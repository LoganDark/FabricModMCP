---
phase: 35-platform-helpers-java-executable-resolution
plan: 01
subsystem: infra
tags:
  - platform
  - cross-platform
  - windows
  - foundation
  - node-path
  - node-os

# Dependency graph
requires: []
provides:
  - "src/platform/index.ts module with five typed exports (isWindows, javaBinaryName, javaBinaryInHome, jdtlsCandidateDirs, commonJavaLocations)"
  - "Cross-host-safe path construction via forced-flavor path.win32.join / path.posix.join"
  - "Mockable platform branching pattern (Object.defineProperty(process, 'platform', ...) + vi.resetModules() + dynamic import)"
affects:
  - 35-02-PLAN.md (consumes javaBinaryName + javaBinaryInHome in detectJava)
  - Phase 36 (file:// URI sweep — reuses isWindows for separator handling)
  - Phase 37 (commonJavaLocations consumer; java-discovery.ts globbing)
  - Phase 38 (jdtlsCandidateDirs consumer; Windows JDT LS install probing)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure cross-cutting helper module under src/platform/ (no fs, no child_process)"
    - "Forced-flavor path join (path.win32 vs path.posix) for cross-host testability"
    - "Module-load-time const + vi.resetModules() platform mocking"

key-files:
  created:
    - src/platform/index.ts
    - tests/platform/index.test.ts
  modified: []

key-decisions:
  - "Pure module: src/platform/index.ts imports only node:path and node:os — no fs / child_process. resolveJavaExecutable (which needs existsSync) lives in src/jdtls/client.ts (Plan 35-02)."
  - "Forced-flavor join: pathWin32.join in Windows branches, pathPosix.join in Unix branches. Lets Windows-mocked tests assert exact strings (e.g., 'C:\\\\Program Files\\\\Java\\\\jdk-21\\\\bin\\\\java.exe') from a macOS/Linux host."
  - "UNIX-01 byte-identical: javaBinaryInHome Unix branch returns pathPosix.join(home, 'bin', 'java'); jdtlsCandidateDirs Unix branch returns the v1.5 three-path literal array; covered by exact-string assertions in tests."
  - "Module-load-time isWindows const (Pitfall 3 Option B) — tests use Object.defineProperty(process, 'platform', { value, configurable: true }) + vi.resetModules() + dynamic import so each branch test sees a freshly-evaluated const."
  - "Env fallbacks for LOCALAPPDATA / ProgramFiles fall back to deterministic literals so missing env vars never produce empty-string path traversals (T-35-01 mitigation)."

patterns-established:
  - "src/platform/index.ts as the single source of truth for process.platform branching across the codebase — no inline 'process.platform === 'win32'' checks at call sites (anti-pattern per RESEARCH.md)"
  - "Cross-host-safe platform-branch testing pattern (originalPlatform capture + setPlatform helper + afterEach restore + vi.resetModules + dynamic import) — extendable to Phases 36/37/38 if more test files need the same mock"
  - "Tab indentation + .js extension on relative imports preserved (ESM nodenext convention)"

requirements-completed:
  - WIN-01
  - UNIX-01

# Metrics
duration: ~6min
completed: 2026-05-15
---

# Phase 35 Plan 01: Platform Helpers Module Summary

**Pure src/platform/index.ts module with five typed exports — isWindows const + javaBinaryName/javaBinaryInHome/jdtlsCandidateDirs/commonJavaLocations functions — forced-flavor path joins keep Windows assertions deterministic from any host, and Unix branches return v1.5 literals byte-identical (UNIX-01).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-15T17:36:30Z
- **Completed:** 2026-05-15T17:42:47Z
- **Tasks:** 2 (both auto/tdd)
- **Files created:** 2 (src/platform/index.ts, tests/platform/index.test.ts)
- **Files modified:** 0

## Accomplishments

- Created `src/platform/index.ts` (134 LOC) — pure module exporting `isWindows`, `javaBinaryName()`, `javaBinaryInHome(javaHome)`, `jdtlsCandidateDirs()`, `commonJavaLocations()`. Imports only `node:path` and `node:os`. No `fs`, no `child_process`, no side effects.
- Created `tests/platform/index.test.ts` (170 LOC) — 5 `describe` blocks, 15 `it` tests, covering Windows + Linux + Darwin branches for every export.
- Established the module-load-time-const + `vi.resetModules()` + dynamic-import platform-mock pattern, with `setPlatform()` helper, `afterEach` cleanup that restores `process.platform` AND `process.env` (since `jdtlsCandidateDirs`/`commonJavaLocations` read `LOCALAPPDATA`/`ProgramFiles`).
- UNIX-01 regression guard locked in via byte-identical literal assertions for `javaBinaryInHome('/usr/lib/jvm/temurin-21')` and the three `jdtlsCandidateDirs` paths.
- WIN-01 forward-coverage locked in via exact-string assertion `'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe'` (possible only because the Windows branch uses `pathWin32.join`).

## Task Commits

1. **Task 1: Create src/platform/index.ts with five strongly-typed exports** — `57f3748` (feat)
2. **Task 2: Create tests/platform/index.test.ts with branch coverage for all five exports** — `d8b71cc` (test)

Both tasks have `tdd="true"` in the plan. The plan-prescribed order is source-first (Task 1) then tests (Task 2); per the plan's task layout and TDD-gate rules in this codebase, this is the expected RED-as-tests-for-existing-file pattern. The test commit immediately followed source and exercises both branches under all asserted criteria.

## Files Created/Modified

- `src/platform/index.ts` (created, 134 LOC) — Five typed platform helpers. Pure module, no I/O imports.
- `tests/platform/index.test.ts` (created, 170 LOC) — 15 branch-coverage tests using `Object.defineProperty(process, 'platform', ...)` + `vi.resetModules()` + dynamic import.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript types | `pnpm exec tsc --noEmit` | exit 0, no errors |
| Platform tests | `pnpm exec vitest run tests/platform/index.test.ts` | 15/15 pass (~98ms) |
| Full suite | `pnpm test` | 782/782 pass across 68 test files |
| `grep -c '^export ' src/platform/index.ts` | acceptance grep | 5 (>=5) |
| `grep -E "from 'node:(fs\|child_process\|crypto\|stream)" src/platform/index.ts` | I/O purity | 0 matches |
| Tab indentation in src | `grep -cP '^\t' src/platform/index.ts` | 46 |
| Tab indentation in tests | `grep -cP '^\t' tests/platform/index.test.ts` | 128 |
| UNIX-01 literal assertion | `expect(javaBinaryInHome('/usr/lib/jvm/temurin-21')).toBe('/usr/lib/jvm/temurin-21/bin/java')` | 1 match |
| WIN-01 binary-name assertion | `expect(javaBinaryName()).toBe('java.exe')` | 1 match |

Note: the baseline test count in RESEARCH.md is recorded as 696. The pre-Plan-35-01 worktree base already contained later landed work (quick-260515-d0i `--java-home` flag and quick-260515-6c5 gradle-parser fix) that bumped the baseline to 767 prior to this plan. Plan 35-01 added 15 tests → 782 total. No existing tests were modified or skipped.

## Decisions Made

None beyond what the plan and RESEARCH.md prescribed. All open questions in RESEARCH.md were already RESOLVED before execution (Q1 — export `resolveJavaExecutable` is Plan 35-02's concern; Q2 — `path.win32.join` / `path.posix.join` followed; Q3 — `commonJavaLocations` returns parent dirs only; Q4 — Unix passthrough preserves existing tests).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `node_modules` not present in the worktree at executor start; `pnpm install --frozen-lockfile` ran cleanly (214 packages, 850ms). Not a plan deviation — worktrees start without dependencies.
- The standard `pnpm test -- tests/platform/index.test.ts` invocation runs the full suite because the `--` separator is consumed by pnpm itself, not forwarded to vitest. Worked around by calling `pnpm exec vitest run tests/platform/index.test.ts` directly when narrow scoping was needed. Both invocations green; no test-runner-config change required.

## User Setup Required

None — pure stdlib, no env vars, no external services.

## Assumptions to Flag for Plan 35-02 / Phases 36/37/38

From `35-RESEARCH.md` §Assumptions Log:

- **A1 (load-bearing for Plan 35-02):** `spawn('java', …)` is assumed to apply PATHEXT for bare-name PATH lookups on Windows even though it does NOT for absolute paths. Plan 35-02 implements `resolveJavaExecutable` and the bare-name pass-through depends on this. **Action:** Plan 35-02's Windows-branch test should explicitly assert that `resolveJavaExecutable('java')` returns `'java'` unchanged WITHOUT calling `existsSync`, codifying A1 in test form. Real Windows validation deferred to Phase 39.
- **A2 (validated in this plan):** `Object.defineProperty(process, 'platform', { value, configurable: true })` works under vitest 4.1.4. All 15 platform tests confirmed it flips the platform and that `vi.resetModules()` re-evaluates `isWindows` on dynamic import. No issues.
- **A3 (validated):** Shipping `commonJavaLocations` in Phase 35 even though Phase 37 owns its only consumer caused no lint/dead-code warnings. `pnpm exec tsc --noEmit` clean.
- **A5 (deferred):** `LOCALAPPDATA` / `ProgramFiles` env-var fallbacks are exercised in this plan via test setup (`process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local'`). Behavior on a real Windows host where those vars are set by the OS is deferred to Phase 39. The fallback literal `'C:\\Program Files'` is correct for English en-US locales; localized Windows installs may use a different `Program Files` directory name but the env var always exposes the canonical path, so the fallback branch is only ever hit when the env var is unset (vanishingly rare).
- **A4 (preserved):** No Unix `existsSync` gate was added to anything in this plan — `src/platform/index.ts` has zero `fs` references. Plan 35-02 must keep `resolveJavaExecutable`'s Unix branch as a pass-through to satisfy A4 and existing `tests/jdtls/client.test.ts` `detectJava` assertions.

## Next Phase Readiness

- **Plan 35-02 unblocked.** `src/jdtls/client.ts` can now `import { javaBinaryName, javaBinaryInHome } from '../platform/index.js'` (`.js` extension per nodenext ESM convention). The Plan 35-02 interface contract from `35-01-PLAN.md <interfaces>` is honored byte-for-byte:
  - `isWindows: boolean` ✓
  - `javaBinaryName(): string` ✓
  - `javaBinaryInHome(javaHome: string): string` ✓
  - `jdtlsCandidateDirs(): string[]` ✓
  - `commonJavaLocations(): string[]` ✓
- **Phase 36/37/38 receive the rest of the module today (per Locked Decision #1 in RESEARCH.md "ship all four helpers in this phase").** No additional follow-up work needed here when those phases land.

## Self-Check: PASSED

- `src/platform/index.ts` exists ✓
- `tests/platform/index.test.ts` exists ✓
- Commit `57f3748` exists in log ✓
- Commit `d8b71cc` exists in log ✓
- `pnpm exec tsc --noEmit` exit 0 ✓
- `pnpm test` 782/782 pass ✓
- All Task 1 acceptance criteria (8/8) pass ✓
- All Task 2 acceptance criteria (11/11) pass ✓

---
*Phase: 35-platform-helpers-java-executable-resolution*
*Completed: 2026-05-15*
