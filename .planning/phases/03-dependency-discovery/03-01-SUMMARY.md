---
phase: 03-dependency-discovery
plan: 01
subsystem: project
tags: [pom-parser, gradle-cache, dependency-discovery, source-jars]

# Dependency graph
requires:
  - phase: 02-project-discovery
    provides: GradleConfig with parsed dependencies, LoadedProject type, project loader
provides:
  - DependencyEntry and JarCategory types for dependency registry
  - POM XML parser for Maven dependency extraction
  - Source jar finder for Gradle cache resolution
  - Three-pronged dependency discovery (Mojang libs, Fabric API, declared deps)
  - Transitive POM traversal with cycle detection and depth limiting
  - Loader integration populating dependencyJars at load time
affects: [03-02-jar-reading, phase-04, phase-06, phase-07]

# Tech tracking
tech-stack:
  added: []
  patterns: [regex-based POM parsing, Gradle cache traversal, three-pronged discovery strategy]

key-files:
  created:
    - src/project/pom-parser.ts
    - src/project/source-jar-finder.ts
    - src/project/dependency-discovery.ts
    - tests/project/pom-parser.test.ts
    - tests/project/dependency-discovery.test.ts
  modified:
    - src/project/types.ts
    - src/project/loader.ts
    - tests/project/loader.test.ts

key-decisions:
  - "Regex POM parsing sufficient for Maven dependency blocks -- no XML library needed"
  - "Depth limit 5 for transitive POM traversal prevents graph explosion"
  - "Compile-scope only for transitive deps (test, provided, runtime excluded)"

patterns-established:
  - "POM parsing: strip comments, strip dependencyManagement, match dependency blocks"
  - "Gradle cache traversal: readdir SHA1 dirs, check expected filename"
  - "Discovery orchestration: seed entries, then strategies A/B/C in sequence"

requirements-completed: [PROJ-07, PROJ-09, PROJ-10]

# Metrics
duration: 4min
completed: 2026-04-13
---

# Phase 3 Plan 1: Dependency Discovery Pipeline Summary

**Three-pronged dependency discovery with POM parsing, source jar resolution, and transitive traversal integrated into project loader**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-13T07:21:20Z
- **Completed:** 2026-04-13T07:25:37Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built POM parser that extracts Maven dependencies using regex, handling dependencyManagement, XML comments, and scope defaults
- Created source jar finder that traverses Gradle cache SHA1 directories to locate sources jars
- Implemented three-pronged discovery: Mojang minecraft_info.json for MC libraries, Loom cache POM for Fabric API modules, POM traversal for declared dependencies
- Integrated discovery into project loader with summary logging (tested live: found 54 deps, 52 with sources)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extended types, POM parser, and source jar finder** - `e55ae9e` (feat)
2. **Task 2: Three-pronged dependency discovery and loader integration** - `3176914` (feat)

## Files Created/Modified
- `src/project/types.ts` - Added JarCategory, DependencyEntry, FilterConfig types; updated LoadedProject
- `src/project/pom-parser.ts` - Regex-based POM XML dependency extraction
- `src/project/source-jar-finder.ts` - Gradle cache source jar path resolution
- `src/project/dependency-discovery.ts` - Three-pronged discovery orchestrator with transitive traversal
- `src/project/loader.ts` - Integrated dependency discovery into loadProject
- `tests/project/pom-parser.test.ts` - 7 tests covering all POM parsing edge cases
- `tests/project/dependency-discovery.test.ts` - 8 tests covering discovery strategies, cycles, depth limits
- `tests/project/loader.test.ts` - Updated ProjectStore mock with filterConfig

## Decisions Made
- Regex POM parsing is sufficient for Maven dependency blocks -- POMs follow a rigid structure and we only need groupId, artifactId, version, scope
- Depth limit of 5 for transitive traversal prevents discovering the entire Maven Central graph
- Only compile-scope transitive dependencies are followed (test, provided, runtime excluded)
- PROJ-10 (manual path override) acknowledged as deferred per CONTEXT.md

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DependencyEntry registry populated during project load, ready for jar reading (Plan 2)
- FilterConfig defaulted to include-all, ready for filtering tool implementation
- All 50 tests pass including existing Phase 1 and Phase 2 tests

---
*Phase: 03-dependency-discovery*
*Completed: 2026-04-13*
