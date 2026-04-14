# Architecture Patterns

**Domain:** Context management features for MCP server (v1.3)
**Researched:** 2026-04-14
**Focus:** Line-range reading, context lines on read_member, verbosity audit, pagination gaps

## Current Architecture Summary

The codebase follows a strict **domain -> tool** layered pattern:

- **Domain layer** (`src/browsing/`, `src/jdtls/`, `src/project/`): Pure logic, I/O via injected adapters, no MCP awareness
- **Tool layer** (`src/tools/`): Thin wiring -- Zod schemas, project resolution, error formatting, MCP response envelope
- **Shared helpers** (`src/tools/tool-helpers.ts`): Cross-cutting utilities used by many tools -- `resolveClassSource`, `processNavigationLocations`, `getDependenciesForTool`, `returnError`
- **Response envelope** (`src/types/envelope.ts`): `makeSuccess`/`makeError`/`makeDisambiguation` produce typed structures; tools return `{ content: [text], structuredContent: envelope }`

### Key Data Flow for Source Reading

```
read_source tool
  -> resolveClassSource (tool-helpers) finds sourceText from jars
  -> returns full sourceText as SourceResult.source
  -> wraps in envelope with lineCount

read_member tool
  -> resolveClassSource -> sourceText
  -> JDT LS documentSymbol -> transformSymbolResponse -> enrichSymbols
  -> extractMemberSource (member-extractor) -> MemberExtraction with source, startLine, endLine
  -> wraps as MemberResult in envelope
```

### Current Pagination State

| Tool | Has limit/offset? | Default limit | Notes |
|------|--------------------|---------------|-------|
| search_classes | YES | 250 | Full pagination with total count |
| search_symbols | YES | 50 (max 200) | Full pagination with total count |
| find_references | NO | -- | Returns all results unbounded |
| find_implementations | NO | -- | Returns all results unbounded |
| find_definition | NO | -- | Usually 1 result, unbounded is fine |
| list_members | NO | -- | Returns full symbol tree, no pagination |
| list_classes | NO | -- | Returns all classes in package |
| list_packages | NO | -- | Returns all packages |
| read_source | NO | -- | Returns full source from all matching jars |
| read_member | NO | -- | Returns full member source |

## Recommended Architecture for v1.3

### Design Principle: Truncation Logic Lives in Domain Layer

Truncation, slicing, and pagination are **data transformation** -- they belong in the domain layer, not the tool layer. The tool layer's job is parameter validation and MCP envelope formatting. Putting slice logic in tools would violate the existing separation and make it untestable without MCP.

**Exception:** When truncation is trivial (a single `Array.slice` on already-computed results), it can stay in the tool layer. The navigation tools (`find_references`, `find_implementations`) fall into this category -- the results are already computed by `processNavigationLocations`, and slicing is a one-liner.

### Component Boundaries

| Component | Responsibility | Changes Needed |
|-----------|---------------|----------------|
| `src/browsing/source-slicer.ts` | **NEW** -- Line-range slicing of source text | Pure function: takes source string + offset/limit, returns sliced text + metadata |
| `src/browsing/member-extractor.ts` | Extract member source by FQN | **MODIFY** -- Add context lines support to `extractMemberSource` |
| `src/browsing/types.ts` | Domain result types | **MODIFY** -- Add range metadata to SourceResult |
| `src/tools/read-source.ts` | MCP tool wiring | **MODIFY** -- Add offset/limit params, disambiguation when multi-jar + range |
| `src/tools/read-member.ts` | MCP tool wiring | **MODIFY** -- Add linesBefore/linesAfter params, pass through to extractor |
| `src/tools/find-references.ts` | MCP tool wiring | **MODIFY** -- Add limit/offset params, slice results |
| `src/tools/find-implementations.ts` | MCP tool wiring | **MODIFY** -- Add limit/offset params, slice results |
| `src/tools/tool-helpers.ts` | Shared utilities | **MODIFY** -- Add `paginateResults` helper for navigation tools |
| `src/tools/descriptions.ts` | Tool descriptions | **MODIFY** -- Update descriptions for changed tool signatures |

### New Module: source-slicer.ts

