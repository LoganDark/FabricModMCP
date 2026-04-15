# Phase 22: Verbosity Audit - Research

**Researched:** 2026-04-14
**Domain:** MCP tool response size optimization
**Confidence:** HIGH

## Summary

This phase audits and reduces response sizes for the 10 high-volume MCP tools. The core change is philosophical: responses become small by default with opt-in `details` flags to include verbose data. This is a deliberate breaking change accepted by the user because consumers are agents that adapt.

The existing codebase is well-structured for this work. Navigation tools share `processNavigationLocations()` which produces `NavigationResult[]` with a `context: ContextSnippet` field that is the primary size offender. Member tools share `enrichSymbols()` which produces `EnrichedSymbol[]` with parameters, return types, field types, and nested children -- the javadoc-equivalent data lives in the `detail` field from LSP. The `PARAMS` object in `descriptions.ts` and `pagination.ts` establish the pattern for shared parameter schemas.

**Primary recommendation:** Add a shared `details` Zod schema object to `descriptions.ts`, strip fields from responses by default in each tool's handler (post-processing after existing data flows), and verify with real Minecraft project data that the worst offenders (ClientPlayerEntity, GameRenderer) drop below Claude Code's response size limit.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Small by default, opt-in for more detail (NOT compact mode)
- This is a breaking change to structuredContent shapes -- accepted because consumers are agents
- `details` object parameter with per-tool boolean flags, all defaulting to false (= small)
- Per-tool schemas: each tool defines only the flags relevant to it
- Shared supertypes for common flags across tool categories, merged with `&` for tool-specific additions
- Only tools with optional detail fields accept `details` -- tools with nothing to strip don't get it
- Audit scope: find_references, find_implementations, find_definition, search_symbols, search_classes, list_members, list_classes, list_packages, locate_in_source, type_hierarchy
- Skip: read_source, read_member, get_project_metadata, get_symbol_info, project management tools
- Benchmark classes: ClientPlayerEntity and GameRenderer
- Audit measures structuredContent sizes only (text summaries are fine as-is)
- Success criteria #4 (backward compat) is reinterpreted: the NEW default is small; old behavior requires passing `details` flags

### Claude's Discretion
- Exact shared supertype hierarchy for detail flags
- Which fields constitute "essential" vs "detail" per tool
- Audit report format and placement
- Whether to consolidate any tools' detail flags after seeing audit data
- How to handle list_classes, list_packages, type_hierarchy detail flags (may not need any)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VERB-01 | Audit all search and navigation tool outputs with real Minecraft project data to measure response sizes | Audit methodology defined: use JSON.stringify on structuredContent envelope, measure byte length, benchmark with ClientPlayerEntity and GameRenderer |
| VERB-02 | Reduce default verbosity where safe (no breaking changes to structuredContent shape) | CONTEXT.md overrides this: breaking changes are accepted. Default becomes small. Fields identified per tool category below. |
| VERB-03 | Add compact/verbose mode controls to tools identified as worst offenders in the audit | `details` object parameter with per-tool boolean flags, all defaulting to false. Shared supertype pattern for flag categories. |
</phase_requirements>

## Standard Stack

No new dependencies required. This phase modifies existing tool handlers and shared utilities only.

### Core (already in project)
| Library | Version | Purpose | Role in This Phase |
|---------|---------|---------|-------------------|
| Zod | 4.x | Schema validation | Define `details` parameter schemas per tool |
| @modelcontextprotocol/sdk | 1.29.x | MCP server | Tool registration with updated inputSchema |

## Architecture Patterns

### Response Field Taxonomy

Based on codebase analysis, here is the field-by-field classification for each tool category:

#### Navigation Tools (find_references, find_implementations, find_definition)

Each result is a `NavigationResult`:

| Field | Classification | Rationale |
|-------|---------------|-----------|
| `jar` | ESSENTIAL | Identifies provenance |
| `category` | ESSENTIAL | Jar category for prioritization |
| `className` | ESSENTIAL | What class the result is in |
| `line` | ESSENTIAL | Where in the file |
| `column` | ESSENTIAL | Precise position |
| `entryPath` | DETAIL | Redundant with className (className is derived from entryPath) |
| `provenanceChains` | DETAIL | Dependency chain -- useful for deep analysis, not for basic navigation |
| `context` | DETAIL | ContextSnippet with source code -- the biggest size contributor per result |

**Detail flag:** `details: { lineContent?: boolean }` -- when true, includes `context` and `entryPath` and `provenanceChains`

The `context` field is a `ContextSnippet` containing `snippet` (multi-line source text), `startLine`, `endLine`, and `kind`. For a class like ClientPlayerEntity with 100+ references, each snippet can be 5-30 lines of source code. This is the primary size multiplier.

#### Member Tools (list_members)

Each result is an `EnrichedSymbol` (recursive tree):

