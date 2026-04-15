---
phase: 23-type-foundation-and-projectstore
plan: 01
subsystem: types
tags: [typescript, discriminated-union, compat-layer, project-model]

# Dependency graph
requires: []
provides:
  - "Project, FabricModChild, StudyJarChild, ProjectChild type hierarchy"
  - "LoadedProject type alias for backward compatibility"
  - "Compat accessor functions (getSoleFabricMod, getGradleConfig, etc.)"
  - "getStudyJars filtering function"
affects: [23-02-PLAN, 23-03-PLAN, projectstore, tool-layer]

# Tech tracking
tech-stack:
  added: []
  patterns: ["discriminated union with kind field for child types", "compat accessor functions delegating through sole-child resolution"]

key-files:
  created:
    - src/project/compat.ts
    - tests/project/compat.test.ts
    - tests/project/types.test.ts
  modified:
    - src/project/types.ts

key-decisions:
  - "StudyJar interface kept alongside StudyJarChild -- StudyJar is internal, StudyJarChild adds kind discriminant"
  - "Compat accessors throw DomainError with specific codes NO_FABRIC_MOD and MULTIPLE_FABRIC_MODS"

patterns-established:
  - "Discriminated union: ProjectChild narrowed by kind field ('fabric-mod' | 'study-jar')"
  - "Compat accessor pattern: getSoleFabricMod resolves sole mod, property accessors delegate through it"

requirements-completed: [CONT-01, CONT-02, CONT-03, CONT-06]

# Metrics
duration: 2min
completed: 2026-04-15
---

# Phase 23 Plan 01: Type Foundation Summary

**Discriminated union type hierarchy (Project/FabricModChild/StudyJarChild) with compat accessor layer for backward-compatible field access**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-15T16:01:42Z
- **Completed:** 2026-04-15T16:03:54Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Rewrote types.ts with Project as pure container, FabricModChild and StudyJarChild as discriminated union children
- Built compat accessor layer (8 exported functions) bridging old field access to new child-based structure
- 21 tests covering compat accessors (14 tests) and type hierarchy correctness (7 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite types.ts** - `223e5bb` (feat)
2. **Task 2: Create compat.ts with tests** - `f80472e` (test/RED) + `72544c0` (feat/GREEN)
3. **Task 3: Create types.test.ts** - `6e837ac` (test)

## Files Created/Modified
- `src/project/types.ts` - New type hierarchy: Project, FabricModChild, StudyJarChild, ProjectChild, LoadedProject alias
- `src/project/compat.ts` - 8 compat accessor functions for backward-compatible field access
- `tests/project/compat.test.ts` - 14 tests for compat accessors (error cases, delegation, study jar filtering)
- `tests/project/types.test.ts` - 7 tests for discriminated union narrowing and type assignability

## Decisions Made
- Kept StudyJar interface alongside StudyJarChild since StudyJar is used internally and StudyJarChild adds the kind discriminant
- Used DomainError with codes NO_FABRIC_MOD and MULTIPLE_FABRIC_MODS for clear error handling in compat layer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Type hierarchy and compat layer ready for Plan 02 (ProjectStore migration)
- Existing tests will fail due to LoadedProject type change -- expected and addressed in Plans 02/03

## Self-Check: PASSED

All 4 files verified present. All 4 commits verified in git log.

---
*Phase: 23-type-foundation-and-projectstore*
*Completed: 2026-04-15*
