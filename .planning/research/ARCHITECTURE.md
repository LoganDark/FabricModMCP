# Architecture Patterns

**Domain:** Symbol resolution features for MCP server (v1.2)
**Researched:** 2026-04-14

## Recommended Architecture

This milestone adds method/field first-class citizenship to an existing layered architecture. The changes are surgical: one JDT LS config fix, new domain types, a member FQN scheme, and enriched tool outputs. No new tools are needed -- existing tools gain richer return types.

### Integration Overview

```
Existing layer          What changes                      Why
--------------------    --------------------------------  -------------------------
jdtls/client.ts         Add initializationOptions setting One-line config fix
browsing/types.ts       New MemberReference type          Structured method/field representation
browsing/types.ts       MemberFqn type alias              FQN scheme for members
jdtls/types.ts          (no changes needed)               NavigationResult already sufficient
tools/search-symbols.ts Richer transform for method/field results  Methods now appear in results
tools/list-members.ts   Parse detail string into MemberReference   Structured output
tools/get-symbol-info.ts Accept member FQN, resolve to position    Inspection parity
tools/find-definition.ts Accept member FQN (future)       Same pattern
tool-helpers.ts         Member FQN parser utility          Shared across tools
descriptions.ts         Updated descriptions + FQN docs   User-facing documentation
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `jdtls/client.ts` | JDT LS process lifecycle, LSP init settings | JDT LS process (stdio) |
| `browsing/types.ts` | Domain type definitions (ClassReference, MemberReference, MemberFqn) | All tools, all domain modules |
| `browsing/member-parser.ts` (NEW) | Parse JDT LS detail strings into structured MemberReference | `tools/list-members.ts`, `tools/search-symbols.ts` |
| `tools/search-symbols.ts` | Workspace symbol search via `workspace/symbol` | `jdtls/client.ts` endpoint, `browsing/member-parser.ts` |
| `tools/list-members.ts` | Document symbol listing via `textDocument/documentSymbol` | `jdtls/client.ts` client, `browsing/member-parser.ts` |
| `tools/get-symbol-info.ts` | Hover info for any symbol (class or member) | `jdtls/client.ts` client, member FQN resolver |
| `tools/tool-helpers.ts` | Shared utilities including member FQN parsing | All tool files |

### Data Flow

**Current flow (search_symbols):**
```
query -> workspace/symbol -> SymbolInformation[] -> transform(name, kind, location) -> response
```
Currently only returns types because `includeSourceMethodDeclarations` is not enabled.

**New flow (search_symbols with methods):**
```
query -> workspace/symbol -> SymbolInformation[] (now includes methods)
  -> transform: for each result:
     if method/constructor: parse containerName to get owning class, build member FQN
     if field: (not returned by workspace/symbol -- JDT LS limitation)
     if type: existing behavior
  -> response with memberFqn field on method/field results
```

**Current flow (list_members):**
```
class FQN -> resolve source -> didOpen -> textDocument/documentSymbol -> DocumentSymbol[]
  -> transformSymbol(name, kind, detail, range, children) -> response
```
`detail` is a raw string like `"void"` for fields or `"(BlockPos) : BlockState"` for methods.

**New flow (list_members with MemberReference):**
```
class FQN -> resolve source -> didOpen -> textDocument/documentSymbol -> DocumentSymbol[]
  -> transformSymbol + parseMemberDetail:
     For methods: parse detail "(BlockPos, int) : BlockState" into {
       parameters: [{ name: "BlockPos", fqn: "net.minecraft.util.math.BlockPos", kind: "class" }],
       returnType: { name: "BlockState", fqn: "net.minecraft.block.BlockState", kind: "class" }
     }
     For fields: parse detail "BlockState" into {
       type: { name: "BlockState", fqn: "net.minecraft.block.BlockState", kind: "class" }
     }
  -> response with structured MemberReference
