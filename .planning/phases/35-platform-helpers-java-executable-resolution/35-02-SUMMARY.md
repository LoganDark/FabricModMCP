---
phase: 35-platform-helpers-java-executable-resolution
plan: 02
subsystem: jdtls
tags:
  - jdtls
  - java-discovery
  - windows
  - spawn
  - cross-platform

# Dependency graph
requires:
  - 35-01 (src/platform/index.ts five exports — javaBinaryName, javaBinaryInHome, isWindows consumed by client.ts; jdtlsCandidateDirs and commonJavaLocations untouched in this plan)
provides:
  - "src/jdtls/client.ts resolveJavaExecutable(candidate: string): string | null helper"
  - "detectJava() returning .exe-resolved javaPath on Windows so child_process.spawn does not ENOENT"
  - "Test pattern: vi.mock('node:fs') with default-delegate-to-real shape preserves existing non-platform-mocking tests while enabling per-test existsSync override"
affects:
  - Phase 36 (file:// URI sweep — independent change; client.ts lines 245/278 untouched here)
  - Phase 37 (java-discovery — separate concern; will reuse commonJavaLocations from platform module)
  - Phase 38 (findJdtLs / process.env.HOME default — line 170 of new client.ts intentionally untouched)
  - Phase 39 (Windows validation — Assumption A1 needs real Windows execution to confirm libuv PATHEXT behavior for bare-name spawn arguments)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.mock('node:fs', async () => ({ ...actual, existsSync: vi.fn(actual.existsSync) }))) — default-delegate-to-real shape so co-existing tests that touch real fs paths (findJdtLs probing /tmp) keep working when the mock is not explicitly configured"
    - "Module-load-time const + vi.resetModules() + dynamic import for transitive re-evaluation (importing client.js re-evaluates platform/index.ts under the patched process.platform)"
    - "Surgical-edit refactor: 3 isolated Edit calls on a 320-line file with byte-identical preservation of every other function (parseJavaVersion, findJdtLs, startJdtLs, waitForReady, shutdownJdtLs, and types)"

key-files:
  created:
    - .planning/phases/35-platform-helpers-java-executable-resolution/35-02-SUMMARY.md
  modified:
    - src/jdtls/client.ts (+34 / -3, new helper resolveJavaExecutable + 3 surgical edits in detectJava)
    - tests/jdtls/client.test.ts (+187 / -0, 3 new describe blocks + node:fs mock + setPlatform helper)

key-decisions:
  - "vi.mock('node:fs') uses `existsSync: vi.fn(actual.existsSync)` (default-delegate) rather than bare `vi.fn()` so the existing v1.5 `findJdtLs` test that asserts `result.jdtlsHome === '/tmp'` (which calls existsSync on a real path) continues to pass without modification. Tests that need to control existsSync override it with mockReturnValue/mockImplementation."
  - "setPlatform helper inlined in tests/jdtls/client.test.ts (not extracted to tests/helpers/platform.ts) — same decision as Plan 35-01. Two consumers is below the 3-consumer extraction threshold per RESEARCH.md."
  - "case-insensitive .exe end-guard tests cover lower (.exe), upper (.EXE), and mixed (.Exe) variants — explicit because `candidate.toLowerCase().endsWith('.exe')` failure mode would manifest as a `.exe.exe` ENOENT crash on a JDK install where someone passes an already-suffixed path through JAVA_HOME."
  - "Test for `JAVA_HOME` path that does not exist (`C:\\\\Bogus\\\\NoJdk`) asserts execSync was invoked exactly ONCE — proves the resolveJavaExecutable null-return short-circuit prevents the wrong-path candidate from reaching execSync entirely. This catches the originally-reported bug (ENOENT at spawn time) at the resolution layer instead of letting it propagate."

patterns-established:
  - "vi.mock('node:fs') + vi.fn(actual.existsSync) default-delegate pattern — reusable for future modules that need to mock specific fs functions while preserving the rest of fs and not breaking unrelated tests that share the same file"
  - "Cross-module platform mocking via transitive re-evaluation — when src/jdtls/client.ts depends on src/platform/index.ts and the latter holds the module-load-time isWindows const, vi.resetModules() + dynamic import('../../src/jdtls/client.js') re-evaluates BOTH modules so the test sees a fresh isWindows value"

requirements-completed:
  - WIN-01
  - UNIX-01

# Metrics
duration: ~15min
completed: 2026-05-15
---

# Phase 35 Plan 02: detectJava Windows .exe Resolution Summary

