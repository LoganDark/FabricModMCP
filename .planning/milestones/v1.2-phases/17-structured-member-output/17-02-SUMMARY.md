---
phase: 17-structured-member-output
plan: 02
subsystem: tools
tags: [fqn, enrichment, list-members, search-symbols, structured-output]

requires:
  - phase: 17-structured-member-output
    provides: buildMemberFqn, enrichSymbols, createResolvePackage, EnrichedSymbol types
provides:
  - list_members returns EnrichedSymbol[] with memberFqn, parameters, returnType, fieldType
  - search_symbols results include memberFqn for methods/fields/constructors
affects: [v1.2-completion, mixin-integration]

tech-stack:
  added: []
  patterns: [multi-jar resolvePackage inline, enrichment wiring in tool layer]

key-files:
  created: []
  modified:
    - src/tools/list-members.ts
    - src/tools/search-symbols.ts
    - src/browsing/member-enrichment.ts
    - tests/tools/list-members.test.ts
    - tests/tools/search-symbols.test.ts

key-decisions:
  - "Multi-jar resolvePackage built inline in list-members rather than separate module (simple, uses cached EntryIndex)"
  - "enrichOne falls back to kind-based classification when detail is null (handles constructors with no detail string)"

patterns-established:
  - "Enrichment wiring: tool builds resolvePackage, derives classFqn from entryPath, calls enrichSymbols"
  - "memberFqn on search results: computed from containerName + name + kindName via buildMemberFqn"

requirements-completed: [TYPE-03, SRCH-03]

duration: 4min
completed: 2026-04-14
---

# Phase 17 Plan 02: Tool Wiring Summary

**Wired enrichment pipeline into list_members (structured types + FQNs) and added memberFqn to search_symbols results**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-14T11:58:25Z
- **Completed:** 2026-04-14T12:02:20Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- list_members now returns EnrichedSymbol[] with memberFqn, parameters/returnType on methods, fieldType on fields
- search_symbols results include memberFqn (Class#method() for methods, Class#field: for fields, null for classes/interfaces)
- Full test suite passes at 496 tests with 9 new assertions across both tools
- TYPE-03 and SRCH-03 requirements satisfied, completing the v1.2 milestone feature set

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire enrichment into list_members** - `3f1faa9` (feat)
2. **Task 2: Add memberFqn to search_symbols** - `ce6598e` (feat)

## Files Created/Modified
- `src/tools/list-members.ts` - Added enrichment pipeline: builds multi-jar resolvePackage, derives classFqn, calls enrichSymbols
- `src/tools/search-symbols.ts` - Added buildMemberFqn import and memberFqn computation in result mapping
- `src/browsing/member-enrichment.ts` - Fixed enrichOne to handle null detail on constructors/fields via kind-based fallback
- `tests/tools/list-members.test.ts` - 4 new tests: method enrichment, field enrichment, class container, constructor FQN
- `tests/tools/search-symbols.test.ts` - 5 new tests: method FQN, null containerName, constructor, interface null, field colon

## Decisions Made
- Multi-jar resolvePackage built inline in list-members (iterates getDependenciesForTool, uses cached EntryIndex per jar) rather than creating a separate module -- simple and efficient since getOrBuildIndex is O(1) after first call
- enrichOne enhanced to fall back to kind-based classification when parseDetail returns null (e.g., constructors with `detail: null` still get memberFqn and empty parameters)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed enrichOne null-detail fallback for constructors/fields**
- **Found during:** Task 1 (Wire enrichment into list_members)
- **Issue:** Constructors with `detail: null` from JDT LS fell through to EnrichedClassSymbol branch (no memberFqn, no parameters)
- **Fix:** Added METHOD_KINDS/FIELD_KINDS sets to member-enrichment.ts; enrichOne now checks symbol kind as fallback when parsed is null
- **Files modified:** src/browsing/member-enrichment.ts
- **Verification:** Constructor test case passes, all 8 existing enrichment tests still pass
- **Committed in:** 3f1faa9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness -- constructors must have memberFqn regardless of detail string presence.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All v1.2 milestone features implemented: method search (Phase 15), member parser (Phase 16), structured output (Phase 17)
- 496 tests passing, no regressions
- Ready for milestone completion review

---
*Phase: 17-structured-member-output*
*Completed: 2026-04-14*

## Self-Check: PASSED
