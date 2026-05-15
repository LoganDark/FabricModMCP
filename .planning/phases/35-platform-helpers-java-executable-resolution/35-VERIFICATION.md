---
phase: 35-platform-helpers-java-executable-resolution
verified: 2026-05-15T10:57:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 35: Platform Helpers + Java Executable Resolution — Verification Report

**Phase Goal:** Establish `src/platform/index.ts` and make Windows able to spawn `java.exe` — WIN-01 (Windows spawn succeeds with absolute Java path resolution) and UNIX-01 (existing Unix `detectJava` behavior byte-identical to v1.5).

**Verified:** 2026-05-15
**Status:** PASS
**Re-verification:** No — initial verification.

---

## Goal Achievement — Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `src/platform/index.ts` exists with all five typed exports; no fs/child_process imports | PASS | `grep -c '^export '` → 5; `grep -E "from 'node:(fs\|child_process\|crypto\|stream)"` → 0; named exports verified verbatim: `isWindows`, `javaBinaryName`, `javaBinaryInHome`, `jdtlsCandidateDirs`, `commonJavaLocations` (lines 28, 35, 50, 70, 108) |
| 2 | `resolveJavaExecutable` exported from `src/jdtls/client.ts` with documented semantics (bare passthrough, Windows `.exe` probe, Unix passthrough) | PASS | Line 123 of `src/jdtls/client.ts`: `export function resolveJavaExecutable(candidate: string): string \| null`. Body (lines 124–135): bare-name early return (no separator check), Windows existsSync + `.exe` probe, Unix passthrough WITHOUT existsSync — matches `<interfaces>` contract exactly |
| 3 | `detectJava` candidate construction uses `javaBinaryInHome` / `javaBinaryName` | PASS | `src/jdtls/client.ts:71` `candidates.push(javaBinaryInHome(javaHome));`; `src/jdtls/client.ts:73` `candidates.push(javaBinaryName());`; v1.5 literals `join(javaHome, 'bin', 'java')` and `candidates.push('java')` no longer present (grep counts: 0 each) |
| 4 | UNIX-01 byte-identical regression guards intact: assertions for `/cli/java/bin/java`, `/env/java/bin/java`, and bare `'java'` still present and passing | PASS | `tests/jdtls/client.test.ts:91` `toBe('/cli/java/bin/java')`; lines 105 & 129 `toBe('/env/java/bin/java')` (×2 in v1.5 — both preserved); line 117 `toBe('java')`. All four are inside the original `describe('detectJava', ...)` block. Full suite green (793/793). |
| 5 | WIN-01 covered by `describe('detectJava on Windows', ...)` and `describe('resolveJavaExecutable on Windows', ...)` | PASS | `grep -c "describe('detectJava on Windows'"` → 1; `grep -c "describe('resolveJavaExecutable on Windows'"` → 1; `grep -c "describe('resolveJavaExecutable on Unix'"` → 1. All three new describes added to `tests/jdtls/client.test.ts` (11 new tests; full suite 782→793). |
| 6 | `src/jdtls/client.ts` out-of-scope sites preserved (v1.5 line 139, 185-189, 214, 247 equivalents) | PASS | `grep -c "process.env.HOME ?? ''"` → 1 (now line 170); `grep -cE "config_mac\|config_win\|config_linux"` → 3 (now lines 216-220, inline ternary preserved); `grep -c "'file://' + workspaceDir"` → 2 (now lines 245 and 278). All four sites byte-identical to v1.5; only intentional shifts due to inserted import + helper. |
| 7 | `pnpm exec tsc --noEmit` exit 0 | PASS | Command run; exit code 0; no diagnostics emitted. |
| 8 | `pnpm test` exit 0; total 793 (or higher) | PASS | `pnpm test` → "Test Files 68 passed (68); Tests 793 passed (793)" in 1.43s. Exactly 793 — matches SUMMARY's stated post-plan total (782 + 11 new = 793). No skipped, no failed, no xfail. |

