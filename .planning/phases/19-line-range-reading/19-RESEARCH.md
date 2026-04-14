# Phase 19: Line-Range Reading - Research

**Researched:** 2026-04-14
**Domain:** MCP tool parameter extension, line-range slicing, response metadata
**Confidence:** HIGH

## Summary

Phase 19 adds optional `startLine` and `lineCount` parameters to the existing `read_source` tool, along with uniform response metadata (`totalLineCount`, `startLine`, `endLine`, `truncated`) on every `SourceResult`. This is a pure extension of an existing tool with no new dependencies, no architectural changes, and no external integrations. The codebase already has proven line-splitting patterns (`split('\n')` + `slice()` with 1-based indexing) in `member-extractor.ts` and `locate-in-source.ts`.

The implementation touches four files: `read-source.ts` (tool handler), `types.ts` (SourceResult interface), `descriptions.ts` (parameter schemas and descriptions), and test updates. The existing `resolveClassSource()` helper already handles jar validation and source text retrieval -- the line-range slicing is applied after source text is obtained.

**Primary recommendation:** Extract a pure `sliceLines()` utility function that takes source text, optional startLine, optional lineCount, and returns `{ content, startLine, endLine, totalLineCount, truncated }`. Test it independently, then wire it into read-source.ts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `startLine` and `lineCount` are both optional and independent
- `startLine` alone: read from that line to EOF
- `lineCount` alone: read first N lines from start of file
- Both together: read N lines starting at startLine
- 1-based line numbering (consistent with existing codebase conventions)
- Clamp silently when range extends beyond file (e.g., startLine: 490, lineCount: 50 on a 500-line file returns lines 490-500)
- startLine beyond EOF returns empty content with metadata showing totalLineCount
- Agent infers clamping from metadata (returned range vs requested range) -- no separate clamped flag
- Error on invalid values: startLine <= 0, lineCount <= 0 are rejected as bad input
- When startLine or lineCount is provided, `jar` parameter is required
- Error with jar list when jar is omitted and line range is requested (agent can see available jars and retry)
- Without line range params, existing multi-jar behavior is unchanged
- Every SourceResult always includes: startLine, endLine, totalLineCount, truncated
- Multi-jar results (no line range): each result gets startLine: 1, endLine: totalLines, truncated: false
- Line-range results: startLine/endLine reflect actual returned range, truncated: true if clamped
- Uniform shape -- agent never has to check whether metadata fields exist

### Claude's Discretion
- Error message wording for invalid parameters and ambiguous jar
- Whether to rename existing `lineCount` field or add `totalLineCount` alongside it
- Internal line-splitting implementation details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| READ-01 | read_source accepts optional startLine and lineCount to return a line range instead of full source | Existing `split('\n')` + `slice()` patterns in member-extractor.ts and locate-in-source.ts. New Zod params added to inputSchema. |
| READ-02 | read_source with line range requires a specific jar parameter; returns error with jar list when multiple jars match | Existing `returnError()` and `getAllDependencies()` provide jar list for error response. Validation check before jar resolution. |
| READ-04 | Line-range and context-lines output includes metadata (total lines in file, returned range) so agent knows what it's seeing | Extend `SourceResult` interface with `totalLineCount`, `startLine`, `endLine`, `truncated` fields. Populate uniformly in both code paths. |
</phase_requirements>

## Standard Stack

No new dependencies. This phase uses only existing project libraries.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.x | Parameter validation for new startLine/lineCount params | Already used for all tool schemas |
| @modelcontextprotocol/sdk | 1.29.x | MCP server tool registration | Already the server framework |

## Architecture Patterns

### Recommended Approach: Pure Utility Function

Extract line-slicing logic into a testable pure function, separate from the tool handler.

**File:** `src/browsing/line-slicer.ts` (new)

```typescript
export interface LineSliceResult {
	source: string;
	startLine: number;
	endLine: number;
	totalLineCount: number;
	truncated: boolean;
}

export function sliceLines(
	sourceText: string,
	requestedStartLine?: number,
	requestedLineCount?: number,
): LineSliceResult {
	const lines = sourceText.split('\n');
	const totalLineCount = lines.length;

	// No range requested -- return full source
	if (requestedStartLine === undefined && requestedLineCount === undefined) {
		return {
			source: sourceText,
			startLine: 1,
			endLine: totalLineCount,
			totalLineCount,
			truncated: false,
		};
	}

	const start = requestedStartLine ?? 1;

	// startLine beyond EOF -- empty content
	if (start > totalLineCount) {
		return {
			source: '',
			startLine: start,
			endLine: start - 1,
			totalLineCount,
			truncated: true,
		};
	}

	const end = requestedLineCount !== undefined
		? Math.min(start + requestedLineCount - 1, totalLineCount)
		: totalLineCount;

	const sliced = lines.slice(start - 1, end);
	const truncated = (start !== 1) || (end !== totalLineCount);

	return {
		source: sliced.join('\n'),
		startLine: start,
		endLine: end,
		totalLineCount,
		truncated,
	};
}
```

