---
phase: quick
plan: 260424-hn5
subsystem: tools
tags: [mcp, server-instructions, pagination, ux]

provides:
  - "SERVER_INSTRUCTIONS Large Responses section with pagination retry guidance"
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/tools/descriptions.ts

key-decisions:
  - "Placed section after configure_filters as last section in SERVER_INSTRUCTIONS"

patterns-established: []

requirements-completed: []

duration: 1min
completed: 2026-04-24
---

# Quick 260424-hn5: Add Large Responses Pagination Guidance Summary

**Added SERVER_INSTRUCTIONS section telling agents to retry with pagination parameters instead of reading oversized responses from files**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-24T19:43:58Z
- **Completed:** 2026-04-24T19:44:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added "Large Responses" section to SERVER_INSTRUCTIONS in descriptions.ts
- Documents startLine/lineCount for read_source/read_member and limit/offset for navigation tools
- Explicitly warns agents to ignore MCP client file-read suggestions and retry with smaller ranges

## Task Commits

1. **Task 1: Add response pagination guidance to SERVER_INSTRUCTIONS** - `9bcbe1d` (feat)

## Files Created/Modified
- `src/tools/descriptions.ts` - Added Large Responses section to SERVER_INSTRUCTIONS

## Decisions Made
- Placed the new section as the last section in SERVER_INSTRUCTIONS, after configure_filters

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing DTS build error from TypeScript 6.0.2 baseUrl deprecation - not caused by this change, ESM build succeeds, all 701 tests pass

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
N/A - standalone quick task.

---
*Phase: quick*
*Completed: 2026-04-24*
