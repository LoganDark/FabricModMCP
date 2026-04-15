# Phase 20: Member Context Lines - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

read_member includes surrounding source context on demand. Agents can see the source context surrounding a member without a separate read_source call.

Requirements: READ-03

</domain>

<decisions>
## Implementation Decisions

### Context output shape
- Merged source: `source` field contains context lines + member source as one continuous block
- Member boundary metadata: `memberStartLine` and `memberEndLine` fields mark the original member range within the expanded block
- Expanded range metadata: `startLine` and `endLine` reflect the full range including context
- When context is not requested, `memberStartLine === startLine` and `memberEndLine === endLine`

### Parameter behavior
- `linesBefore` and `linesAfter` are both optional and independent
- `linesBefore` alone: expand upward from member start
- `linesAfter` alone: expand downward from member end
- Both together: expand in both directions
- Omitting both produces identical output to pre-v1.3 behavior (backward compatible)

### Overload handling
- Each overload extraction gets its own independent context expansion
- No deduplication — if adjacent overloads' context ranges overlap, repeated lines appear in both results
- Each result is self-contained; agent can read any single result without needing others

### Boundary behavior
- Silent clamp when context extends past file boundaries (same as Phase 19 read_source)
- Agent infers clamping from metadata (actual startLine vs theoretical requested range)
- No separate clamped/truncated flag — metadata is sufficient

### Claude's Discretion
- Whether to add `memberLineCount` alongside `memberStartLine`/`memberEndLine` or let agent compute it
- Error handling for invalid values (linesBefore < 0, linesAfter < 0)
- Whether context expansion happens in member-extractor.ts or in the tool handler

</decisions>

<specifics>
## Specific Ideas

- Success criteria #2 requires byte-identical output when linesBefore/linesAfter are omitted — must not change existing MemberResult shape, only add new fields
- The `extractMemberSource()` function already computes startLine/endLine per member including Javadoc — context expansion extends outward from these boundaries
- Phase 19's `sliceLines` utility handles line slicing with 1-based numbering and clamping — reusable pattern

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — READ-03 definition (linesBefore/linesAfter on read_member)

### Roadmap
- `.planning/ROADMAP.md` — Phase 20 success criteria (3 criteria: context params, backward compat, metadata)

### Prior phase context
- `.planning/phases/19-line-range-reading/19-CONTEXT.md` — Phase 19 decisions on line-range behavior, clamping, metadata shape

### Prior research
- `.planning/STATE.md` — v1.3 research decisions (backward compat, no new dependencies)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/browsing/member-extractor.ts`: `extractMemberSource()` — already computes startLine/endLine/lineCount per member, handles Javadoc scanning
- `src/browsing/member-extractor.ts`: `findDecorationsStart()` — Javadoc boundary detection, context expansion starts from its result
- `src/utils/slice-lines.ts`: `sliceLines()` — line slicing with 1-based numbering, clamping at boundaries (from Phase 19)

### Established Patterns
- 1-based line numbers throughout (LSP convention, member-extractor, sliceLines)
- `MemberResult` in `src/browsing/types.ts` has startLine, endLine, lineCount — extend with memberStartLine/memberEndLine
- `MemberExtraction` in `src/browsing/member-extractor.ts` has same fields — extend at extraction level
- Phase 19 pattern: optional params, backward-compatible defaults, metadata always present

### Integration Points
- `src/tools/read-member.ts`: Tool registration, schema, handler — add linesBefore/linesAfter params, pass to extraction
- `src/browsing/types.ts`: `MemberResult` interface — add memberStartLine/memberEndLine fields
- `src/browsing/member-extractor.ts`: `extractMemberSource()` / `MemberExtraction` — expand context range
- `src/tools/descriptions.ts`: PARAMS and TOOL_DESCRIPTIONS — add parameter descriptions

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-member-context-lines*
*Context gathered: 2026-04-14*
