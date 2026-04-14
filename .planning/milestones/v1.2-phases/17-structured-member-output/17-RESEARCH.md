# Phase 17: Structured Member Output - Research

**Researched:** 2026-04-14
**Domain:** Wiring Phase 16 domain types into tool output, FQN generation
**Confidence:** HIGH

## Summary

Phase 17 connects the Phase 16 parser infrastructure (TypeReference, MemberReference, parseDetail, import resolver) to the two tools that expose member information: `list_members` and `search_symbols`. The technical challenge is modest -- the hard parsing/resolution work is already done. This phase is primarily about data flow orchestration: building the enrichment pipeline in `list_members` (parse imports, create resolver, parse each member's detail string, attach structured types and FQN) and adding FQN derivation in `search_symbols`.

The key architectural question is where to place the enrichment logic. The CONTEXT.md decisions call for EnrichedSymbol discriminated union types and a `buildMemberFqn` pure function. The enrichment should be a separate module that takes TransformedSymbol trees plus context (source text, entry path, EntryIndex) and returns EnrichedSymbol trees.

**Primary recommendation:** Create `src/browsing/member-enrichment.ts` with enrichSymbols() that takes TransformedSymbol[], source text, entry path, and resolvePackage callback, and returns EnrichedSymbol[]. Create `src/browsing/member-fqn.ts` with buildMemberFqn(). Wire into list_members after transformSymbol, and add memberFqn to search_symbols using containerName.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- FQN format: `{classFqn}#{memberName}()` for methods/constructors, `{classFqn}#{memberName}:` for fields
- Hash `#` separator between class FQN and member name
- Class portion is always the full FQN (e.g., `net.minecraft.client.MinecraftClient#tick()`)
- No parameter types in parens -- just `()` for all methods/constructors
- Constructors use the class simple name: `net.minecraft.client.MinecraftClient#MinecraftClient()`
- Fields use trailing colon: `net.minecraft.client.MinecraftClient#instance:`
- FQN applies to methods, constructors, fields, constants, and enum members only -- classes/interfaces/enums/packages do not get memberFqn
- Constants and enum members treated as fields (colon suffix)
- `buildMemberFqn(classFqn, memberName, memberKind)` as a pure domain function, not inline in tools
- list_members: derive class FQN from the entry path via EntryIndex lookup
- search_symbols: use `containerName` from JDT LS workspace/symbol results directly
- Inline flat fields: methods get `parameters: ParameterInfo[]` and `returnType: TypeReference | null`, fields get `fieldType: TypeReference`
- Keep existing `detail` string for backward compatibility
- Add `memberFqn` field
- EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol as discriminated union by `kind`
- No nullable fields -- each variant has exactly what it needs
- Children are recursive: nested members also get enriched types and FQNs
- search_symbols: add `memberFqn` field only (no structured types)
- memberFqn is null for non-method/field results
- `createResolvePackage(entryIndex: EntryIndex)` added to `src/browsing/import-resolver.ts`

### Claude's Discretion
- How to efficiently parse detail strings for all members in a class (batching, caching resolvers)
- Whether to create an enrichment helper function or inline the transformation
- Error handling when parseDetail returns null (symbol kinds without detail strings)
- Test fixture design for integration tests

### Deferred Ideas (OUT OF SCOPE)
- FQN-based tool input (accepting member FQNs in find_references, find_definition, etc.) -- deferred to v1.3
- Generic type arguments on ClassType (typeArguments[]) -- deferred
- Parameter types in FQN for overload disambiguation -- decided against for now
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-03 | search_symbols results include member FQN (`Class;method()` format) | buildMemberFqn function + containerName from workspace/symbol provides all data needed. Note: CONTEXT.md changed format from semicolon to hash separator. |
| TYPE-03 | list_members output enriched with structured MemberReference types | parseDetail + createTypeResolver + extractImports from Phase 16 provide the parser pipeline; enrichment module wires them together per class. |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.7+ | Primary language | Already in use |
| vitest | 3.x | Testing | Already configured, tests exist for both tools |

### No new dependencies needed

This phase adds no new libraries. All building blocks exist in Phase 16's output modules. The work is pure TypeScript domain logic and tool wiring.

## Architecture Patterns

### New Files

```
src/browsing/
  member-fqn.ts          # buildMemberFqn() pure function
  member-enrichment.ts   # enrichSymbols() pipeline: TransformedSymbol[] -> EnrichedSymbol[]
```

### Modified Files

```
src/browsing/types.ts           # Add EnrichedSymbol union types
src/browsing/import-resolver.ts # Add createResolvePackage(entryIndex)
src/tools/list-members.ts       # Wire enrichment after transformSymbol
src/tools/search-symbols.ts     # Add memberFqn to transformed results
```

### Pattern 1: Member FQN Construction

**What:** Pure function that builds a member FQN string from class FQN, member name, and kind.
**When to use:** In both list_members (from entry path) and search_symbols (from containerName).

```typescript
// src/browsing/member-fqn.ts

const FIELD_KINDS = new Set(["field", "constant", "enumMember"]);
const METHOD_KINDS = new Set(["method", "constructor"]);

export function buildMemberFqn(
	classFqn: string,
	memberName: string,
	memberKind: string,
): string | null {
	if (METHOD_KINDS.has(memberKind)) {
		return `${classFqn}#${memberName}()`;
	}
	if (FIELD_KINDS.has(memberKind)) {
		return `${classFqn}#${memberName}:`;
	}
	return null;  // classes, interfaces, etc. don't get FQN
}
```

Key details:
- Method names from JDT LS DocumentSymbol already include `()` in sym.name (e.g., `run()`) -- the buildMemberFqn function must NOT double-append. Strip trailing `()` from memberName before appending.
- Actually, looking at the test fixture: `name: 'run()'` -- yes, DocumentSymbol names for methods include `()`. The function needs to handle this. search_symbols SymbolInformation names may or may not include parens.

**CRITICAL FINDING:** In the list-members test, the DocumentSymbol response has `name: 'run()'` with parens already in the name. The `buildMemberFqn` function must strip trailing `()` from the member name before building the FQN, then re-append the appropriate suffix. This prevents `MinecraftClient#run()()`.

