---
phase: 11-types-and-domain-logic
plan: 01
subsystem: infra
tags: [typescript, types, jar-reader, cache, ref-counting]

# Dependency graph
requires: []
provides:
  - StudyJar and StudyJarStats type interfaces
  - JarCategory 'study' literal
  - LoadedProject.studyJars field
  - JarReader.addProjectJar and removeProjectJar methods with ref-counting
  - evictEntryIndex function for granular cache eviction
affects: [11-02, study-jar-service, study-jar-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [granular jar management with ref-counting, single-key cache eviction]

key-files:
  created:
    - tests/browsing/entry-index-cache.test.ts
  modified:
    - src/project/types.ts
    - src/project/jar-reader.ts
    - src/project/loader.ts
    - src/browsing/entry-index-cache.ts
    - tests/project/jar-reader.test.ts

key-decisions:
  - "StudyJar types added alongside existing DependencyEntry rather than extending it -- separate concern"
  - "removeProjectJar is a safe no-op for unregistered projects (consistent with closeProject behavior)"

patterns-established:
  - "Granular add/remove pattern: addProjectJar/removeProjectJar for per-jar operations vs registerProject for bulk"
  - "Cache eviction pattern: evictEntryIndex for single-key removal vs clearEntryIndexCache for full reset"

requirements-completed: [INFRA-01, INFRA-02]

# Metrics
duration: 3min
completed: 2026-04-14
---

# Phase 11 Plan 01: Types and Domain Logic Summary

**StudyJar type system with granular JarReader add/remove and per-key cache eviction**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-14T05:37:30Z
- **Completed:** 2026-04-14T05:40:26Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- StudyJar and StudyJarStats interfaces exported from types.ts with JarCategory extended to include 'study'
- JarReader extended with addProjectJar/removeProjectJar supporting ref-counted handle lifecycle
- evictEntryIndex function added for granular cache eviction without clearing all entries
- 11 new tests added (6 for jar-reader, 5 for entry-index-cache), all 338 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Add StudyJar types** - `0fa7c5b` (feat)
2. **Task 2: Add addProjectJar/removeProjectJar** - `a3d65ef` (test) + `b56c254` (feat)
3. **Task 3: Add evictEntryIndex** - `0d76dbe` (test) + `0ee1733` (feat)

_TDD tasks have separate test and implementation commits._

## Files Created/Modified
- `src/project/types.ts` - Added StudyJar, StudyJarStats interfaces; extended JarCategory and LoadedProject
- `src/project/jar-reader.ts` - Added addProjectJar and removeProjectJar methods
- `src/project/loader.ts` - Initialize studyJars as empty Map in loadProject
- `src/browsing/entry-index-cache.ts` - Added evictEntryIndex function
- `tests/project/jar-reader.test.ts` - Added 6 tests for granular add/remove behavior
- `tests/browsing/entry-index-cache.test.ts` - Created with 5 tests for eviction and cache behavior

## Decisions Made
- StudyJar types are separate interfaces rather than extending DependencyEntry -- different lifecycle and semantics
- removeProjectJar is a no-op for unregistered projects (consistent with closeProject's existing behavior)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added studyJars initialization in loader.ts**
- **Found during:** Task 1 (type verification)
- **Issue:** Adding required `studyJars` field to LoadedProject caused TS2741 error in loader.ts where LoadedProject is constructed
- **Fix:** Added `studyJars: new Map()` to the return object in loadProject
- **Files modified:** src/project/loader.ts
- **Verification:** `npx tsc --noEmit` no longer reports studyJars error
- **Committed in:** 0fa7c5b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for type correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Type contracts established for StudyJar system
- JarReader has granular per-jar add/remove with ref-counting
- Entry index cache has per-key eviction
- Ready for plan 02 (service layer and tool integration)

## Self-Check: PASSED

All 6 files verified present. All 5 commits verified in git log.

---
*Phase: 11-types-and-domain-logic*
*Completed: 2026-04-14*
