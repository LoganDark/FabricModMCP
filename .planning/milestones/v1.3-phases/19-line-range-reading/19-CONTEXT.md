# Phase 19: Line-Range Reading - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

read_source returns specific line ranges with metadata instead of full source files. Agents can read specific line ranges from source files instead of consuming entire 1,000-5,000 line classes.

Requirements: READ-01, READ-02, READ-04

</domain>

<decisions>
## Implementation Decisions

### Parameter behavior
- `startLine` and `lineCount` are both optional and independent
- `startLine` alone: read from that line to EOF
- `lineCount` alone: read first N lines from start of file
- Both together: read N lines starting at startLine
- 1-based line numbering (consistent with existing codebase conventions)

### Out-of-range handling
- Clamp silently when range extends beyond file (e.g., startLine: 490, lineCount: 50 on a 500-line file returns lines 490-500)
- startLine beyond EOF returns empty content with metadata showing totalLineCount
- Agent infers clamping from metadata (returned range vs requested range) — no separate clamped flag
- Error on invalid values: startLine <= 0, lineCount <= 0 are rejected as bad input

### Single-jar requirement for line range
- When startLine or lineCount is provided, `jar` parameter is required
- Error with jar list when jar is omitted and line range is requested (agent can see available jars and retry)
- Without line range params, existing multi-jar behavior is unchanged

### Response metadata
- Every SourceResult always includes: startLine, endLine, totalLineCount, truncated
- Multi-jar results (no line range): each result gets startLine: 1, endLine: totalLines, truncated: false
- Line-range results: startLine/endLine reflect actual returned range, truncated: true if clamped
- Uniform shape — agent never has to check whether metadata fields exist

### Claude's Discretion
- Error message wording for invalid parameters and ambiguous jar
- Whether to rename existing `lineCount` field or add `totalLineCount` alongside it
- Internal line-splitting implementation details

</decisions>

<specifics>
## Specific Ideas

- Success criteria #4 requires that reading a file in consecutive chunks and concatenating produces identical content to reading without range params — line splitting must be deterministic
- Existing patterns in member-extractor.ts and locate-in-source.ts use `split('\n')` + `slice()` with 1-based conversion — reuse this approach

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` -- READ-01, READ-02, READ-04 definitions and acceptance criteria

### Roadmap
- `.planning/ROADMAP.md` -- Phase 19 success criteria (4 criteria including chunk concatenation invariant)

### Prior research
- `.planning/STATE.md` -- v1.3 research decisions (startLine/lineCount naming, backward compat, single-jar requirement)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/browsing/member-extractor.ts`: Line extraction with 1-based numbering, `split('\n')` + `slice()` pattern
- `src/tools/locate-in-source.ts`: `extractContext()` function — clamp-and-slice pattern for line ranges
- `src/types/envelope.ts`: `makeSuccess()` envelope builder, `ToolError` for validation errors

### Established Patterns
- 1-based line numbers throughout (LSP convention, member-extractor, locate-in-source)
- `SourceResult` in `src/browsing/types.ts` already has `lineCount` field — extend with new metadata
- `resolveClassSource()` in `src/tools/tool-helpers.ts` handles jar validation and error codes
- `handleClassSourceError()` converts domain errors to MCP responses

### Integration Points
- `src/tools/read-source.ts`: Tool registration, schema, and handler — primary file to modify
- `src/browsing/types.ts`: `SourceResult` interface — add metadata fields
- `src/tools/descriptions.ts`: PARAMS and TOOL_DESCRIPTIONS — add new parameter descriptions

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 19-line-range-reading*
*Context gathered: 2026-04-14*
