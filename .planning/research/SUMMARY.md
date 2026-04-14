# Project Research Summary

**Project:** MinecraftDevMCP v1.3 — Context Management
**Domain:** MCP server response size control for Java code navigation
**Researched:** 2026-04-14
**Confidence:** HIGH

## Executive Summary

MinecraftDevMCP v1.3 is a focused response-size control milestone for an existing, mature MCP server (22 tools, 526 tests, 6,863 LOC). The project already has a proven architecture — domain/tool separation, typed envelopes, and established pagination patterns in `search_classes` and `search_symbols`. The core problem is that Minecraft source files and navigation results can overflow Claude's context window: a single `read_source` on `MinecraftClient.java` consumes ~25% of available context, and `find_references` on heavily-used symbols can return 500+ results with full context snippets. All v1.3 work is additive — new optional parameters on existing tools — with zero new dependencies.

The recommended approach is to implement features in four independent phases: line-range reading on `read_source` (highest impact), context lines on `read_member` (quick win), pagination on `find_references` and `find_implementations` (critical for reference-heavy workflows), and a verbosity audit after controls are in place. Every change must preserve backward compatibility — omitting new parameters must produce identical output to the pre-v1.3 version. The existing stack (TypeScript 6.0.2, MCP SDK ^1.29.0, Zod ^4.3.6, node-stream-zip ^1.15.0) is fully sufficient with no additions required.

The dominant risk is breaking existing `structuredContent` contracts through silent field removal or default verbosity changes. A secondary risk is off-by-one errors from the codebase's three simultaneous line-number conventions (0-based LSP, 1-based user-facing, 0-based array indices). Both risks have clear mitigations: additive-only parameters, backward-compatibility tests on every modified tool, and strict naming conventions (`startLine`/`lineCount` for line ranges vs. `offset`/`limit` for pagination).

## Key Findings

### Recommended Stack

No stack changes are needed for v1.3. Every feature is achievable with existing patterns already proven in the codebase: `String.split().slice()` for line-range reading, the `extractContext` pattern from `locate-in-source.ts` for context lines, and `Array.slice(offset, offset + limit)` for pagination. The Zod 4 schemas already installed handle new optional parameter definitions.

**Core technologies (unchanged):**
- TypeScript 6.0.2 / Node.js 22 LTS — primary language and runtime
- @modelcontextprotocol/sdk ^1.29.0 — MCP server implementation, stdio transport; tool results are atomic JSON objects, no streaming
- Zod ^4.3.6 — tool parameter validation with Standard Schema support; new optional params fit directly into existing schema patterns
- node-stream-zip ^1.15.0 — jar reading; `entryData()` returns full entry Buffer (no partial read possible — line slicing happens after decode, not at I/O level)
- ts-lsp-client ^1.1.1 — JDT LS communication; unchanged for v1.3

**What NOT to add:** tokenizer library (wrong model for Claude, WASM overhead, character/4 heuristic is sufficient), streaming response library (MCP tool results are atomic), cursor-based pagination (offset/limit is already the established pattern in this codebase), LRU cache for line splits (violates no-caching project constraint, and splitting is negligible for Java file sizes).

### Expected Features

See `.planning/research/FEATURES.md` for full detail.

**Must have (table stakes):**
- Line-range reading on `read_source` (`startLine` + `lineCount`) — agents cannot work efficiently with 1,000-5,000-line Minecraft classes in full
- Pagination on `find_references` (`limit`/`offset`/`total`/`hasMore`) — references can be 500+ results; currently unbounded and the largest single source of context overflow
- Pagination on `find_implementations` (`limit`/`offset`/`total`/`hasMore`) — same structural problem, lower frequency
- Snippet verbosity control (`snippetMode`: `"signature"` | `"context"` | `"none"`) on navigation tools — each snippet can be a full method body; 30 references × 100-line method = 3,000 lines of snippets

**Should have (differentiators):**
- Context lines on `read_member` (`contextLinesBefore`/`contextLinesAfter`) — follows existing `locate_in_source` pattern exactly; quick win
- Grouped reference counts by package distribution — agent sees distribution at a glance without extra tool calls
- Compact mode on `search_classes` — reduces per-result size ~60-80% for broad discovery searches

**Defer:**
- `search_symbols` result deduplication — quality fix, not context management; bundle in if time permits
- Per-project response size configuration — adds state management for marginal benefit; agents control per-call instead
- Separate summary tool variants (`find_references_summary` etc.) — doubles tool surface area (22 tools already); use parameters on existing tools