### Pattern 2: EnrichedSymbol Discriminated Union

**What:** Type-safe output types that extend TransformedSymbol with structured data.

```typescript
// In src/browsing/types.ts

export interface EnrichedMethodSymbol extends TransformedSymbol {
	memberFqn: string;
	parameters: ParameterInfo[];
	returnType: TypeReference | null;
	children: EnrichedSymbol[];
}

export interface EnrichedFieldSymbol extends TransformedSymbol {
	memberFqn: string;
	fieldType: TypeReference;
	children: EnrichedSymbol[];
}

export interface EnrichedClassSymbol extends TransformedSymbol {
	children: EnrichedSymbol[];
}

export type EnrichedSymbol = EnrichedMethodSymbol | EnrichedFieldSymbol | EnrichedClassSymbol;
```

Discrimination is by `kind` field inherited from TransformedSymbol:
- `kind === "method" || kind === "constructor"` -> EnrichedMethodSymbol
- `kind === "field" || kind === "constant" || kind === "enumMember"` -> EnrichedFieldSymbol
- Everything else -> EnrichedClassSymbol

### Pattern 3: Enrichment Pipeline for list_members

**What:** A function that takes the TransformedSymbol tree and source context, returns EnrichedSymbol tree.

```typescript
// src/browsing/member-enrichment.ts

export async function enrichSymbols(
	symbols: TransformedSymbol[],
	sourceText: string,
	classFqn: string,
	resolvePackage: (packageName: string) => Promise<string[]>,
): Promise<EnrichedSymbol[]> {
	// 1. Extract imports once for the whole file
	const imports = extractImports(sourceText);
	// 2. Create resolver once (it caches star import lookups)
	const resolveType = createTypeResolver(imports, resolvePackage);
	// 3. Recursively enrich each symbol
	return Promise.all(symbols.map(sym => enrichOne(sym, classFqn, resolveType)));
}
```

