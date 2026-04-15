---
phase: 26-jdt-ls-workspace-unification
plan: 01
subsystem: jdtls
tags: [jdt-ls, workspace-sync, fabric-mod, lsp, session-init]

# Dependency graph
requires:
  - phase: 25.1-rework-tools-and-tests
    provides: FabricModChild type, native project architecture, workspace-sync pattern for study jars
provides:
  - syncFabricModToWorkspace function for incremental workspace extraction
  - unsyncFabricModFromWorkspace function for workspace cleanup
  - initJdtLsSession helper encapsulating JDT LS lifecycle
  - generateProjectFile exported from workspace.ts
affects: [26-02 tool wiring, create-project, add-fabric-mod, remove-project-member, refresh-project-members]

# Tech tracking
tech-stack:
  added: []
  patterns: [mod-source deps extract under fabricMod.name instead of dep.id, dual-key jarIdToDirName for mod source]

key-files:
  created:
    - src/jdtls/startup.ts
    - tests/jdtls/startup.test.ts
  modified:
    - src/jdtls/workspace-sync.ts
    - src/jdtls/workspace.ts
    - tests/jdtls/workspace-sync.test.ts

key-decisions:
  - "Mod-source deps extract under fabricMod.name dir, not dep.id dir -- keeps mod source at clean path like 'testmod/' instead of 'testmod--testmod/'"
  - "Dual-key jarIdToDirName: both dep.id and fabricMod.name point to the same mod-source dir -- enables lookup by either key"

patterns-established:
  - "Fabric mod workspace sync: extract per-dep -> update jarIdToDirName -> regenerate .classpath -> notify JDT LS"
  - "initJdtLsSession: detect Java -> find JDT LS -> create temp workspace -> start process -> monitor exit"

requirements-completed: [LSP-01]

# Metrics
duration: 5min
completed: 2026-04-15
---

# Phase 26 Plan 01: Workspace Sync and Session Init Summary

**syncFabricModToWorkspace extracts all fabric mod deps into namespaced JDT LS workspace dirs; initJdtLsSession encapsulates detect-Java + find-JDT-LS + start + graceful-degradation flow**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-15T23:01:15Z
- **Completed:** 2026-04-15T23:06:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- syncFabricModToWorkspace and unsyncFabricModFromWorkspace functions following proven study jar sync pattern
- initJdtLsSession helper with graceful degradation when Java or JDT LS unavailable
- Process exit monitoring that sets available=false on crash
- generateProjectFile exported from workspace.ts for reuse
- 16 new tests (10 workspace-sync + 6 startup), full suite at 658 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Add syncFabricModToWorkspace and unsyncFabricModFromWorkspace** - `31992a4` (feat)
2. **Task 2: Create initJdtLsSession helper in startup.ts** - `f9cbbfb` (feat)

## Files Created/Modified
- `src/jdtls/workspace-sync.ts` - Added syncFabricModToWorkspace and unsyncFabricModFromWorkspace
- `src/jdtls/startup.ts` - New module with initJdtLsSession helper
- `src/jdtls/workspace.ts` - Exported generateProjectFile (was private)
- `tests/jdtls/workspace-sync.test.ts` - 10 new tests for fabric mod sync/unsync
- `tests/jdtls/startup.test.ts` - 6 new tests for session initialization

## Decisions Made
- Mod-source deps extract under `fabricMod.name` directory (e.g., `testmod/`) rather than `jarIdToDirName(dep.id)` (e.g., `testmod--testmod/`) -- cleaner workspace structure, matches how study jars use their plain name
- Both `dep.id` and `fabricMod.name` are stored as keys in `jarIdToDirName` pointing to the same directory -- enables lookup by either key for different consumers

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mod-source extraction directory naming**
- **Found during:** Task 1 (syncFabricModToWorkspace implementation)
- **Issue:** Plan's pseudocode extracted mod-source deps under `jarIdToDirName(dep.id)` which produces `testmod--testmod`, but tracked the mod name as a separate entry pointing to `jarIdToDirName(fabricMod.name)` which produces `testmod` -- directory mismatch
- **Fix:** Mod-source deps now extract under `jarIdToDirName(fabricMod.name)` and both the dep.id and fabricMod.name keys point to that same directory
- **Files modified:** src/jdtls/workspace-sync.ts
- **Verification:** All 24 workspace-sync tests pass
- **Committed in:** 31992a4 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix necessary for consistent directory naming. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- syncFabricModToWorkspace and unsyncFabricModFromWorkspace ready for Plan 02 to wire into add_fabric_mod, remove_project_member, and refresh tools
- initJdtLsSession ready for Plan 02 to wire into create_project
- All existing tests still pass (658 total)

---
*Phase: 26-jdt-ls-workspace-unification*
*Completed: 2026-04-15*
