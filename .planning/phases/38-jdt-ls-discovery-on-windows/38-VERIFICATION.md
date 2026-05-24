---
phase: 38-jdt-ls-discovery-on-windows
verified: 2026-05-24T16:23:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
---

# Phase 38: JDT LS Discovery on Windows — Verification Report

**Phase Goal:** Extend `findJdtLs` with Windows-friendly install locations and replace `process.env.HOME` with `os.homedir()` cross-platform.
**Verified:** 2026-05-24T16:23:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Windows-conventional install locations probed when `process.platform === 'win32'` (LOCALAPPDATA, ProgramFiles, USERPROFILE, mason) | VERIFIED | `src/jdtls/client.ts:136` iterates `jdtlsCandidateDirs()`; `src/platform/index.ts:70-87` returns the four Windows paths in fixed order; `tests/jdtls/client.test.ts:427-441` asserts the four cwds in order; full suite green (869/869) |
| 2 | `process.env.HOME` replaced by `os.homedir()` in `client.ts`; `grep -rn 'process.env.HOME' src/` returns no matches outside test fixtures | VERIFIED | `grep -rn 'process\.env\.HOME' src/` → exit 1 (no matches); the lone v1.5 site at old client.ts:63 is gone (consumed by `jdtlsCandidateDirs()` which calls `homedir()` internally) |
| 3 | `JDTLS_HOME` env var override continues to work on both platforms; improved "not found" error lists candidate paths actually probed | VERIFIED | `src/jdtls/client.ts:117-132` honors `JDTLS_HOME` first (fail-fast on missing-dir vs missing-launcher with distinct messages); `composeFailureReason` at lines 90-97 produces the multi-line message; tests at `tests/jdtls/client.test.ts:443-456` assert the multi-line format including each probed candidate path with its skip reason |
| 4 | `findJdtLs()` consumes `jdtlsCandidateDirs()` — no inline candidate enumeration in `client.ts` | VERIFIED | `client.ts:23` imports `jdtlsCandidateDirs`; `client.ts:136` `for (const dir of jdtlsCandidateDirs())`; `grep -c "'/usr/local/share/jdtls'" src/jdtls/client.ts` → 0; no `join(home, '.local'...)` or `join(home, 'jdtls')` remain |
| 5 | Each candidate (incl. JDTLS_HOME) accepted only when `existsSync(dir)` AND `globSync('plugins/org.eclipse.equinox.launcher_*.jar', { cwd, absolute: true }).length > 0`; empty-dir shadow case skipped | VERIFIED | `client.ts:119-130` (JDTLS_HOME branch with deep probe), `client.ts:136-148` (candidate loop with deep probe); shadow-case test `tests/jdtls/client.test.ts:413-425` verifies higher-priority dir without launcher is skipped and lower-priority valid dir wins |
| 6 | `JDTLS_HOME` set-but-invalid returns single-line error with NO fall-through (dir-missing OR launcher-missing branch) | VERIFIED | `client.ts:119-124` (dir-missing branch, returns immediately) and `client.ts:125-130` (launcher-missing branch, returns immediately); tests `tests/jdtls/client.test.ts:174-194` assert no `'Tried:'` in either error |
| 7 | Multi-line failure starts with `'JDT LS not found. Tried:'`, lists JDTLS_HOME and every candidate with skip reason, ends with install hint | VERIFIED | `composeFailureReason` at `client.ts:90-97` constructs `['JDT LS not found. Tried:', ...slotLines, 'Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.'].join('\n')`; test `tests/jdtls/client.test.ts:443-456` exact-asserts every line |
| 8 | Every per-candidate skip emits `logger.debug('JDT LS candidate skipped', { candidate, reason })` | VERIFIED | `client.ts:138, 143` both emit the logger.debug call; spy test `tests/jdtls/client.test.ts:458-479` asserts 4 calls on a fresh logger instance with the correct shape |
| 9 | Unix candidate ordering byte-identical to v1.5 (UNIX-01): `~/.local/share/jdtls` > `/usr/local/share/jdtls` > `~/jdtls` | VERIFIED | `src/platform/index.ts:82-86` returns the three paths in exact v1.5 order; `tests/jdtls/client.test.ts:511-524` asserts Linux ordering, `526-541` asserts Darwin ordering matches Linux |
| 10 | `JdtLsNotFound` envelope shape unchanged: `{ jdtlsHome: null; error: string }` — only content enriched | VERIFIED | `client.ts:31-34` defines `JdtLsNotFound = { jdtlsHome: null; error: string }` with no new fields; tsc clean |
| 11 | CI regression gate at `tests/no-process-env-home.test.ts` enforces zero `process.env.HOME` matches in `src/` | VERIFIED | File exists; uses `walk('src')` (scope strict); regex `/process\.env\.HOME\b/` with word boundary; vitest assertion-message override points at "Phase 38 D-08/D-09"; passes (`pnpm exec vitest run tests/no-process-env-home.test.ts` green) |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/jdtls/client.ts` | Refactored findJdtLs consuming jdtlsCandidateDirs(); SkipReason/SlotRecord types; composeFailureReason/formatSlotLine/formatReason helpers; deepened JDTLS_HOME validation | VERIFIED (exists, substantive, wired) | Contains `jdtlsCandidateDirs` import (line 23), `globSync` import (line 20), `LAUNCHER_GLOB` const (line 54), 3-variant SkipReason union (lines 63-66), all three helpers (lines 75-97), rewritten findJdtLs (lines 114-151); imported by `src/index.ts` and `src/jdtls/startup.ts`; tsc clean |
| `tests/jdtls/client.test.ts` | Extended with Windows / Unix / JDTLS_HOME branches / shadow case / multi-line composition / logger.debug spy describes | VERIFIED (exists, substantive, wired) | New describes: `findJdtLs on Windows` (lines 382-480, 5 it-cases), `findJdtLs on Unix (UNIX-01 regression)` (lines 482-542, 3 it-cases); JDTLS_HOME-launcher-missing test (lines 184-194); `vi.mock('glob')` factory at lines 26-34; updated existing JDTLS_HOME-valid test (lines 165-172) to mock globSync |
| `tests/no-process-env-home.test.ts` | CI regression gate: recursive walk of src/**/*.ts asserting no `process.env.HOME` match | VERIFIED (exists, substantive, wired) | 38 lines, uses tabs, walks `src/` only, word-boundary regex, vitest assertion-message override referencing D-08/D-09 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/jdtls/client.ts` | `src/platform/index.ts` | `import { jdtlsCandidateDirs } from '../platform/index.js'` | WIRED | `client.ts:23` imports; `client.ts:136` consumes |
| `src/jdtls/client.ts` | `glob` package | `import { glob, globSync } from 'glob'` | WIRED | `client.ts:20` imports both; `globSync` used at lines 125, 142 |
| `tests/jdtls/client.test.ts` | `glob` (globSync mock) | `vi.mock('glob', ...)` factory | WIRED | `tests/jdtls/client.test.ts:26-34` declares mock with default `globSync: vi.fn(() => [])` |
| `tests/no-process-env-home.test.ts` | `src/**/*.ts` | recursive readdir + readFile + regex | WIRED | walker at lines 13-23, test at lines 25-37 |

