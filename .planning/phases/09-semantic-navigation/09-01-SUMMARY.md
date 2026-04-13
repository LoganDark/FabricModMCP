---
phase: 09-semantic-navigation
plan: 01
subsystem: navigation
tags: [jdtls, uri-mapping, context-extraction, java-parsing, lsp]

# Dependency graph
requires:
  - phase: 08-cascading-regex
    provides: CascadeSuccess type with line/column for position identification
provides:
  - JdtLsSession, NavigationResult, ContextSnippet, SnippetKind types
  - Bidirectional URI mapper (file:// URI <-> jar ID + entry path)
  - Context extractor for enclosing semantic units (method/field/class/fallback)
  - Integration test scaffolds for find_definition and find_references tools
affects: [09-02-jdtls-lifecycle, 09-03-mcp-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [regex-based-java-parsing, uri-mapping-with-dir-name-encoding, tdd-red-green]

key-files:
  created:
    - src/jdtls/types.ts
    - src/jdtls/uri-mapper.ts
    - src/jdtls/context-extractor.ts
    - tests/jdtls/uri-mapper.test.ts
    - tests/jdtls/context-extractor.test.ts
    - tests/tools/find-definition.test.ts
    - tests/tools/find-references.test.ts
  modified: []

key-decisions:
  - "URI mapper uses __ as colon replacement for filesystem-safe directory names"
  - "Context extractor scans backward up to 50 lines for method declarations"
  - "Integration test scaffolds use test.skipIf pattern for graceful skip when tools not yet implemented"

patterns-established:
  - "Colon-to-double-underscore encoding for jar ID -> directory name mapping"
  - "Brace-depth tracking for matching nested Java blocks"
  - "test.skipIf(!moduleAvailable) pattern for scaffold tests awaiting future implementations"

requirements-completed: [NAV-04]

# Metrics
duration: 3min
completed: 2026-04-13
---

# Phase 9 Plan 1: JDT LS Domain Types and Pure Modules Summary

**Bidirectional URI mapper and regex-based context extractor for JDT LS integration, with typed session/navigation interfaces and Wave 0 test scaffolds**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-13T13:04:07Z
- **Completed:** 2026-04-13T13:07:53Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Defined JdtLsSession, NavigationResult, ContextSnippet, SnippetKind types for the full semantic navigation pipeline
- Built bidirectional URI mapper that translates between file:// URIs and jar ID + entry path pairs with filesystem-safe encoding
- Implemented regex-based context extractor that identifies enclosing method bodies, field declarations, class declarations, or falls back to surrounding lines
- Created integration test scaffolds for find_definition and find_references that skip gracefully until Plan 09-03

## Task Commits

Each task was committed atomically:

1. **Task 1: JDT LS types and URI mapper** - `a753964` (feat)
2. **Task 2: Context extractor** - `be90162` (test: RED), `da91d86` (feat: GREEN)
3. **Task 3: Integration test scaffolds** - `f9ae161` (test)

_Note: Task 2 used TDD with separate RED and GREEN commits_

## Files Created/Modified
- `src/jdtls/types.ts` - JdtLsSession, NavigationResult, ContextSnippet, SnippetKind type definitions
- `src/jdtls/uri-mapper.ts` - Bidirectional file:// URI <-> jar ID + entry path mapping
- `src/jdtls/context-extractor.ts` - Regex-based enclosing semantic unit extraction
- `tests/jdtls/uri-mapper.test.ts` - 22 unit tests for URI mapper (round-trips, edge cases)
- `tests/jdtls/context-extractor.test.ts` - 9 unit tests for context extractor (methods, fields, classes, fallback, boundaries)
- `tests/tools/find-definition.test.ts` - 4 scaffold tests for find_definition tool (skipping until 09-03)
- `tests/tools/find-references.test.ts` - 5 scaffold tests for find_references tool (skipping until 09-03)

## Decisions Made
- URI mapper uses `__` as colon replacement in directory names for filesystem safety (reversible encoding)
- Context extractor scans backward up to 50 lines for method declarations, 10 lines for class declarations
- Integration test scaffolds use dynamic import check with `test.skipIf` for graceful degradation
- URI mapper uses reverse map (dirName -> jarId) built at creation time for O(1) lookup on fromFileUri

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript compilation errors in `set-default-project.ts` and `unload-project.ts` (structuredContent type incompatibility with MCP SDK). Not caused by this plan's changes -- out of scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Types and pure modules ready for Plan 09-02 (JDT LS lifecycle management)
- URI mapper ready for translating LSP Location responses to jar-based NavigationResults
- Context extractor ready for enriching navigation results with source context
- Test scaffolds ready to activate when Plan 09-03 creates tool implementations

---
*Phase: 09-semantic-navigation*
*Completed: 2026-04-13*
