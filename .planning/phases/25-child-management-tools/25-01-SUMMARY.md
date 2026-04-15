---
phase: 25-child-management-tools
plan: 01
subsystem: tools
tags: [load-project, multi-mod, namespace, jar-id, auto-suffix]

requires:
  - phase: 24-dependency-namespacing
    provides: namespaced dependency IDs (modName/depId format)
provides:
  - load_project adds children to existing or new projects
  - Auto-suffix child name collision handling with namespace renaming
  - jarIdToDirName handles / separator for flat directory names
  - renameChildNamespace utility for dependency ID renaming
  - Multi-mod test factory helpers
affects: [25-02, phase-26-jdtls-workspace]

tech-stack:
  added: []
  patterns: [incremental-jar-registration, child-auto-suffix]

key-files:
  created: []
  modified:
    - src/tools/load-project.ts
    - src/tools/descriptions.ts
    - src/jdtls/uri-mapper.ts
    - src/project/namespace-resolver.ts
    - tests/jdtls/uri-mapper.test.ts
    - tests/project/namespace-resolver.test.ts
    - tests/tools/load-project.test.ts
    - tests/helpers/factories.ts

key-decisions:
  - "load_project defaults to 'default' project instead of auto-generating from basename"
  - "Child auto-suffix uses -2, -3 pattern (not -copy or UUID)"
  - "JDT LS workspace sync for added children deferred to Phase 26"

patterns-established:
  - "Incremental jar registration: addProjectJar for existing projects, registerProject for new"
  - "Child name collision: auto-suffix with renameChildNamespace for dependency ID consistency"

requirements-completed: [CONT-04, TOOL-02, TOOL-03]

duration: 4min
completed: 2026-04-15
---

# Phase 25 Plan 01: Evolve load_project for Multi-Mod Projects Summary

**load_project evolved to add fabric mods as children to existing projects with auto-suffix collision handling and incremental jar registration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T21:05:23Z
- **Completed:** 2026-04-15T21:09:48Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- load_project now uses `project` parameter (defaults to "default") instead of `name`, adding children to existing projects
- jarIdToDirName handles `/` namespace separator producing flat directory names (e.g., `my-mod/minecraft` -> `my-mod--minecraft`)
- renameChildNamespace utility renames all dependency IDs when a child is auto-suffixed
- Auto-suffix on child name collision (testmod -> testmod-2) with full namespace renaming
- Tool result includes child, project, and backward-compat name fields
- Multi-mod test factory helpers (makeFakeFabricModNamed, makeFakeMultiModProject)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix jarIdToDirName and add renameChildNamespace** - `1286fc5` (feat)
2. **Task 2: Evolve load_project to add children to existing projects** - `e667247` (feat)

## Files Created/Modified
- `src/jdtls/uri-mapper.ts` - jarIdToDirName/dirNameToJarId now handle / separator
- `src/project/namespace-resolver.ts` - Added renameChildNamespace function
- `src/tools/load-project.ts` - Evolved to add children to existing projects with auto-suffix
- `src/tools/descriptions.ts` - Updated load_project description for multi-mod behavior
- `tests/jdtls/uri-mapper.test.ts` - Added tests for / separator handling
- `tests/project/namespace-resolver.test.ts` - Added renameChildNamespace tests
- `tests/tools/load-project.test.ts` - Rewritten for multi-mod child behavior (7 tests)
- `tests/helpers/factories.ts` - Added makeFakeFabricModNamed and makeFakeMultiModProject

## Decisions Made
- load_project defaults to "default" project instead of auto-generating from directory basename -- simplifies multi-mod workflow
- Child auto-suffix uses -2, -3 pattern consistent with ProjectStore.generateProjectName
- JDT LS workspace sync for added children deferred to Phase 26 -- logged as info when JDT LS is available

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Multi-mod loading works end-to-end with auto-suffix collision handling
- Ready for Plan 02 (unload_child, list_children, set_default_child tools)
- Phase 26 will need to handle JDT LS workspace sync for incrementally added children

---
*Phase: 25-child-management-tools*
*Completed: 2026-04-15*