```

**Member FQN resolution flow (new):**
```
"net.minecraft.client.MinecraftClient;tick()" -> parse:
  class = "net.minecraft.client.MinecraftClient"
  member = "tick"
  kind = method (has parens)

-> resolve class source (existing resolveClassSource)
-> find member position within source (cascading regex with generated patterns)
-> feed to existing LSP tools (hover, definition, references)
```

## New Types

### MemberReference (in `browsing/types.ts`)

```typescript
/**
 * Structured representation of a method or field with resolved type references.
 * Extends the existing ClassReference pattern used in type_hierarchy.
 */

export interface ParameterInfo {
	name: string;           // parameter name (from source if available, positional otherwise)
	type: ClassReference;   // resolved type reference
}

export interface MethodReference {
	kind: 'method' | 'constructor';
	name: string;                    // method name
	fqn: string;                     // "net.minecraft.client.MinecraftClient;tick()"
	parameters: ParameterInfo[];     // ordered parameter list with types
	returnType: ClassReference | null; // null for constructors and void
	deprecated: boolean;
	modifiers: string[];             // ["public", "final", etc.]
}

export interface FieldReference {
	kind: 'field';
	name: string;                    // field name
	fqn: string;                     // "net.minecraft.client.MinecraftClient;world:"
	type: ClassReference;            // resolved type reference
	deprecated: boolean;
	modifiers: string[];             // ["private", "final", etc.]
}

export type MemberReference = MethodReference | FieldReference;
```

### Member FQN Scheme

```typescript
/**
 * Member FQN format:
 *   Methods:      "net.minecraft.foo.Bar;method()"
 *   Constructors: "net.minecraft.foo.Bar;<init>()"
 *   Fields:       "net.minecraft.foo.Bar;field:"
 *
 * The semicolon separates class FQN from member name.
 * Trailing () indicates method/constructor. Trailing : indicates field.
 * No parameter types in the FQN -- disambiguation handled by cascading regex
 * when overloads exist (this matches how users actually think about members).
 */

export interface ParsedMemberFqn {
	classFqn: string;        // "net.minecraft.foo.Bar"
	memberName: string;      // "method" or "field"
	memberKind: 'method' | 'field';  // determined by suffix
}

export function parseMemberFqn(fqn: string): ParsedMemberFqn | null {
	const semiIdx = fqn.indexOf(';');
	if (semiIdx === -1) return null;  // plain class FQN, not a member

	const classFqn = fqn.substring(0, semiIdx);
	const memberPart = fqn.substring(semiIdx + 1);

	if (memberPart.endsWith('()')) {
		return { classFqn, memberName: memberPart.slice(0, -2), memberKind: 'method' };
	}
	if (memberPart.endsWith(':')) {
		return { classFqn, memberName: memberPart.slice(0, -1), memberKind: 'field' };
	}
	return null;
}
```

### Why This FQN Scheme

The semicolon separator was chosen deliberately:
- Dots are used within class FQNs (`net.minecraft.foo.Bar`)
- Hash (`#`) is common in Javadoc but conflicts with shell escaping
- Semicolon is used in JVM internal signatures and is unambiguous here
- No parameter types in the FQN because: (a) overloaded methods are rare enough that cascading regex handles disambiguation, (b) encoding parameter types in FQNs adds complexity for marginal benefit, (c) the FQN is for human use and tool input, not a unique identifier

## Modifications to Existing Components

### 1. `jdtls/client.ts` -- Enable Method Declarations in workspace/symbol

**Change:** Add `includeSourceMethodDeclarations: true` to initialization settings.

**Location:** `startJdtLs()` function, line ~221, `initializationOptions.settings.java` object.

```typescript
initializationOptions: {
	settings: {
		java: {
			autobuild: { enabled: true },
			symbols: {
				includeSourceMethodDeclarations: true,  // NEW
			},
			import: {
				maven: { enabled: false },
				gradle: { enabled: false },
			},
		},
	},
},
```

**Impact:** After this change, `workspace/symbol` returns `SymbolInformation` items with `kind: 6` (method), `kind: 9` (constructor) in addition to type kinds. The `containerName` field on these items contains the owning class FQN.