```typescript
// src/browsing/source-slicer.ts
// Pure function. No I/O.

export interface SlicedSource {
	source: string;        // The sliced text
	startLine: number;     // 1-based first line returned
	endLine: number;       // 1-based last line returned
	lineCount: number;     // Lines in the slice
	totalLineCount: number; // Lines in the full source
	truncated: boolean;    // Whether the result was truncated by limit
}

export function sliceSource(
	sourceText: string,
	offset?: number,   // 1-based line to start from (default: 1)
	limit?: number,    // Max lines to return (default: all)
): SlicedSource;
```

This is a pure domain function -- takes text, returns sliced text with metadata. No MCP awareness.

### Modified: member-extractor.ts

`extractMemberSource` already returns `startLine`, `endLine`, and `source`. Context lines should be added here because:

1. The extractor already knows the source text and line ranges
2. `findDecorationsStart` already scans backward for Javadoc -- context lines are the same concept extended
3. The locate-in-source tool has a local `extractContext` function that does exactly this pattern -- same approach, different scope

```typescript
// Add optional context parameter to extractMemberSource
export function extractMemberSource(
	sourceText: string,
	enrichedSymbols: EnrichedSymbol[],
	targetFqn: string,
	context?: { linesBefore: number; linesAfter: number },
): MemberExtraction[];
```

When `context` is provided, each extraction expands its `startLine`/`endLine` range and `source` text to include surrounding lines beyond the Javadoc + member body. The `lineCount` reflects the expanded range.

### Modified: types.ts (SourceResult)

```typescript
export interface SourceResult {
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	source: string;
	lineCount: number;
	// NEW for v1.3:
	totalLineCount: number;  // Full file line count (differs from lineCount when sliced)
	startLine: number;       // 1-based first line in source (1 when not sliced)
	endLine: number;         // 1-based last line in source
	truncated: boolean;      // True when limit caused truncation
}
```

### read_source: Disambiguation Requirement

The milestone spec says: "error if multiple jars match without explicit jar" when offset/limit are used. This uses the existing `Disambiguation` envelope type from `envelope.ts`:

```typescript
// When offset or limit provided AND multiple jars contain the class:
return {
	content: [{ type: 'text', text: 'Multiple jars contain this class. Specify a jar for line-range reading.' }],
	structuredContent: makeDisambiguation(
		'Line-range reading requires a single jar. Specify the jar parameter.',
		matchingJars.map(j => ({ value: j.id, label: j.id, description: j.category })),
	),
};
```

The `Disambiguation` type already exists in `envelope.ts` and is exactly for this purpose. It has never been used before -- this would be its first real use.

### Navigation Tool Pagination Pattern

`find_references` and `find_implementations` should add limit/offset following the same pattern as `search_symbols`:

```typescript
// In tool-helpers.ts -- shared by find_references and find_implementations
export function paginateResults<T>(
	results: T[],
	offset: number,
	limit: number,
): { page: T[]; total: number; offset: number; limit: number } {
	return {
		page: results.slice(offset, offset + limit),
		total: results.length,
		offset,
		limit,
	};
}
```