**Score:** 8/8 truths verified.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/platform/index.ts` | 5 named typed exports, no fs/child_process imports, tab-indented, ≥60 LOC | PASS | 135 LOC; 5 exports; imports only `node:path` (win32, posix) and `node:os` (homedir); tab indentation confirmed |
| `tests/platform/index.test.ts` | 5 describes, ≥10 it tests, branch coverage for both platforms | PASS | 5 describes, 15 `it` tests; `Object.defineProperty(process, 'platform', ...)` helper present; `vi.resetModules()` + dynamic import pattern verified; UNIX-01 literal assertion + WIN-01 binary-name assertion grep-verified |
| `src/jdtls/client.ts` (modified) | New import + 2 candidate edits + loop iterator rename + new exported `resolveJavaExecutable` helper; everything else byte-identical to v1.5 | PASS | Import added line 17; candidates wired lines 71 & 73; loop iterator renamed to `candidate` at line 75; `resolveJavaExecutable` resolves at line 76, null-skip at line 77; new helper at lines 123-135. Out-of-scope lines 170, 216-220, 245, 278 byte-identical. |
| `tests/jdtls/client.test.ts` (modified) | Existing 15 v1.5 tests byte-identical; 3 new describes for Windows resolver, Unix resolver, Windows detectJava | PASS | All 4 UNIX-01 string assertions present (`grep`-verified); 3 new describes present; `vi.mock('node:fs', ...)` block added; `setPlatform` helper added; full file under vitest runs 26/26 green. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/jdtls/client.ts` | `src/platform/index.ts` | `import { javaBinaryName, javaBinaryInHome, isWindows } from '../platform/index.js'` (line 17) | WIRED | Import present + all three symbols used inside `detectJava` and `resolveJavaExecutable` (`javaBinaryInHome` at 71, `javaBinaryName` at 73, `isWindows` at 127) |
| `detectJava` candidate loop | `resolveJavaExecutable` (same file) | `const javaPath = resolveJavaExecutable(candidate); if (javaPath === null) continue;` (lines 76-77) | WIRED | Resolver invoked + null short-circuits before `execSync`, matching the contract |
| `tests/jdtls/client.test.ts` (existing v1.5 tests) | `detectJava` (Unix branch) | exact string equality on `/cli/java/bin/java`, `/env/java/bin/java`, `'java'` | WIRED | All four assertions still present byte-identical; test file runs green |
| `tests/jdtls/client.test.ts` (new Windows describes) | `resolveJavaExecutable` / `detectJava` (Windows branch via `setPlatform('win32')`) | `Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })` + `vi.resetModules()` + `await import('../../src/jdtls/client.js')` | WIRED | New describes execute under mocked Windows; transitive re-evaluation through `src/platform/index.ts` verified by tests passing (`isWindows` flips on dynamic re-import) |

---

## Data-Flow Trace (Level 4)

Not applicable — Phase 35 ships infrastructure helpers + a resolver with deterministic input → output. No dynamic data rendering, no UI, no API endpoint with downstream consumers. The "data" is platform branch decisions and path-string returns; all branches are exercised by tests with concrete asserted outputs.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly | `pnpm exec tsc --noEmit` | exit 0, no output | PASS |
| Full test suite green | `pnpm test` | "68 test files, 793 tests, all passing" (1.43s) | PASS |
| `resolveJavaExecutable` exported as function | already verified via tests calling `resolveJavaExecutable('java')`, `resolveJavaExecutable('/cli/java/bin/java')` etc. at `tests/jdtls/client.test.ts` lines 258, 268-269 | green | PASS |
| Test suite count ≥ 793 (plan-stated final) | suite output line `Tests  793 passed (793)` | exactly 793 | PASS |

Probe execution: SKIPPED. Phase 35 declares no `scripts/*/tests/probe-*.sh` files; the project uses vitest as its single validation harness and the PLAN's `<verify>` blocks invoke `pnpm exec tsc --noEmit` and `pnpm test` — both run and green above.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WIN-01 | 35-01, 35-02 | JDT LS spawns successfully on Windows when Java home is supplied — `java.exe` resolution works for absolute paths so `child_process.spawn` succeeds | SATISFIED (mocked) | `javaBinaryName()` returns `'java.exe'` under win32 (asserted in `tests/platform/index.test.ts`); `javaBinaryInHome(home)` returns backslash + `.exe` path (asserted in same file); `resolveJavaExecutable` probes existence and falls back to `.exe` suffix (asserted in `describe('resolveJavaExecutable on Windows', ...)`); `detectJava` Windows end-to-end with mocked platform/existsSync/execSync returns `javaPath` containing `\bin\java.exe`. **Open assumption A1** (libuv PATHEXT for bare-name `spawn`) requires real-Windows confirmation in Phase 39 — documented in 35-02-SUMMARY §Open Assumptions. |
| UNIX-01 | 35-01, 35-02 | Existing Unix `detectJava` / `findJdtLs` behavior is byte-identical for users who don't set `org.gradle.java.home` (no behavioral change on Linux/macOS) | SATISFIED | Four byte-identical assertions preserved in `tests/jdtls/client.test.ts` (lines 91, 105, 117, 129); Unix-branch resolver passes through fake paths without `existsSync` (asserted in `describe('resolveJavaExecutable on Unix', ...)` lines 258, 268-269); v1.5 literals `'/usr/lib/jvm/temurin-21/bin/java'` reproduced verbatim by `javaBinaryInHome`; full suite green (no regressions). |

