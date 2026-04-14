---
phase: 03-dependency-discovery
plan: 02
subsystem: api
tags: [node-stream-zip, picomatch, jar-reading, glob-filtering, mcp-tools]

requires:
  - phase: 03-dependency-discovery/plan-01
    provides: dependency discovery pipeline, DependencyEntry/FilterConfig types, projectStore
provides:
  - JarReader class for on-demand jar entry reading via node-stream-zip
  - matchesFilter and getFilteredDependencies for include/exclude glob filtering
  - configure_filters MCP tool for filter configuration
  - refresh_dependencies MCP tool to re-run discovery
  - read_jar_entry MCP tool to read files from source jars
affects: [source-browsing, search, find-definition, find-references]

tech-stack:
  added: [node-stream-zip 1.15.0, picomatch 4.0.4, "@types/picomatch 4.0.3"]
  patterns: [lazy-handle-lifecycle, glob-based-include-exclude-filtering, module-level-singleton-jar-reader]

key-files:
  created:
    - src/project/jar-reader.ts
    - src/project/jar-registry.ts
    - src/tools/configure-filters.ts
    - src/tools/refresh-dependencies.ts
    - src/tools/read-jar-entry.ts
    - tests/project/jar-reader.test.ts
    - tests/project/jar-registry.test.ts
  modified:
    - src/tools/index.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "JarReader uses lazy-open handles cached in a Map, closed on project unload"
  - "Module-level JarReader singleton in read-jar-entry tool for handle reuse across calls"

patterns-established:
  - "Lazy jar handle lifecycle: open on first access, cache in Map, close via closeAll on unload"
  - "Filter semantics: include-all mode patterns exclude, exclude-all mode patterns include"

requirements-completed: [PROJ-08, BROW-05]

duration: 3min
completed: 2026-04-13
---

# Phase 3 Plan 2: Jar Reading, Filtering, and MCP Tools Summary

**On-demand jar entry reading via node-stream-zip with picomatch glob filtering and three new MCP tools (configure_filters, refresh_dependencies, read_jar_entry)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-13T07:27:17Z
- **Completed:** 2026-04-13T07:30:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- JarReader reads .java files directly from source jars without extraction to disk (BROW-05)
- Include/exclude filtering with picomatch glob patterns on jar identifiers (PROJ-08)
- Three MCP tools registered: configure_filters, refresh_dependencies, read_jar_entry
- All 66 tests pass including 16 new tests for jar-reader and jar-registry

## Task Commits

Each task was committed atomically:

1. **Task 1: Jar reader, jar registry with filtering, and tests** - `fe54c6e` (feat - TDD)
2. **Task 2: MCP tools for filter config, dependency refresh, and jar entry reading** - `abe2564` (feat)

## Files Created/Modified
- `src/project/jar-reader.ts` - JarReader class with lazy handle management via node-stream-zip
- `src/project/jar-registry.ts` - matchesFilter and getFilteredDependencies using picomatch
- `src/tools/configure-filters.ts` - MCP tool to set include/exclude mode and glob patterns
- `src/tools/refresh-dependencies.ts` - MCP tool to re-run dependency discovery
- `src/tools/read-jar-entry.ts` - MCP tool to read files from source jars on demand
- `src/tools/index.ts` - Updated to register all three new tools
- `tests/project/jar-reader.test.ts` - 6 tests for jar reading, handle lifecycle, error cases
- `tests/project/jar-registry.test.ts` - 10 tests for filter matching and dependency filtering
- `package.json` - Added node-stream-zip, picomatch, @types/picomatch

## Decisions Made
- JarReader uses lazy-open handles cached in a Map keyed by jar path, with closeAll for project unload
- Module-level JarReader singleton in read-jar-entry.ts for handle reuse across MCP calls

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 3 is complete: dependency discovery, jar reading, and filtering are all functional
- Ready for Phase 4+ source browsing tools (list packages, list classes, read source)
- JarReader and jar registry provide the foundation for all future source access

---
*Phase: 03-dependency-discovery*
*Completed: 2026-04-13*
