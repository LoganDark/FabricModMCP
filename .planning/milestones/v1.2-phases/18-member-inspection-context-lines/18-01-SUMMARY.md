---
phase: 18-member-inspection-context-lines
plan: 01
subsystem: browsing
tags: [mcp, java, fqn, member-extraction, javadoc, lsp]

requires:
  - phase: 17-structured-member-output
    provides: enrichSymbols pipeline, memberFqn on EnrichedMethodSymbol/EnrichedFieldSymbol
provides:
  - read_member MCP tool for individual method/field source by FQN
  - member-extractor domain module (parseMemberFqn, findDecorationsStart, extractMemberSource)
  - symbol-transform shared module (extracted from list-members)
  - MemberResult type for member source results
affects: [18-02, future-context-lines, mixin-tooling]

tech-stack:
  added: []
  patterns: [shared-symbol-transform, member-fqn-parsing, javadoc-decoration-scanning]

key-files:
  created:
    - src/browsing/member-extractor.ts
    - src/browsing/symbol-transform.ts
    - src/tools/read-member.ts
    - tests/browsing/member-extractor.test.ts
    - tests/tools/read-member.test.ts
  modified:
    - src/tools/list-members.ts
    - src/tools/descriptions.ts
    - src/tools/index.ts
    - src/browsing/types.ts

key-decisions:
  - "Extracted transformSymbol to shared symbol-transform.ts rather than duplicating in read-member"
  - "Inner class FQNs use outer class name for source file lookup, full className for FQN matching"
  - "findDecorationsStart only scans for Javadoc (not annotations) since JDT LS range already includes annotations"

patterns-established:
  - "Shared symbol transform: src/browsing/symbol-transform.ts centralizes LSP DocumentSymbol transformation"
  - "Member extraction pattern: parse FQN, resolve source, enrich symbols, extract matching members"

requirements-completed: [P18-01, P18-02, P18-03, P18-04, P18-05, P18-06]

duration: 5min
completed: 2026-04-14
---

# Phase 18 Plan 01: Read Member Tool Summary

**read_member MCP tool that extracts individual method/field source by FQN with Javadoc, including overload and inner class support**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-14T12:49:38Z
- **Completed:** 2026-04-14T12:54:22Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Member extractor domain module with FQN parsing, Javadoc scanning, and source extraction
- read_member MCP tool wired with LSP documentSymbol + enrichSymbols pipeline
- Extracted transformSymbol to shared module, reducing duplication between list-members and read-member
- 24 new tests (17 domain + 7 tool), 526 total passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Member extractor domain module** - `4ad4697` (test) + `e0f4a64` (feat) — TDD red/green
2. **Task 2: read_member MCP tool registration and wiring** - `59d5674` (feat)

## Files Created/Modified
- `src/browsing/member-extractor.ts` - parseMemberFqn, findDecorationsStart, extractMemberSource
- `src/browsing/symbol-transform.ts` - Shared transformSymbol/transformSymbolInformation/transformSymbolResponse
- `src/tools/read-member.ts` - registerReadMemberTool MCP tool
- `src/tools/list-members.ts` - Updated to use shared symbol-transform
- `src/tools/descriptions.ts` - Added read_member description
- `src/tools/index.ts` - Registered registerReadMemberTool
- `src/browsing/types.ts` - Added MemberResult interface
- `tests/browsing/member-extractor.test.ts` - 17 domain-level tests
- `tests/tools/read-member.test.ts` - 7 tool-level tests

## Decisions Made
- Extracted transformSymbol to shared `src/browsing/symbol-transform.ts` rather than duplicating -- cleaner and DRY
- Inner class FQNs (e.g., `Outer$Inner#field:`) use the outer class name for source file resolution since Java inner classes live in the outer class source file
- findDecorationsStart only looks for Javadoc `/** */` blocks, not annotations, because JDT LS symbol ranges already include annotations in their start position

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added transformSymbolResponse convenience function**
- **Found during:** Task 2 (read_member tool)
- **Issue:** The plan suggested extracting transformSymbol but the inline symbol-type detection logic in list-members was also duplicated
- **Fix:** Created transformSymbolResponse() that handles null/DocumentSymbol[]/SymbolInformation[] in one call
- **Files modified:** src/browsing/symbol-transform.ts, src/tools/list-members.ts
- **Verification:** Full test suite passes (526 tests)
- **Committed in:** 59d5674

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality)
**Impact on plan:** Improvement over plan -- less duplication, cleaner shared code.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- read_member tool fully operational, ready for context lines feature in Plan 02
- All existing tests pass with no regressions

---
*Phase: 18-member-inspection-context-lines*
*Completed: 2026-04-14*