No orphaned requirements — REQUIREMENTS.md traceability table maps WIN-01 and UNIX-01 to Phase 35; both addressed by plans 35-01 and 35-02.

---

## Anti-Patterns Found

Scanned files modified in this phase: `src/platform/index.ts`, `tests/platform/index.test.ts`, `src/jdtls/client.ts`, `tests/jdtls/client.test.ts`.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No `TBD`/`FIXME`/`XXX` markers in modified files. No unreferenced TODO/HACK/PLACEHOLDER. No `return null/{}/[]` stubs at user-visible boundaries. No empty handlers. No "coming soon" prose. No hardcoded-empty props in component call sites (no components touched). Tab indentation preserved per CLAUDE.md convention. |

The `return null` on line 132 of `src/jdtls/client.ts` is intentional contract — `resolveJavaExecutable` returns `null` to signal "skip this candidate" and is consumed at line 77 (`if (javaPath === null) continue;`). Not a stub.

---

## Out-of-Scope Line Preservation (UNIX-01 + scope discipline)

| Site | v1.5 line | Phase 35 line | Status |
|------|-----------|---------------|--------|
| `process.env.HOME ?? ''` in `findJdtLs` | 139 | 170 | byte-identical (Phase 38 territory) |
| `configName` ternary (`config_mac`/`config_win`/`config_linux`) | 185-189 | 216-220 | byte-identical (out of Phase 35 scope) |
| `'file://' + workspaceDir` in `rootUri` | 214 | 245 | byte-identical (Phase 36 territory) |
| `'file://' + workspaceDir` in `workspaceFolders` | 247 | 278 | byte-identical (Phase 36 territory) |

All four sites verified via grep counts (1, 3, 2 respectively — exact match to v1.5).

---

## Human Verification Required

None for Phase 35 as scoped. Phase 39 is the milestone-completion checkpoint that exercises Assumption A1 (libuv PATHEXT for bare-name `spawn`) on a real Windows host — that work is explicitly deferred to Phase 39 per ROADMAP.md and the open-assumption notes in both summaries. No human action is required for Phase 35 acceptance.

---

## Gaps Summary

No gaps. Phase 35 delivers exactly what its success criteria require:

1. `src/platform/index.ts` ships with five typed, pure-module exports — verified by grep + tsc + tests.
2. `resolveJavaExecutable` exists with documented semantics — bare passthrough, Windows existsSync + `.exe` probe with case-insensitive guard, Unix passthrough.
3. `detectJava` is wired through both helpers (`javaBinaryName` / `javaBinaryInHome`) and the resolver.
4. UNIX-01 regression guard intact — all four v1.5 fake-path assertions still pass byte-identical inside the original `describe('detectJava', ...)` block; the four out-of-scope lines (HOME default, configName ternary, two `file://` constructions) untouched.
5. WIN-01 forward coverage in place — three new Windows-mocked describes (11 new tests) cover resolver and end-to-end `detectJava`.
6. tsc + full vitest suite (793/793) both green.

**Open assumption (documented, not a gap):** A1 — libuv applies PATHEXT for bare-name `spawn` on Windows. Plan 35-02 codifies the assumption in test form (`resolveJavaExecutable('java')` passes through without existsSync); real-Windows confirmation is the Phase 39 deliverable per the milestone plan. This does not block Phase 35 acceptance.

---

## Overall Verdict

**PASS** — Phase 35 has achieved its stated goal. WIN-01 is satisfied at the unit-test layer (real-Windows confirmation deferred to Phase 39 per milestone plan), and UNIX-01 is satisfied by byte-identical preservation of v1.5 fake-path assertions plus a Unix-passthrough resolver that explicitly does not call `existsSync`. Out-of-scope lines (Phase 36 / 38 territory) are byte-identical to v1.5. TypeScript compiles cleanly; full vitest suite is 793/793.

Follow-up items (not gaps, informational):
- **Phase 39:** Validate Assumption A1 on a real Windows host (`spawn('java.exe', …)` PATHEXT behavior for bare names).
- **Phase 36 / 38:** Note that `src/jdtls/client.ts` line numbers have shifted (139→170, 185-189→216-220, 214→245, 247→278). Their plans should re-reference post-Phase-35 line numbers.

---

*Verified: 2026-05-15T10:57:00Z*
*Verifier: Claude (gsd-verifier)*
