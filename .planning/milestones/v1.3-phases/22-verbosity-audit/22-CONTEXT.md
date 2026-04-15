# Phase 22: Verbosity Audit - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Measure real response sizes across search, navigation, and listing tools using real Minecraft project data. Reduce default verbosity by making responses small by default with opt-in granular detail flags. Tools that produce large results get a `details` parameter object with per-tool boolean fields.

Requirements: VERB-01, VERB-02, VERB-03

**Requirements update:** The original REQUIREMENTS.md Out of Scope entry "Changing default output to compact" is superseded. The new direction is small by default, opt-in for detail. This is a deliberate breaking change — this MCP server is consumed by agents, not stable software, and agents adapt.

</domain>

<decisions>
## Implementation Decisions

### Default response philosophy
- Small by default, opt-in for more detail
- NOT compact mode (opt-in to be small) — the opposite: opt-in to be large
- This is a breaking change to structuredContent shapes — accepted because consumers are agents that adapt
- The original Out of Scope entry against changing defaults is overridden by this decision

### Detail parameter design
- `details` object parameter with per-tool boolean flags, all defaulting to false (= small)
- Per-tool schemas: each tool defines only the flags relevant to it
- Shared supertypes for common flags across tool categories, merged with `&` for tool-specific additions
- Only tools with optional detail fields accept `details` — tools with nothing to strip don't get it
- Example: `details: { lineContent: true, javadoc: true }` not `includeLineContent: true` at top level

### Audit scope
- Audit the high-volume tools only:
  - Navigation: find_references, find_implementations, find_definition
  - Search: search_symbols, search_classes
  - Listing: list_members, list_classes, list_packages
  - locate_in_source
  - type_hierarchy
- Skip: read_source, read_member (already have size controls), get_project_metadata, get_symbol_info, project management tools
- Measure structuredContent sizes only (text summaries are fine as-is)

### Audit methodology
- Use real Minecraft project data with real tool calls
- Benchmark classes: ClientPlayerEntity and GameRenderer — these are the real-world pain points that cause Claude Code's harness to hard-error at response size
- Produce audit report with measured sizes (pre- and post-reduction)

### Per-tool detail flags (expected shape, refined during audit)
- Navigation tools (find_references, find_implementations, find_definition): `details: { lineContent?: boolean }` — lineContent/context fields
- Member tools (list_members, search_symbols): `details: { javadoc?: boolean, annotations?: boolean }` — documentation metadata
- locate_in_source: `details: { context?: boolean }` — surrounding context lines
- Exact flags determined by audit data — these are starting hypotheses

### Claude's Discretion
- Exact shared supertype hierarchy for detail flags
- Which fields constitute "essential" vs "detail" per tool
- Audit report format and placement
- Whether to consolidate any tools' detail flags after seeing audit data
- How to handle list_classes, list_packages, type_hierarchy detail flags (may not need any)

</decisions>

<specifics>
## Specific Ideas

- ClientPlayerEntity and GameRenderer have been almost impossible to study because they cause Claude Code's harness to hard-error at the size of the tool responses, without the agent even getting a chance to look at it
- The audit should quantify exactly how large these responses are and demonstrate the reduction
- Success criteria #4 requires backward compat when no new params are passed — but this is now inverted: the NEW default is small, so "no new params" gives the small version. Old behavior requires passing `details` flags. This is the accepted breaking change.

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — VERB-01, VERB-02, VERB-03 definitions (note: Out of Scope entry on default compact is overridden by decisions above)

### Roadmap
- `.planning/ROADMAP.md` — Phase 22 success criteria (4 criteria including backward compat, which is reinterpreted per decisions above)

### Prior phase context
- `.planning/phases/21-navigation-pagination/21-CONTEXT.md` — Navigation tool pagination decisions (limit/offset already added)
- `.planning/phases/19-line-range-reading/19-CONTEXT.md` — Line-range reading decisions, metadata shape conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/tools/descriptions.ts`: PARAMS shared schemas — add detail type definitions here
- `src/tools/pagination.ts`: Shared utility pattern — model for shared detail type definitions
- `src/types/envelope.ts`: `makeSuccess()` envelope builder — structuredContent shape

### Established Patterns
- All tools use `{ content: [text], structuredContent: envelope }` response pattern
- Navigation tools share `processNavigationLocations` which returns `NavigationResult[]` — detail stripping can happen here or per-tool
- Member tools share `symbol-transform.ts` for member representation — detail stripping can happen at transform level
- `PARAMS` object in descriptions.ts for shared parameter schemas

### Integration Points
- Each audited tool's handler: add `details` to inputSchema, conditionally include/exclude fields based on flags
- `src/tools/tool-helpers.ts`: `processNavigationLocations` returns full results — may need a post-processing step to strip fields
- Shared detail types: new file or added to descriptions.ts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-verbosity-audit*
*Context gathered: 2026-04-14*
