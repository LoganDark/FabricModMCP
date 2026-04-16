---
phase: 31-data-exposure
plan: 01
subsystem: api
tags: [mcp-tools, jdtls, type-hierarchy, member-enrichment]

# Dependency graph
requires:
  - phase: 30-api-consistency
    provides: unified pagination and clean API patterns
provides:
  - JDT LS status fields in get_project_info response
  - declaredDependencies in get_member_info response
  - jar field on ClassReference in type_hierarchy
  - fqn field on EnrichedClassSymbol for inner class identification
affects: [documentation, server-instructions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional additive fields on response types (jar?, fqn?)"

key-files:
  created: []
  modified:
    - src/tools/get-project-info.ts
    - src/tools/get-member-info.ts
    - src/browsing/types.ts
    - src/tools/type-hierarchy.ts
    - src/browsing/member-enrichment.ts
    - src/tools/tool-helpers.ts
    - tests/tools/get-project-info.test.ts
    - tests/tools/get-member-info.test.ts
    - tests/tools/type-hierarchy.test.ts
    - tests/browsing/member-enrichment.test.ts
    - tests/tools/list-members.test.ts

key-decisions:
  - "Omit raw field from declaredDependencies (redundant group:artifact:version)"
  - "fqn on EnrichedClassSymbol uses classFqn parameter which already computes $ separator for inner classes"

patterns-established:
  - "Optional additive fields: add jar?/fqn? to existing interfaces without breaking consumers"
  - "stripEnrichedSymbol pattern: if ('field' in sym) base.field = sym.field for optional enrichment fields"

requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04]

# Metrics
duration: 3min
completed: 2026-04-16
---

# Phase 31 Plan 01: Data Exposure Summary

**Surface JDT LS status, build dependencies, jar provenance in type hierarchies, and inner class FQNs in compact output across four tool responses**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-16T01:20:50Z
- **Completed:** 2026-04-16T01:24:10Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- get_project_info now returns jdtlsAvailable boolean and jdtlsFailureReason so agents know if semantic navigation is available
- get_member_info returns declaredDependencies in projectInfo with configuration/group/artifact/version (no redundant raw field)
- type_hierarchy ClassReference entries include jar field when URI maps to a known jar via uriMapper
- list_members compact output includes fqn on all class-kind symbols, enabling agents to use inner class FQNs directly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add type fields and implement DATA-01 + DATA-02** - `f78a0c9` (feat)
2. **Task 2: Implement DATA-03 (jar in ClassReference) and DATA-04 (fqn in EnrichedClassSymbol)** - `572fd9f` (feat)

## Files Created/Modified
- `src/tools/get-project-info.ts` - Added jdtlsAvailable and jdtlsFailureReason to response envelope
- `src/tools/get-member-info.ts` - Added declaredDependencies to projectInfo block
- `src/browsing/types.ts` - Added optional jar? to ClassReference, optional fqn? to EnrichedClassSymbol
- `src/tools/type-hierarchy.ts` - toClassReference now accepts uriMapper and populates jar field
- `src/browsing/member-enrichment.ts` - enrichOne sets fqn on class-kind symbols using classFqn
- `src/tools/tool-helpers.ts` - stripEnrichedSymbol includes fqn for class-kind symbols
- `tests/tools/get-project-info.test.ts` - 3 new tests for JDT LS status scenarios
- `tests/tools/get-member-info.test.ts` - 2 new tests for declaredDependencies
- `tests/tools/type-hierarchy.test.ts` - Updated assertions for jar field on ClassReference
- `tests/browsing/member-enrichment.test.ts` - 1 new test for fqn on class-kind symbols
- `tests/tools/list-members.test.ts` - 1 new test for fqn in compact inner class output

## Decisions Made
- Omit `raw` field from declaredDependencies per user decision (redundant concatenation of group:artifact:version)
- fqn field reuses existing `classFqn` parameter which already computes `$` separator for inner classes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four data exposure items implemented and tested
- 682 tests pass with no regressions
- Ready for documentation phase or next milestone work

---
*Phase: 31-data-exposure*
*Completed: 2026-04-16*

## Self-Check: PASSED