### Pattern: Validation-Before-Resolution

The jar requirement check for line-range requests must happen BEFORE any jar resolution or source reading:

```typescript
// In read-source.ts handler, early in the function:
if ((startLine !== undefined || lineCount !== undefined) && jar === undefined) {
	// Collect jar list for error message
	const jarIds = getAvailableJarIds(loadedProject, className);
	return returnError(
		'JAR_REQUIRED',
		'Line-range parameters (startLine/lineCount) require a specific jar',
		[],
		jarIds.length > 0
			? [`Available jars containing this class: ${jarIds.join(', ')}`]
			: ['Use get_project_metadata to see available jars'],
	);
}
```

### Pattern: SourceResult Metadata Extension

The existing `SourceResult` interface currently has `lineCount`. The decision is between renaming it or adding `totalLineCount` alongside it.

**Recommendation: Rename `lineCount` to `totalLineCount`** and add the new fields. Rationale:
- The existing `lineCount` represents total lines in the file, which is exactly what `totalLineCount` means
- Having both `lineCount` and `totalLineCount` with different semantics when line-range is used would be confusing
- This is an internal interface change -- `SourceResult` is only constructed in `read-source.ts`
- The `MemberResult` type also has `lineCount` but that means "lines in the member extraction" -- different semantics, leave it alone

Updated interface:
```typescript
export interface SourceResult {
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	source: string;
	startLine: number;
	endLine: number;
	totalLineCount: number;
	truncated: boolean;
}
```

