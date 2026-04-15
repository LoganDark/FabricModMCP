---
phase: 24-dependency-namespacing
plan: 03
subsystem: tools
tags: [scope-parameter, namespace-resolution, tool-layer-integration]

requires:
  - phase: 24-dependency-namespacing
    provides: namespace-resolver with resolveJarId/resolveJarIds/getAutoIncludeIds, parameterized autoIncludeIds in jar-registry
provides:
  - scope parameter on all 17 jar-aware tools
  - getDependenciesForTool scope-aware with autoIncludeIds
  - resolveClassSource scope-aware with namespace resolution
  - resolveSymbolPosition scope-aware with namespace resolution
  - SERVER_INSTRUCTIONS documenting namespaced jar IDs and scope parameter
  - Dual-purpose configure-filters, get-project-metadata, unload-project with scope
affects: [tool-layer, server-instructions, configure-filters, get-project-metadata, unload-project]

tech-stack:
  added: []
  patterns: [scope parameter passthrough on all jar-aware tools, scope-aware rootPath resolution]

key-files:
  created: []
  modified:
    - src/tools/descriptions.ts
    - src/tools/tool-helpers.ts
    - src/tools/resolve-symbol-position.ts
    - src/tools/list-packages.ts
    - src/tools/list-classes.ts
    - src/tools/search-classes.ts
    - src/tools/list-members.ts
    - src/tools/read-source.ts
    - src/tools/read-member.ts
    - src/tools/read-jar-entry.ts
    - src/tools/locate-in-source.ts
    - src/tools/find-definition.ts
    - src/tools/find-references.ts
    - src/tools/find-implementations.ts
    - src/tools/get-symbol-info.ts
    - src/tools/search-symbols.ts
    - src/tools/type-hierarchy.ts
    - src/tools/configure-filters.ts
    - src/tools/get-project-metadata.ts
    - src/tools/unload-project.ts
    - tests/project/dependency-resolver.test.ts
    - tests/tools/list-packages.test.ts
    - tests/tools/list-classes.test.ts
    - tests/tools/search-classes.test.ts
    - tests/tools/get-project-metadata.test.ts

key-decisions:
  - "resolve-symbol-position.ts evolved to accept scope, replacing inline getFilteredDependencies with getDependenciesForTool"
  - "locate-in-source uses resolveJarId + getDependenciesForTool instead of inline filter calls for consistency"
  - "get-project-metadata with scope returns child-specific metadata including dependencyJars inventory"
  - "unload-project with scope removes a single child without shutting down JDT LS or closing project"

patterns-established:
  - "All jar-aware tools follow: inputSchema has scope: PARAMS.scope, handler destructures scope, passes to helper functions"
  - "Scope-aware rootPath resolution: scope ? child.rootPath : getRootPath(loadedProject)"

requirements-completed: [DEP-01, DEP-02, DEP-03]

duration: 13min
completed: 2026-04-15
---

# Phase 24 Plan 03: Tool-Layer Scope Integration Summary

**Scope parameter added to all 17 jar-aware tools with namespace-aware dependency resolution, server instructions updated for namespaced IDs**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-15T18:04:07Z
- **Completed:** 2026-04-15T18:17:45Z
- **Tasks:** 2
- **Files modified:** 25

## Accomplishments
- Added PARAMS.scope schema and updated SERVER_INSTRUCTIONS to document namespaced jar IDs and scope parameter
- getDependenciesForTool now scope-aware: resolves bare IDs via namespace resolver, computes autoIncludeIds per child
- resolveClassSource and resolveSymbolPosition both accept scope for namespace-aware jar resolution
- All 17 jar-aware tools accept optional scope parameter in inputSchema and handler
- Dual-purpose tools: configure-filters targets specific child's filterConfig, get-project-metadata returns child-specific data, unload-project removes a single child
- 5 test files updated from bare IDs (minecraft, src) to namespaced IDs (testmod/minecraft, testmod)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add scope to PARAMS, update getDependenciesForTool and resolveClassSource, update SERVER_INSTRUCTIONS** - `4e22c6b` (feat)
2. **Task 2: Add scope parameter to all jar-aware tool registration schemas and handler functions** - `f48bd0b` (feat)

## Files Created/Modified
- `src/tools/descriptions.ts` - Added PARAMS.scope, updated SERVER_INSTRUCTIONS and configure_filters description
- `src/tools/tool-helpers.ts` - Scope-aware getDependenciesForTool and resolveClassSource
- `src/tools/resolve-symbol-position.ts` - Scope-aware symbol position resolution with resolveJarId
- `src/tools/locate-in-source.ts` - Scope-aware with rootPath and getDependenciesForTool
- `src/tools/read-source.ts` - Scope-aware in both single-jar and all-jars modes
- `src/tools/configure-filters.ts` - Scope targets specific child's filterConfig with autoIncludeIds
- `src/tools/get-project-metadata.ts` - Scope returns child-specific metadata
- `src/tools/unload-project.ts` - Scope removes single child from project
- 9 more tool files - Mechanical scope parameter addition
- `tests/project/dependency-resolver.test.ts` - Namespaced dep IDs, scope test
- `tests/tools/list-packages.test.ts` - Namespaced dep and jar IDs
- `tests/tools/list-classes.test.ts` - Namespaced dep and jar IDs
- `tests/tools/search-classes.test.ts` - Namespaced dep and jar IDs
- `tests/tools/get-project-metadata.test.ts` - Namespaced dep IDs

## Decisions Made
- resolve-symbol-position.ts evolved to use getDependenciesForTool instead of inline getFilteredDependencies for consistency
- locate-in-source refactored to use resolveJarId + getDependenciesForTool instead of duplicating filter logic
- get-project-metadata with scope returns child's dependencyJars inventory directly (not project-wide getAllDependencies)
- unload-project with scope only removes the child, does not shut down JDT LS or close jar handles

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated 5 tool test files with namespaced dependency IDs**
- **Found during:** Task 1 (test verification)
- **Issue:** list-packages, list-classes, search-classes, get-project-metadata test files had local makeFakeProject functions using bare IDs (minecraft, src) that now fail because getDependenciesForTool resolves bare IDs to namespaced form
- **Fix:** Updated all dep map keys and assertions to use namespaced IDs (testmod/minecraft, testmod, testmod/net.fabricmc...)
- **Files modified:** tests/tools/list-packages.test.ts, tests/tools/list-classes.test.ts, tests/tools/search-classes.test.ts, tests/tools/get-project-metadata.test.ts, tests/project/dependency-resolver.test.ts
- **Verification:** All 641 tests pass
- **Committed in:** 4e22c6b (Task 1 commit)

**2. [Rule 3 - Blocking] Updated resolve-symbol-position.ts for scope support**
- **Found during:** Task 2 (reading tool files that call resolveSymbolPosition)
- **Issue:** resolveSymbolPosition used inline getFilteredDependencies/getFilterConfig -- passing scope through required updating this shared module
- **Fix:** Added scope parameter, replaced inline filter with getDependenciesForTool, added resolveJarId for bare ID resolution
- **Files modified:** src/tools/resolve-symbol-position.ts
- **Verification:** All 641 tests pass
- **Committed in:** f48bd0b (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All tools support scope parameter for multi-child project operation
- Phase 24 (dependency namespacing) is now complete
- Compat layer (getRootPath, getSoleFabricMod) still used by some tools for single-child case -- cleanup deferred to Phase 27

---
*Phase: 24-dependency-namespacing*
*Completed: 2026-04-15*