**Risk:** Performance. The JDT LS team disabled this by default for performance reasons. With ~6,600 source files, queries like `"*"` or short strings may return very large result sets. The existing `limit` parameter on `search_symbols` (default 50, max 200) provides pagination, but JDT LS still computes the full result set server-side.

**Mitigation:** The existing pagination in `search_symbols` already handles this. Monitor response times. If problematic, add a minimum query length validation (e.g., require 2+ characters).

**Note on fields:** `includeSourceMethodDeclarations` does NOT include fields in `workspace/symbol` results. Fields are only available via `textDocument/documentSymbol` (which `list_members` already uses). This is a JDT LS limitation, not a bug. The `search_symbols` tool can filter by `kind: 'field'` but will return no results for fields -- this should be documented clearly in the tool description.

### 2. `tools/search-symbols.ts` -- Enrich Method Results

**What changes:**
- Transform method/constructor results to include `containerName` as the owning class
- Add `memberFqn` field to method results using the FQN scheme
- Existing kind filtering already supports `'method'`, `'constructor'`, `'field'` -- no schema change needed

**New output shape per result:**
```typescript
{
	name: "tick",                           // existing
	kind: "method",                         // existing (now actually appears)
	containerName: "net.minecraft.client.MinecraftClient",  // existing field, now meaningful
	deprecated: false,                      // existing
	memberFqn: "net.minecraft.client.MinecraftClient;tick()",  // NEW
	location: { ... },                      // existing
}
```

### 3. `tools/list-members.ts` -- Structured Member Output

**What changes:**
- Import and use new `browsing/member-parser.ts` to parse `detail` strings
- Add `memberFqn` to each member in output
- Add structured type info (parameters, returnType for methods; type for fields)
- The existing `TransformedSymbol` type gains optional structured fields

**Approach:** Extend `TransformedSymbol` rather than replace it. Add optional `memberFqn`, `parameters`, `returnType`, `fieldType` fields. This preserves backward compatibility -- the `detail` string remains as-is for tools/humans that want the raw form.

```typescript
// Extended TransformedSymbol in browsing/types.ts
export interface TransformedSymbol {
	name: string;
	kind: string;
	detail: string | null;
	deprecated: boolean;
	range: { ... };
	selectionRange: { ... };
	children: TransformedSymbol[];
	// NEW optional fields for v1.2:
	memberFqn?: string;             // "OwningClass;name()" or "OwningClass;name:"
	parameters?: ParameterInfo[];   // for methods/constructors
	returnType?: ClassReference | null;  // for methods
	fieldType?: ClassReference;     // for fields
	modifiers?: string[];           // ["public", "static", "final"]
}
```

### 4. `tools/get-symbol-info.ts` -- Accept Member FQN

**What changes:**
- Accept either a class FQN + patterns (existing) or a member FQN + optional patterns
- When member FQN is provided without patterns, auto-generate cascading regex patterns to locate the member

**Auto-generated patterns for member FQN:**
```typescript
// For "net.minecraft.client.MinecraftClient;tick()"
// Auto-generate: ["\\btick\\s*\\(", "tick"]
// The first pattern finds the method declaration, the second narrows to the name

// For "net.minecraft.client.MinecraftClient;world:"
// Auto-generate: ["\\bworld\\s*[=;]", "world"]  or  ["\\bworld\\b", "world"]
```

This is a convenience layer. Users can still provide explicit `patterns` to disambiguate overloads or target specific usages.

### 5. New Module: `browsing/member-parser.ts`

**Purpose:** Parse JDT LS `detail` strings from `DocumentSymbol` into structured types.

**Input formats from JDT LS:**
- Methods: `"(BlockPos, int) : BlockState"` or `"(String, boolean) : void"` or `"() : void"`
- Constructors: `"(BlockPos)"` (no return type)
- Fields: `"BlockState"` or `"int"` or `"Map<BlockPos, BlockState>"`
- Enum constants: (no detail or empty)

