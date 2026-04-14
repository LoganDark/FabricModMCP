---
phase: 07-search
plan: 01
subsystem: browsing
tags: [picomatch, glob, search, pagination, deduplication]

requires:
  - phase: 06-browsing
    provides: EntryIndex, class-parser, source-adapter, jar-registry
provides:
  - EntryIndex.getAllClasses() for global class enumeration
  - searchClasses() function with pattern matching, kind filtering, pagination
  - FlatClassInfo interface for flat class representation
  - SearchClassResult, SearchResponse, SearchOptions types
affects: [07-search plan 02 (MCP tool wiring)]

tech-stack:
  added: []
  patterns: [dot-to-slash picomatch conversion for FQN glob matching, auto-prefix for single-segment patterns]

key-files:
  created:
    - src/browsing/search.ts
    - tests/browsing/search.test.ts
  modified:
    - src/browsing/entry-index.ts
    - tests/browsing/entry-index.test.ts

key-decisions:
  - "Single-segment patterns auto-prefixed with {**/,} so *Client matches any-depth FQN"
  - "Class declarations always read for matched classes (type/access always populated)"
  - "EntryIndex cache keyed by jar path for repeated search performance"

patterns-established:
  - "Dot-to-slash conversion: FQN dots become path separators for picomatch glob matching"
  - "Auto-prefix pattern: single-segment patterns get {**/,} prefix for depth-agnostic matching"

requirements-completed: [SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05]

duration: 1min
completed: 2026-04-13
---

# Phase 7 Plan 1: Search Domain Logic Summary

**FQN glob search with picomatch dot-to-slash conversion, kind filtering, deduplication, priority sorting, and offset pagination**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-13T10:19:33Z
- **Completed:** 2026-04-13T10:20:50Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- EntryIndex.getAllClasses() enumerates all non-anonymous classes with FQN, className, packageName, isInnerClass
- searchClasses() implements full search pipeline: pattern matching, kind filtering, dedup, sorting, pagination
- Dot-to-slash FQN conversion enables picomatch glob patterns on Java fully-qualified names
- Single-segment patterns (e.g. *Client) auto-prefixed to match at any package depth

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED):** Add failing tests - `c32f9ca` (test)
2. **Task 1 (GREEN):** Implement getAllClasses and searchClasses - `5600fae` (feat)

## Files Created/Modified
- `src/browsing/entry-index.ts` - Added FlatClassInfo interface and getAllClasses() method
- `src/browsing/search.ts` - New search domain module with searchClasses(), types, and entry index caching
- `tests/browsing/entry-index.test.ts` - Added getAllClasses test suite (6 tests)
- `tests/browsing/search.test.ts` - New search test suite (18 tests) with mock JarReader/SourceAdapter

## Decisions Made
- Single-segment patterns (no dots) auto-prefixed with `{**/,}` so `*Client` matches `net.minecraft.client.MinecraftClient` -- without this, picomatch `*` only matches within a single path segment
- Class declarations always read for all matched classes to populate type/access fields, even when no kind filter is specified -- consistent output
- EntryIndex instances cached per jar path in module-level Map for repeated search performance

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Single-segment pattern matching fix**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Pattern `*Client` converted to path `*Client` but picomatch `*` doesn't cross `/` boundaries, so it couldn't match `net/minecraft/client/MinecraftClient`
- **Fix:** Auto-prefix single-segment patterns (no `/` after dot conversion) with `{**/,}` to allow matching at any depth
- **Files modified:** src/browsing/search.ts
- **Verification:** All 44 tests pass including `*Client`, `*$Options`, and `*client` patterns
- **Committed in:** 5600fae (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential fix for single-segment pattern usability. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Search domain logic complete, ready for MCP tool wiring in plan 02
- searchClasses() accepts JarReader and dependencies as parameters for easy integration
- All 218 tests pass (no regressions)

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 07-search*
*Completed: 2026-04-13*
