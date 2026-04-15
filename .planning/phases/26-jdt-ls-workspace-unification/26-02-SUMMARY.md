---
phase: 26-jdt-ls-workspace-unification
plan: 02
subsystem: jdtls
tags: [jdt-ls, workspace-sync, mcp-tools, semantic-navigation]

# Dependency graph
requires:
  - phase: 26-01
    provides: "syncFabricModToWorkspace, unsyncFabricModFromWorkspace, initJdtLsSession domain functions"
provides:
  - "JDT LS eager startup wired into create_project tool"
  - "Workspace sync wired into add_fabric_mod tool"
  - "Workspace resync (unsync old + sync new) wired into refresh_project and refresh_project_members"
affects: [navigation-tools, project-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns: ["oldModForUnsync pattern for resync with stale dependency list"]

key-files:
  created: []
  modified:
    - src/tools/create-project.ts
    - src/tools/add-fabric-mod.ts
    - src/tools/refresh-project.ts
    - src/tools/refresh-project-members.ts
    - tests/tools/create-project.test.ts
    - tests/tools/add-fabric-mod.test.ts
    - tests/tools/refresh-project.test.ts
    - tests/tools/refresh-project-members.test.ts

key-decisions:
  - "oldModForUnsync spread pattern preserves old dep list for workspace cleanup before syncing new deps"

patterns-established:
  - "Mock workspace-sync in tool tests: vi.mock with synced:false default, mockClear before assertion tests"

requirements-completed: [LSP-01, LSP-02]

# Metrics
duration: 4min
completed: 2026-04-15
---

# Phase 26 Plan 02: Tool Wiring Summary

**JDT LS lifecycle wired into all project tools -- eager startup on create, sync on add, resync on refresh**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T23:06:19Z
- **Completed:** 2026-04-15T23:10:07Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- create_project eagerly starts JDT LS session and stores it on the project, reporting availability in response
- add_fabric_mod calls syncFabricModToWorkspace instead of logging a Phase 26 TODO placeholder
- refresh_project and refresh_project_members save old deps, unsync old workspace entries, then sync new deps after re-discovery
- 664 tests passing (up from 658), all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire initJdtLsSession into create_project and syncFabricModToWorkspace into add_fabric_mod** - `bdb2f09` (feat)
2. **Task 2: Wire workspace resync into refresh_project and refresh_project_members** - `a9ed81a` (feat)

## Files Created/Modified
- `src/tools/create-project.ts` - Added initJdtLsSession call after project creation, JDT LS status in response
- `src/tools/add-fabric-mod.ts` - Replaced Phase 26 TODO with syncFabricModToWorkspace call, added workspaceSynced to response
- `src/tools/refresh-project.ts` - Added unsyncFabricModFromWorkspace/syncFabricModToWorkspace in refresh loop with oldModForUnsync pattern
- `src/tools/refresh-project-members.ts` - Same resync pattern as refresh-project for member-scoped refresh
- `tests/tools/create-project.test.ts` - Added initJdtLsSession mock, tests for jdtls session storage and response fields
- `tests/tools/add-fabric-mod.test.ts` - Added syncFabricModToWorkspace mock, tests for sync call and workspaceSynced response
- `tests/tools/refresh-project.test.ts` - Added workspace-sync mock, test verifying unsync/sync called per mod
- `tests/tools/refresh-project-members.test.ts` - Added workspace-sync mock, test verifying unsync/sync called for refreshed mods only

## Decisions Made
- Used oldModForUnsync spread pattern (`{ ...mod, dependencyJars: oldDeps }`) to preserve the old dependency list for workspace cleanup, since mod.dependencyJars is already reassigned to new deps by the time we unsync

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock call count accumulation across tests**
- **Found during:** Task 2 (refresh test verification)
- **Issue:** vi.mock mocks accumulate call counts across test cases; new assertion tests saw calls from earlier tests
- **Fix:** Added vi.mocked(fn).mockClear() at start of assertion tests
- **Files modified:** tests/tools/refresh-project.test.ts, tests/tools/refresh-project-members.test.ts
- **Verification:** All 9 refresh tests pass
- **Committed in:** a9ed81a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correct test assertions. No scope creep.

## Issues Encountered
None beyond the mock clearing fix above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 26 complete: all JDT LS workspace lifecycle operations wired into project tools
- Semantic navigation (find_definition, find_references, etc.) now works across all children in a project
- Navigation tools already read from project.jdtls and require no further changes
- 664 tests passing with no regressions

---
*Phase: 26-jdt-ls-workspace-unification*
*Completed: 2026-04-15*
