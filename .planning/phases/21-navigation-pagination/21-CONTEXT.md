# Phase 21: Navigation Pagination - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Add limit and offset parameters to find_references, find_implementations, and find_definition so agents can paginate large navigation result sets instead of receiving unbounded results. Omitting these params returns all results (backward compatible).

Requirements: NAV-01, NAV-02, NAV-03, NAV-04

</domain>

<decisions>
## Implementation Decisions

### Response metadata shape
- Include `hasMore` boolean in response (as required by success criteria)
- Also include `total` and `offset` (matching search_classes precedent)
- Response shape: `{ results, total, offset, hasMore }` alongside existing `sourcePosition`
- Agent gets all the info it needs without computing anything

### Pagination layer placement
- Create a shared pagination utility (not inline in each tool handler)
- Standardize pagination input type: `{ limit?: number, offset?: number }`
- Standardize pagination output type: `{ results: T[], total: number, offset: number, hasMore: boolean }`
- All three navigation tools use this utility after `processNavigationLocations`
- search_classes already has its own pagination in search.ts; no need to retrofit it

### Default limit behavior
- When `limit` is omitted, return ALL results (no cap)
- This is different from search_classes (which defaults to 250) -- navigation results are typically smaller and agents need the full picture by default
- `offset` without `limit` returns all results starting from offset

### Claude's Discretion
- Exact file placement for the pagination utility
- Whether to add pagination params to PARAMS in descriptions.ts or define inline
- Error handling for invalid values (negative offset, zero limit)
- Whether the shared utility is a function or a type + function pair

</decisions>

<specifics>
## Specific Ideas

- All three navigation tools have nearly identical post-processing structure: LSP call -> normalizeLocations -> processNavigationLocations -> build envelope. Pagination slots in right before envelope construction as a simple array slice.
- The `hasMore` field is explicitly called out in all four success criteria -- it must be present in the response even when pagination is not used (set to false).

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` -- NAV-01 through NAV-04 definitions and acceptance criteria

### Roadmap
- `.planning/ROADMAP.md` -- Phase 21 success criteria (4 criteria: per-tool pagination + backward compat)

### Prior phase context
- `.planning/phases/19-line-range-reading/19-CONTEXT.md` -- Establishes clamping and metadata conventions
- `.planning/phases/20-member-context-lines/20-CONTEXT.md` -- Establishes backward-compat pattern for optional params

### Existing pagination precedent
- `src/browsing/search.ts` -- search_classes pagination with `{ total, offset, results }` shape

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/browsing/search.ts`: Existing pagination pattern with offset/limit/total -- reference for the new shared utility
- `src/tools/tool-helpers.ts`: `processNavigationLocations()` -- shared post-processing that all three tools already use
- `src/tools/descriptions.ts`: PARAMS shared schema definitions -- add limit/offset here

### Established Patterns
- All three navigation tools follow identical structure: resolveSymbolPosition -> LSP call -> normalizeLocations -> processNavigationLocations -> makeSuccess envelope
- `search_classes` pagination uses `offset ?? 0` and `limit ?? 250` with `sorted.slice(offset, offset + limit)`
- Tool responses use `{ content: [text summary], structuredContent: envelope }` pattern

### Integration Points
- `src/tools/find-references.ts`: Add limit/offset to schema and handler, apply pagination before envelope
- `src/tools/find-implementations.ts`: Same changes
- `src/tools/find-definition.ts`: Same changes
- `src/tools/descriptions.ts`: Add PARAMS.limit and PARAMS.offset shared schemas
- New shared pagination utility (Claude's discretion on placement)

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 21-navigation-pagination*
*Context gathered: 2026-04-14*