**Key challenge:** The `detail` string uses simple names, not FQNs. Resolving `"BlockPos"` to `"net.minecraft.util.math.BlockPos"` requires:
1. Parsing import statements from the source file (already read by `list_members`)
2. Mapping simple names to FQNs via the imports
3. Handling primitives (`int`, `boolean`, `void`) -- no ClassReference, just the name
4. Handling generics (`Map<BlockPos, BlockState>`) -- strip type params for the ClassReference, preserve in display

**Implementation plan:**
```typescript
export interface ParsedDetail {
	parameters?: Array<{ typeName: string; resolved?: ClassReference }>;
	returnType?: { typeName: string; resolved?: ClassReference } | null;
	fieldType?: { typeName: string; resolved?: ClassReference };
}

/**
 * Parse a JDT LS detail string into structured type info.
 *
 * @param detail - The raw detail string from DocumentSymbol
 * @param kind - The symbol kind (method, field, constructor, etc.)
 * @param imports - Map of simple name -> FQN from source file imports
 */
export function parseDetail(
	detail: string | null,
	kind: string,
	imports: Map<string, string>,
): ParsedDetail;

/**
 * Extract import map from Java source text.
 * Maps simple class names to their FQNs.
 */
export function extractImportMap(sourceText: string): Map<string, string>;
```

### 6. `tools/tool-helpers.ts` -- Member FQN Utilities

**Add:**
- `parseMemberFqn()` function (as defined in types section above)
- `generateMemberPatterns(memberName: string, memberKind: 'method' | 'field'): string[]` -- auto-generate cascading regex patterns from a member name

## New Module vs Modified Module Summary

| Path | Status | Description |
|------|--------|-------------|
| `browsing/types.ts` | MODIFIED | Add MemberReference, MethodReference, FieldReference, ParameterInfo, ParsedMemberFqn |
| `browsing/member-parser.ts` | NEW | Parse JDT LS detail strings + extract import maps |
| `jdtls/client.ts` | MODIFIED | One line: add `symbols.includeSourceMethodDeclarations: true` |
| `tools/search-symbols.ts` | MODIFIED | Add memberFqn to method/constructor results |
| `tools/list-members.ts` | MODIFIED | Parse details into structured types, add memberFqn |
| `tools/get-symbol-info.ts` | MODIFIED | Accept member FQN, auto-generate patterns |
| `tools/tool-helpers.ts` | MODIFIED | Add parseMemberFqn(), generateMemberPatterns() |
| `tools/descriptions.ts` | MODIFIED | Update descriptions, document FQN scheme |

## Patterns to Follow

### Pattern 1: Extend Existing Types, Don't Replace

**What:** Add optional fields to `TransformedSymbol` and `ClassReference` rather than creating parallel type hierarchies.
**When:** Adding structured data to existing tool outputs.
**Why:** Preserves backward compatibility. Consumers that don't know about new fields keep working. Avoids type explosion.

### Pattern 2: Domain Module for Parsing, Tool Module for Wiring

**What:** Put detail string parsing in `browsing/member-parser.ts`, not in the tool file.
**When:** Adding any non-trivial logic that transforms data.
**Why:** Follows the established domain-tool separation. `member-parser.ts` is testable in isolation with unit tests against known JDT LS output strings. The tool file stays thin.

### Pattern 3: Graceful Degradation for Type Resolution

**What:** When a type name can't be resolved to a FQN (missing import, primitive, generic parameter), still return what you have.
**When:** Parsing detail strings into ClassReferences.
**Why:** Partial information is better than no information. A ClassReference with `fqn: "BlockPos"` (unresolved) and `name: "BlockPos"` is still useful. The `kind` can be `"unresolved"` to signal this.