| Field | Classification | Rationale |
|-------|---------------|-----------|
| `name` | ESSENTIAL | Member name |
| `kind` | ESSENTIAL | method/field/constructor/etc. |
| `memberFqn` | ESSENTIAL | Full qualified reference for follow-up tools |
| `range.start.line` / `range.end.line` | ESSENTIAL | Line range |
| `deprecated` | ESSENTIAL | Important for agent decisions |
| `detail` | DETAIL | LSP detail string (raw signature text) |
| `parameters` | DETAIL | Parsed parameter list with TypeReference objects |
| `returnType` | DETAIL | Parsed return type TypeReference |
| `fieldType` | DETAIL | Parsed field type TypeReference |
| `range.*.character` | DETAIL | Column precision rarely needed for member listing |
| `selectionRange` | DETAIL | Selection range rarely needed |
| `children` (inner members) | ESSENTIAL | Structure is important, but children should also be stripped |

**Detail flags:** `details: { signatures?: boolean, annotations?: boolean }` -- `signatures` includes parameters, returnType, fieldType, detail. `annotations` is a future flag if annotation data is ever added.

Note: The CONTEXT.md suggested `javadoc` and `annotations` flags, but examining the actual code, there is no javadoc or annotation data in the enriched symbols -- the LSP `detail` field contains the signature string (e.g., `"(int, String) : void"`), and annotations are not extracted as structured data. The `signatures` flag better describes what exists.

#### Search Tools (search_symbols)

Each result has:

| Field | Classification | Rationale |
|-------|---------------|-----------|
| `name` | ESSENTIAL | Symbol name |
| `kind` | ESSENTIAL | Symbol kind |
| `containerName` | ESSENTIAL | Enclosing class |
| `memberFqn` | ESSENTIAL | Full reference |
| `deprecated` | ESSENTIAL | Useful signal |
| `location.jar` | ESSENTIAL | Which jar |
| `location.line` | ESSENTIAL | Line number |
| `location.uri` | DETAIL | Full file URI -- internal implementation detail |
| `location.column` | DETAIL | Column precision |

**Detail flag:** `details: { uri?: boolean }` -- includes the raw file URI. Alternatively, this tool may not need a details param at all since stripping uri and column makes only marginal difference.

#### Search Tools (search_classes)

Each result is a `ClassInfo`:

| Field | Classification | Rationale |
|-------|---------------|-----------|
| `name` | ESSENTIAL | Class name |
| `fqn` | ESSENTIAL | Full reference |
| `kind` | ESSENTIAL | class/interface/enum/etc. |
| `jars` | ESSENTIAL | Which jars contain it |
| `access` | DETAIL | public/private/etc. |
| `modifiers` | DETAIL | abstract/final/etc. |
| `innerClasses` | DETAIL | Inner class listings |

**Detail flag:** `details: { modifiers?: boolean }` -- includes access, modifiers, innerClasses

#### locate_in_source

Each result is a `LocateResult`:

| Field | Classification | Rationale |
|-------|---------------|-----------|
| `jar` | ESSENTIAL | Which jar |
| `category` | ESSENTIAL | Jar category |
| `line` | ESSENTIAL | Line number |
| `column` | ESSENTIAL | Column number |
| `offset` | ESSENTIAL | Character offset |
| `steps` | DETAIL | Cascade step details -- useful for debugging regex |
| `provenanceChains` | DETAIL | Dependency chains |
| `context` | Already optional | Controlled by existing `context` parameter |

**Detail flag:** `details: { steps?: boolean }` -- includes cascade step data and provenanceChains. The `context` param already exists and remains separate.

#### type_hierarchy

| Field | Classification | Rationale |
|-------|---------------|-----------|
| `class` | ESSENTIAL | Target class |
| `jar` | ESSENTIAL | Source jar |
| `extends` | ESSENTIAL | Supertype chain |
| `implements` | ESSENTIAL | Interface list |
| `subtypes` | ESSENTIAL | Subtype list |
| `subtypeDepth` | ESSENTIAL | Configured depth |

All fields are essential. Each entry is a `ClassReference` with only `name`, `fqn`, `kind` -- already compact. **No `details` parameter needed.**

#### list_classes

Similar analysis to search_classes. The `innerClasses`, `access`, `modifiers` arrays are the detail fields.

**Detail flag:** `details: { modifiers?: boolean }` -- same as search_classes

#### list_packages

Each result is a `PackageEntry` with `name`, `classCount`, `jars` -- already compact. **No `details` parameter needed.**

### Shared Detail Type Hierarchy

