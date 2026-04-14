---
phase: 13-study-jar-management-tools
plan: 01
subsystem: api
tags: [mcp, tools, study-jar, zod]

requires:
  - phase: 11-study-jar-domain
    provides: StudyJar types, createStudyJar domain service, jar handle management
  - phase: 12-existing-tool-integration
    provides: getDependenciesForTool unified resolver, study jar integration with browsing tools
provides:
  - add_study_jar MCP tool for adding source jars to projects
  - remove_study_jar MCP tool for batch removal with cache eviction
  - list_study_jars MCP tool for listing study jars with stats
  - configure_study_jar MCP tool for toggling auto-include flag
affects: [14-jdtls-classpath-integration]

tech-stack:
  added: []
  patterns: [pre-validation-before-mutation for batch operations, DomainError-to-returnError conversion in tool layer]

key-files:
  created:
    - src/tools/add-study-jar.ts
    - src/tools/remove-study-jar.ts
    - src/tools/list-study-jars.ts
    - src/tools/configure-study-jar.ts
  modified:
    - src/tools/descriptions.ts
    - src/tools/index.ts

key-decisions:
  - "Followed configure-filters.ts as canonical tool pattern exemplar"
  - "Pre-validate all names before mutation in batch operations (remove, configure) for fail-fast with no partial side effects"

patterns-established:
  - "Study jar tool pattern: thin MCP wrappers over domain service in src/project/study-jar.ts"
  - "Batch operation pattern: validate-all-then-apply for remove and configure tools"

requirements-completed: [STUDY-01, STUDY-02, STUDY-03, STUDY-04]

duration: 3min
completed: 2026-04-14
---

# Phase 13 Plan 01: Study Jar Management Tools Summary

**Four MCP tools (add, remove, list, configure) for study jar lifecycle management, wired into registerAllTools with 379 tests green**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-14T06:52:02Z
- **Completed:** 2026-04-14T06:54:48Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Added four tool descriptions to TOOL_DESCRIPTIONS under new "Study jar management" section
- Created four tool files following the canonical configure-filters.ts pattern with proper DomainError handling
- Wired all four tools into registerAllTools, bringing total tool count to 25
- All 379 existing tests remain green with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tool descriptions to descriptions.ts** - `5716a44` (feat)
2. **Task 2: Create all four study jar tool files** - `9b19695` (feat)
3. **Task 3: Wire tools into registerAllTools** - `997b16b` (feat)

## Files Created/Modified
- `src/tools/descriptions.ts` - Added 4 study jar tool description entries
- `src/tools/add-study-jar.ts` - registerAddStudyJarTool wrapping createStudyJar with DomainError catch
- `src/tools/remove-study-jar.ts` - registerRemoveStudyJarTool with pre-validation, jarReader.removeProjectJar, evictEntryIndex
- `src/tools/list-study-jars.ts` - registerListStudyJarsTool mapping studyJars to structured response
- `src/tools/configure-study-jar.ts` - registerConfigureStudyJarTool with pre-validation, autoInclude toggle
- `src/tools/index.ts` - Import and register all 4 study jar tools

## Decisions Made
- Followed configure-filters.ts as canonical tool pattern exemplar -- consistent with existing codebase
- Pre-validate all names before mutation in batch operations (remove, configure) for fail-fast with no partial side effects

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 study jar CRUD tools operational, completing the study jar management surface
- Ready for Plan 02 (tests) and Phase 14 (JDT LS classpath integration)

## Self-Check: PASSED

All 6 files verified present. All 3 task commits verified in git log.

---
*Phase: 13-study-jar-management-tools*
*Completed: 2026-04-14*