### Architecture Approach

The codebase uses a strict domain/tool layered pattern. Truncation and slicing are data transformation operations that belong in the domain layer (new `source-slicer.ts` pure function), while the tool layer handles only Zod validation and MCP envelope formatting. One exception: pagination of already-computed `NavigationResult[]` arrays is trivial enough (single `Array.slice`) to stay in the tool layer via a shared `paginateResults` helper in `tool-helpers.ts`. New fields on existing types (`SourceResult`, `MemberResult`) should always be present — trivially backfilled on the non-sliced path — avoiding optional-field proliferation.

**Major components and changes:**
1. `src/browsing/source-slicer.ts` (NEW) — pure `sliceSource(text, startLine?, lineCount?)` function returning `SlicedSource` with full metadata; no I/O, fully unit-testable
2. `src/browsing/member-extractor.ts` (MODIFY) — add optional `context: { linesBefore, linesAfter }` to `extractMemberSource`, using clamped range expansion matching the `extractContext` pattern in `locate-in-source.ts`
3. `src/tools/tool-helpers.ts` (MODIFY) — add `paginateResults<T>()` helper shared by `find-references.ts` and `find-implementations.ts`
4. `src/tools/read-source.ts` (MODIFY) — add `startLine`/`lineCount` params; disambiguation via existing `makeDisambiguation` when multi-jar + range requested
5. `src/tools/find-references.ts` + `find-implementations.ts` (MODIFY) — add `limit`/`offset` params; slice `processNavigationLocations` output via `paginateResults`
6. `src/tools/descriptions.ts` (MODIFY) — update all changed tool signatures; new params not in descriptions will not be used by agents
7. `src/browsing/types.ts` (MODIFY) — extend `SourceResult` with `totalLineCount`, `startLine`, `endLine`, `truncated` (always present, not optional)

### Critical Pitfalls

1. **Breaking structuredContent contracts** — Never remove fields from existing response shapes. All changes must be additive. Test: calling any modified tool with no new parameters must produce byte-identical `structuredContent` to the pre-change version. This is a cross-cutting constraint enforced in every phase.

2. **Off-by-one errors in line-range extraction** — The codebase simultaneously uses three line conventions: 0-based LSP positions, 1-based user-facing numbers, and 0-based array indices. Use `startLine` as 1-based throughout, document conversions explicitly at each site, and require a reassembly test (reading a file in N-line chunks and concatenating must produce identical output to reading without range params).

3. **Parameter name collision between line-range and pagination** — `offset` already means "skip N results" in `search_classes`/`search_symbols`. Using `offset` for line-range reading would create a semantic collision agents will get wrong. Use `startLine`/`lineCount` for line ranges exclusively; reserve `offset`/`limit` for pagination. Decide naming convention before any Phase 1 implementation begins.

4. **Silent verbosity degradation** — Never reduce default response verbosity. The `context: ContextSnippet` field in `NavigationResult` is the agent's primary reasoning data for understanding references. Removing it causes invisible quality regression (no errors, no test failures, just worse answers). Add opt-in `snippetMode` defaulting to current behavior; agents explicitly request compact when doing bulk scans.

5. **Pagination without clear "more results" signal** — Every paginated response must include `total`, `offset`, `limit`, and `hasMore`. An agent receiving 50 of 312 references without a total count will treat the first page as the complete set and miss critical usages.

6. **Trailing newline phantom line** — `source.split('\n')` on a newline-terminated Java file produces an extra empty element. The existing `lineCount` field already counts this phantom element. The `totalLines` metadata in line-range responses must match `lineCount` exactly, or chunk-reassembly will fail at file boundaries.

7. **Line-range without single-jar requirement** — `read_source` currently searches all matching jars when `jar` is omitted. Different jars may contain different versions of the same class with different line counts. When `startLine`/`lineCount` are provided, the `jar` parameter must be required; the error message must explain why.

## Implications for Roadmap

Phases 1-3 are fully independent and can run in any order. Phase 4 is an analysis phase that is only meaningful after 1-3 provide a controls baseline. The suggested order optimizes for impact.

### Phase 1: Line-Range Reading on read_source