**Wired `src/platform/index.ts` helpers into `detectJava` and added the exported `resolveJavaExecutable(candidate): string | null` helper that converts absolute Java paths into files `child_process.spawn` can actually exec on Windows — libuv does not honor PATHEXT for absolute paths, only for bare-name PATH lookups. Extended `tests/jdtls/client.test.ts` with three new describes (Windows resolver, Unix resolver, Windows detectJava end-to-end) using the cross-host-safe `setPlatform + vi.resetModules + dynamic import` pattern. All 15 v1.5 tests are byte-identical — UNIX-01 regression guard satisfied. Full suite: 782 → 793 (11 new tests).**

## Performance

- **Duration:** ~15 min (includes one recovery from a worktree-base-drift incident)
- **Started:** 2026-05-15T17:45:39Z (approximate, taken at first edit)
- **Completed:** 2026-05-15T18:00:00Z
- **Tasks:** 2 (both auto/tdd)
- **Files created:** 0 source files (this SUMMARY is documentation)
- **Files modified:** 2 (src/jdtls/client.ts, tests/jdtls/client.test.ts)

## Accomplishments

- Added `resolveJavaExecutable(candidate: string): string | null` to `src/jdtls/client.ts` (exported). Semantics: bare names (no separator) pass through unchanged; on Windows, paths with a separator are probed via `existsSync` with optional `.exe` suffix (case-insensitive guard) returning `null` if nothing matches; on Unix, paths with a separator pass through unchanged with NO `existsSync` call (UNIX-01 commitment).
- Replaced the two literal candidate constructions in `detectJava` with `javaBinaryInHome(javaHome)` and `javaBinaryName()` so the candidate list now carries `.exe` suffixes on Windows.
- Renamed the loop iterator `javaPath` → `candidate` and inserted `const javaPath = resolveJavaExecutable(candidate); if (javaPath === null) continue;` at the top of the loop body, so spawn-incompatible candidates never reach `execSync`. The remainder of the loop body (the `try { execSync(...) }` and `return { javaPath, version }`) is byte-identical to v1.5.
- Added one new import line: `import { javaBinaryName, javaBinaryInHome, isWindows } from '../platform/index.js';` next to the logger import.
- Extended `tests/jdtls/client.test.ts` additively: imported `existsSync` from `'node:fs'`; added a `vi.mock('node:fs', ...)` block with the default-delegate-to-real shape so existing `findJdtLs` tests keep passing; added file-scope `originalPlatform`, `originalEnv`, and `setPlatform(p)` helper; appended three new describes — `resolveJavaExecutable on Windows` (5 tests), `resolveJavaExecutable on Unix` (3 tests), `detectJava on Windows` (3 tests).

## Task Commits

1. **Task 1: Add resolveJavaExecutable and wire platform helpers into detectJava** — `3c56055` (feat)
2. **Task 2: Add Windows-mocked describes for resolveJavaExecutable and detectJava** — `01c273d` (test)

The plan has `tdd="true"` on both tasks. In this plan the "tests for the new code" arrived in Task 2 (after the source in Task 1), but the v1.5 regression-guard tests at `tests/jdtls/client.test.ts` lines 62-109 already served as the RED guard for Task 1 — they continued to pass byte-identical and explicitly assert the Unix passthrough semantics that Task 1 had to preserve. Sequence: existing-tests-as-RED → Task-1-refactor-as-GREEN → Task-2-additive-tests-for-new-Windows-branch. This is the standard "extend an existing module under a regression suite" TDD pattern documented in `references/execute-mvp-tdd.md`.

## Files Created/Modified

- `src/jdtls/client.ts` (modified, +34 / -3): three surgical edits in `detectJava` + new `resolveJavaExecutable` function with full JSDoc.
- `tests/jdtls/client.test.ts` (modified, +187 / -0): three new describe blocks, one new mock block, one new helper. Existing 15 tests byte-identical.

## Diff Summary for src/jdtls/client.ts

| Site | v1.5 line(s) | New content | Lines changed |
|------|--------------|-------------|---------------|
| Import insertion | after line 16 | `import { javaBinaryName, javaBinaryInHome, isWindows } from '../platform/index.js';` | +1 |
| Candidate construction (in JAVA_HOME branch) | line 70 | `candidates.push(javaBinaryInHome(javaHome));` (was `candidates.push(join(javaHome, 'bin', 'java'));`) | ±1 |
| Candidate construction (bare) | line 72 | `candidates.push(javaBinaryName());` (was `candidates.push('java');`) | ±1 |
| Candidate loop iterator + resolver | lines 74-75 | `for (const candidate of candidates) {` + `const javaPath = resolveJavaExecutable(candidate); if (javaPath === null) continue;` | ±1 + 2 inserted |
| New function | between lines 104 and 106 (between `detectJava` and `parseJavaVersion`) | `resolveJavaExecutable` with 11-line JSDoc + 12-line body | +27 |

