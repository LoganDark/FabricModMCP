---
phase: 29-jdt-ls-and-workspace-bug-fixes
plan: 01
subsystem: jdtls
tags: [jdt-ls, type-hierarchy, inner-class, workspace-sync, signal-handlers, cleanup]

requires:
  - phase: 26-jdt-ls-workspace-unification
    provides: JDT LS workspace extraction and sync infrastructure
provides:
  - Cycle-safe supertype walk in type_hierarchy tool
  - Inner class FQN support in read_source with position hints
  - JDT LS data directory cleanup on process exit
  - Partial extraction directory cleanup on workspace sync failure
affects: []

tech-stack:
  added: []
  patterns:
    - "Cycle detection via Set<string> of FQNs in graph walks"
    - "Inner class FQN handling: strip $ suffix, read outer file, scan for declaration line"
    - "Best-effort cleanup pattern: try/catch around rm() in signal handlers and error paths"

key-files:
  created: []
  modified:
    - src/tools/type-hierarchy.ts
    - src/tools/read-source.ts
    - src/browsing/types.ts
    - src/index.ts
    - src/jdtls/workspace-sync.ts
    - tests/tools/type-hierarchy.test.ts
    - tests/tools/read-source.test.ts
    - tests/jdtls/workspace-sync.test.ts

key-decisions:
  - "Cycle detection seeds seen set with target class FQN to catch self-referential cycles immediately"
  - "Inner class handling in read_source only (not classNameToEntryPath) to limit scope per CONTEXT.md"
  - "findInnerClassHint is a local function in read-source.ts, not a shared utility"

patterns-established:
  - "Signal handler cleanup: iterate projectStore.list(), clean tempDir and dataDir with try/catch"

requirements-completed: [FIX-02, FIX-04, FIX-05, FIX-06]

duration: 5min
completed: 2026-04-16
---

# Phase 29 Plan 01: JDT LS & Workspace Bug Fixes Summary

**Four targeted bug fixes: cycle-safe type hierarchy walk, inner class FQN read_source with position hints, JDT LS data dir cleanup on exit, and partial extraction directory cleanup**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-16T00:38:14Z
- **Completed:** 2026-04-16T00:43:42Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Type hierarchy supertype walk now terminates on circular hierarchies (A extends B, B extends A) by tracking seen FQNs
- read_source accepts inner class FQNs (e.g., `Outer$Inner`), reads the outer class file, and returns `innerClass: { name, startLine }` hint metadata
- SIGINT and SIGTERM handlers clean up both tempDir and dataDir for all JDT LS sessions (best-effort)
- syncFabricModToWorkspace deletes partially extracted directories when extraction fails midway

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix type hierarchy cycle detection and inner class read_source**
   - `36f9c4d` (test: add failing tests)
   - `5d7165f` (feat: implement cycle detection and inner class handling)
2. **Task 2: Fix JDT LS data dir cleanup and workspace sync partial extraction cleanup**
   - `19cbe95` (test: add failing test for partial extraction cleanup)
   - `fda9374` (feat: implement data dir cleanup and partial extraction cleanup)

## Files Created/Modified
- `src/tools/type-hierarchy.ts` - Added Set<string> cycle detection in supertype walk
- `src/tools/read-source.ts` - Inner class FQN handling with findInnerClassHint()
- `src/browsing/types.ts` - Added optional `innerClass` field to SourceResult interface
- `src/index.ts` - cleanupAllSessions() + SIGINT/SIGTERM handlers
- `src/jdtls/workspace-sync.ts` - Track createdDirs, rm them in catch block
- `tests/tools/type-hierarchy.test.ts` - Circular hierarchy test
- `tests/tools/read-source.test.ts` - Inner class FQN tests (4 new)
- `tests/jdtls/workspace-sync.test.ts` - Partial extraction cleanup test

## Decisions Made
- Seeded cycle detection `seen` set with target class FQN so self-referential cycles are caught immediately
- Placed inner class handling in read_source.ts only (not in classNameToEntryPath) per CONTEXT.md scope guidance
- findInnerClassHint kept as local function rather than shared utility -- only read_source needs it

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Cycle detection initially let one extra iteration through before detecting the cycle (3 entries instead of 1). Fixed by checking seen set BEFORE adding supers to extendsChain.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All four FIX items resolved, JDT LS subsystem more resilient to edge cases
- 675 tests pass, no regressions

---
*Phase: 29-jdt-ls-and-workspace-bug-fixes*
*Completed: 2026-04-16*
