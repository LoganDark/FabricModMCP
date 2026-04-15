---
phase: 24-dependency-namespacing
plan: 02
subsystem: project
tags: [dependency-namespacing, category-dispatch, multi-child-aggregation]

requires:
  - phase: 24-dependency-namespacing
    provides: namespace-resolver with resolveJarId, getAutoIncludeIds
provides:
  - Namespaced dependency ID generation in discoverDependencies
  - Category-based source adapter dispatch (dep.category instead of dep.id)
  - Parameterized filter auto-include via autoIncludeIds set
  - Multi-child dependency aggregation in dependency-resolver
affects: [24-03, tool-layer, configure-filters, refresh-dependencies]

tech-stack:
  added: []
  patterns: [modName-prefixed dependency IDs at creation, category-based dispatch over string matching]

key-files:
  created: []
  modified:
    - src/project/dependency-discovery.ts
    - src/browsing/source-adapter.ts
    - src/project/jar-registry.ts
    - src/project/dependency-resolver.ts
    - src/project/loader.ts
    - src/tools/refresh-dependencies.ts
    - tests/project/dependency-discovery.test.ts
    - tests/project/jar-registry.test.ts
    - tests/project/dependency-resolver.test.ts

key-decisions:
  - "Fallback Fabric API entry also gets namespaced ID (modName/net.fabricmc.fabric-api:fabric-api)"
  - "autoIncludeIds parameter is optional -- existing callers keep working without it until Plan 03 wires them"

patterns-established:
  - "Dependency IDs created with modName/ prefix at discoverDependencies call site"
  - "Source adapter dispatches on dep.category not dep.id for type selection"
  - "Filter auto-include is context-aware via Set parameter, not hardcoded magic strings"

requirements-completed: [DEP-01, DEP-02]

duration: 5min
completed: 2026-04-15
---

# Phase 24 Plan 02: Core Data-Layer Namespacing Summary

**Namespaced dependency IDs at creation, category-based source adapter dispatch, parameterized filter auto-include, and multi-child dependency aggregation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-15T17:57:19Z
- **Completed:** 2026-04-15T18:02:38Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- discoverDependencies now takes modName parameter, prefixes all dependency IDs with modName/ (e.g., testmod/minecraft, testmod/com.example:lib)
- source-adapter uses dep.category === 'mod-source' instead of dep.id === 'src' for filesystem adapter selection
- matchesFilter accepts autoIncludeIds Set parameter, removing hardcoded 'minecraft'/'src' magic strings
- dependency-resolver iterates all fabric mod children directly instead of going through compat getSoleFabricMod
- All 640 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Namespace dependency-discovery, fix source-adapter, evolve jar-registry filter** - `5a8318e` (feat)
2. **Task 2: Evolve dependency-resolver to aggregate across all children** - `8d888e7` (feat)

## Files Created/Modified
- `src/project/dependency-discovery.ts` - Added modName param, all IDs prefixed with modName/
- `src/browsing/source-adapter.ts` - Changed dep.id === 'src' to dep.category === 'mod-source'
- `src/project/jar-registry.ts` - matchesFilter/getFilteredDependencies accept autoIncludeIds set
- `src/project/dependency-resolver.ts` - Iterates all children by kind, removed compat dependency
- `src/project/loader.ts` - Passes fabricMod.id as modName to discoverDependencies
- `src/tools/refresh-dependencies.ts` - Passes mod.name as modName to discoverDependencies
- `tests/project/dependency-discovery.test.ts` - Updated all assertions for namespaced IDs
- `tests/project/jar-registry.test.ts` - Added autoIncludeIds tests, removed hardcoded ID tests
- `tests/project/dependency-resolver.test.ts` - Added multi-child aggregation and bare study jar ID tests

## Decisions Made
- Fallback Fabric API entry also gets namespaced ID for consistency
- autoIncludeIds parameter is optional so existing callers don't break before Plan 03 wires them

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All dependency IDs are namespaced at creation time
- Plan 03 needs to wire autoIncludeIds into tool-helpers and configure-filters callers
- Compat layer still has getDependencyJars/getStudyJars (used by tool files) -- cleanup deferred to Phase 27

---
*Phase: 24-dependency-namespacing*
*Completed: 2026-04-15*
