---
phase: 12-existing-tool-integration
plan: 02
subsystem: tools
tags: [dependency-resolver, study-jars, refactor]

requires:
  - phase: 12-existing-tool-integration (plan 01)
    provides: getResolvedDependencies, getAllDependencies, getDependenciesForTool, simplified searchClasses
provides:
  - All tool files wired through dependency resolver
  - Study jars universally visible through all browsing and navigation tools
  - No direct dependencyJars access in tool layer (except load-project and refresh-dependencies)
affects: [13-study-jar-tools, 14-jdtls-classpath]

tech-stack:
  added: []
  patterns: [getDependenciesForTool for jars-parameter tools, getAllDependencies for specific-jar lookups, getResolvedDependencies for default-set views]

key-files:
  created: []
  modified:
    - src/tools/list-packages.ts
    - src/tools/list-classes.ts
    - src/tools/search-classes.ts
    - src/tools/read-source.ts
    - src/tools/locate-in-source.ts
    - src/tools/read-jar-entry.ts
    - src/tools/configure-filters.ts
    - src/tools/get-project-metadata.ts
    - src/tools/list-projects.ts
    - src/tools/tool-helpers.ts
    - src/tools/resolve-symbol-position.ts

key-decisions:
  - "getAllDependencies used for specific-jar mode (explicit jar selection should find any jar including study jars)"
  - "getResolvedDependencies used for default/all-jars mode (only auto-include study jars appear by default)"

patterns-established:
  - "Three-tier resolver pattern: getDependenciesForTool (jars param tools), getAllDependencies (specific jar lookup), getResolvedDependencies (default set)"

requirements-completed: [INTG-01, INTG-02]

duration: 4min
completed: 2026-04-14
---

# Phase 12 Plan 02: Tool Integration Wiring Summary

**All 11 tool files updated to use dependency resolver, eliminating direct dependencyJars access across the entire tool layer**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-14T06:23:14Z
- **Completed:** 2026-04-14T06:26:51Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Replaced direct `loadedProject.dependencyJars` access in all tool files with resolver functions
- Study jars are now universally visible: auto-include jars in default views, all study jars selectable via explicit `jars` parameter
- Zero regressions: all 379 tests pass after refactor
- Clean grep verification: no `dependencyJars` references remain in tool files (except allowed exceptions in load-project.ts and refresh-dependencies.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update tools with jars parameter** - `f8a97f2` (refactor)
2. **Task 2: Update remaining tools and shared helpers** - `a95e99c` (refactor)

## Files Created/Modified
- `src/tools/list-packages.ts` - Uses getDependenciesForTool instead of manual filtering
- `src/tools/list-classes.ts` - Uses getDependenciesForTool instead of manual filtering
- `src/tools/search-classes.ts` - Already updated in plan 01 (verified, no changes needed)
- `src/tools/read-source.ts` - Specific-jar uses getAllDependencies, all-jars uses getResolvedDependencies
- `src/tools/locate-in-source.ts` - Specific-jar uses getAllDependencies, all-jars uses getResolvedDependencies
- `src/tools/read-jar-entry.ts` - Uses getAllDependencies for jar lookup and key listing
- `src/tools/configure-filters.ts` - Uses getResolvedDependencies for total/filtered size reporting
- `src/tools/get-project-metadata.ts` - buildJarInventory iterates getAllDependencies
- `src/tools/list-projects.ts` - Uses getResolvedDependencies for dependency count
- `src/tools/tool-helpers.ts` - resolveClassSource and processNavigationLocations use resolver functions
- `src/tools/resolve-symbol-position.ts` - Specific-jar uses getAllDependencies, all-jars uses getResolvedDependencies

## Decisions Made
- Used `getAllDependencies` for specific-jar lookups so that explicitly naming a study jar always works
- Used `getResolvedDependencies` for default/all-jars mode so only auto-include study jars appear without explicit selection
- `configure-filters.ts` reports total dependencies from `getResolvedDependencies` (not raw `dependencyJars`) so counts include auto-include study jars

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed variable name collision in configure-filters.ts**
- **Found during:** Task 2
- **Issue:** Plan used `resolved` as variable name for `getResolvedDependencies()` result, but `resolved` was already declared by `resolveProjectSafely()` in the same scope
- **Fix:** Renamed to `resolvedDeps` to avoid redeclaration error
- **Files modified:** src/tools/configure-filters.ts
- **Verification:** Build and all 379 tests pass
- **Committed in:** a95e99c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial naming fix, no scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 12 complete: all tool files use dependency resolver
- Ready for Phase 13 (study jar management tools) or Phase 14 (JDT LS classpath integration)
- The three-tier resolver pattern (getDependenciesForTool / getAllDependencies / getResolvedDependencies) is established and consistent across all tools

## Self-Check: PASSED

All 10 modified files verified present. Both task commits (f8a97f2, a95e99c) verified in git log.

---
*Phase: 12-existing-tool-integration*
*Completed: 2026-04-14*
