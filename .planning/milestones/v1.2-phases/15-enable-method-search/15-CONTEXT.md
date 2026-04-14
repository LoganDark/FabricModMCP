# Phase 15: Enable Method Search - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

search_symbols fulfills its promise of returning methods, not just types. Enable `includeSourceMethodDeclarations` in JDT LS config, fix the readiness probe explosion risk, and update the tool description to accurately reflect capabilities.

</domain>

<decisions>
## Implementation Decisions

### Readiness probe removal
- Remove `waitForWorkspaceSync` entirely from `workspace-sync.ts` — do not replace with a sentinel query
- JDT LS handles indexing internally; real queries will naturally wait or return partial results
- The existing probe was only a liveness check (checks "got an array back"), not a completeness guarantee
- Callers of `waitForWorkspaceSync` (study jar add/remove tools) should stop awaiting it
- This satisfies SRCH-02 by eliminating the explosion-prone `query: '*'` probe entirely

### JDT LS method declarations
- Add `includeSourceMethodDeclarations: true` to JDT LS initialization settings at `client.ts` `initializationOptions.settings.java`
- No other JDT LS config changes needed — this single setting unlocks method results in `workspace/symbol`

### Result volume
- No guardrails needed — JDT LS has its own internal result cap, and `search_symbols` already has pagination
- No truncation warnings, no smart kind filtering, no default filters

### Tool description update
- Be precise about what's findable: types (classes, interfaces, enums) and methods/constructors
- Explicitly note that fields are not searchable via workspace/symbol (no `includeSourceFieldDeclarations` setting exists in JDT LS)
- Remove "fields" from the current description which falsely lists them as searchable

### Claude's Discretion
- Exact wording of updated tool description
- Whether to update the server instructions workflow section mentioning search_symbols
- Any internal refactoring of workspace-sync.ts after removing the probe function

</decisions>

<specifics>
## Specific Ideas

No specific requirements — the changes are well-defined by the requirements and success criteria.

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — SRCH-01 (method results), SRCH-02 (readiness probe fix), SRCH-04 (tool description accuracy)

### Roadmap
- `.planning/ROADMAP.md` — Phase 15 success criteria (4 criteria: method results with SymbolKind, probe fix, description update, containerName)

### Key source files
- `src/jdtls/client.ts` lines 200-232 — JDT LS initialization options where `includeSourceMethodDeclarations` must be added
- `src/jdtls/workspace-sync.ts` lines 74-98 — `waitForWorkspaceSync` function to remove
- `src/tools/search-symbols.ts` — search_symbols tool implementation (already handles method kind numbers)
- `src/tools/descriptions.ts` line 143-144 — Tool description to update

### Out of scope reference
- `.planning/REQUIREMENTS.md` "Out of Scope" table — confirms field search is a JDT LS hard limitation, not a bug to fix

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `search-symbols.ts` `KIND_NAME_TO_NUMBER` map already includes `method: 6` and `constructor: 9` — no changes needed to kind filtering
- `SYMBOL_KIND_NAME` map in `jdtls/symbol-kind.ts` already maps kind numbers to display names

### Established Patterns
- JDT LS settings live in `initializationOptions.settings.java` object passed during `client.initialize()`
- Tool descriptions centralized in `TOOL_DESCRIPTIONS` object in `descriptions.ts`
- `waitForWorkspaceSync` is called from study jar add/remove tool handlers — those callers need updating

### Integration Points
- `workspace-sync.ts` exports `waitForWorkspaceSync` — removing it affects callers in study jar tools
- `client.ts` `startJdtLs` — initialization options are the only place to configure JDT LS settings
- `search-symbols.ts` sends `workspace/symbol` — will automatically receive method results once the setting is enabled

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 15-enable-method-search*
*Context gathered: 2026-04-14*
