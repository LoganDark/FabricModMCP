---
phase: 25-child-management-tools
plan: 02
subsystem: tools
tags: [refresh-dependencies, unload-project, scope, jar-lifecycle, multi-mod]

requires:
  - phase: 25-child-management-tools
    plan: 01
    provides: load_project multi-mod support, incremental jar registration
provides:
  - Scope-aware refresh_dependencies with per-child jar lifecycle
  - autoUnloadConflictingStudyJarsForDeps for scoped collision checks
  - Scoped unload with jar handle cleanup and workspace sync
affects: [phase-26-jdtls-workspace]

tech-stack:
  added: []
  patterns: [per-child-jar-lifecycle, scoped-collision-check]

key-files:
  created:
    - tests/tools/refresh-dependencies.test.ts
  modified:
    - src/tools/refresh-dependencies.ts
    - src/tools/unload-project.ts
    - src/tools/descriptions.ts
    - src/project/study-jar.ts
    - tests/tools/unload-project.test.ts

key-decisions:
  - "Scoped refresh uses removeProjectJar/addProjectJar per-jar, never closeProject/registerProject"
  - "Scoped collision check uses autoUnloadConflictingStudyJarsForDeps against refreshed child's deps only"
  - "Scoped unload rebuilds .classpath and notifies JDT LS after removing child workspace entries"

patterns-established:
  - "Per-child jar lifecycle: scoped operations use removeProjectJar/addProjectJar, not closeProject/registerProject"
  - "Scoped collision check: autoUnloadConflictingStudyJarsForDeps checks only against specified dep map"

requirements-completed: [DEP-04, TOOL-01]

duration: 4min
completed: 2026-04-15
---

# Phase 25 Plan 02: Scope-Aware Refresh and Scoped Unload Cleanup Summary

**refresh_dependencies scope-aware with per-child jar lifecycle, scoped study jar collision checks, and unload with jar handle + workspace cleanup**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T21:11:05Z
- **Completed:** 2026-04-15T21:15:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- refresh_dependencies accepts scope parameter for targeted per-child refresh without disrupting other children
- Scoped refresh uses removeProjectJar/addProjectJar for per-jar lifecycle (not closeProject/registerProject)
- autoUnloadConflictingStudyJarsForDeps checks study jar conflicts only against refreshed child's deps
- Scoped unload cleans up jar handles, evicts entry index caches, rebuilds .classpath, and notifies JDT LS
- 8 new tests (6 refresh, 2 unload) covering scoped/unscoped paths and collision check scoping

## Task Commits

Each task was committed atomically:

1. **Task 1: Make refresh_dependencies scope-aware** - `5abb9aa` (feat)
2. **Task 2: Add jar handle cleanup to scoped unload** - `763764b` (feat)

## Files Created/Modified
- `src/tools/refresh-dependencies.ts` - Scope-aware refresh with resolveFabricModsForRefresh, per-child jar close/re-register
- `src/project/study-jar.ts` - Added autoUnloadConflictingStudyJarsForDeps for scoped collision checks
- `src/tools/descriptions.ts` - Updated refresh_dependencies description to document scope behavior
- `src/tools/unload-project.ts` - Scoped unload with jar handle cleanup, workspace rebuild, JDT LS notification
- `tests/tools/refresh-dependencies.test.ts` - 6 tests for scoped/unscoped refresh and collision check scoping
- `tests/tools/unload-project.test.ts` - Added 2 tests for scoped unload jar cleanup

## Decisions Made
- Scoped refresh uses removeProjectJar/addProjectJar per-jar instead of closeProject/registerProject -- preserves other children's jar handles
- Scoped collision check uses autoUnloadConflictingStudyJarsForDeps to check only against the refreshed child's dep map -- prevents unloading study jars that only conflict with other children's deps
- Scoped unload rebuilds .classpath and notifies JDT LS after removing entries -- keeps workspace in sync

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 25 plans complete -- multi-mod child management fully operational
- Scoped refresh and scoped unload handle jar lifecycle correctly
- Phase 26 JDT LS workspace sync for incrementally added children is the next step

---
*Phase: 25-child-management-tools*
*Completed: 2026-04-15*
