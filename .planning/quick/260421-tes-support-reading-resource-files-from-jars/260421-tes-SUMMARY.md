---
phase: quick
plan: 260421-tes
subsystem: project
tags: [jar, compiled-jar, resources, node-stream-zip]

provides:
  - "compiledJarPath field on DependencyEntry for all dependency types"
  - "read_jar_entry source parameter for reading compiled vs sources jars"
  - "findCompiledJar and resolveCompiledJarPath functions"
  - "add_study_jar compiledJar parameter"
affects: [browsing, tools, project]

tech-stack:
  added: []
  patterns: ["compiled jar path tracked alongside sources jar path"]

key-files:
  created: []
  modified:
    - "src/project/types.ts"
    - "src/project/source-jar-finder.ts"
    - "src/project/loom-cache.ts"
    - "src/project/dependency-discovery.ts"
    - "src/project/loader.ts"
    - "src/project/study-jar.ts"
    - "src/tools/read-jar-entry.ts"
    - "src/tools/add-study-jar.ts"
    - "src/tools/descriptions.ts"
    - "src/tools/get-member-info.ts"

key-decisions:
  - "compiledJarPath is nullable (string | null) on DependencyEntry since not all deps have compiled jars"
  - "hasCompiledJar boolean added to get_member_info jar inventory output for discoverability"
  - "source parameter defaults to 'sources' for full backward compatibility"

requirements-completed: []

duration: 9min
completed: 2026-04-21
---

# Quick 260421-tes: Support Reading Resource Files from Jars Summary

**Compiled jar path tracking and read_jar_entry source parameter for reading non-source resources (lang files, shaders, textures, JSON) from Minecraft and dependency jars**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-22T04:19:04Z
- **Completed:** 2026-04-22T04:28:00Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments
- Added `compiledJarPath` field to `DependencyEntry`, `StudyJar`, `StudyJarChild`, and `FabricModChild` types
- Created `findCompiledJar()` for Gradle cache scanning and `resolveCompiledJarPath()` for Loom cache resolution
- `read_jar_entry` now accepts `source: "sources" | "compiled"` parameter (defaults to "sources") for reading from either jar type
- `add_study_jar` accepts optional `compiledJar` path for associating a compiled jar with a study jar
- `get_member_info` jar inventory now includes `hasCompiledJar` boolean for each dependency
- All 701 existing tests pass with updated fixtures

## Task Commits

Each task was committed atomically:

1. **Task 1: Add compiledJarPath to types, finders, and discovery** - `2fc090c` (feat)
2. **Task 2: Update read_jar_entry and add_study_jar tools** - `ae0c579` (feat)
3. **Task 3: End-to-end verification and edge case handling** - `9900aec` (fix)

## Files Created/Modified
- `src/project/types.ts` - Added compiledJarPath to DependencyEntry, StudyJar, StudyJarChild, FabricModChild
- `src/project/source-jar-finder.ts` - Added findCompiledJar() function
- `src/project/loom-cache.ts` - Added resolveCompiledJarPath() function
- `src/project/dependency-discovery.ts` - Wired compiledJarPath through discovery pipeline
- `src/project/loader.ts` - Resolves compiled jar path during mod loading and reload
- `src/project/study-jar.ts` - Optional compiledJarPath on creation, staleness check, dependency entry conversion
- `src/tools/read-jar-entry.ts` - Added source parameter with compiled jar reading path
- `src/tools/add-study-jar.ts` - Added compiledJar parameter, registers with jar reader
- `src/tools/descriptions.ts` - Updated tool descriptions for compiled jar support
- `src/tools/get-member-info.ts` - Added hasCompiledJar to jar inventory, compiledJarPath to study jar output
- `src/tools/refresh-project.ts` - Passes compiledJarPath to discoverDependencies
- `src/tools/refresh-project-members.ts` - Passes compiledJarPath to discoverDependencies
- `tests/helpers/factories.ts` - Added compiledJarPath and compiledJar to test factories
- `tests/project/dependency-discovery.test.ts` - Updated for new function signature and mock

## Decisions Made
- `compiledJarPath` is `string | null` (nullable) on `DependencyEntry` since not all dependencies have compiled jars in cache
- `compiledJarPath` is optional (`string | undefined`) on `StudyJar` and `StudyJarChild` since study jars may or may not have one
- Added `hasCompiledJar` boolean to `get_member_info` jar inventory output rather than exposing full file paths
- `source` parameter defaults to `"sources"` for complete backward compatibility
- New error code `JAR_NO_COMPILED` for when compiled jar is requested but not available

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated refresh tool callers of discoverDependencies**
- **Found during:** Task 1
- **Issue:** `refresh-project.ts` and `refresh-project-members.ts` call `discoverDependencies` but the plan only mentioned updating `loader.ts`
- **Fix:** Updated both refresh tools to pass `compiledJarPath` as the new third parameter
- **Files modified:** `src/tools/refresh-project.ts`, `src/tools/refresh-project-members.ts`

**2. [Rule 1 - Bug] Added compiledJarPath to test fixtures**
- **Found during:** Task 3
- **Issue:** 28 tests failed because `DependencyEntry` and `FabricModChild` constructions in test files and factories were missing the new required `compiledJarPath` field
- **Fix:** Updated all test factory helpers, discovery test mocks, reload-config test mocks, and refresh tool test fixtures
- **Files modified:** `tests/helpers/factories.ts`, `tests/project/dependency-discovery.test.ts`, `tests/project/reload-config.test.ts`, `tests/tools/refresh-project.test.ts`, `tests/tools/refresh-project-members.test.ts`

**3. [Rule 2 - Missing Critical] Added hasCompiledJar to get_member_info output**
- **Found during:** Task 3
- **Issue:** `get_member_info` explicitly picks DependencyEntry fields for jar inventory, so `compiledJarPath` would not appear automatically
- **Fix:** Added `hasCompiledJar` boolean to jar inventory entries and `compiledJarPath` to study jar output

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- The `pnpm build` DTS generation fails with a TypeScript 7.0 deprecation warning for the `baseUrl` option. This is a pre-existing issue unrelated to this task.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Compiled jar infrastructure is ready for use
- Future work could add jar entry listing for compiled jars (list what resources are available)

---
*Quick task: 260421-tes*
*Completed: 2026-04-21*