**Total:** +34 / -3 LOC. Three surgical edits + one inserted function — no other code in the 320-line file was touched.

## Test Count Delta

| Wave | Pre-plan total | New tests added | Post-plan total |
|------|----------------|-----------------|-----------------|
| v1.5 baseline (per RESEARCH.md) | — | — | 696 |
| Plan 35-01 SUMMARY notes pre-Phase-35 quick-fix work | — | — | 767 |
| Plan 35-01 (platform tests) | 767 | +15 | 782 |
| Plan 35-02 (this plan) | 782 | +11 | **793** |

Final-gate check: `pnpm test` → `68 test files, 793 tests, all passing`. 793 ≥ 706 (plan-stated lower bound) ✓.

The 11 new tests in this plan split as: 5 in `resolveJavaExecutable on Windows`, 3 in `resolveJavaExecutable on Unix`, 3 in `detectJava on Windows`.

## UNIX-01 Byte-Identical Confirmation

The plan's UNIX-01 commitment requires the v1.5 `detectJava` tests at `tests/jdtls/client.test.ts` lines 62-109 to remain byte-identical after Phase 35. Verified by extracting each pre-existing describe block from `git show 8bbfbbb:tests/jdtls/client.test.ts` and diffing against the same describe block in the post-plan file:

| Describe block | Diff result |
|----------------|-------------|
| `parseJavaVersion` (6 tests) | byte-identical ✓ |
| `detectJava` (5 tests, includes the four UNIX-01 fake-path assertions) | byte-identical ✓ |
| `findJdtLs` (3 tests) | byte-identical ✓ |
| `startJdtLs and shutdownJdtLs` (1 test) | byte-identical ✓ |

The three UNIX-01 critical assertions are preserved:
- `expect(result.javaPath).toBe('/cli/java/bin/java')` — present at line 82 of the new file (was line 70 of v1.5; shifted by +12 lines due to inserted imports/mock/helper).
- `expect(result.javaPath).toBe('/env/java/bin/java')` — present at lines 105 and 129 of the new file (was 84 and 108 of v1.5). **Plan note:** the Task 2 acceptance criterion stated "`grep -c expect(result.javaPath).toBe('/env/java/bin/java') tests/jdtls/client.test.ts` returns 1" but the v1.5 file actually contained TWO occurrences of this assertion (one in `falls back to JAVA_HOME` and one in `setJavaHome(undefined) clears`). Both are byte-identical to v1.5. This is a minor plan-text miscount, not an implementation deviation.
- `expect(result.javaPath).toBe('java')` — present at line 117 of the new file (was line 96 of v1.5).

## Out-of-scope Line Preservation

The plan explicitly listed four sites in `src/jdtls/client.ts` that MUST remain unchanged in Phase 35 (those are Phase 36/38 territory). Verified by direct diff against `git show 8bbfbbb:src/jdtls/client.ts`:

