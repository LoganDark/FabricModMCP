---
phase: 06-source-browsing
plan: 02
subsystem: browsing
tags: [mcp-tools, list-packages, list-classes, read-source, picomatch, zod]

requires:
  - phase: 06-source-browsing
    provides: EntryIndex, parseClassDeclaration, SourceAdapter from Plan 01
  - phase: 03-dependency-discovery
    provides: JarReader, DependencyEntry, getFilteredDependencies
  - phase: 05-project-metadata
    provides: Tool registration pattern, response envelope, provenance metadata
provides:
  - list_packages MCP tool for hierarchical package browsing with cross-jar merging
  - list_classes MCP tool for class listing with metadata and nested inner classes
  - read_source MCP tool for full source reading by FQN with multi-jar support
affects: [search-tools, find-definition, find-references]

tech-stack:
  added: []
  patterns: [entry-index-caching, jar-glob-filtering, multi-jar-source-merging, fqn-to-entry-path-conversion]

key-files:
  created:
    - src/tools/list-packages.ts
    - src/tools/list-classes.ts
    - src/tools/read-source.ts
    - tests/tools/list-packages.test.ts
    - tests/tools/list-classes.test.ts
    - tests/tools/read-source.test.ts
  modified:
    - src/tools/index.ts

key-decisions:
  - "EntryIndex cached per jar path in module-level Map for repeated call performance"
  - "read_source returns ALL matches when searching all jars, not just first match"
  - "Jar priority ordering: minecraft -> mod-source -> fabric-api -> library"
  - "FQN to entry path: last dot splits package from class, $ preserved in filename"

patterns-established:
  - "Jar glob filtering: picomatch applied to jar IDs after project-level include/exclude"
  - "Multi-jar merging: same package/class across jars merged by unioning jars arrays"
  - "Source tool pattern: resolveProject -> filter deps -> create adapters -> aggregate results"

requirements-completed: [BROW-01, BROW-02, BROW-03, BROW-04, BROW-06, BROW-07, BROW-08]

duration: 2min
completed: 2026-04-13
---

# Phase 6 Plan 2: Source Browsing MCP Tools Summary

**Three MCP tools (list_packages, list_classes, read_source) for hierarchical source navigation with cross-jar merging, picomatch glob filtering, and provenance tracking**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-13T09:19:32Z
- **Completed:** 2026-04-13T09:21:42Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- list_packages tool returns merged package listings with class counts and jar provenance across all filtered jars
- list_classes tool returns class entries with access/modifiers/type metadata and nested inner classes (anonymous filtered out)
- read_source tool reads full source by FQN from any or all jars with priority ordering and provenance chains
- All three tools support optional project parameter, jar glob filtering, and standard DomainError handling
- 30 new integration tests covering all behaviors, edge cases, and error paths

## Task Commits

Each task was committed atomically:

1. **Task 1: list_packages and list_classes MCP tools** - `91ff807` (test) + `79b97de` (feat)
2. **Task 2: read_source MCP tool and tool registration** - `80a9475` (test) + `fcee17f` (feat)

_TDD tasks have separate test and implementation commits_

## Files Created/Modified
- `src/tools/list-packages.ts` - list_packages tool with EntryIndex caching and cross-jar package merging
- `src/tools/list-classes.ts` - list_classes tool with class metadata parsing and inner class nesting
- `src/tools/read-source.ts` - read_source tool with FQN-based lookup, multi-jar results, priority ordering
- `src/tools/index.ts` - Updated to register all three new tools
- `tests/tools/list-packages.test.ts` - 10 tests for package listing, filtering, merging, provenance
- `tests/tools/list-classes.test.ts` - 9 tests for class metadata, inner classes, jar filtering
- `tests/tools/read-source.test.ts` - 11 tests for FQN reading, multi-jar, errors, priority

## Decisions Made
- EntryIndex is cached per jar path in a module-level Map to avoid rebuilding on repeated tool calls
- read_source returns ALL jar matches when no specific jar is requested (not just first match)
- Jar priority ordering uses category-based ranking: minecraft (0), mod-source (1), fabric-api (2), library (3)
- FQN to entry path conversion: split on last dot to separate package from class name, preserve $ for inner classes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All source browsing tools are complete and registered
- Phase 6 is fully implemented: domain logic (Plan 01) + MCP tools (Plan 02)
- Full test suite green (194 tests across 23 files)
- Ready for Phase 7 (search capabilities) which can build on these browsing primitives

## Self-Check: PASSED

All 7 files verified present. All 4 commit hashes verified in git log.

---
*Phase: 06-source-browsing*
*Completed: 2026-04-13*
