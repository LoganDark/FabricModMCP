---
phase: 22-verbosity-audit
plan: 01
subsystem: api
tags: [zod, mcp-tools, verbosity, compact-output]

requires:
  - phase: 21-navigation-pagination
    provides: paginated navigation results with applyPagination helper
provides:
  - DETAIL_PARAMS shared Zod schemas for opt-in verbose output
  - stripNavigationResult and stripLocateResult helper functions
  - Compact-by-default navigation tool output (find_references, find_definition, find_implementations)
  - Compact-by-default locate_in_source output
affects: [22-verbosity-audit]

tech-stack:
  added: []
  patterns: [detail-params-pattern, strip-function-pattern]

key-files:
  created: []
  modified:
    - src/tools/descriptions.ts
    - src/jdtls/types.ts
    - src/browsing/types.ts
    - src/tools/tool-helpers.ts
    - src/tools/find-references.ts
    - src/tools/find-definition.ts
    - src/tools/find-implementations.ts
    - src/tools/locate-in-source.ts

key-decisions:
  - "DETAIL_PARAMS uses category-based schemas (navigation, member, class, locate) not per-tool schemas"
  - "Strip functions use destructuring rest to remove fields rather than explicit delete"

patterns-established:
  - "detail-params-pattern: DETAIL_PARAMS.{category} added to inputSchema, details destructured in handler, strip function applied after pagination"
  - "strip-function-pattern: stripXxxResult(result, details) returns full result when flag true, strips verbose fields when omitted"

requirements-completed: [VERB-02, VERB-03]

duration: 4min
completed: 2026-04-15
---

# Phase 22 Plan 01: Navigation & Locate Compact Output Summary

**Compact-by-default navigation and locate tools via shared DETAIL_PARAMS schemas and strip functions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T06:59:12Z
- **Completed:** 2026-04-15T07:03:13Z
- **Tasks:** 2
- **Files modified:** 8 source + 4 test

## Accomplishments
- Defined DETAIL_PARAMS shared Zod schemas with navigation, member, class, and locate categories
- Made NavigationResult and LocateResult detail fields optional (context, entryPath, provenanceChains, steps)
- Created stripNavigationResult and stripLocateResult helper functions in tool-helpers.ts
- Wired compact-by-default into all 4 navigation/locate tool handlers with opt-in details parameter

## Task Commits

Each task was committed atomically:

1. **Task 1: Define detail schemas, update types, create strip functions** - `aef993f` (feat)
2. **Task 2: Wire compact-by-default into navigation and locate tool handlers** - `5d059d9` (feat)

## Files Created/Modified
- `src/tools/descriptions.ts` - Added DETAIL_PARAMS export with 4 category schemas
- `src/jdtls/types.ts` - Made NavigationResult context/entryPath/provenanceChains optional
- `src/browsing/types.ts` - Made LocateResult steps/provenanceChains and ClassInfo access/modifiers optional
- `src/tools/tool-helpers.ts` - Added stripNavigationResult and stripLocateResult functions
- `src/tools/find-references.ts` - Added details param, strip call after pagination
- `src/tools/find-definition.ts` - Added details param, strip call after pagination
- `src/tools/find-implementations.ts` - Added details param, strip call after pagination
- `src/tools/locate-in-source.ts` - Added details param, strip calls in both jar modes
- `tests/tools/find-references.test.ts` - Updated to expect compact output by default
- `tests/tools/find-definition.test.ts` - Updated to expect compact output by default
- `tests/tools/find-implementations.test.ts` - Updated to expect compact output by default
- `tests/tools/locate-in-source.test.ts` - Updated to expect compact output by default

## Decisions Made
- DETAIL_PARAMS organized by category (navigation, member, class, locate) rather than per-tool, enabling shared schemas across tools in same category
- Strip functions use object destructuring with rest to cleanly remove fields rather than mutating or deleting properties

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DETAIL_PARAMS.member and DETAIL_PARAMS.class schemas are defined but not yet wired into list_members, list_classes, and search_classes tools
- Plan 22-02 will wire these remaining schemas into member and class listing tools

---
*Phase: 22-verbosity-audit*
*Completed: 2026-04-15*
