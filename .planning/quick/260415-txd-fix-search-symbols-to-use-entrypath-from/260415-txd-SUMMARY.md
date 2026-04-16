---
phase: quick
plan: 260415-txd
subsystem: tools
tags: [jdtls, uri-mapper, search-symbols]

provides:
  - "search_symbols location.uri uses entryPath instead of raw file:// URI"
affects: [search-symbols, uri-mapper]

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/tools/search-symbols.ts
    - tests/tools/search-symbols.test.ts

key-decisions:
  - "Use mapping?.entryPath ?? sym.location.uri for fallback behavior matching processNavigationLocations pattern"

requirements-completed: []

duration: 34s
completed: 2026-04-15
---

# Quick Task 260415-txd: Fix search_symbols to use entryPath from URI mapper

**search_symbols now returns jar entry paths (e.g. net/minecraft/client/MinecraftClient.java) in location.uri instead of raw file:// URIs, matching find-definition/find-references behavior**

## Performance

- **Duration:** 34s
- **Started:** 2026-04-15T21:34:34Z
- **Completed:** 2026-04-15T21:35:08Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Fixed location.uri in search_symbols results to use entryPath from URI mapper when jar mapping succeeds
- Added test assertion verifying entryPath is returned instead of raw file:// URI
- Maintained fallback to raw URI when mapping returns null

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test assertion for entryPath in location.uri, then fix search-symbols.ts** - `d8a1630` (feat)

## Files Created/Modified
- `src/tools/search-symbols.ts` - Changed `uri: sym.location.uri` to `uri: mapping?.entryPath ?? sym.location.uri`
- `tests/tools/search-symbols.test.ts` - Added assertion that location.uri equals the entryPath

## Decisions Made
- Used `mapping?.entryPath ?? sym.location.uri` pattern for null-safe fallback, consistent with how processNavigationLocations in tool-helpers.ts handles URI mapping

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

---
*Quick task: 260415-txd*
*Completed: 2026-04-15*