```typescript
// Graceful degradation example
function resolveTypeName(simpleName: string, imports: Map<string, string>): ClassReference {
	// Primitives
	if (['int', 'long', 'float', 'double', 'boolean', 'byte', 'short', 'char', 'void'].includes(simpleName)) {
		return { name: simpleName, fqn: simpleName, kind: 'primitive' };
	}
	// Check imports
	const fqn = imports.get(simpleName);
	if (fqn) {
		return { name: simpleName, fqn, kind: 'class' };
	}
	// java.lang types
	const javaLangTypes = ['String', 'Object', 'Integer', 'Long', 'Float', 'Double',
		'Boolean', 'Byte', 'Short', 'Character', 'Void', 'Class', 'Enum', 'Record',
		'Throwable', 'Exception', 'RuntimeException', 'Error', 'Override', 'Deprecated',
		'SuppressWarnings', 'Iterable', 'Comparable', 'Cloneable', 'AutoCloseable',
		'Thread', 'Runnable', 'Math', 'System', 'StringBuilder', 'Number'];
	if (javaLangTypes.includes(simpleName)) {
		return { name: simpleName, fqn: `java.lang.${simpleName}`, kind: 'class' };
	}
	// Same-package types (no import needed in Java)
	// Cannot resolve without knowing the package -- mark unresolved
	return { name: simpleName, fqn: simpleName, kind: 'unresolved' };
}
```

### Pattern 4: FQN as Primary Identifier, Patterns as Disambiguator

**What:** Member FQN (`Class;method()`) is the primary way to reference a member. Cascading regex patterns are the escape hatch for overloaded methods or unusual cases.
**When:** Any tool that accepts a member target.
**Why:** FQNs are deterministic and composable (output of one tool feeds input of another). Patterns are powerful but require knowledge of the source. Using FQN-first with patterns-as-fallback gives the best UX.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate "Member Info" Tool

**What:** Creating a new `get_member_info` tool alongside `get_symbol_info`.
**Why bad:** Tool proliferation. Claude already has 25 tools. The existing `get_symbol_info` can accept a member FQN via the `class` parameter (parsing semicolons) and use the same hover mechanism. A member FQN naturally decomposes into a class FQN + cascading regex patterns.
**Instead:** Extend `get_symbol_info` to understand member FQNs. Document the FQN scheme in the tool description.

### Anti-Pattern 2: Full Signature in FQN

**What:** Encoding parameter types in the FQN: `"Bar;method(BlockPos,int)"`
**Why bad:** Requires knowing exact parameter types before you can reference a method. Users discovering methods via `list_members` or `search_symbols` would need to copy exact signatures. Overloads are rare enough in Minecraft code that cascading regex handles disambiguation.
**Instead:** Simple `Class;method()` scheme. If overloads exist, user adds patterns to disambiguate.

### Anti-Pattern 3: Resolving All Types Eagerly via LSP