The resolver is created once per class file, so star import resolution is cached across all members in the class. This is efficient -- no per-member overhead for import parsing.

### Pattern 4: Class FQN Derivation

**What:** Converting entry path to class FQN for list_members.

```typescript
// entryPath: "net/minecraft/client/MinecraftClient.java"
// classFqn:  "net.minecraft.client.MinecraftClient"
function entryPathToFqn(entryPath: string): string {
	return entryPath.replace(/\.java$/, '').replaceAll('/', '.');
}
```

This is the inverse of `classNameToEntryPath` already in tool-helpers.ts.

### Pattern 5: createResolvePackage Bridge

**What:** Bridge function connecting EntryIndex.getClasses() to the resolvePackage callback signature.

```typescript
// Added to src/browsing/import-resolver.ts

export function createResolvePackage(
	entryIndex: EntryIndex,
): (packageName: string) => Promise<string[]> {
	return async (packageName: string): Promise<string[]> => {
		const entries = entryIndex.getClasses(packageName);
		return entries.map(e => e.className);
	};
}
```

The EntryIndex already indexes ALL loaded jars per project (Minecraft, Fabric API, dependencies, study jars), so this naturally searches everything.

### Pattern 6: search_symbols FQN Addition

**What:** Adding memberFqn to search_symbols output using containerName.

In `search_symbols`, the workspace/symbol response includes `containerName` (the containing class FQN). The FQN is built as:

```typescript
const transformed = page.map((sym: any) => {
	const kindName = SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`;
	const memberFqn = buildMemberFqn(
		sym.containerName ?? '',
		sym.name,
		kindName,
	);
	// ... rest of transformation
	return { ...existing, memberFqn };
});
```

Note: `containerName` from workspace/symbol is already a dot-separated FQN like `net.minecraft.client.MinecraftClient`.

### Anti-Patterns to Avoid
- **Double-appending parens on method names:** DocumentSymbol names include `()` already. Must strip before FQN construction.
- **Parsing imports per member:** Extract imports ONCE per file, create resolver ONCE, reuse for all members.
- **Failing on null parseDetail results:** Classes, interfaces, enums have detail strings that parseDetail returns null for. EnrichedClassSymbol handles this -- just pass through without structured types.
- **Blocking on async in tight loops:** Use Promise.all for parallel member enrichment, not sequential await.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type name resolution | Custom FQN lookup | Phase 16's createTypeResolver + extractImports | Already handles 7-stage cascade with caching |
| Detail string parsing | Regex on detail strings | Phase 16's parseDetail() | Handles generics, annotations, varargs, arrays |
| Package class lookup | Manual jar scanning | EntryIndex.getClasses() | Already indexed on jar load |

## Common Pitfalls

### Pitfall 1: DocumentSymbol Method Names Include Parens
**What goes wrong:** Building FQN as `classFqn#run()()` with doubled parens.
**Why it happens:** JDT LS DocumentSymbol uses `name: "run()"` for methods, but the FQN scheme also appends `()`.
**How to avoid:** Strip trailing `()` from the name before passing to buildMemberFqn, or handle it inside buildMemberFqn.
**Warning signs:** FQN strings with `()()` in test output.

### Pitfall 2: Nested Classes in the Symbol Tree
**What goes wrong:** Inner class members get the outer class FQN instead of their own.
**Why it happens:** DocumentSymbol is hierarchical -- inner classes appear as children of the outer class.
**How to avoid:** When recursing into an EnrichedClassSymbol's children, if the child is itself a class/interface/enum, update the classFqn for its descendants. Build the inner class FQN as `outerFqn$InnerName`.
**Warning signs:** All members of inner classes showing the outer class in their FQN.

