---
phase: 38-jdt-ls-discovery-on-windows
plan: 01
subsystem: jdtls
tags: [windows, jdt-ls, platform-discovery, glob, vitest, regression-gate]

# Dependency graph
requires:
  - phase: 35-platform-helpers-java-executable-resolution
    provides: "jdtlsCandidateDirs() in src/platform/index.ts (Windows: 4 paths; Unix: 3 v1.5 paths)"
  - phase: 37-smarter-java-discovery-cross-platform
    provides: "Multi-line failure composer structural precedent in src/jdtls/java-discovery.ts (formatSlotLine / formatReason / SlotRecord pattern)"
provides:
  - "findJdtLs() now discovers JDT LS on Windows via Phase 35's four-path candidate list with deep probe (existsSync + launcher-jar glob)"
  - "Empty-dir shadow case is now caught and skipped — a higher-priority candidate directory without a launcher jar no longer prevents discovery of a lower-priority valid one"
  - "JDTLS_HOME set-but-invalid returns one of two distinct single-line errors (dir-missing vs launcher-missing) with no fall-through to candidate probing"
  - "Multi-line failure diagnostic mirrors discoverJava precedent — 'JDT LS not found. Tried:' header + per-slot lines + install hint"
  - "process.env.HOME site removed from src/jdtls/client.ts; home resolution owned entirely by jdtlsCandidateDirs() in src/platform/index.ts"
  - "CI regression gate at tests/no-process-env-home.test.ts enforces zero process.env.HOME matches in src/**/*.ts for all future commits"
