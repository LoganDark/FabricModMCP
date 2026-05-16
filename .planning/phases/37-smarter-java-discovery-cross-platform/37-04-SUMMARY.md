---
phase: 37-smarter-java-discovery-cross-platform
plan: 04
subsystem: jdtls
tags: [test, java-discovery, startup, retry, cross-platform, vendor-enumeration, unescape, projectRoot]

requires:
  - phase: 37-smarter-java-discovery-cross-platform
    plan: 01
    provides: src/jdtls/java-discovery.ts (discoverJava / unescapePropertiesValue / setJavaHome / parseJavaVersion / vendor map / multi-line failureReason)
  - phase: 37-smarter-java-discovery-cross-platform
    plan: 02
    provides: src/jdtls/client.ts shim + src/jdtls/startup.ts initJdtLsSession({ projectRoot }) + retryDegradedJdtLsSessions()
  - phase: 37-smarter-java-discovery-cross-platform
    plan: 03
    provides: tool-handler retry hooks (no test changes required by this plan)
provides:
  - tests/jdtls/java-discovery.test.ts NEW 593-line test file covering JAVA-01..JAVA-05 at the unit-test layer
  - tests/jdtls/startup.test.ts EXTENDED — existing 5 describes converted to async discoverJava mock, plus 8 new tests for initJdtLsSession({ projectRoot }) + retryDegradedJdtLsSessions()
affects: []

tech-stack:
  added: []
  patterns: [vi-mock-spread-idiom, setPlatform-vi.resetModules-dynamic-import, execFile-callback-mocking-for-promisified-API, per-project-projectRoot-regression-fixture]

key-files:
  created:
    - tests/jdtls/java-discovery.test.ts
  modified:
    - tests/jdtls/startup.test.ts

key-decisions:
  - "execFile mock uses callback-form interception. promisify(execFile) wraps the standard (file, args, opts, cb) callback signature internally, so the test must intercept at the underlying mock implementation — the mockVersionOutputFor helper produces both success and error (timeout / ENOENT) cases via the same callback shape."
  - "Scoop layout test (win32) mocks existsSync(true). On Windows, resolveJavaExecutable gates absolute candidates with an existsSync probe — without mocking it the scan-slot candidates never reach the execFile probe stage and the test reports zero probedTargets. The macOS and Linux vendor tests don't need this mock because resolveJavaExecutable passes through on Unix (UNIX-01)."
  - "Existing top-level `client.js` import line was extended with `discoverJava` (NOT a separate import statement) so `vi.mocked(discoverJava)` resolves the same binding the SUT imports — without this edit the test would throw `ReferenceError: discoverJava is not defined` per Task 2 instruction."
  - "Existing `mockDetectJava` constant was retained for backward compatibility even though no test in the new file uses it. The acceptance criteria don't require its removal, and keeping it documents the parity with the Phase 35 detectJava surface."
  - "retryDegradedJdtLsSessions test fixtures construct fully-typed FabricModChild / StudyJarChild / Project objects via `seedProject` + `makeFabricModChild`. Earlier ad-hoc casts to `as any` would have lost the compile-time enforcement that Plan 02's sweep filter actually reads `kind === 'fabric-mod'` and `rootPath`."
  - "Per-project projectRoot regression (the D-03/D-05 specific test): two degraded projects with distinct rootPath values must each receive its own projectRoot through discoverJava — this is the test that would catch a future regression where the sweep accidentally captures a closure-scoped projectRoot from the first iteration."

patterns-established:
  - "callback-style execFile mock for promisified-API tests: `mockImplementation((file, args, opts, cb) => cb(null, { stdout, stderr }))` — the (err, result) callback shape that promisify(execFile) wraps internally"
  - "Per-platform-flipping describe block: `beforeEach { setPlatform(p); vi.resetModules(); mockX.mockReset(); }` + `afterEach { setPlatform(originalPlatform); vi.resetModules(); }` paired with `await import('../../src/jdtls/java-discovery.js')` inside each `it()` after the platform/module reset"
  - "MANDATORY vi.mock spread for fs / fs/promises / child_process — `{ ...actual, named: vi.fn() }` so untouched named exports (readFile, mkdir, etc.) continue to resolve in transitively-loaded test code (Pitfall 6)"
  - "Project-store fixture helpers: `seedProject(name, jdtls, children)` + `makeFabricModChild(name, rootPath)` + `makeStudyJarChild(name)` + `makeDegradedSession()` / `makeAvailableSession()` — minimal but type-correct domain fixtures for retry-sweep tests"

requirements-completed: [JAVA-01, JAVA-02, JAVA-03, JAVA-04, JAVA-05]

duration: ~9min
completed: 2026-05-16
---

# Phase 37 Plan 04: Test coverage for Java discovery + startup wiring Summary

