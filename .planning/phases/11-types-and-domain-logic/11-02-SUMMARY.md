---
phase: 11-types-and-domain-logic
plan: 02
subsystem: infra
tags: [study-jar, domain-logic, staleness-detection, jar-reader, validation]

requires:
  - phase: 11-types-and-domain-logic-01
    provides: StudyJar/StudyJarStats types, JarReader.addProjectJar/removeProjectJar, evictEntryIndex
provides:
  - Study jar domain module with full lifecycle (create, validate, track, staleness, convert)
  - refresh_dependencies wiring for study jar survival across dependency refreshes
  - Selective entry index eviction replacing blanket cache clears
affects: [12-tool-implementation, 13-tool-integration]

tech-stack:
  added: []
  patterns: [domain-module-with-DomainError-codes, staleness-detection-via-mtime-size, study-prefix-namespacing]

key-files:
  created:
    - src/project/study-jar.ts
    - tests/project/study-jar.test.ts
  modified:
    - src/tools/refresh-dependencies.ts

key-decisions:
  - "Selective eviction over blanket cache clear -- study jar caches preserved during dependency refresh"
  - "Name validation pattern: alphanumeric start, then alphanumeric/hyphen/dot only"

patterns-established:
  - "Study jar ID namespace: study:{name} prefix avoids collision with Maven-coordinate dependency IDs"
  - "Staleness detection: mtime+size comparison with lazy reopen on change"

requirements-completed: [INFRA-01, INFRA-02]

duration: 5min
completed: 2026-04-14
---

# Phase 11 Plan 02: Study Jar Domain Module Summary

**Study jar lifecycle domain service with validation, creation, staleness detection, DependencyEntry conversion, and refresh_dependencies survival wiring**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-14T05:42:14Z
- **Completed:** 2026-04-14T05:46:51Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Complete study jar domain module: validateStudyJarName, deriveStudyJarName, validateStudyJarId, createStudyJar, checkAndReopenIfStale, studyJarToDependencyEntry
- Study jars survive refresh_dependencies: paths re-registered, staleness checked after refresh
- Selective entry index eviction replaces blanket clearEntryIndexCache for dependency-only eviction
- 23 tests covering all domain functions and refresh survival

## Task Commits

Each task was committed atomically:

1. **Task 1: Create study-jar.ts domain module** - `d5744ac` (test: failing tests), `d6aa774` (feat: implementation)
2. **Task 2: Wire study jars into refresh_dependencies** - `f8e21d7` (feat)

## Files Created/Modified
- `src/project/study-jar.ts` - Study jar domain module with all lifecycle functions
- `tests/project/study-jar.test.ts` - 23 tests for validation, creation, staleness, conversion, refresh survival
- `src/tools/refresh-dependencies.ts` - Study jar re-registration and selective eviction after refresh

## Decisions Made
- Selective eviction over blanket cache clear: study jar entry index caches are preserved during dependency refresh, only dependency jar caches are evicted
- Name validation pattern uses `^[a-zA-Z0-9][a-zA-Z0-9.\-]*$` -- alphanumeric start required, hyphens and dots allowed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertions using error codes instead of messages**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan's test examples used `toThrow('ERROR_CODE')` but DomainError stores code in `.code` property, not in `.message`
- **Fix:** Created `expectDomainError` and `expectAsyncDomainError` test helpers that check `err.code` directly
- **Files modified:** tests/project/study-jar.test.ts
- **Verification:** All 23 tests pass
- **Committed in:** d6aa774 (Task 1 implementation commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correction for test correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Study jar domain module ready for tool layer wiring in Phase 12
- refresh_dependencies integration complete -- study jars are first-class citizens that survive dependency refreshes
- Pre-existing tsc type errors in tool files (ToolError index signature) are unrelated to this plan's changes

---
*Phase: 11-types-and-domain-logic*
*Completed: 2026-04-14*