### Anti-Patterns to Avoid
- **Splitting lines twice:** Split once, pass the array or the slice result around. Do not call `source.split('\n')` in multiple places for the same source text.
- **Non-deterministic line splitting:** Must use `.split('\n')` consistently everywhere. Using `.split(/\r?\n/)` or other patterns would break the chunk-concatenation invariant (success criteria #4).
- **Conditional metadata fields:** Every `SourceResult` must have ALL metadata fields. Never make them optional or conditional.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Line splitting | Custom regex-based line parser | `string.split('\n')` | Already the project convention. Java source files in jars use `\n` line endings. Deterministic behavior required for chunk concatenation invariant. |
| Parameter validation | Manual if/else chains | Zod `.int().min(1)` | Consistent with all other tool schemas. Rejects <= 0 at the schema level. |

## Common Pitfalls

### Pitfall 1: Off-by-one in 1-based to 0-based conversion
**What goes wrong:** `slice(startLine, endLine)` when startLine is 1-based produces wrong results.
**Why it happens:** Array indices are 0-based, line numbers are 1-based.
**How to avoid:** Always `slice(startLine - 1, endLine)` -- subtract 1 from start, use endLine directly (since slice's end is exclusive, and endLine is inclusive 1-based, they align: 1-based line 5 = 0-based index 4, and `slice(_, 5)` excludes index 5, so includes through index 4).
**Warning signs:** First line missing, last line duplicated, or off-by-one in endLine metadata.

### Pitfall 2: Empty file edge case
**What goes wrong:** A file with empty content (`""`) produces `[""]` when split, so `totalLineCount` = 1.
**Why it happens:** `"".split('\n')` returns `[""]` in JavaScript.
**How to avoid:** This is actually correct behavior -- an empty file has one empty line. But verify that `startLine: 1, lineCount: 1` on an empty file returns `""` with `totalLineCount: 1`.
**Warning signs:** Tests with empty files failing on metadata values.

### Pitfall 3: Trailing newline handling
**What goes wrong:** A file ending in `\n` has `split('\n')` produce a final empty string element, inflating line count by 1 compared to what editors show.
**Why it happens:** `"a\nb\n".split('\n')` returns `["a", "b", ""]`.
**How to avoid:** This is the existing behavior in the codebase (existing `lineCount` uses `split('\n').length`). Maintain consistency -- do NOT strip trailing newlines or adjust the count. The chunk-concatenation invariant requires this: if chunks are joined and compared to full source, the split/join must be identical.
**Warning signs:** Concatenated chunks differ from full source by a trailing newline.

### Pitfall 4: Chunk concatenation invariant violation
**What goes wrong:** Reading lines 1-50 then 51-100 and joining with `\n` produces different text than reading lines 1-100.
**Why it happens:** Join logic doesn't account for how split/slice works with newlines.
**How to avoid:** The invariant is: `sliceLines(text, 1, 50).source + '\n' + sliceLines(text, 51, 50).source === sliceLines(text, 1, 100).source`. This holds because `lines.slice(0, 50).join('\n') + '\n' + lines.slice(50, 100).join('\n') === lines.slice(0, 100).join('\n')`. Verify with a dedicated test.
**Warning signs:** Test that reads in chunks and compares to full read fails.

### Pitfall 5: Jar list collection for error message
**What goes wrong:** Error message for missing jar doesn't actually show which jars contain the class.
**Why it happens:** Checking all jars for class existence requires I/O (reading jar entries), which may be expensive for an error path.
**How to avoid:** Two options: (1) show all available jars in the project (cheap, from dependency map), or (2) actually check which jars contain the class (accurate but costs I/O). Recommend option 1 for the error message -- list all jar IDs from the dependency map. The agent can narrow down from there.
**Warning signs:** Error message says "available jars" but lists jars that don't contain the class.

## Code Examples

### Existing line-slice pattern (from locate-in-source.ts)
```typescript
// Source: src/tools/locate-in-source.ts, lines 15-27
function extractContext(
	source: string,
	line: number,
	linesBefore: number,
	linesAfter: number,
): LocateResultContext {
	const lines = source.split('\n');
	const totalLines = lines.length;
	const startLine = Math.max(1, line - linesBefore);
	const endLine = Math.min(totalLines, line + linesAfter);
	const text = lines.slice(startLine - 1, endLine).join('\n');
	return { text, startLine, endLine };
}
```

### Existing SourceResult construction (from read-source.ts)
```typescript
// Source: src/tools/read-source.ts, lines 41-47
const sources: SourceResult[] = [{
	jar: dep.id,
	category: dep.category,
	provenanceChains: dep.provenanceChains,
	source: sourceResult.sourceText,
	lineCount,
}];
```

### Zod parameter pattern (from descriptions.ts)
```typescript
// New params to add alongside existing PARAMS:
startLine: z.number().int().min(1).optional()
	.describe('First line to return (1-based). Requires jar parameter.'),
lineCount: z.number().int().min(1).optional()
	.describe('Number of lines to return. Requires jar parameter.'),
```

Note: The PARAMS object currently has no `startLine` or `lineCount` entries. These are new. The existing `SourceResult.lineCount` field is being renamed to `totalLineCount` in the interface.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run tests/tools/read-source.test.ts` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-01 | startLine alone returns from that line to EOF | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "startLine alone"` | Wave 0 |
| READ-01 | lineCount alone returns first N lines | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "lineCount alone"` | Wave 0 |
| READ-01 | Both together returns N lines from startLine | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "startLine and lineCount"` | Wave 0 |
| READ-01 | Clamping when range exceeds file | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "clamp"` | Wave 0 |
| READ-01 | startLine beyond EOF returns empty with metadata | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "beyond EOF"` | Wave 0 |
| READ-01 | Error on invalid values (startLine <= 0, lineCount <= 0) | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "invalid"` | Wave 0 |
| READ-02 | Error with jar list when line range without jar | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "jar required"` | Wave 0 |
| READ-04 | Every SourceResult has startLine, endLine, totalLineCount, truncated | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "metadata"` | Wave 0 |
| READ-04 | Full-file read (no range) has correct metadata | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "full file metadata"` | Wave 0 |
| ALL | Chunk concatenation invariant | unit | `pnpm vitest run tests/tools/read-source.test.ts -t "concatenat"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tests/tools/read-source.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/browsing/line-slicer.test.ts` -- unit tests for the pure sliceLines() function (covers edge cases: empty file, trailing newline, clamping, beyond EOF, chunk concatenation)
- [ ] Update `tests/tools/read-source.test.ts` -- add test cases for new parameters, metadata fields, jar-required error, and backward compatibility

## Sources

### Primary (HIGH confidence)
- Project source code: `src/tools/read-source.ts`, `src/browsing/types.ts`, `src/tools/descriptions.ts`, `src/tools/tool-helpers.ts` -- current implementation read directly
- Project source code: `src/tools/locate-in-source.ts` -- line-slicing pattern reference
- Project source code: `src/browsing/member-extractor.ts` -- line extraction pattern reference
- Project tests: `tests/tools/read-source.test.ts` -- existing test patterns

### Secondary (MEDIUM confidence)
- None needed -- this is purely internal code modification with no external dependencies

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, purely extending existing code
- Architecture: HIGH -- follows established patterns already in the codebase (extractContext, member-extractor)
- Pitfalls: HIGH -- edge cases well-understood from JavaScript string splitting behavior and existing code review

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- no external dependencies to change)