affects: [phase-39, windows-support, cross-platform-validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Slot-record + composeFailureReason pattern (mirrors java-discovery.ts) for any future discovery chain needing a multi-line diagnostic"
    - "SkipReason discriminated union with kind-as-text literals so formatReason can return the kind string unchanged"
    - "globSync (sync) for startup-time discovery probes — distinct from glob (async) used inside startJdtLs"
    - "Test-suite-wide vi.mock('glob') with default returnValue=[] so tests not exercising globSync don't get `undefined` from the deeper probe"
    - "Logger spy re-imports logger AFTER vi.resetModules() so the spy is attached to the same module instance findJdtLs uses"

key-files:
  created:
    - tests/no-process-env-home.test.ts
  modified:
    - src/jdtls/client.ts
    - tests/jdtls/client.test.ts

key-decisions:
  - "D-01: Deep probe (existsSync + launcher-jar glob) — both checks required, not just existsSync; locks out the empty-dir shadow case"
  - "D-02: Multi-line failure format header is exactly 'JDT LS not found. Tried:' so the existing toContain('JDT LS not found') assertion stays green"
  - "D-04: Candidate-dir labels in the failure message are bare absolute paths (no decoration); JDTLS_HOME slot uses the literal label 'JDTLS_HOME'"
  - "D-07: JDTLS_HOME set-but-invalid returns immediately (no fall-through to candidate probing) — surfaces user-configuration errors loudly"
  - "D-08/D-09: The lone process.env.HOME site in src/ is removed AND a vitest gate enforces this for all future PRs"
  - "Test-suite default globSync mock returns [] (not undefined) so pre-existing JDTLS_HOME-not-set tests don't crash with 'Cannot read properties of undefined'"

patterns-established:
  - "Discovery chain with multi-line diagnostic: slot-record taxonomy + private composeFailureReason/formatSlotLine/formatReason helpers — applied identically in java-discovery (Phase 37) and now jdtls/client (Phase 38)"
  - "Sync glob for startup probes via globSync import alongside the existing async glob import (single import statement)"
  - "Vitest grep regression gate scoped to src/ — readdir recursive walker, word-boundary regex, vitest assertion-message override pointing at the decision record"

requirements-completed: [WIN-02]

# Metrics
duration: 8min
completed: 2026-05-24
---

# Phase 38 Plan 01: JDT LS discovery on Windows Summary

**findJdtLs() now discovers JDT LS on Windows via Phase 35's 4-path candidate list with deep launcher-jar probe; the process.env.HOME site is eliminated and locked out by a vitest regression gate.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-24T16:10:00Z
- **Completed:** 2026-05-24T16:15:00Z
- **Tasks:** 3
- **Files modified:** 3 (1 source, 2 test — 1 new test file)

## Accomplishments
- Rewrote `findJdtLs()` to consume `jdtlsCandidateDirs()` from `src/platform/index.ts` with a deep probe (existsSync + `plugins/org.eclipse.equinox.launcher_*.jar` glob match); empty-dir shadow case is now caught and skipped.
- Deepened `JDTLS_HOME` validation symmetrically — two distinct single-line error branches (dir-missing vs launcher-missing), both fail-fast with no fall-through to candidate probing (D-07).
- Composed a multi-line failure diagnostic mirroring Phase 37's `discoverJava` precedent: `'JDT LS not found. Tried:'` header, per-slot lines (`JDTLS_HOME: (not set)` + each probed candidate path with its skip reason), trailing install hint.
- Wired `logger.debug('JDT LS candidate skipped', { candidate, reason })` for every per-candidate skip (D-05).
- Removed the lone `process.env.HOME` site from `src/jdtls/client.ts` — home resolution now owned entirely by `jdtlsCandidateDirs()`.
- Extended `tests/jdtls/client.test.ts` with `findJdtLs on Windows` (4 cases: ordering, shadow case, multi-line failure, logger.debug spy) and `findJdtLs on Unix (UNIX-01 regression)` (3 cases: Linux ordering, Darwin ordering, byte-identical v1.5 path tuple).
- Added `tests/no-process-env-home.test.ts` as a CI regression gate that fails any future PR reintroducing `process.env.HOME` to `src/**/*.ts`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite findJdtLs() with deep probe + multi-line composer** — `2496b51` (feat)
2. **Task 2: Extend tests/jdtls/client.test.ts with Windows / Unix / shadow / multi-line describes** — `abdd4e0` (test)
3. **Task 3: Create tests/no-process-env-home.test.ts regression gate** — `c2609c0` (test)

## Files Created/Modified
- `src/jdtls/client.ts` — Imports `jdtlsCandidateDirs` and `globSync`; adds `LAUNCHER_GLOB` const, `SkipReason` 3-variant discriminated union, `SlotRecord` type, and private `formatReason` / `formatSlotLine` / `composeFailureReason` helpers; replaces the body of `findJdtLs()` with JDTLS_HOME deep-probe (fail-fast) followed by a candidate loop that logs each skip via `logger.debug` and composes the multi-line failure when every slot misses.
- `tests/jdtls/client.test.ts` — Adds `vi.mock('glob', ...)` factory (default `globSync` returns `[]`), updates the existing JDTLS_HOME-valid test to mock `globSync` for the deeper probe, adds a JDTLS_HOME-launcher-missing test with D-07 no-fall-through assertion, appends two new top-level describes (`findJdtLs on Windows` with 5 it-cases; `findJdtLs on Unix (UNIX-01 regression)` with 3 it-cases including Darwin).
- `tests/no-process-env-home.test.ts` — NEW. Recursive `readdir`-based walker scoped strictly to `walk('src')`, regex `/process\.env\.HOME\b/` with word boundary (protects against future false positives on `HOMEDIR` / `HOMEDRIVE`), vitest assertion-message override pointing future readers at Phase 38 D-08/D-09.

## Decisions Made
- **Logger-spy isolation:** The `logger.debug` D-05 spy test re-imports `../../src/logging/logger.js` AFTER `vi.resetModules()` and spies on THAT instance, because the dynamic import of `client.js` evaluates a fresh logger module instance distinct from the top-of-file import. Patching the top-of-file logger would silently no-op. (Slight refinement of the plan's `vi.spyOn(logger, 'debug')` suggestion — same intent, working implementation.)
- **Test-suite-wide globSync default:** The `vi.mock('glob')` factory installs `globSync: vi.fn(() => [])` so pre-existing tests that don't explicitly arrange a `globSync` return value don't crash on `Cannot read properties of undefined (reading 'length')` when the new deeper probe runs. Per-describe `beforeEach` calls also restore the `[]` default after `mockReset()`. (Standard Vitest hygiene; not strictly called out in the plan but necessary to keep the pre-existing `JDTLS_HOME not set` test green.)

## Deviations from Plan

None — plan executed exactly as written. The two minor implementation refinements above (logger-spy module-instance handling, test-suite-wide globSync default) are interpretation-level adjustments necessary to satisfy the plan's explicit behavior contracts; they do not change any user-visible behavior, any test assertion target, or any acceptance-criterion bytecount.

## Issues Encountered

- **Vitest initial run surfaced two failures** that were resolved before the Task 2 commit:
  1. The existing `returns error when JDTLS_HOME not set and no common locations exist` test crashed with `Cannot read properties of undefined (reading 'length')` because the new `globSync` mock returned `undefined` by default. **Fix:** Default the global `vi.mock('glob')` factory to `vi.fn(() => [])` and restore that default in each describe's `beforeEach` after `mockReset()`.
  2. The `emits logger.debug for every skipped candidate (D-05)` spy test asserted 0 calls instead of 4. Root cause: the top-of-file `import { logger }` was bound to a module instance that `vi.resetModules()` in `beforeEach` invalidated, so the dynamically imported `findJdtLs` was calling a fresh logger instance the spy never saw. **Fix:** Dynamically re-import `../../src/logging/logger.js` inside the test (after `vi.resetModules()` ran in `beforeEach`) and attach the spy to that instance.

Both fixes are standard Vitest module-isolation hygiene; neither required any change to source code under `src/`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- WIN-02 satisfied; Phase 38 is complete on the macOS dev host.
- UNIX-01 byte-identical commitment preserved: Linux / Darwin candidate ordering is unchanged (only depth of probe changed, plus the new shadow-case-skips-and-continues semantics).
- UNIX-03 preserved: full 869-test suite green (72 files).
- **Deferred to Phase 39:** Real-Windows-host verification of `findJdtLs()` against a live JDT LS install + Linux CI run. The Phase 38 tests cross-host-simulate Windows via `setPlatform('win32')` + mocked `existsSync` / `globSync`; smoke-testing on a real Windows host belongs in Phase 39 per the phase scope.
- **CI gate enforcement:** Any future PR that reintroduces `process.env.HOME` to `src/**/*.ts` will fail the `tests/no-process-env-home.test.ts` regression gate.

## Self-Check: PASSED

- `src/jdtls/client.ts` exists and contains `jdtlsCandidateDirs` import, `globSync` import, `LAUNCHER_GLOB` const, 3-variant `SkipReason` union, `composeFailureReason` helper. **FOUND**
- `tests/jdtls/client.test.ts` exists and contains `describe('findJdtLs on Windows')`, `describe('findJdtLs on Unix (UNIX-01 regression)')`, `vi.mock('glob', ...)` factory, JDTLS_HOME launcher-missing test, `'JDT LS not found. Tried:'` assertion. **FOUND**
- `tests/no-process-env-home.test.ts` exists, contains `walk('src')`, word-boundary regex `process\.env\.HOME\b`, `os.homedir()` message string. **FOUND**
- Commit `2496b51` exists in git log (Task 1 — feat). **FOUND**
- Commit `abdd4e0` exists in git log (Task 2 — test). **FOUND**
- Commit `c2609c0` exists in git log (Task 3 — test). **FOUND**
- `grep -rn 'process\.env\.HOME' src/ | wc -l` returns `0`. **VERIFIED**
- `pnpm test` exits 0 with 869 tests passed across 72 files. **VERIFIED**

---
*Phase: 38-jdt-ls-discovery-on-windows*
*Completed: 2026-05-24*