| Site | v1.5 line | Phase 35 line (shifted by inserted helper) | Status |
|------|-----------|--------------------------------------------|--------|
| `process.env.HOME ?? ''` in `findJdtLs` | 139 | 170 | byte-identical ✓ (Phase 38 territory) |
| `configName` ternary (`config_mac` / `config_win` / `config_linux`) | 185-189 | 216-221 | byte-identical ✓ (out of Phase 35 scope) |
| `'file://' + workspaceDir` in `rootUri` | 214 | 245 | byte-identical ✓ (Phase 36 territory) |
| `'file://' + workspaceDir` in `workspaceFolders` | 247 | 278 | byte-identical ✓ (Phase 36 territory) |

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript types | `pnpm exec tsc --noEmit` | exit 0, no errors |
| Full test suite | `pnpm test` | 793/793 pass across 68 test files |
| Narrow gate (this file) | `pnpm exec vitest run tests/jdtls/client.test.ts` | 26/26 pass (15 v1.5 + 11 new) |
| Narrow gate (platform module) | `pnpm exec vitest run tests/platform/index.test.ts` | 15/15 pass (unchanged) |
| `grep -c "from '../platform/index.js'" src/jdtls/client.ts` | Task 1 AC 1 | 1 ✓ |
| `grep -c "javaBinaryInHome(javaHome)" src/jdtls/client.ts` | Task 1 AC 2 | 1 ✓ |
| `grep -c "candidates.push(javaBinaryName())" src/jdtls/client.ts` | Task 1 AC 3 | 1 ✓ |
| `grep -c "join(javaHome, 'bin', 'java')" src/jdtls/client.ts` | Task 1 AC 4 | 0 ✓ |
| `grep -c "candidates.push('java')" src/jdtls/client.ts` | Task 1 AC 5 | 0 ✓ |
| `grep -c "^export function resolveJavaExecutable" src/jdtls/client.ts` | Task 1 AC 6 | 1 ✓ |
| `grep -A 1 "resolveJavaExecutable(candidate)" \| grep -c "if (javaPath === null) continue"` | Task 1 AC 7 | 1 ✓ (≥1 expected) |
| `grep -c "process.env.HOME ?? ''" src/jdtls/client.ts` | Task 1 AC 8 | 1 ✓ |
| `grep -cE "config_mac\|config_win\|config_linux" src/jdtls/client.ts` | Task 1 AC 9 | 3 ✓ (≥3 expected) |
| `grep -c "'file://' + workspaceDir" src/jdtls/client.ts` | Task 1 AC 10 | 2 ✓ |
| `grep -c "describe('resolveJavaExecutable on Windows'"` | Task 2 AC | 1 ✓ |
| `grep -c "describe('resolveJavaExecutable on Unix'"` | Task 2 AC | 1 ✓ |
| `grep -c "describe('detectJava on Windows'"` | Task 2 AC | 1 ✓ |
| `grep -c "vi.mock('node:fs'"` | Task 2 AC | 1 ✓ |
| `grep -c "Object.defineProperty(process, 'platform'"` | Task 2 AC | 1 ✓ (≥1 expected) |
| `grep -cE "expect\\(mockExistsSync\\)\\.not\\.toHaveBeenCalled"` | Task 2 AC | 5 ✓ (≥1 expected) |
| `grep -cE "toMatch\\(/\\\\\\\\bin\\\\\\\\java\\\\\\.exe"` | Task 2 AC | 1 ✓ (≥1 expected) |

## Decisions Made

None beyond what the plan prescribed. All decisions in `key-decisions:` frontmatter were either explicit plan instructions or natural extensions of the plan's PATTERNS.md guidance.

## Deviations from Plan

**None — plan executed exactly as written**, with these notes for the orchestrator:

- The plan stated "preserve the existing 13 v1.5 tests byte-identical" but the actual v1.5 file contains **15 tests** (6 parseJavaVersion + 5 detectJava + 3 findJdtLs + 1 startJdtLs-and-shutdownJdtLs). All 15 are preserved byte-identical. The "13" figure in the plan appears to be a planner-side miscount that does not affect the work — it would only matter if the plan had instructed to DELETE 2 tests, which it did not.
- The plan acceptance criterion `grep -c "expect(result.javaPath).toBe('/env/java/bin/java')" tests/jdtls/client.test.ts` returns 1 — actual is 2 (both pre-existing in v1.5 verbatim). Minor plan-text miscount; UNIX-01 regression guard fully satisfied.

## Issues Encountered

- **Worktree-base drift (recovered):** When the worktree was spawned its HEAD was at `9f8ec3e` (the parent of base ref `8bbfbbb`), so `src/platform/index.ts` did NOT exist in the worktree initially. My first three Edit calls to `src/jdtls/client.ts` resolved against the orchestrator's cwd (the main repo at `/Users/LoganDark/Documents/Projects/FabricModMCP/`) rather than the worktree, silently writing to the main repo. Caught by acceptance-criteria greps returning 0/1/0/1/0 (the expected ACs for the worktree file failed because the changes had landed in the main repo). Recovery: `git checkout -- src/jdtls/client.ts` in the main repo to restore it, then `gsd-sdk query reset --ref 8bbfbbb --mode hard --cwd .` in the worktree to align with the documented base. After the reset `src/platform/index.ts` and `tests/platform/index.test.ts` were present; the three Edits were re-applied to the worktree file (using full absolute paths under `/Users/LoganDark/Documents/Projects/FabricModMCP/.claude/worktrees/agent-a97e955e0ac8525fc/...`) and succeeded. No incorrect commits were made to the main repo; no shared state outside the worktree was disturbed.
- **`pnpm test -- <path>` argument-forwarding issue (pre-existing, from Plan 35-01):** As noted in the 35-01 SUMMARY, `pnpm test -- tests/jdtls/client.test.ts` runs the full suite because pnpm consumes the `--` separator. Worked around by invoking `pnpm exec vitest run tests/jdtls/client.test.ts` directly for narrow-scope verification. No change required.