### Pitfall 3: search_symbols Name Format Differs
**What goes wrong:** Assuming workspace/symbol names have the same format as DocumentSymbol names.
**Why it happens:** workspace/symbol SymbolInformation and textDocument/documentSymbol DocumentSymbol format names differently.
**How to avoid:** Test with real JDT LS output. The name in SymbolInformation for methods may or may not include parens -- verify against actual response format. The existing search_symbols test has `name: "tick()"` so it does include parens.
**Warning signs:** Missing or doubled parens in search_symbols FQNs.

### Pitfall 4: Source Text Not Available for search_symbols
**What goes wrong:** Trying to parse imports/details for search_symbols enrichment.
**Why it happens:** workspace/symbol does not include source text or detail strings.
**How to avoid:** Per CONTEXT.md decision: search_symbols gets memberFqn ONLY, no structured types. Don't try to add ParameterInfo/returnType/fieldType to search_symbols.

### Pitfall 5: Enum Members and Constants
**What goes wrong:** Enum values and constants not getting FQN because their kind isn't in the field set.
**Why it happens:** Forgetting that constants (kind 14) and enumMembers (kind 22) are treated as fields per CONTEXT.md.
**How to avoid:** FIELD_KINDS set must include "constant" and "enumMember" in addition to "field".

### Pitfall 6: entryPath for Inner Classes
**What goes wrong:** Inner class entry paths like `net/minecraft/client/MinecraftClient$Options.java` producing FQN `net.minecraft.client.MinecraftClient$Options` instead of `net.minecraft.client.MinecraftClient.Options`.
**Why it happens:** Entry paths use `$` for inner classes in filenames.
**How to avoid:** For list_members, the entry path is always a top-level class (the one requested). Inner class FQNs are derived from the DocumentSymbol tree hierarchy, not from entry paths. The entryPath-derived classFqn is always the outer class.

## Code Examples

### Full Enrichment Flow in list_members

```typescript
// After transforming symbols but before building the envelope:
const classFqn = entryPath.replace(/\.java$/, '').replaceAll('/', '.');
const resolvePackage = createResolvePackage(loadedProject.entryIndex);
const enriched = await enrichSymbols(members, sourceText, classFqn, resolvePackage);

const envelope = makeSuccess(
	{ jar: sourceJarId, class: className, members: enriched },
	{ provenance },
);
```

### Recursive Enrichment of a Single Symbol

```typescript
async function enrichOne(
	sym: TransformedSymbol,
	classFqn: string,
	resolveType: (name: string) => Promise<TypeReference>,
): Promise<EnrichedSymbol> {
	const enrichedChildren = await Promise.all(
		sym.children.map(child => {
			// If child is a class/interface/enum, update classFqn for its descendants
			if (['class', 'interface', 'enum'].includes(child.kind)) {
				const innerFqn = `${classFqn}$${child.name}`;
				return enrichOne(child, innerFqn, resolveType);
			}
			return enrichOne(child, classFqn, resolveType);
		})
	);

	const parsed = await parseDetail(sym.detail, sym.kind, resolveType);

	if (parsed?.kind === 'method') {
		const memberFqn = buildMemberFqn(classFqn, sym.name, sym.kind)!;
		return {
			...sym,
			memberFqn,
			parameters: parsed.parameters,
			returnType: parsed.returnType,
			children: enrichedChildren,
		};
	}

	if (parsed?.kind === 'field') {
		const memberFqn = buildMemberFqn(classFqn, sym.name, sym.kind)!;
		return {
			...sym,
			memberFqn,
			fieldType: parsed.fieldType,
			children: enrichedChildren,
		};
	}

	// Class-level symbol or unsupported kind
	return { ...sym, children: enrichedChildren };
}
```

### search_symbols FQN Addition