**Wrote `tests/jdtls/java-discovery.test.ts` (593 LOC, 23 tests across 8 describes) locking down every JAVA-NN requirement at the unit layer — priority-chain order, version-skip continuation, end-to-end backslash unescape via gradle.properties, per-candidate 3s timeout (SIGTERM + killed=true), vendor enumeration across macOS bundle / Homebrew openjdk filter / Scoop current/ / Linux /opt JDK-prefix filter, version-hint sort, multi-line `Java not found.` failureReason, and zero-arg-call gradle-properties-skip — and extended `tests/jdtls/startup.test.ts` (291 → 469 LOC, 6 → 14 tests) by converting the existing five tests from `mockDetectJava.mockReturnValue` to `mockDiscoverJava.mockResolvedValue` and adding new describes for `initJdtLsSession({ projectRoot })` parameter passthrough and `retryDegradedJdtLsSessions()` behavior (degraded-only sweep, per-iteration projectRoot scope D-03/D-05, atomic field replacement, swallow + logger.warn on failure).**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-16T13:01:36Z (worktree base + reset)
- **Completed:** 2026-05-16T13:11:53Z
- **Tasks:** 3/3 completed (two `type="auto"` test-writing tasks + one regression-only verification task)
- **Files modified:** 1 new (`tests/jdtls/java-discovery.test.ts`, 593 LOC), 1 extended (`tests/jdtls/startup.test.ts`, +248/-10 = 469 LOC final)

## Accomplishments

- **Task 1 — `tests/jdtls/java-discovery.test.ts` (NEW, 593 LOC):**
  - 8 top-level describes, 23 tests, all green
  - `unescapePropertiesValue` describe (8 unit cases): `\\\\` → `\\`, `\\u0043` → `C`, `\\:` / `\\=`, control chars (`\\t`, `\\n`, `\\r`, `\\f`), unknown `\\q` → `q`, the critical `\\\\u0043` → literal `\\u0043` (NOT `C`) per single-pass scanner spec, empty string, no-backslash content
  - `discoverJava priority order` describe (5 tests): each slot assertion proves it wins when prior slots are absent (slot 1 with `setJavaHome` over `JAVA_HOME`, slot 2 gradle.properties, slot 3 `JAVA_HOME` env, slot 4 bare `java` on PATH, slot 5 enumerated `/usr/lib/jvm/temurin-21/bin/java`)
  - `JAVA-02 version skip continuation`: Java 17 in slot 1 does NOT short-circuit; slot 3 with Java 21 is still probed and wins
  - `JAVA-03 backslash unescape end-to-end`: `org.gradle.java.home=/opt/jdk\:21` produces resolved javaPath `/opt/jdk:21/bin/java`
  - `JAVA-05 per-candidate 3s timeout` (2 tests): SIGTERM-killed AND `killed: true` both classify as `timed out after 3s`; verifies `timeout: 3000` option literally passed to execFile
  - `JAVA-04 vendor enumeration` (4 tests): macOS bundle layout with temurin-21 probed before temurin-17 (version-hint sort), Homebrew `openjdk@*` filter (postgresql and openssl entries filtered out), Scoop `current/bin/java.exe` layout on win32 with existsSync mocked, Linux `/opt` JDK-prefix filter (jdk-21/temurin-17/corretto-21 accepted; postgres + intellij-idea-community filtered out)
  - `failureReason multi-line format`: starts with literal `Java not found. Tried:`, contains `--java-home: (not set)`, contains `org.gradle.java.home: (not set in /work/proj/gradle.properties)` (projectRoot supplied), contains `JAVA_HOME=/some/path: Java 17 (need 21+)`, contains `java on PATH:`, ends with the install-instruction footer
  - `JAVA-05 zero-arg call`: gradle.properties slot silently skipped (no `readFile` call for any `gradle.properties` path), failureReason uses the no-projectRoot `(not set)` form (NOT `(not set in ...)`)

