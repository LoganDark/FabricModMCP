---
phase: 23-type-foundation-and-projectstore
plan: 03
subsystem: api
tags: [typescript, type-migration, compat-layer, project-rearchitecture]

requires:
  - phase: 23-02
    provides: compat.ts accessors, FabricModChild/StudyJarChild types, Project container type
provides:
  - All tool files use compat accessors instead of direct field access
  - Test factory returns new Project shape with children Map
  - Study jar tools operate on project.children
  - load-project creates FabricModChild and adds to project.children
affects: [24-tool-scoping, 25-multi-mod, 26-jdtls-workspace]

tech-stack:
  added: []
  patterns:
    - "compat accessor pattern for tool-layer code accessing child properties"
    - "makeFakeFabricMod + makeFakeProject two-layer test factory"

key-files:
  created: []
  modified:
    - src/tools/tool-helpers.ts
    - src/tools/load-project.ts
    - src/tools/refresh-dependencies.ts
    - src/tools/get-project-metadata.ts
    - src/tools/configure-filters.ts
    - src/tools/add-study-jar.ts
    - src/tools/remove-study-jar.ts
    - src/tools/list-study-jars.ts
    - src/tools/configure-study-jar.ts
    - src/tools/search-classes.ts
    - src/tools/list-classes.ts
    - src/tools/list-packages.ts
    - src/tools/list-members.ts
    - src/tools/read-source.ts
    - src/tools/read-member.ts
    - src/tools/locate-in-source.ts
    - src/tools/resolve-symbol-position.ts
    - src/tools/list-projects.ts
    - tests/helpers/factories.ts

key-decisions:
  - "All tasks executed together because factory change cascaded to all tool files simultaneously"
  - "Test files with local factories updated to use makeFakeFabricMod for mod-level overrides"
  - "dependency-resolver.test.ts workaround removed -- compat accessors now handle the indirection"

patterns-established:
  - "compat accessor import pattern: import { getRootPath, getFilterConfig } from '../project/compat.js'"
  - "Test factory two-layer pattern: makeFakeFabricMod for child overrides, makeFakeProject for project-level"

requirements-completed: [CONT-01, CONT-02, CONT-03, CONT-05, CONT-06]

duration: 15min
completed: 2026-04-15
---

# Phase 23 Plan 03: Tool and Test Factory Migration Summary

**All 21 tool files and test factory migrated to use compat accessors and children Map -- 613 tests pass with zero regressions**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-15T16:16:16Z
- **Completed:** 2026-04-15T16:31:54Z
- **Tasks:** 3
- **Files modified:** 30

## Accomplishments
- Every tool file in src/tools/ uses compat accessors (getRootPath, getFilterConfig, getSoleFabricMod, getGradleConfig, getFabricMod, getStudyJars) instead of direct field access
- Test factory split into makeFakeFabricMod (child overrides) and makeFakeProject (project-level) for clean test authoring
- Study jar tools operate on project.children with kind-based discrimination instead of project.studyJars
- 9 test files with local factories updated to create proper Project shapes with FabricModChild children
- Zero direct field access to old LoadedProject properties remains in src/tools/

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate tool-helpers, study-jar tools, and test factory** - `678ba91` (feat)
2. **Task 2: Migrate browsing tools** - `a556550` (feat)
3. **Task 3: Migrate LSP/navigation tools** - `660029c` (feat)

## Files Created/Modified
- `tests/helpers/factories.ts` - New makeFakeFabricMod + updated makeFakeProject returning Project with children
- `src/tools/tool-helpers.ts` - getRootPath/getFilterConfig compat accessors
- `src/tools/refresh-dependencies.ts` - getSoleFabricMod/getStudyJars for mod and study jar access
- `src/tools/get-project-metadata.ts` - getGradleConfig/getFabricMod for project info
- `src/tools/configure-filters.ts` - getSoleFabricMod for filterConfig mutation
- `src/tools/add-study-jar.ts` - children.set with kind: 'study-jar'
- `src/tools/remove-study-jar.ts` - children.get/delete with kind check
- `src/tools/list-study-jars.ts` - getStudyJars compat accessor
- `src/tools/configure-study-jar.ts` - children.get with kind narrowing
- `src/tools/list-projects.ts` - getRootPath/getGradleConfig for project listing
- `src/tools/search-classes.ts` - getRootPath
- `src/tools/list-classes.ts` - getRootPath
- `src/tools/list-packages.ts` - getRootPath
- `src/tools/list-members.ts` - getRootPath
- `src/tools/read-source.ts` - getRootPath/getFilterConfig
- `src/tools/read-member.ts` - getRootPath
- `src/tools/locate-in-source.ts` - getRootPath/getFilterConfig
- `src/tools/resolve-symbol-position.ts` - getRootPath/getFilterConfig
- `tests/tools/*.test.ts` - 9 test files updated with new factory patterns

## Decisions Made
- All 3 tasks executed as a single logical unit because changing the test factory (Task 1) immediately broke all tests that relied on the old Project shape, forcing all tool migrations to happen simultaneously
- Local test factories in 9 test files updated to use makeFakeFabricMod for mod-level overrides (dependencyJars, fabricMod, etc.) and wrap in Project, rather than passing old-style flat overrides
- Removed the filterConfig workaround in dependency-resolver.test.ts (was `as unknown as Project` cast) since compat accessors now properly traverse to the fabric mod child

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Factory change cascaded to all tool files**
- **Found during:** Task 1
- **Issue:** Updating makeFakeProject to return new Project shape (with children Map) immediately broke all tests that called tools using the old shape, since tools still accessed loadedProject.rootPath etc. which no longer existed on Project
- **Fix:** Migrated all browsing and LSP tool files (Tasks 2 and 3 scope) within Task 1 execution to unblock tests
- **Files modified:** All src/tools/ files listed above
- **Verification:** All 613 tests pass

**2. [Rule 3 - Blocking] Test files with local factories needed updating**
- **Found during:** Task 1
- **Issue:** 9 test files had local makeFakeProject wrappers that passed old-style overrides (dependencyJars, rootPath, fabricMod) to makeFakeProjectBase -- these properties silently dropped on the new Project type
- **Fix:** Updated each local factory to use makeFakeFabricMod for mod-level overrides, then wrap in Project with children Map
- **Files modified:** tests/tools/{load-project,get-project-metadata,list-packages,search-classes,list-classes,read-source,locate-in-source,find-references,list-projects,set-default-project,unload-project,configure-study-jar}.test.ts, tests/project/dependency-resolver.test.ts
- **Verification:** All 613 tests pass

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Deviations were necessary because the plan's 3-task sequential structure assumed factory changes wouldn't cascade. In practice they did, requiring all tasks to execute as one atomic unit. No scope creep.

## Issues Encountered
- 3 pre-existing test failures in tests/cli/args.test.ts (--project flag parsing) -- unrelated to migration, confirmed by running tests on unmigrated code

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 23 (type-foundation-and-projectstore) is complete
- All tool files use compat accessors -- ready for Phase 24 (tool scoping)
- The compat layer provides clean abstraction boundary for future multi-mod support (Phase 25)
- LoadedProject type alias remains as Project for backward compat (removal planned in Phase 27)

---
*Phase: 23-type-foundation-and-projectstore*
*Completed: 2026-04-15*
