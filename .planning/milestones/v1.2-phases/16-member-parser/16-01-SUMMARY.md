---
phase: 16-member-parser
plan: 01
subsystem: browsing
tags: [typescript, discriminated-unions, java-imports, type-resolution]

# Dependency graph
requires: []
provides:
  - TypeReference discriminated union (6 variants) for representing Java types
  - MemberReference union (MethodReference | FieldReference) for member signatures
  - ParameterInfo interface for method parameters
  - extractImports function for parsing Java import statements
  - createTypeResolver function for simple-name to FQN resolution
affects: [16-02-detail-parser]

# Tech tracking
tech-stack:
  added: []
  patterns: [discriminated-union-types, four-stage-resolution-cascade, star-import-caching]

key-files:
  created:
    - src/browsing/member-types.ts
    - src/browsing/import-resolver.ts
    - tests/browsing/member-types.test.ts
    - tests/browsing/import-resolver.test.ts
  modified: []

key-decisions:
  - "java.lang types use hardcoded set (~35 common types) rather than resolvePackage callback"
  - "Star import cache stores Promise<string[]> to deduplicate concurrent resolution"

patterns-established:
  - "Discriminated unions with kind field for type-safe exhaustive switching"
  - "Four-stage cascade pattern: explicit -> star -> same-package -> java.lang -> unresolved"

requirements-completed: [TYPE-01, TYPE-02]

# Metrics
duration: 2min
completed: 2026-04-14
---

# Phase 16 Plan 01: Type Definitions and Import Resolver Summary

**TypeReference/MemberReference discriminated unions and four-stage import-based type name resolver with star import caching**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-14T10:15:38Z
- **Completed:** 2026-04-14T10:17:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Defined TypeReference union with 6 variants (primitive, class, array, vararg, void, unresolved) as foundation for detail string parsing
- Defined MemberReference union (MethodReference with ParameterInfo[], FieldReference) for structured member representations
- Implemented extractImports to parse Java source imports (explicit, star, package declaration; static imports ignored)
- Implemented createTypeResolver with 7-stage cascade and per-package star import caching

## Task Commits

Each task was committed atomically:

1. **Task 1: TypeReference and MemberReference type definitions** - `ab4ed41` (feat)
2. **Task 2: Import extraction and type name resolution** - `187aea3` (feat)

_TDD: Task 1 tests passed immediately (type-only imports erased at runtime). Task 2 RED phase confirmed failure, GREEN phase passed all 15 tests._

## Files Created/Modified
- `src/browsing/member-types.ts` - TypeReference union, MemberReference union, ParameterInfo interface
- `src/browsing/import-resolver.ts` - extractImports and createTypeResolver with four-stage cascade
- `tests/browsing/member-types.test.ts` - 11 tests for type construction and discrimination
- `tests/browsing/import-resolver.test.ts` - 15 tests for import parsing and resolution cascade

## Decisions Made
- java.lang types resolved via hardcoded set (~35 types) rather than resolvePackage callback -- avoids unnecessary async call for well-known types
- Star import cache stores the Promise itself (not awaited result) to deduplicate concurrent resolution of the same package

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TypeReference and MemberReference types ready for Plan 02 (detail string parser)
- Import resolver ready to provide name resolution for the parser
- All 448 tests pass with no regressions

---
*Phase: 16-member-parser*
*Completed: 2026-04-14*