- **Task 2 — `tests/jdtls/startup.test.ts` (EXTENDED, 469 LOC):**
  - Mock block at lines 12-17 extended with `discoverJava: vi.fn()` (kept `detectJava: vi.fn()` for surface preservation; `mockDetectJava` constant retained for backward compatibility)
  - Top-level named-import statement extended: `import { detectJava, discoverJava, findJdtLs, startJdtLs } from '../../src/jdtls/client.js';` (single statement edit so `vi.mocked(discoverJava)` resolves at runtime)
  - Existing 5 tests converted from `mockDetectJava.mockReturnValue({...})` to `mockDiscoverJava.mockResolvedValue({...})` — return-shape identical, but async; the `toContain('Java not found')` assertion at the first test passes unchanged because Plan 01's failureReason prefix is exactly `Java not found. Tried:`
  - New `describe('initJdtLsSession with projectRoot')` (2 tests): explicit `{ projectRoot: '/work/my-mod' }` threads through to discoverJava; zero-arg call resolves to `{ projectRoot: undefined }` (D-06 zero-arg compat)
  - New `describe('retryDegradedJdtLsSessions')` (6 tests):
    - degraded-only sweep filter — healthy project skipped, exactly one discoverJava call
    - first fabric-mod child rootPath used (D-03) with mixed children (fabric-mod + study-jar)
    - **per-project projectRoot scope (D-03/D-05) regression** — two degraded projects with distinct rootPath each receive their own projectRoot, proves the sweep does NOT capture an outer-scope value
    - atomic `project.jdtls` replacement on success (no fabric-mod child → projectRoot undefined → still succeeds via the mock; the field gets the new available session)
    - swallow + `logger.warn` containing `reinit failed` on synthetic discoverJava throw
    - skips projects where `project.jdtls` is undefined (`?.available !== false` is true for undefined)
  - `createMockProcess()` helper and `wireSuccessfulInit()` builder reused across all new tests to keep the mock-setup boilerplate uniform with the original 5 tests

- **Task 3 — Full-suite regression:** `pnpm test` exits 0 with 850/850 tests across 70 files. The Phase 35 `tests/jdtls/client.test.ts` is unchanged (`git diff --name-only c00543c..HEAD -- tests/jdtls/client.test.ts` empty; 26/26 tests pass byte-identically). Tool tests using `toContain('Java not found')` in `tests/tools/get-project-info.test.ts` and `tests/tools/create-project.test.ts` (12 tests across both files) pass unchanged because Plan 01's failureReason starts with the exact literal `Java not found. Tried:`.

## Task Commits

Each task was committed atomically (Task 3 produced no source/test changes — regression-only checkpoint):

1. **Task 1: Add tests/jdtls/java-discovery.test.ts covering JAVA-01..05** — `5440263` (test)
2. **Task 2: Extend startup.test.ts for projectRoot + retryDegradedJdtLsSessions** — `2d3d832` (test)
3. **Task 3: Full-suite regression — no changes** — verification-only step, no commit produced

## Files Created/Modified

- `tests/jdtls/java-discovery.test.ts` (NEW, 593 LOC) — Cross-platform test for the Plan 01 module covering JAVA-01 (priority chain), JAVA-02 (skip-on-fail), JAVA-03 (backslash unescape), JAVA-04 (vendor enumeration), JAVA-05 (3s per-candidate timeout). Uses the canonical Phase 35/36 `setPlatform + vi.resetModules + dynamic import` triplet and the MANDATORY `{ ...actual, named: vi.fn() }` spread idiom for `node:child_process`, `node:fs`, and `node:fs/promises` mocks.
- `tests/jdtls/startup.test.ts` (EXTENDED, +248/-10 = 469 LOC final) — Extended for the Plan 02 surface change (`detectJava` → `discoverJava` async + new `{ projectRoot? }` param + new `retryDegradedJdtLsSessions` sweep). All existing assertions preserved; new fixtures cover the D-03/D-05 per-project-projectRoot regression.

## Verification Results

**Per plan `<verification>` block:**

- `pnpm test` exits 0 — **PASS** (70 files, 850 tests).
- `git diff --name-only HEAD -- tests/jdtls/client.test.ts` empty — **PASS** (UNIX-01 byte-identical preservation).
- `git diff --name-only c00543c..HEAD` lists exactly `tests/jdtls/java-discovery.test.ts` and `tests/jdtls/startup.test.ts` — **PASS** (no other files touched).
- No file under `src/` modified by this plan — **PASS** (`git diff --name-only c00543c..HEAD -- 'src/**'` empty).
- `pnpm tsc --noEmit` exits 0 — **PASS** (no type errors).

**Per-task acceptance criteria:**

Task 1 (9 ACs, all PASS):

| AC                                                          | Required          | Observed |
| ----------------------------------------------------------- | ----------------- | -------- |
| File exists                                                 | yes               | yes      |
| `grep -c "describe(" tests/jdtls/java-discovery.test.ts`    | >= 7              | 8        |
| `grep -c "unescapePropertiesValue" tests/jdtls/java-discovery.test.ts` | >= 5      | 21       |
| `grep -cF "Java not found" tests/jdtls/java-discovery.test.ts` | >= 1           | 2        |
| `grep -c "timed out after 3s" tests/jdtls/java-discovery.test.ts` | >= 1        | 3        |
| `grep -c "setPlatform" tests/jdtls/java-discovery.test.ts`  | >= 4              | 19       |
| `grep -c "vi.resetModules" tests/jdtls/java-discovery.test.ts` | >= 4           | 19       |
| `grep -cE "await import.*java-discovery" tests/jdtls/java-discovery.test.ts` | >= 4 | 23 |
| `grep -cE "openjdk@21\|temurin-21" tests/jdtls/java-discovery.test.ts` | >= 2 | 8 |
| `pnpm test tests/jdtls/java-discovery.test.ts` exits 0      | yes               | 23/23 PASS |