**Rationale:** Highest-value single change. Large Minecraft classes (1,000-5,000+ lines) are the most common source of context overflow in daily use. A single `read_source` on `MinecraftClient.java` consumes ~25% of Claude's context window. This phase enables surgical, targeted access to file regions.

**Delivers:** `startLine`/`lineCount` params on `read_source`; disambiguation response when multi-jar + range; `startLine`/`endLine`/`totalLineCount`/`truncated` metadata added to all `SourceResult` responses (backfilled trivially on the non-sliced path); new `source-slicer.ts` pure domain function.

**Implements:**
- Create `src/browsing/source-slicer.ts` (pure function, fully unit-testable before tool wiring)
- Extend `SourceResult` in `types.ts` with four new always-present fields
- Modify `read-source.ts`: add params, add disambiguation logic, call `sliceSource`
- Update `descriptions.ts`

**Avoids:**
- Off-by-one errors: reassembly test is a required acceptance criterion
- Line-range without jar: hard error with explanatory message, validated before any I/O
- Trailing newline phantom line: reassembly test catches inconsistency
- Parameter name collision: use `startLine`/`lineCount`, not `offset`/`limit`

### Phase 2: Context Lines on read_member

**Rationale:** Small, self-contained change that mirrors the existing `locate_in_source` context parameter pattern exactly. The `extractMemberSource` function already tracks `startLine`/`endLine`; expanding the range is a single clamped slice operation.

**Delivers:** Optional `contextLinesBefore`/`contextLinesAfter` on `read_member`; expanded `source` text and adjusted `startLine`/`endLine` reflecting the wider range; no new types required.

**Implements:**
- Modify `extractMemberSource` in `member-extractor.ts` to accept optional `context` param using clamping from `extractContext` pattern
- Modify `read-member.ts`: add params, pass through to extractor
- Update `descriptions.ts`

**Avoids:**
- Context lines concatenated without separation: PITFALLS.md flags risk of adjacent member fragments appearing in context; test verifies content coherence
- Building redundant feature: evaluate at planning time whether `read_source` line-range makes this unnecessary before implementing

### Phase 3: Navigation Tool Pagination

**Rationale:** Prevents context explosion from unbounded `find_references` results, which is the second-largest source of context overflow. Critical for any workflow analyzing commonly-referenced symbols (e.g., `Identifier.of()`, `World.getBlockState`).

**Delivers:** `limit`/`offset`/`total`/`hasMore` on `find_references` and `find_implementations`; shared `paginateResults<T>` helper in `tool-helpers.ts`; default behavior when limit is omitted preserves full result return for backward compatibility.

**Implements:**
- Add `paginateResults<T>` to `tool-helpers.ts`
- Modify `find-references.ts` and `find-implementations.ts`: add params, slice `processNavigationLocations` output after it returns the full result set
- `snippetMode` parameter added here as well, composing with pagination
- Update `descriptions.ts` for both tools

**Avoids:**
- Pagination without total count: every response includes `total` and `hasMore`
- Breaking existing behavior: limit is optional; omitting it returns all results as before
- Putting pagination inside `processNavigationLocations`: the helper returns all results; the tool handler slices

### Phase 4: Verbosity Audit

**Rationale:** Analysis-first phase that can only be done meaningfully after Phases 1-3 establish size controls. With pagination and line-range in place, the audit focuses on per-result verbosity (is each individual result too large?) rather than total result count.

**Delivers:** Documented assessment of per-result verbosity hot spots; targeted reductions as opt-in flags on affected tools; no default behavior changes without backward-compat tests.

**Implements (TBD from audit):**
- Audit `NavigationResult` context snippet sizes via `extractEnclosingContext` — are full method bodies the right default?
- Audit `search_symbols` output — is `containerName` redundant with `memberFqn`? Can `location.uri` be condensed?
- Audit `list_members` enriched output for large classes (MinecraftClient has ~300 members)
- Audit `search_classes` result shape — are `provenanceChains` and `innerClasses` needed in search results?
- Implement any reductions as opt-in parameters; document what each compact mode omits

**Avoids:**
- Silent verbosity degradation: all changes are opt-in; before/after `structuredContent` comparison required for every tool modified

### Phase Ordering Rationale

- Phases 1-3 are architecturally independent; any order is valid
- Phase 1 first: agents hit context limits reading source files more frequently than any other overflow scenario
- Phase 2 second: smallest change, follows an existing pattern exactly, delivers immediate value for inspection workflows
- Phase 3 third: prevents reference explosion; pairs with `snippetMode` to give agents full control over navigation result size
- Phase 4 last by design: it is an analysis phase that benefits from having Phases 1-3 in place to calibrate what "too verbose" means relative to the new controls
- Parameter naming convention must be settled at the start of Phase 1 — it cannot be changed after any phase ships

