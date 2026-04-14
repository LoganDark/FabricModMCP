---
phase: 12-existing-tool-integration
plan: 01
subsystem: api
tags: [dependency-resolver, study-jar, tool-helpers, search]

requires:
  - phase: 11-study-jar-management
    provides: StudyJar type system, studyJarToDependencyEntry conversion
provides:
  - getResolvedDependencies function (real deps + autoInclude study jars)
  - getAllDependencies function (real deps + ALL study jars)
  - getDependenciesForTool helper (two-mode resolver for tool layer)
  - CATEGORY_PRIORITY with study at priority 4
  - Simplified searchClasses signature (4 params, pre-resolved deps)
affects: [12-02-PLAN, tool-integration, browsing]

tech-stack:
  added: []
  patterns: [two-mode-resolver, pre-resolved-deps-pattern]

key-files:
  created:
    - src/project/dependency-resolver.ts
    - tests/project/dependency-resolver.test.ts
  modified:
    - src/tools/tool-helpers.ts
    - src/browsing/search.ts
    - src/tools/search-classes.ts
    - tests/browsing/search.test.ts
    - tests/helpers/factories.ts

key-decisions:
  - "Two-mode resolver: getResolvedDependencies for default views, getAllDependencies for explicit jar selection"
  - "searchClasses accepts pre-resolved deps, pushing filtering responsibility to callers"

patterns-established:
  - "Pre-resolved deps pattern: tools call getDependenciesForTool, pass result to domain functions"
  - "Study jar priority 4: study jars always sort after library jars in results"

requirements-completed: [INTG-01, INTG-02]

duration: 5min
completed: 2026-04-14
---

# Phase 12 Plan 01: Dependency Resolver Summary

**Two-mode dependency resolver (resolved vs all) with getDependenciesForTool helper and simplified searchClasses signature**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-14T06:16:16Z
- **Completed:** 2026-04-14T06:21:26Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created dependency-resolver.ts with getResolvedDependencies (autoInclude=true only) and getAllDependencies (all study jars)
- Added getDependenciesForTool to tool-helpers.ts providing unified two-mode resolution for all tools
- Simplified searchClasses from 5 parameters to 4 by accepting pre-resolved deps instead of raw deps+filterConfig
- Added CATEGORY_PRIORITY['study'] = 4, ensuring study jars sort after library jars

## Task Commits

Each task was committed atomically:

1. **Task 1: Create dependency-resolver.ts and tests** - `5a6f586` (feat)
2. **Task 2: Add CATEGORY_PRIORITY['study'], getDependenciesForTool, and update searchClasses signature** - `cae5b30` (feat)

## Files Created/Modified
- `src/project/dependency-resolver.ts` - Two-mode resolver: getResolvedDependencies and getAllDependencies
- `src/tools/tool-helpers.ts` - getDependenciesForTool helper, CATEGORY_PRIORITY['study'] = 4
- `src/browsing/search.ts` - Simplified searchClasses signature (4 params, pre-resolved deps)
- `src/tools/search-classes.ts` - Updated to use getDependenciesForTool before calling searchClasses
- `tests/project/dependency-resolver.test.ts` - 18 tests covering resolver and getDependenciesForTool
- `tests/browsing/search.test.ts` - Updated for new searchClasses signature
- `tests/helpers/factories.ts` - Added studyJars to makeFakeProject

## Decisions Made
- Two-mode resolver API: getResolvedDependencies for default tool behavior (autoInclude=true only), getAllDependencies for explicit jar selection via jars parameter
- searchClasses now receives pre-resolved deps, pushing jar filtering responsibility to the tool layer via getDependenciesForTool

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added studyJars to test helper factory**
- **Found during:** Task 2 (integration test failures)
- **Issue:** makeFakeProject in tests/helpers/factories.ts lacked studyJars field, causing getDependenciesForTool to crash when iterating project.studyJars
- **Fix:** Added `studyJars: new Map()` to makeFakeProject default
- **Files modified:** tests/helpers/factories.ts
- **Verification:** All 379 tests pass
- **Committed in:** cae5b30 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for test infrastructure compatibility. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- dependency-resolver.ts and getDependenciesForTool ready for plan 02 to wire into all remaining tools
- searchClasses already updated; plan 02 will update list-packages, list-classes, read-source, and LSP tools
- All 379 tests passing, no regressions

---
*Phase: 12-existing-tool-integration*
*Completed: 2026-04-14*