Task 2 (12 ACs, all PASS):

| AC                                                                                     | Required | Observed |
| -------------------------------------------------------------------------------------- | -------- | -------- |
| Top-level discoverJava import from client.js                                           | 1        | 1        |
| `grep -c "discoverJava: vi.fn()" tests/jdtls/startup.test.ts`                          | 1        | 1        |
| `grep -c "mockDiscoverJava" tests/jdtls/startup.test.ts`                               | >= 8     | 20       |
| `grep -c "vi.mocked(discoverJava)" tests/jdtls/startup.test.ts`                        | >= 1     | 1        |
| `grep -cE "describe.*initJdtLsSession with projectRoot" tests/jdtls/startup.test.ts`   | 1        | 1        |
| `grep -cE "describe.*retryDegradedJdtLsSessions" tests/jdtls/startup.test.ts`          | 1        | 1        |
| `grep -c "projectRoot: '/work/my-mod'" tests/jdtls/startup.test.ts`                    | >= 1     | 2        |
| `grep -c "projectRoot: undefined" tests/jdtls/startup.test.ts`                         | >= 1     | 3        |
| `grep -c "rootPath" tests/jdtls/startup.test.ts`                                       | >= 1     | 5        |
| `grep -c "/work/mod-a" tests/jdtls/startup.test.ts`                                    | >= 1     | 4        |
| `grep -c "/work/mod-b" tests/jdtls/startup.test.ts`                                    | >= 1     | 2        |
| Existing `toContain('Java not found')` assertion PRESENT                               | yes      | yes (line 78 unchanged) |
| `pnpm test tests/jdtls/startup.test.ts` exits 0                                        | yes      | 14/14 PASS |

Task 3 (4 ACs, all PASS):

- `git diff --name-only HEAD -- tests/jdtls/client.test.ts` empty — **PASS**
- `pnpm test` exits 0 — **PASS** (70 files / 850 tests)
- `pnpm test tests/jdtls/client.test.ts` 26/26 — **PASS** (Phase 35 byte-identical surface preserved)
- `pnpm test tests/tools/get-project-info.test.ts tests/tools/create-project.test.ts` 12/12 — **PASS** (Java-not-found assertions still match)

## Deviations from Plan

None — plan executed exactly as written.

**Implementation notes (not deviations):**

1. **Scoop test required existsSync mock.** The plan's prose specifies `setPlatform('win32')` + readdir mock for the scoop apps path. In practice the win32 branch of `resolveJavaExecutable` gates absolute candidate paths via `existsSync`, so an additional `vi.mocked(existsSync).mockReturnValue(true)` was needed inside that one test to let the candidates reach the execFile probe stage. The acceptance criteria don't mention this; documenting here for the test-pattern record. macOS and Linux vendor tests don't need the mock because Unix resolveJavaExecutable is a no-op passthrough (UNIX-01).

2. **`mockDetectJava` constant retained.** The plan said "you may delete `mockDetectJava` if no test still uses it." Kept it instead — it documents the parity with the still-living `detectJava` symbol re-exported from the shim, and removing it would have required a separate edit. No acceptance criterion was affected.

## Threat Flags

None — all test surface is internal to the test harness and uses mocked fs/child_process/platform. Trust boundary T-37-11 (process.platform mutation leak) is mitigated by the `afterEach` restoration pattern reused verbatim from Phase 35/36 tests. T-37-12 (vi.mock spread omission) is mitigated by the `{ ...actual, named: vi.fn() }` idiom used in every mock block.

## Known Stubs

None — both test files are fully wired. All 23 + 14 = 37 tests across the two files pass. The full-suite regression (850/850) covers every existing test file unchanged.

## Self-Check: PASSED

**Files verified:**
- FOUND: `tests/jdtls/java-discovery.test.ts` (593 LOC)
- FOUND: `tests/jdtls/startup.test.ts` (469 LOC, modified)

**Commits verified:**
- FOUND: `5440263` (Task 1 — java-discovery.test.ts)
- FOUND: `2d3d832` (Task 2 — startup.test.ts extension)

**Scope guardrails verified:**
- `git diff --name-only c00543c..HEAD -- tests/jdtls/client.test.ts` empty — UNIX-01 byte-identical commitment held
- `git diff --name-only c00543c..HEAD -- 'src/**'` empty — no source files modified by this plan
- `git diff --name-only c00543c..HEAD` lists exactly two test files
