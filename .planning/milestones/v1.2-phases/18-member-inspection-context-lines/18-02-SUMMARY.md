---
phase: 18-member-inspection-context-lines
plan: 02
subsystem: browsing
tags: [locate, context-lines, cascading-regex]

requires:
  - phase: 18-member-inspection-context-lines
    provides: "Phase context and research for context lines feature"
provides:
  - "locate_in_source context parameter with line-based extraction and clamping"
  - "LocateResultContext type in browsing/types.ts"
affects: [find-definition, find-references, mixin-tooling]

tech-stack:
  added: []
  patterns: ["Optional context extraction pattern — helper function + conditional wiring in both code paths"]

key-files:
  created: []
  modified:
    - src/tools/locate-in-source.ts
    - src/browsing/types.ts
    - src/tools/descriptions.ts
    - tests/tools/locate-in-source.test.ts

key-decisions:
  - "extractContext splits on newline and uses 1-based line indexing with Math.max/Math.min clamping"
  - "Context field omitted entirely (not null) when parameter not provided for backward compatibility"

patterns-established:
  - "Optional context extraction: helper function at module scope, conditionally called when parameter !== undefined"

requirements-completed: [P18-07, P18-08, P18-09]

duration: 2min
completed: 2026-04-14
---

# Phase 18 Plan 02: Context Lines for locate_in_source Summary

**Optional context parameter on locate_in_source that extends matches to whole line boundaries with configurable surrounding lines**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-14T12:49:41Z
- **Completed:** 2026-04-14T12:51:41Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- Added LocateResultContext type with text, startLine, endLine fields
- Added optional context parameter (linesBefore/linesAfter) to locate_in_source input schema
- Implemented extractContext helper with boundary clamping (line 1 min, last line max)
- Wired context extraction into both specific-jar and all-jars code paths
- Updated tool description to document context parameter
- Added 6 new test cases covering surrounding lines, whole-line extension, backward compat, clamping at both boundaries, and multi-jar context

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for context parameter** - `a652ed0` (test)
2. **Task 1 (GREEN): Implement context parameter** - `ade3f2b` (feat)

## Files Created/Modified
- `src/browsing/types.ts` - Added LocateResultContext interface, optional context field on LocateResult
- `src/tools/locate-in-source.ts` - Added extractContext helper, context input schema, wired into both code paths
- `src/tools/descriptions.ts` - Appended context parameter documentation to locate_in_source description
- `tests/tools/locate-in-source.test.ts` - Added 6 test cases in new 'context parameter' describe block

## Decisions Made
- extractContext uses simple string split on '\n' with 1-based line indexing -- matches cascadeRegex's 1-based line convention
- Context field is omitted entirely when parameter not provided (not set to null/undefined) for clean backward compatibility
- Context object uses inclusive startLine/endLine range (both 1-based) for intuitive consumption

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- locate_in_source now supports context extraction, ready for downstream tools (find_definition, find_references) to leverage
- Full test suite green (519 tests)

---
*Phase: 18-member-inspection-context-lines*
*Completed: 2026-04-14*

## Self-Check: PASSED
