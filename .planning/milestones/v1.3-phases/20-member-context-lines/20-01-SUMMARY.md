---
phase: 20-member-context-lines
plan: 01
subsystem: browsing
tags: [member-extractor, context-lines, line-range]

requires:
  - phase: 18-member-inspection
    provides: extractMemberSource and MemberExtraction/MemberResult interfaces
provides:
  - extractMemberSource with linesBefore/linesAfter context expansion
  - MemberExtraction and MemberResult with memberStartLine/memberEndLine metadata
affects: [20-02 tool handler wiring]

tech-stack:
  added: []
  patterns: [optional-params-backward-compat, silent-boundary-clamping]

key-files:
  created: []
  modified:
    - src/browsing/member-extractor.ts
    - src/browsing/types.ts
    - src/tools/read-member.ts
    - tests/browsing/member-extractor.test.ts

key-decisions:
  - "Context expansion happens in member-extractor.ts domain layer, not tool handler"
  - "memberStartLine/memberEndLine always reflect original member range including Javadoc"

patterns-established:
  - "Context expansion pattern: optional linesBefore/linesAfter with Math.max/Math.min clamping"

requirements-completed: [READ-03]

duration: 3min
completed: 2026-04-14
---

# Phase 20 Plan 01: Member Context Lines Domain Layer Summary

**extractMemberSource accepts optional linesBefore/linesAfter with silent boundary clamping and memberStartLine/memberEndLine metadata**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-14T16:14:25Z
- **Completed:** 2026-04-14T16:17:34Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- Extended MemberExtraction interface with memberStartLine and memberEndLine fields
- Extended MemberResult interface with memberStartLine and memberEndLine fields
- Added optional linesBefore/linesAfter parameters to extractMemberSource with silent clamping at file boundaries
- Updated read-member tool handler to pass through new fields
- Added 9 new unit tests covering backward compat, expansion directions, clamping, and overload independence

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for context expansion** - `9754f5c` (test)
2. **Task 1 (GREEN): Implement context expansion** - `9daf682` (feat)

## Files Created/Modified
- `src/browsing/member-extractor.ts` - Added memberStartLine/memberEndLine to MemberExtraction, linesBefore/linesAfter params with clamping logic
- `src/browsing/types.ts` - Added memberStartLine/memberEndLine to MemberResult interface
- `src/tools/read-member.ts` - Pass through memberStartLine/memberEndLine in MemberResult construction
- `tests/browsing/member-extractor.test.ts` - 9 new tests for context expansion behavior

## Decisions Made
- Context expansion logic lives in the domain layer (member-extractor.ts), keeping the tool handler thin
- memberStartLine includes Javadoc (matches existing decorationStart behavior)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated read-member.ts MemberResult construction**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Adding memberStartLine/memberEndLine to MemberResult interface caused type error in read-member.ts where MemberResult objects are constructed
- **Fix:** Added memberStartLine and memberEndLine fields to the mapping in read-member.ts
- **Files modified:** src/tools/read-member.ts
- **Verification:** pnpm test passes (555 tests, 0 failures)
- **Committed in:** 9daf682 (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for type correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Domain layer complete with full test coverage
- Plan 02 can wire linesBefore/linesAfter into read_member tool schema and handler

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 20-member-context-lines*
*Completed: 2026-04-14*