```typescript
const transformed = page.map((sym: any) => {
	const kindName = SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`;
	const memberFqn = sym.containerName
		? buildMemberFqn(sym.containerName, sym.name, kindName)
		: null;
	const mapping = uriMapper.fromFileUri(sym.location.uri);
	return {
		name: sym.name,
		kind: kindName,
		containerName: sym.containerName ?? null,
		memberFqn,
		deprecated: sym.tags?.includes(1) ?? false,
		location: {
			uri: sym.location.uri,
			jar: mapping?.jar ?? null,
			line: sym.location.range.start.line + 1,
			column: sym.location.range.start.character + 1,
		},
	};
});
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TYPE-03 | list_members returns EnrichedSymbol with parameters/returnType/fieldType/memberFqn | unit | `npx vitest run tests/browsing/member-enrichment.test.ts -x` | No -- Wave 0 |
| TYPE-03 | list_members tool integration returns enriched output | unit | `npx vitest run tests/tools/list-members.test.ts -x` | Yes -- needs new test cases |
| SRCH-03 | search_symbols includes memberFqn in results | unit | `npx vitest run tests/tools/search-symbols.test.ts -x` | Yes -- needs new test cases |
| TYPE-03 | buildMemberFqn produces correct format | unit | `npx vitest run tests/browsing/member-fqn.test.ts -x` | No -- Wave 0 |
| TYPE-03 | createResolvePackage bridges EntryIndex correctly | unit | `npx vitest run tests/browsing/import-resolver.test.ts -x` | Yes -- needs new test cases |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `tests/browsing/member-fqn.test.ts` -- covers buildMemberFqn with all kind variants, parens stripping
- [ ] `tests/browsing/member-enrichment.test.ts` -- covers enrichSymbols with mock resolver, nested classes, field/method/class variants
- [ ] New test cases in `tests/tools/list-members.test.ts` -- verify enriched output shape
- [ ] New test cases in `tests/tools/search-symbols.test.ts` -- verify memberFqn on method results, null on class results

## Open Questions

1. **Does buildMemberFqn need to handle names with parens AND without?**
   - What we know: DocumentSymbol names include `()` (e.g., `run()`), but workspace/symbol names also include `()` based on test fixtures (e.g., `tick()`)
   - What's unclear: Whether ALL method names from both sources always include `()`, or only sometimes
   - Recommendation: Strip trailing `()` unconditionally in buildMemberFqn before re-appending, making it idempotent regardless of input format

2. **How should EntryIndex be accessed from list_members?**
   - What we know: `loadedProject` has access to dependency data, but EntryIndex may not be directly on it
   - What's unclear: The exact path from LoadedProject to a unified EntryIndex covering all jars
   - Recommendation: Investigate LoadedProject structure during implementation; may need to build a combined EntryIndex from all project dependencies

3. **Inner class FQN separator in member FQN**
   - What we know: Java uses `$` for inner classes in bytecode, `.` in source
   - What's unclear: Whether FQN should use `net.minecraft.client.MinecraftClient$Options#method()` or `net.minecraft.client.MinecraftClient.Options#method()`
   - Recommendation: Use `$` to match Java convention and be consistent with ClassReference FQN format elsewhere in the codebase

## Sources

### Primary (HIGH confidence)
- `src/browsing/member-types.ts` -- TypeReference and MemberReference types (read directly)
- `src/browsing/detail-parser.ts` -- parseDetail implementation (read directly)
- `src/browsing/import-resolver.ts` -- extractImports, createTypeResolver (read directly)
- `src/browsing/entry-index.ts` -- EntryIndex.getClasses() API (read directly)
- `src/tools/list-members.ts` -- current tool implementation (read directly)
- `src/tools/search-symbols.ts` -- current tool implementation (read directly)
- `src/browsing/types.ts` -- TransformedSymbol type (read directly)
- `tests/tools/list-members.test.ts` -- existing test patterns and mock fixtures (read directly)
- `tests/tools/search-symbols.test.ts` -- existing test patterns (read directly)
- `tests/browsing/detail-parser.test.ts` -- test fixture patterns (read directly)

### Secondary (MEDIUM confidence)
- LSP 3.17 specification -- SymbolKind enum values, DocumentSymbol vs SymbolInformation distinction

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all Phase 16 outputs verified in source
- Architecture: HIGH -- patterns follow existing codebase conventions, data flow traced through actual code
- Pitfalls: HIGH -- identified from reading actual JDT LS response formats in test fixtures

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- internal wiring, no external dependencies)
