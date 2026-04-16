---
phase: 28-jar-and-cache-bug-fixes
plan: 01
subsystem: jar-io, caching, api
tags: [node-stream-zip, entry-index-cache, race-condition, error-messages, provenance]

requires:
  - phase: 25.1-rework-tools-and-tests
    provides: Native Project/FabricModChild/StudyJarChild types, evictEntryIndex pattern
provides:
  - Cache eviction in remove_project before closeProject
  - Race-safe JarReader.getHandle with Promise-based handle map
  - Corrected error messages referencing list_packages and list_classes
  - Provenance metadata in add_study_jar response envelope
affects: [documentation, api-consistency]

tech-stack:
  added: []
  patterns: [promise-based-handle-map, evict-before-close]

key-files:
  created: []
  modified:
    - src/tools/remove-project.ts
    - src/project/jar-reader.ts
    - src/tools/read-jar-entry.ts
    - src/tools/add-study-jar.ts
    - tests/tools/remove-project.test.ts
    - tests/project/jar-reader.test.ts
    - tests/tools/add-study-jar.test.ts

key-decisions:
  - "Store Promise<StreamZip> instead of StreamZip in handles map for race-safe concurrent access"
  - "Evict cache entries for both jar paths and mod source keys before closeProject"

patterns-established:
  - "Promise-based handle map: store the Promise immediately on first access, concurrent callers await the same Promise"
  - "Evict-before-close: always evict dependent caches before destroying the data source they depend on"

requirements-completed: [FIX-01, FIX-03, FIX-07, FIX-08]

duration: 3min
completed: 2026-04-16
---

# Phase 28 Plan 01: Jar and Cache Bug Fixes Summary

**Race-safe jar handle caching, entry index eviction on project removal, corrected error messages, and provenance metadata on add_study_jar**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-16T00:23:37Z
- **Completed:** 2026-04-16T00:26:22Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- JarReader.getHandle stores Promise immediately, eliminating race condition where concurrent callers could create duplicate StreamZip instances
- remove_project evicts all entryIndexCache entries (jar paths + mod source keys) before calling closeProject, preventing stale cache memory leaks
- Error messages in read_jar_entry and jar-reader.readEntry now correctly suggest list_packages and list_classes instead of non-existent listEntries tool
- add_study_jar response envelope includes provenance metadata (tool + project) matching the pattern used by all other tools

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix cache eviction in remove_project and race condition in JarReader.getHandle** - `6f62646` (fix, TDD)
2. **Task 2: Fix error messages and add provenance metadata** - `68b2471` (fix)

## Files Created/Modified
- `src/tools/remove-project.ts` - Added evictEntryIndex calls before closeProject for jar paths and child cache keys
- `src/project/jar-reader.ts` - Changed handles map to Promise-based, race-safe getHandle, corrected error message
- `src/tools/read-jar-entry.ts` - Corrected error message to suggest list_packages and list_classes
- `src/tools/add-study-jar.ts` - Added provenance metadata to makeSuccess call
- `tests/tools/remove-project.test.ts` - Added cache eviction and ordering tests
- `tests/project/jar-reader.test.ts` - Added concurrent access and failure retry tests
- `tests/tools/add-study-jar.test.ts` - Added provenance metadata verification test

## Decisions Made
- Changed handles map type from `Map<string, StreamZip>` to `Map<string, Promise<StreamZip>>` -- the Promise is stored immediately before any await, so concurrent callers get the same handle without creating duplicates
- On failure, the sentinel Promise is deleted from the map so subsequent calls can retry

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed provenance test to use metadata.provenance**
- **Found during:** Task 2
- **Issue:** Plan suggested envelope.provenance but actual envelope structure nests provenance under metadata
- **Fix:** Changed test assertion to check envelope.metadata.provenance
- **Files modified:** tests/tools/add-study-jar.test.ts
- **Verification:** Test passes correctly
- **Committed in:** 68b2471

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test assertion correction. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four bug fixes complete (FIX-01, FIX-03, FIX-07, FIX-08)
- 670 tests passing (5 new tests added)
- Ready for next phase of v1.5 work

---
*Phase: 28-jar-and-cache-bug-fixes*
*Completed: 2026-04-16*