**What:** For every member in `list_members`, making additional LSP hover calls to resolve each parameter and return type to a full ClassReference with validated FQN.
**Why bad:** A class with 50 methods and 3 parameters each = 150+ LSP calls. Massive latency.
**Instead:** Parse detail strings synchronously (they're already in memory). Resolve types from the import map (already read for the source). Accept `"unresolved"` gracefully. No additional LSP calls.

### Anti-Pattern 4: Changing ClassReference to Support Members

**What:** Adding method/field fields to `ClassReference` to make it a "universal reference".
**Why bad:** `ClassReference` is used extensively in `type_hierarchy` and represents a type, not a member. Conflating types and members creates confused semantics.
**Instead:** `MemberReference` is a separate union type (`MethodReference | FieldReference`). Both use `ClassReference` for their types but they are distinct concepts.

## Build Order (Suggested Phase Structure)

### Phase 1: Enable Method Declarations + Update search_symbols

**Dependencies:** None (standalone config change + transform update)
**Changes:**
1. `jdtls/client.ts` -- add `symbols.includeSourceMethodDeclarations: true`
2. `tools/search-symbols.ts` -- add `memberFqn` to method/constructor results
3. `tools/descriptions.ts` -- update search_symbols description to note method support and field limitation
4. Tests: verify methods appear in workspace/symbol results, verify FQN format

**Why first:** This is the simplest change with the highest visibility. One line of config enables methods in search results. The transform enrichment is straightforward (`containerName` is already in `SymbolInformation`). This unblocks validation that methods actually appear in results before investing in the parser.

### Phase 2: Member Parser + Import Map Extraction

**Dependencies:** None (pure domain module)
**Changes:**
1. NEW `browsing/member-parser.ts` -- detail string parser + import map extractor
2. `browsing/types.ts` -- add ParameterInfo, MethodReference, FieldReference, MemberReference types
3. Tests: unit tests against known JDT LS detail strings, import map extraction from real source files

**Why second:** This is the foundation for structured member output. It's a pure domain module with no I/O, making it easy to test exhaustively before wiring into tools.

### Phase 3: Enrich list_members Output

**Dependencies:** Phase 2 (member-parser)
**Changes:**
1. `browsing/types.ts` -- extend TransformedSymbol with optional structured fields
2. `tools/list-members.ts` -- use member-parser to add structured types to TransformedSymbol
3. Tests: integration tests verifying structured output from list_members

**Why third:** list_members already returns DocumentSymbol data including the `detail` string. This phase enriches that output with the parsed structured types. Natural progression from Phase 2.

### Phase 4: Member FQN Scheme + Tool Integration

**Dependencies:** Phase 2 (types), Phase 3 (enriched list_members for FQN output testing)
**Changes:**
1. `tools/tool-helpers.ts` -- add parseMemberFqn(), generateMemberPatterns()
2. `tools/get-symbol-info.ts` -- accept member FQN in class parameter, auto-generate patterns
3. `tools/descriptions.ts` -- document FQN scheme in server instructions and tool descriptions
4. Tests: member FQN parsing, pattern generation, end-to-end get_symbol_info with member FQN

**Why last:** This depends on the FQN scheme being established (Phase 2 types) and validated (Phase 3 list_members outputs FQNs that feed back into get_symbol_info). The auto-pattern generation needs testing against real source to ensure the generated regex actually finds the right member.

## Scalability Considerations

| Concern | Current (v1.1) | After v1.2 |
|---------|----------------|------------|
| workspace/symbol response size | Types only (~2,000 results for broad queries) | Methods + types (~10,000+ results for broad queries) |
| list_members output size | Raw detail strings | Structured types add ~50% more data per member |
| Type resolution cost | N/A | O(n) import map build per class, O(1) per type lookup |
| Memory | No additional state | Import maps are transient (built per request, not cached) |

The main scalability concern is `workspace/symbol` returning much larger result sets with methods enabled. The existing pagination (default limit 50, max 200) handles this at the API level. JDT LS still computes the full result set internally, but this is a JDT LS-side concern and not something we can optimize from our side.

## Sources

- [nvim-jdtls Discussion #676 on includeSourceMethodDeclarations](https://github.com/mfussenegger/nvim-jdtls/discussions/676) -- confirms setting path and method-only scope (HIGH confidence)
- [LSP-jdtls Sublime Settings](https://github.com/sublimelsp/LSP-jdtls/blob/main/LSP-jdtls.sublime-settings) -- confirms `java.symbols.includeSourceMethodDeclarations` path (HIGH confidence)
- [JDT LS Issue #1712 on partial results](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1712) -- performance considerations for large symbol sets (MEDIUM confidence)
- [DocumentSymbolHandler source](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/master/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/DocumentSymbolHandler.java) -- detail string format reference (HIGH confidence)
- [Eclipse JDT LS GitHub](https://github.com/eclipse-jdtls/eclipse.jdt.ls) -- reference implementation (HIGH confidence)
- Existing codebase analysis: `src/jdtls/client.ts`, `src/tools/search-symbols.ts`, `src/tools/list-members.ts`, `src/tools/get-symbol-info.ts`, `src/browsing/types.ts`, `src/tools/tool-helpers.ts`