### Data-Flow Trace (Level 4)

Not applicable — Phase 38 is a pure refactor of a discovery function; no dynamic UI/data rendering. The "data" is the return value of `findJdtLs()`, which is verified by behavioral tests above.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full project typechecks | `pnpm exec tsc --noEmit` | exit 0, no diagnostics | PASS |
| Phase 38 vitest suites pass | `pnpm exec vitest run tests/jdtls/client.test.ts tests/no-process-env-home.test.ts` | 36/36 tests passed across 2 files | PASS |
| Full vitest suite passes (UNIX-03) | `pnpm test` | 869/869 tests passed across 72 files | PASS |
| Regression grep gate | `grep -rn 'process\.env\.HOME' src/` | exit 1, no matches | PASS |

### Probe Execution

No probes declared in PLAN or SUMMARY; not a migration/tooling phase. Step skipped.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WIN-02 | 38-01-PLAN.md (declared) | `findJdtLs()` discovers JDT LS on Windows in conventional locations and uses `os.homedir()` instead of `process.env.HOME` | SATISFIED | 4 Windows candidate paths probed in fixed order (Truth #1); `process.env.HOME` removed and gated by CI regression test (Truths #2, #11); JDTLS_HOME deep-probe and multi-line failure message (Truths #3, #5-7); REQUIREMENTS.md line 13 specifies LOCALAPPDATA/PROGRAMFILES/USERPROFILE/LOCALAPPDATA-mason — all four covered by `jdtlsCandidateDirs()` and tested |
| UNIX-01 (collateral) | not declared (cross-phase) | Existing Unix `findJdtLs` behavior byte-identical for users not setting JDTLS_HOME | SATISFIED | Unix candidate ordering preserved (Truth #9); the only Unix behavior change is the empty-dir shadow case being caught and skipped (improvement, not regression) |
| UNIX-03 (collateral) | not declared (Phase 39) | Full v1.5 + v1.6 suite green | SATISFIED | `pnpm test` exits 0 with 869 tests passed across 72 files |

No orphaned requirements: REQUIREMENTS.md line 64 maps WIN-02 to Phase 38, and that ID is claimed by `38-01-PLAN.md` frontmatter `requirements: [WIN-02]`.

### Anti-Patterns Found

Files modified by this phase: `src/jdtls/client.ts`, `tests/jdtls/client.test.ts`, `tests/no-process-env-home.test.ts`.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No `TBD`/`FIXME`/`XXX`/`HACK`/`PLACEHOLDER` markers found in any modified file | — | — |

REVIEW.md (gsd-code-reviewer) identified 3 warnings and 5 info items, none of which were classified as Critical/Blocker by the reviewer. Specifically:
- **WR-01** (JDTLS_HOME `globSync` may throw on `ENOTDIR`/EACCES) — defensive hardening opportunity, not a current functional gap. The current contract behavior (throw on unexpected fs error) matches v1.5's `existsSync`-only behavior in spirit (a process-level crash on egregious env-var misconfiguration). Surfaced as INFO not BLOCKER.
- **WR-02** (JDTLS_HOME tests use real `/tmp`, will break on Windows CI) — a Phase 39 CI-portability concern, not a Phase 38 goal failure. The current macOS dev host runs them green.
- **WR-03** (`LAUNCHER_GLOB` const unused at `startJdtLs:168`) — code-quality cleanup, no behavioral impact. The const JSDoc claims both consumers; in practice only `findJdtLs` uses it. Recommend addressing in a follow-up cleanup, not a Phase 38 blocker.

None of these prevent goal achievement. WIN-02 is satisfied as written. Items are documented in REVIEW.md for follow-up consideration.

### Human Verification Required

(none — all phase 38 success criteria are programmatically verifiable on the macOS dev host. Real-Windows-host end-to-end smoke testing of `findJdtLs()` against a live JDT LS install is explicitly deferred to **Phase 39** per ROADMAP and per the phase plan's "Next Phase Readiness" section. The Phase 38 tests cross-host-simulate Windows via `setPlatform('win32')` + mocked `existsSync`/`globSync`, which is the correct scope for this phase.)

### Gaps Summary

No gaps. All 11 must-have truths verified, all 3 artifacts present and wired, all 4 key links wired, all behavioral spot-checks pass (typecheck + 869-test suite + grep gate), and REQUIREMENTS.md WIN-02 is satisfied.

The phase delivered exactly what was promised:
1. Windows-conventional install locations are probed via Phase 35's `jdtlsCandidateDirs()` (4 paths in fixed priority order).
2. `process.env.HOME` is gone from `src/` and locked out by an automated CI gate.
3. `JDTLS_HOME` continues to override on both platforms with improved fail-fast diagnostics.
4. The multi-line failure message enumerates every probed candidate with its skip reason and a trailing install hint.
5. The empty-dir shadow case is now caught (improvement over v1.5's `existsSync`-only check).
6. UNIX-01 byte-identical commitment preserved; UNIX-03 full-suite gate green.

---

*Verified: 2026-05-24T16:23:00Z*
*Verifier: Claude (gsd-verifier)*