```typescript
// In descriptions.ts alongside PARAMS

/** Navigation tools: find_references, find_implementations, find_definition */
const navigationDetails = z.object({
	lineContent: z.boolean().optional().describe(
		'Include context snippets, entry paths, and provenance chains per result'
	),
}).optional().describe('Detail flags (all default to false = compact)');

/** Member listing tools: list_members */
const memberDetails = z.object({
	signatures: z.boolean().optional().describe(
		'Include parameter types, return types, field types, and LSP detail strings'
	),
}).optional().describe('Detail flags (all default to false = compact)');

/** Class listing tools: list_classes, search_classes */
const classDetails = z.object({
	modifiers: z.boolean().optional().describe(
		'Include access level, modifiers, and inner class listings'
	),
}).optional().describe('Detail flags (all default to false = compact)');

/** Locate tool: locate_in_source */
const locateDetails = z.object({
	steps: z.boolean().optional().describe(
		'Include cascade regex step details and provenance chains'
	),
}).optional().describe('Detail flags (all default to false = compact)');
```

Tools that don't need details: `list_packages`, `type_hierarchy`, `search_symbols` (marginal gains only).

### Recommended Project Structure

No new files needed. Changes go in existing files:

```
src/tools/
	descriptions.ts          # Add DETAIL_PARAMS shared schemas
	find-references.ts       # Add details param, strip fields
	find-implementations.ts  # Add details param, strip fields
	find-definition.ts       # Add details param, strip fields
	list-members.ts          # Add details param, strip fields
	list-classes.ts          # Add details param, strip fields
	search-classes.ts        # Add details param, strip fields
	locate-in-source.ts      # Add details param, strip fields
	tool-helpers.ts          # Add stripNavigationResult() helper
src/browsing/
	symbol-transform.ts      # (or member-enrichment.ts) Add stripEnrichedSymbol() helper
```

### Pattern: Field Stripping

The stripping should happen at the response construction level, not deep in the data pipeline. This keeps the data pipeline clean and makes it easy to verify what gets stripped.

```typescript
// In tool-helpers.ts
export function stripNavigationResult(
	result: NavigationResult,
	details?: { lineContent?: boolean },
): Partial<NavigationResult> {
	if (details?.lineContent) return result; // Full result
	// Strip context, entryPath, provenanceChains
	const { context, entryPath, provenanceChains, ...essential } = result;
	return essential;
}
```

```typescript
// In find-references.ts handler (after processNavigationLocations)
const stripped = paginated.results.map(r => stripNavigationResult(r, details));
// Use stripped in envelope instead of paginated.results
```

### Anti-Patterns to Avoid

- **Deep pipeline modification:** Don't modify `processNavigationLocations` or `enrichSymbols` to conditionally build results. Strip at the tool handler level.
- **Separate type hierarchies for compact/full:** Don't create `CompactNavigationResult` types. Use the same types with optional fields, and strip with destructuring.
- **Stripping in makeSuccess:** Don't modify the envelope builder. It's a generic wrapper.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON size measurement | Custom byte counter | `Buffer.byteLength(JSON.stringify(obj))` | Accurate UTF-8 byte count |
| Object field stripping | Deep recursive stripper | Destructuring rest syntax `const { field, ...rest } = obj` | TypeScript-native, type-safe |
| Per-tool detail schemas | Single monolithic schema | Zod `.object()` per category + `DETAIL_PARAMS` map in descriptions.ts | Follows PARAMS pattern |

## Common Pitfalls

### Pitfall 1: Stripping Fields That Types Require
**What goes wrong:** TypeScript complains when you try to return an object missing required fields from NavigationResult
**Why it happens:** NavigationResult has `context` as required, not optional
**How to avoid:** The stripped result type should be a new interface or use `Omit<NavigationResult, 'context' | 'entryPath' | 'provenanceChains'>`. Alternatively, make those fields optional on the type and only populate when details are requested. Changing the type to have optional fields is cleaner since it's a breaking change anyway.
**Warning signs:** TypeScript errors about missing properties

### Pitfall 2: Forgetting to Strip Recursive Children
**What goes wrong:** list_members strips fields on top-level members but children (inner classes, nested methods) still carry full data
**Why it happens:** EnrichedSymbol has recursive `children: EnrichedSymbol[]`
**How to avoid:** The strip function must recurse through children

### Pitfall 3: Inconsistent Default Behavior
**What goes wrong:** Some tools strip by default, others don't, making the API confusing
**Why it happens:** Each tool modified independently without coordination
**How to avoid:** All strip functions check `details?.flagName` with the same semantics: undefined/false = strip, true = include

### Pitfall 4: Test Assertions on Old Shape
**What goes wrong:** Existing tests break because they assert on fields that are now stripped by default
**Why it happens:** Tests were written for the full-detail response shape
**How to avoid:** Update test assertions to expect the new compact shape. Add explicit test cases for `details: { flag: true }` returning full data.