This is simple enough to live in tool-helpers (it's a one-liner slice, not domain logic).

## Data Flow Changes

### read_source with Line Range

```
read_source(class, jar?, offset?, limit?)
  |
  v
  offset or limit provided?
  |
  +-- YES --> Are multiple jars containing this class?
  |           |
  |           +-- YES (and no jar specified) --> makeDisambiguation with jar options
  |           |
  |           +-- NO (one jar, or jar specified) -->
  |                 resolveClassSource (single jar)
  |                 sliceSource(sourceText, offset, limit)
  |                 SourceResult with truncated/startLine/endLine/totalLineCount
  |
  +-- NO  --> existing behavior (all jars, full source, backfill new fields trivially)
```

The "are multiple jars" check requires a minor restructuring of the current read_source flow. Currently, when no `jar` is specified, it iterates all filtered jars and collects sources. For the disambiguation check, we need to first collect matching jar IDs, then either disambiguate or proceed.

### read_member with Context Lines

```
read_member(memberFqn, jar?, linesBefore?, linesAfter?)
  |
  v
  resolveClassSource -> sourceText
  JDT LS documentSymbol -> enrich
  extractMemberSource(sourceText, enriched, fqn, { linesBefore, linesAfter })
    |
    v
    For each matching symbol:
      existing: startLine = decorationsStart, endLine = range.end.line
      NEW: startLine = max(1, decorationsStart - linesBefore)
           endLine = min(totalLines, range.end.line + linesAfter)
      source includes the expanded range
  -> MemberResult (same shape, wider range when context requested)
```

### find_references / find_implementations with Pagination

```
find_references(class, patterns, limit?, offset?)
  |
  v
  existing flow -> NavigationResult[]
  paginateResults(results, offset ?? 0, limit ?? 100)
  -> envelope includes { results: page, total, offset, limit }
```

## Patterns to Follow

### Pattern 1: Context Expansion (from locate_in_source)

The `extractContext` function in `locate-in-source.ts` (lines 15-27) is the exact pattern for context lines:
```typescript
function extractContext(source: string, line: number, linesBefore: number, linesAfter: number): LocateResultContext {
	const lines = source.split('\n');
	const startLine = Math.max(1, line - linesBefore);
	const endLine = Math.min(lines.length, line + linesAfter);
	const text = lines.slice(startLine - 1, endLine).join('\n');
	return { text, startLine, endLine };
}
```
Apply this same clamping approach inside `extractMemberSource` to expand the member range by `linesBefore` above the decoration start and `linesAfter` below the range end.

### Pattern 2: Optional Parameters with Backward Compatibility

Existing tools use `z.number().optional()` for pagination. Follow the same convention:
```typescript
offset: z.number().int().min(1).optional().describe('Start reading from this line (1-based, default: 1)'),
limit: z.number().int().min(1).optional().describe('Maximum number of lines to return'),
```
When both are omitted, behavior is identical to current -- full source returned. No breaking changes.

### Pattern 3: Total Count in Paginated Responses

Both `search_classes` and `search_symbols` return `{ results, total, offset, limit }`. Navigation tools should follow the same shape for consistency. This lets the agent know whether more results exist.

### Pattern 4: Backfill New Fields Trivially

When adding `totalLineCount`, `startLine`, `endLine`, `truncated` to SourceResult, the non-sliced path sets them trivially:
```typescript
totalLineCount: lineCount,
startLine: 1,
endLine: lineCount,
truncated: false,
```
This keeps the type non-optional (always present) which is better for consumers than optional fields.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Truncation in the Envelope Layer
**What:** Adding slice/truncation logic inside `makeSuccess` or the envelope types.
**Why bad:** The envelope is a pass-through wrapper. It should not transform data. Data shaping happens before envelope creation.
**Instead:** Slice in domain functions, pass shaped data to `makeSuccess`.

### Anti-Pattern 2: Separate "Paged" Result Types
**What:** Creating `PagedSourceResult`, `PagedMemberResult`, etc. alongside existing types.
**Why bad:** Proliferates types. The existing types can accommodate the new fields.
**Instead:** Extend existing `SourceResult` and `MemberResult` with the new fields. They're always present, just trivially set when not slicing.

### Anti-Pattern 3: Line-Range Logic in SourceAdapter
**What:** Adding offset/limit to `SourceAdapter.readEntry()` signature.
**Why bad:** SourceAdapter reads raw bytes from jars/filesystem. Line-range slicing operates on decoded text. Mixing byte-level I/O with text-level slicing couples concerns.
**Instead:** SourceAdapter returns full Buffer. Caller decodes to string, then uses `sliceSource`.

### Anti-Pattern 4: Default Limits That Break Existing Behavior
**What:** Adding a default limit to `find_references` that silently truncates results for existing users.
**Why bad:** Agents using this tool expect all references. Silent truncation causes missed results.
**Instead:** Default limit should be generous (100+) and the response MUST include `total` count so the agent knows to paginate. Document this clearly.

### Anti-Pattern 5: Context Lines as a Separate Response Field
**What:** Adding a `contextBefore`/`contextAfter` alongside the member `source` field.
**Why bad:** The member source already includes Javadoc via `findDecorationsStart`. Adding context lines is the same operation -- extending the extracted range. Having three separate text fields (contextBefore, source, contextAfter) complicates consumption.
**Instead:** Expand the `source` field to include context lines. The `startLine`/`endLine` metadata tells the consumer where the member itself starts vs. context.

## Build Order (Suggested Phase Structure)

Dependencies flow: types -> domain functions -> tool wiring -> descriptions.

### Phase 1: Line-Range Reading on read_source
**Depends on:** Nothing (new module + modifications to existing)
1. Create `src/browsing/source-slicer.ts` with `sliceSource` (pure function, easy to unit test)
2. Extend `SourceResult` in `types.ts` with `totalLineCount`, `startLine`, `endLine`, `truncated`
3. Modify `read-source.ts`: add offset/limit params, disambiguation logic, call sliceSource
4. Backfill new SourceResult fields in existing non-sliced path
5. Update `descriptions.ts` for read_source
6. Tests: sliceSource unit tests, read_source integration tests for sliced/non-sliced/disambiguation

**Why first:** Agents reading large Minecraft classes (1000+ lines) hit context limits immediately. This is the highest-value feature -- surgical line-range control.

### Phase 2: Context Lines on read_member
**Depends on:** Nothing (orthogonal to Phase 1, could run in parallel)
1. Modify `extractMemberSource` in `member-extractor.ts` to accept optional context parameter
2. Add `contextStartLine`/`contextEndLine` or similar to MemberResult if needed (or just let startLine/endLine reflect the expanded range)
3. Modify `read-member.ts`: add linesBefore/linesAfter params, pass to extractor
4. Update `descriptions.ts` for read_member
5. Tests: member extraction with context lines, boundary conditions

**Why second:** Small, self-contained change. Quick win that follows the locate-in-source pattern.

### Phase 3: Navigation Tool Pagination
**Depends on:** Nothing (orthogonal)
1. Add `paginateResults` helper to `tool-helpers.ts`
2. Modify `find-references.ts`: add limit/offset params, use paginateResults
3. Modify `find-implementations.ts`: add limit/offset params, use paginateResults
4. Update `descriptions.ts` for both tools
5. Tests: pagination of navigation results

**Why third:** Prevents context explosion from `find_references` returning 200+ results.

### Phase 4: Verbosity Audit
**Depends on:** Phases 1-3 (audit after controls are in place to recommend defaults)
1. Audit NavigationResult context snippets -- are they too large? Should `extractEnclosingContext` produce shorter snippets?
2. Audit `search_symbols` output -- is `containerName` redundant with `memberFqn`? Can `location.uri` be omitted?
3. Audit `list_members` enriched output -- does the full tree blow up context for large classes?
4. Audit `search_classes` result shape -- are `provenanceChains` and `innerClasses` needed in search results?
5. Recommend and implement defaults changes, document findings

**Why last:** The verbosity audit is informed by the controls added in Phases 1-3. With pagination and line-range controls in place, the audit can focus on per-result verbosity rather than total result count.

### Phase Ordering Rationale
- Phases 1-3 are independent and could be developed in any order or in parallel
- Phase 1 is highest-value (agents most frequently hit context limits reading full source files)
- Phase 4 must come last because it's an analysis phase that benefits from the control mechanisms built in 1-3

## Integration Points Summary

| Feature | Files Modified | Files Created | Key Integration Point |
|---------|---------------|---------------|----------------------|
| Line-range read_source | `read-source.ts`, `types.ts`, `descriptions.ts` | `source-slicer.ts` | `sliceSource` called after `readEntry` decode; disambiguation via existing `makeDisambiguation` |
| Context lines read_member | `member-extractor.ts`, `read-member.ts`, `descriptions.ts` | None | `extractMemberSource` expanded with context param; same clamping pattern as locate-in-source |
| Navigation pagination | `find-references.ts`, `find-implementations.ts`, `tool-helpers.ts`, `descriptions.ts` | None | `paginateResults` slices `processNavigationLocations` output |
| Verbosity audit | Potentially `context-extractor.ts`, various tool files, `descriptions.ts` | None | Analysis-driven; specific changes TBD |

## Scalability Considerations

| Concern | Current | After v1.3 |
|---------|---------|------------|
| Large class source in context | Full 1000+ line files | Agent controls via offset/limit |
| find_references explosion | All results returned (can be 200+) | Paginated with total count |
| Member source size | Full member with Javadoc | Context lines add bounded expansion |
| Per-result verbosity | NavigationResult includes full context snippet | Audit may reduce snippet size |

## Sources

- Direct codebase analysis of MinecraftDevMCP v1.2 (526 tests, 22 tools, 6,863 LOC)
- Architecture patterns derived from existing code conventions (domain/tool separation, envelope pattern, pagination in search_classes/search_symbols, context extraction in locate-in-source)
- Confidence: HIGH -- all findings are from direct source reading, no external references needed
