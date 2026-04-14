---
phase: 17-structured-member-output
plan: 01
subsystem: browsing
tags: [fqn, type-resolution, enrichment, domain-module]

requires:
  - phase: 16-member-parser
    provides: TypeReference, ParameterInfo, MemberReference types, parseDetail, extractImports, createTypeResolver
provides:
  - buildMemberFqn pure function for Class#method() and Class#field: FQN generation
  - EnrichedSymbol discriminated union types (method/field/class)
  - enrichSymbols pipeline transforming TransformedSymbol[] to EnrichedSymbol[]
  - createResolvePackage bridge from EntryIndex to resolver callback
affects: [17-02-PLAN, list_members tool, search_symbols tool]

tech-stack:
  added: []
  patterns: [enrichment pipeline, FQN scheme with # separator]

key-files:
  created:
    - src/browsing/member-fqn.ts
    - src/browsing/member-enrichment.ts
    - tests/browsing/member-fqn.test.ts
    - tests/browsing/member-enrichment.test.ts
  modified:
    - src/browsing/types.ts
    - src/browsing/import-resolver.ts
    - tests/browsing/import-resolver.test.ts

key-decisions:
  - "FQN uses # separator (Class#method(), Class#field:) matching Javadoc convention"
  - "EnrichedClassSymbol has no memberFqn -- classes are containers, not members"

patterns-established:
  - "Enrichment pipeline: extractImports -> createTypeResolver -> enrichOne per symbol"
  - "Inner class FQN derivation: parent$ChildName for nested types"

requirements-completed: [TYPE-03]

duration: 2min
completed: 2026-04-14
---

# Phase 17 Plan 01: Domain Building Blocks Summary

**buildMemberFqn, EnrichedSymbol types, createResolvePackage bridge, and enrichSymbols pipeline for structured member output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-14T11:54:29Z
- **Completed:** 2026-04-14T11:57:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- buildMemberFqn produces Class#method() for methods/constructors and Class#field: for fields, with parens-stripping to prevent JDT LS double-parens
- EnrichedSymbol discriminated union (EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol) added to types.ts
- enrichSymbols pipeline transforms full symbol trees with correct FQN derivation including inner class $ separator
- createResolvePackage bridges EntryIndex.getClasses to the resolver callback signature
- 21 new tests added (9 member-fqn, 8 member-enrichment, 2 createResolvePackage, 2 import updates), full suite at 487 passing

## Task Commits

Each task was committed atomically:

1. **Task 1: buildMemberFqn, EnrichedSymbol types, and createResolvePackage** - `64226cc` (feat)
2. **Task 2: enrichSymbols pipeline function** - `a14a31b` (feat)

## Files Created/Modified
- `src/browsing/member-fqn.ts` - Pure function building FQNs with # separator for methods/fields
- `src/browsing/member-enrichment.ts` - enrichSymbols pipeline transforming symbols to enriched form
- `src/browsing/types.ts` - EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol, EnrichedSymbol union
- `src/browsing/import-resolver.ts` - createResolvePackage bridge function added
- `tests/browsing/member-fqn.test.ts` - 9 tests for FQN generation
- `tests/browsing/member-enrichment.test.ts` - 8 tests for enrichment pipeline
- `tests/browsing/import-resolver.test.ts` - 2 tests added for createResolvePackage

## Decisions Made
- FQN uses # separator (Class#method(), Class#field:) matching Javadoc convention
- EnrichedClassSymbol has no memberFqn -- classes are containers, not addressable members

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All domain building blocks ready for Plan 02 to wire into list_members and search_symbols tools
- enrichSymbols, buildMemberFqn, createResolvePackage all exported and tested
- EnrichedSymbol types available for tool layer consumption

---
*Phase: 17-structured-member-output*
*Completed: 2026-04-14*