### Pitfall 5: Audit Data Staleness
**What goes wrong:** Audit measurements become meaningless if done with mock data
**Why it happens:** Temptation to use fixtures instead of real Minecraft project
**How to avoid:** The audit MUST use real tool calls against a real loaded project. The benchmark classes (ClientPlayerEntity, GameRenderer) are specifically chosen because they cause Claude Code errors.

## Code Examples

### Adding details parameter to a navigation tool

```typescript
// In find-references.ts
import { PARAMS, DETAIL_PARAMS } from './descriptions.js';

server.registerTool(
	'find_references',
	{
		title: 'Find References',
		description: TOOL_DESCRIPTIONS.find_references,
		inputSchema: {
			project: PARAMS.project,
			jar: PARAMS.jar,
			class: PARAMS.class,
			patterns: PARAMS.patterns,
			limit: PARAMS.limit,
			offset: PARAMS.offset,
			details: DETAIL_PARAMS.navigation,
		},
	},
	async ({ project, jar, class: className, patterns, limit, offset, details }) => {
		// ... existing logic ...
		const stripped = paginated.results.map(r => stripNavigationResult(r, details));
		const envelope = makeSuccess(
			{
				...paginated,
				results: stripped,
				sourcePosition: { /* ... */ },
			},
			{ provenance },
		);
		// ...
	},
);
```

### Stripping enriched symbols for list_members

```typescript
// Strip function for enriched symbols (recursive)
function stripEnrichedSymbol(
	sym: EnrichedSymbol,
	details?: { signatures?: boolean },
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		name: sym.name,
		kind: sym.kind,
		memberFqn: 'memberFqn' in sym ? sym.memberFqn : undefined,
		deprecated: sym.deprecated,
		range: {
			start: { line: sym.range.start.line },
			end: { line: sym.range.end.line },
		},
		children: sym.children.map(c => stripEnrichedSymbol(c, details)),
	};

	if (details?.signatures) {
		base.detail = sym.detail;
		base.selectionRange = sym.selectionRange;
		base.range = sym.range; // full range with characters
		if ('parameters' in sym) base.parameters = sym.parameters;
		if ('returnType' in sym) base.returnType = sym.returnType;
		if ('fieldType' in sym) base.fieldType = sym.fieldType;
	}

	return base;
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VERB-01 | Audit measures real response sizes | manual | Manual audit with real project -- produces report | N/A |
| VERB-02 | Default responses are compact (fields stripped) | unit | `npx vitest run tests/tools/find-references.test.ts -t "compact"` | Needs update |
| VERB-02 | Default responses for list_members are compact | unit | `npx vitest run tests/tools/list-members.test.ts -t "compact"` | Needs update |
| VERB-02 | Default responses for search_classes are compact | unit | `npx vitest run tests/tools/search-classes.test.ts -t "compact"` | Needs update |
| VERB-03 | details flags restore full data | unit | `npx vitest run tests/tools/find-references.test.ts -t "details"` | Needs update |
| VERB-03 | details flags on list_members | unit | `npx vitest run tests/tools/list-members.test.ts -t "details"` | Needs update |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Update existing test assertions in affected tool test files to expect compact default shapes
- [ ] Add test cases for `details: { flag: true }` returning full data
- [ ] No new test files needed -- existing files cover all affected tools

## Open Questions

1. **Exact size reduction for ClientPlayerEntity/GameRenderer**
   - What we know: These classes cause Claude Code hard-errors due to response size
   - What's unclear: Exact byte counts before/after reduction (needs real audit)
   - Recommendation: Measure during implementation with real project data, document in audit report

2. **search_symbols detail flag value**
   - What we know: The `uri` and `column` fields are marginal size contributors
   - What's unclear: Whether the marginal savings justify adding a details param
   - Recommendation: Skip details param for search_symbols unless audit shows significant size

3. **list_classes vs search_classes consolidation**
   - What we know: Both return ClassInfo with identical detail fields
   - What's unclear: Whether they should share a single detail schema or be independent
   - Recommendation: Share via `DETAIL_PARAMS.class` -- same schema, same flag names

## Sources

### Primary (HIGH confidence)
- Codebase analysis of all 10 audited tools' source files
- `src/jdtls/types.ts` -- NavigationResult shape (context field identified as primary size offender)
- `src/browsing/types.ts` -- EnrichedSymbol, ClassInfo, LocateResult shapes
- `src/tools/descriptions.ts` -- PARAMS pattern for shared schemas
- `src/tools/pagination.ts` -- Shared utility pattern model
- `src/types/envelope.ts` -- makeSuccess/makeError envelope builder

### Secondary (MEDIUM confidence)
- User's experience report that ClientPlayerEntity and GameRenderer cause Claude Code hard-errors

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, working with existing codebase
- Architecture: HIGH -- patterns directly derived from codebase analysis
- Pitfalls: HIGH -- identified from type system and code structure examination

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- internal refactoring, no external dependencies)
