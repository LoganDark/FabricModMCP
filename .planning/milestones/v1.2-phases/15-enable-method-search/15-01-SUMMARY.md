---
phase: 15-enable-method-search
plan: 01
subsystem: jdtls
tags: [jdt-ls, workspace-symbol, method-search, lsp]

requires:
  - phase: 14-study-jars
    provides: workspace sync with probe-based readiness detection
provides:
  - method declarations enabled in JDT LS workspace/symbol results
  - probe-free workspace sync (notify-only, asynchronous re-indexing)
  - accurate search_symbols description (types+methods, not fields)
affects: [16-member-parser, 17-structured-output]

tech-stack:
  added: []
  patterns:
    - "JDT LS settings via initializationOptions.settings.java.symbols"
    - "Async workspace sync without readiness probe"

key-files:
  created: []
  modified:
    - src/jdtls/workspace-sync.ts
    - src/jdtls/client.ts
    - src/tools/descriptions.ts
    - tests/jdtls/workspace-sync.test.ts
    - tests/tools/search-symbols.test.ts

key-decisions:
  - "Removed probe entirely rather than replacing with a safer query -- async notification is sufficient"
  - "Tool description explicitly directs users to list_members for field search"

patterns-established:
  - "JDT LS config settings nested under initializationOptions.settings.java"

requirements-completed: [SRCH-01, SRCH-02, SRCH-04]

duration: 2min
completed: 2026-04-14
---

# Phase 15 Plan 01: Enable Method Search Summary

**Unlocked JDT LS method declarations in workspace/symbol, removed explosion-prone readiness probe, corrected search_symbols description to types+methods (not fields)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-14T09:22:54Z
- **Completed:** 2026-04-14T09:25:19Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Deleted waitForWorkspaceSync probe function and all callers -- sync/unsync now notify JDT LS asynchronously
- Added `symbols.includeSourceMethodDeclarations: true` to JDT LS initialization options
- Updated search_symbols tool description to accurately state types and methods are searchable, fields are not
- Added test asserting method results include containerName identifying the declaring class

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove waitForWorkspaceSync and update workspace-sync tests** - `f704ce7` (fix)
2. **Task 2: Enable method declarations setting, update tool description, add test assertion** - `9482ef4` (feat)

## Files Created/Modified
- `src/jdtls/workspace-sync.ts` - Removed waitForWorkspaceSync function and probe calls from sync/unsync
- `src/jdtls/client.ts` - Added symbols.includeSourceMethodDeclarations: true to JDT LS init options
- `src/tools/descriptions.ts` - Updated search_symbols description (types+methods, not fields)
- `tests/jdtls/workspace-sync.test.ts` - Removed probe test block and assertion
- `tests/tools/search-symbols.test.ts` - Added method containerName assertion test

## Decisions Made
- Removed probe entirely rather than replacing with a safer query -- async notification is sufficient for workspace sync; the probe was only needed to block until indexing completed, which is unnecessary for correctness
- Tool description explicitly directs users to list_members for field search rather than just saying "fields not supported"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Method results now flow through search_symbols with kind filtering and containerName
- Ready for Phase 16 (member-parser) to build structured representations of method/field details
- Pre-existing 20 TypeScript tsc errors remain (ToolError/ToolSuccess index signature vs MCP SDK) -- unrelated to this phase

---
*Phase: 15-enable-method-search*
*Completed: 2026-04-14*