### Research Flags

Phases with standard patterns (skip research-phase during planning):
- **Phase 1** (line-range reading): Pure string manipulation; `extractContext` pattern already exists in codebase; no novel dependencies
- **Phase 2** (context lines on read_member): Direct reuse of `locate_in_source` context parameter pattern; no novel patterns
- **Phase 3** (navigation pagination): Direct reuse of `search_classes`/`search_symbols` pagination pattern; `paginateResults` is a one-liner `Array.slice`

Phases potentially needing review during planning:
- **Phase 4** (verbosity audit): Specific fields to audit and change are TBD. Needs hands-on codebase walkthrough during planning to identify verbosity hot spots and confirm that candidate default changes are backward-safe. Not a technical risk — purely an analysis scope question.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct codebase analysis of v1.2; no new dependencies identified; node-stream-zip API confirmed (full entry read only) |
| Features | HIGH | Feature priority derived from measured response sizes; MCP community consensus on pagination best practices; real-world overflow reports in Claude Code and Open WebUI |
| Architecture | HIGH | All patterns derived from direct source reading of live codebase files; no external references needed; existing patterns are unambiguous |
| Pitfalls | HIGH | Based on direct inspection of existing line-number conventions across three files, structuredContent contract analysis, and confirmed pagination gaps in find_references/find_implementations |

**Overall confidence:** HIGH

### Gaps to Address

- **Phase 4 scope**: The verbosity audit has no predetermined list of changes. Specific fields to modify will emerge from the audit itself. This is intentional — Phase 4 is analysis-first.
- **read_member context lines necessity**: PITFALLS.md flags that context lines on `read_member` may be redundant once `read_source` line-range exists (agents can read the lines around a member's `startLine`/`endLine` directly). Evaluate this at Phase 2 planning time.
- **find_references default limit decision**: Research recommends "omit = return all" for backward compatibility. An alternative is a generous explicit default (e.g., 200) with `hasMore` signaling. Decide based on observed reference counts during Phase 3 planning.
- **snippetMode placement**: The feature could be bundled with Phase 3 (navigation pagination) or treated as a standalone sub-phase. Its dependency is only on `find_references`/`find_implementations`/`find_definition` tools, not on line-range or pagination.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis — `src/tools/read-source.ts`, `read-member.ts`, `find-references.ts`, `find-implementations.ts`, `search-classes.ts`, `search-symbols.ts`, `locate-in-source.ts`, `tool-helpers.ts`, `member-extractor.ts`, `context-extractor.ts`, `types/envelope.ts`, `browsing/types.ts`, `jdtls/types.ts`
- [MCP Pagination Specification](https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/pagination) — cursor pagination is for protocol-level listing; offset/limit is correct for tool results
- [MCP TypeScript SDK](https://modelcontextprotocol.io/docs/concepts/tools) — tool responses are complete atomic JSON objects; streaming not supported
- [node-stream-zip API](https://github.com/antelle/node-stream-zip) — `entryData()` returns full entry Buffer; no byte-range or partial read possible (DEFLATE is not randomly seekable)

### Secondary (MEDIUM confidence)
- [MCP Response Size Limit Discussion #2211](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2211) — community consensus: explicit controls over silent truncation; always report total count
- [15 Best Practices for MCP Servers in Production](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/) — cap at reasonable thresholds, always report total_count
- [MCP and Context Overload](https://eclipsesource.com/blogs/2026/01/22/mcp-context-overload/) — each tool definition costs 550-1400 tokens; minimize tool count, maximize parameter flexibility

### Tertiary (informational)
- [Truncated MCP Tool Responses - Claude Code #2638](https://github.com/anthropics/claude-code/issues/2638) — real-world truncation causing agent workflow failures
- [MCP Tool Response Fills Context Window - Open WebUI #15884](https://github.com/open-webui/open-webui/discussions/15884) — validates the problem is widespread across hosts
- [Solving Context Window Overflow in AI Agents](https://arxiv.org/html/2511.22729v1) — progressive disclosure and chunking patterns

---
*Research completed: 2026-04-14*
*Ready for roadmap: yes*