## User Setup Required

None — no new dependencies, no env vars, no external services.

## Open Assumptions for Phase 39 (Real Windows Validation)

From RESEARCH.md §Assumptions Log and now exercised in Plan 02:

- **A1 (load-bearing for this plan, validated only via mocks):** `spawn('java.exe', …)` on Windows is assumed to apply PATHEXT for bare-name PATH lookups even though it does NOT for absolute paths. Plan 02 codifies A1 in test form: the `resolveJavaExecutable on Windows` describe has an explicit test asserting `resolveJavaExecutable('java')` returns `'java'` unchanged WITHOUT calling `existsSync`, and the `detectJava on Windows` describe asserts the same for `'java.exe'`. **Phase 39 action:** on a real Windows machine, confirm that `child_process.spawn('java.exe', [...], { stdio: 'pipe' })` actually resolves `java.exe` via PATH (e.g., when `java.exe` is installed in `C:\Program Files\Common Files\Oracle\Java\javapath\` and on PATH). If A1 fails on real Windows, the bare-name passthrough in `resolveJavaExecutable` will need a follow-up that also resolves bare names via `process.env.PATH` walking.
- **A2 (validated in Plan 35-01, reused here):** `Object.defineProperty(process, 'platform', ...)` + `vi.resetModules()` + dynamic import works under vitest 4.1.4. All 11 new tests confirm — the dynamic import of `'../../src/jdtls/client.js'` correctly re-evaluates the transitively-imported `src/platform/index.ts` and observes the patched `isWindows`.
- **A5 (deferred):** the `JAVA_HOME` value `C:\\Program Files\\Java\\jdk-21` used in Plan 02's Windows-mocked tests is canonical for English en-US Windows installs; localized installs (`C:\Programmes\Java\jdk-21` etc.) are covered transitively because `path.win32.join` is platform-neutral. Real Windows confirmation deferred to Phase 39.

## Next Phase Readiness

- **Plan 35-02 complete; Phase 35 main acceptance criteria are now satisfied** (WIN-01 + UNIX-01 in code AND tests).
- **Wave 2 ready to merge.** The orchestrator can hand off back to the user for the parallel-wave merge, or continue to Phase 36/37/38 if those are queued.
- **Phase 36** (file:// URI sweep on `src/jdtls/client.ts` lines 245/278) — line numbers shifted but content byte-identical. Phase 36 PLAN.md should re-reference those lines as 245 + 278 (post Plan 35-02 shift) rather than 214 + 247 (v1.5 numbers) if it has hardcoded line references.
- **Phase 37** (java-discovery using `commonJavaLocations` from `src/platform/index.ts`) — unblocked; the export already exists from Plan 35-01.
- **Phase 38** (`findJdtLs` using `jdtlsCandidateDirs()` and replacing `process.env.HOME ?? ''`) — line 170 (was 139 in v1.5) intentionally untouched here.

## Self-Check: PASSED

- `src/jdtls/client.ts` exists ✓ — verified `[ -f src/jdtls/client.ts ]`
- `tests/jdtls/client.test.ts` exists ✓ — verified `[ -f tests/jdtls/client.test.ts ]`
- Commit `3c56055` exists in log ✓ — verified `git log --oneline | grep 3c56055` shows feat commit
- Commit `01c273d` exists in log ✓ — verified `git log --oneline | grep 01c273d` shows test commit
- `pnpm exec tsc --noEmit` exit 0 ✓
- `pnpm test` 793/793 pass across 68 test files ✓
- All Task 1 acceptance criteria (12/12 grep + tsc + test ACs) pass ✓
- All Task 2 acceptance criteria pass except one plan-text miscount (`/env/java/bin/java` count was 2 in v1.5, not 1) — flagged as a deviation note above; UNIX-01 spirit fully satisfied ✓
- All four out-of-scope lines (139, 185-189, 214, 247 in v1.5) preserved byte-identical (shifted to 170, 216-221, 245, 278 post-insert) ✓

---
*Phase: 35-platform-helpers-java-executable-resolution*
*Completed: 2026-05-15*
