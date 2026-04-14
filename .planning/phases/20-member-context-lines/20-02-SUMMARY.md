---
phase: 20-member-context-lines
plan: 02
subsystem: api
tags: [mcp, zod, read-member, context-lines]

requires:
  - phase: 20-member-context-lines (plan 01)
    provides: extractMemberSource with linesBefore/linesAfter and memberStartLine/memberEndLine in MemberExtraction
provides:
  - read_member tool accepts linesBefore/linesAfter parameters
  - PARAMS.linesBefore and PARAMS.linesAfter shared Zod schemas
  - Integration tests for context expansion through tool interface
affects: [verbosity-audit, future tools needing context line params]

tech-stack:
  added: []
  patterns: [shared PARAMS schema reuse for new optional parameters]

key-files:
  created: []
  modified:
    - src/tools/descriptions.ts
    - src/tools/read-member.ts
    - tests/tools/read-member.test.ts

key-decisions:
  - "linesBefore/linesAfter use min(0) validation (not min(1)) since 0 means no expansion"

patterns-established:
  - "PARAMS shared schema: new optional params added to PARAMS object, referenced from tool inputSchema"

requirements-completed: [READ-03]

duration: 4min
completed: 2026-04-14
---

# Phase 20 Plan 02: Wire read_member Context Lines Summary

**read_member tool accepts linesBefore/linesAfter params, passing them to extractMemberSource and returning memberStartLine/memberEndLine metadata**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-14T16:19:55Z
- **Completed:** 2026-04-14T16:23:51Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added PARAMS.linesBefore and PARAMS.linesAfter shared Zod schemas with int().min(0).optional() validation
- Wired linesBefore/linesAfter into read_member inputSchema, handler, and extractMemberSource call
- Added 4 integration tests verifying context expansion through the full tool interface
- Updated read_member tool description to mention context params

## Task Commits

Each task was committed atomically:

1. **Task 1: Add linesBefore/linesAfter to PARAMS and wire read_member tool** - `00e9976` (feat)
2. **Task 2: Add integration tests for read_member context expansion** - `cb45fe8` (test)

## Files Created/Modified
- `src/tools/descriptions.ts` - Added PARAMS.linesBefore, PARAMS.linesAfter, updated read_member description
- `src/tools/read-member.ts` - Added linesBefore/linesAfter to inputSchema, handler, and extractMemberSource call
- `tests/tools/read-member.test.ts` - Added 4 context lines integration tests

## Decisions Made
- linesBefore/linesAfter use min(0) not min(1) since 0 is a valid value meaning "no expansion"

## Deviations from Plan

None - plan executed exactly as written. The memberStartLine/memberEndLine fields were already present in the MemberResult mapping from plan 01, so step 5 of Task 1 required no changes.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 20 (member-context-lines) is complete
- read_member now supports context expansion, complementing read_source line-range reading from Phase 19
- Ready for verbosity audit / pagination phases in v1.3

---
*Phase: 20-member-context-lines*
*Completed: 2026-04-14*
