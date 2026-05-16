---
phase: 37-smarter-java-discovery-cross-platform
verified: 2026-05-16T07:21:00Z
status: human_needed
score: 15/15 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 11/11
  gaps_closed:
    - "retryDegradedJdtLsSessions does not re-sync fabric-mod sources after rescue (CR-01)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Add a fabric mod to a project whose default JDT LS session was created with available=false (start with no Java on PATH, install Java 21+, then call add_fabric_mod). After the call succeeds, attempt a find_definition against any class in the newly-added mod's sources."
    expected: "Real navigation results returned by find_definition without requiring a second refresh_project call."
    why_human: "Requires a real JDT LS installation, a real Java 21+ install, and a real Minecraft mod project. The unit tests assert syncFabricModToWorkspace is called with the correct arguments post-rescue, but end-to-end semantic navigation cannot be verified without live JDT LS + workspace indexing."
---

# Phase 37: Smarter Java Discovery (cross-platform) Verification Report

**Phase Goal:** "Smarter Java Discovery (cross-platform) — New src/jdtls/java-discovery.ts with priority chain --java-home → org.gradle.java.home → JAVA_HOME → PATH → common install locations; async sequential probes with 3s per-candidate timeout; .properties backslash unescape at the consumption site. CR-01 gap closure: retryDegradedJdtLsSessions must re-sync every fabric-mod child after a successful rescue."

**Verified:** 2026-05-16T07:21:00Z
**Status:** human_needed
**Re-verification:** Yes — after CR-01 gap closure (Plan 37-05)

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|---------|
| 1  | `discoverJava({ projectRoot? })` evaluates 5 slots in the locked order --java-home → org.gradle.java.home → JAVA_HOME → PATH → scan and returns the first Java 21+ hit | VERIFIED | `src/jdtls/java-discovery.ts:361-445` — sequential blocks for each slot with short-circuit on `kind === 'success'`; slot labels appear in canonical order at lines 380, 393, 407, 421, 429 |
| 2  | A candidate that returns Java <21 does NOT abort discovery; chain continues to next candidate | VERIFIED | `probeCandidate` returns `{ kind: 'version-too-old', version }` (not error); `discoverJava` only short-circuits on `kind === 'success'`. Test `JAVA-02 version skip continuation` passes |
| 3  | Per-candidate probes use `execFile` with 3000ms timeout; SIGTERM/SIGKILL/killed classified as `timed out after 3s` | VERIFIED | `java-discovery.ts:292-295` `execFileAsync(..., { timeout: 3_000, encoding: 'utf-8' })`; lines 302-304 classify signal/killed as `'timed-out'`; `formatReason` emits `'timed out after 3s'` |
| 4  | `org.gradle.java.home` values pass through `unescapePropertiesValue` (decodes `\\`, `\:`, `\=`, `\t`, `\n`, `\r`, `\f`, `\uXXXX`; unknown `\X` drops backslash) | VERIFIED | `unescapePropertiesValue` at `java-discovery.ts:162-209` is a single-pass scanner; `readProjectGradleJavaHome` calls `unescapePropertiesValue(raw)`. Test file has 8+ unit tests |
| 5  | When `projectRoot` is undefined the `org.gradle.java.home` slot is silently skipped (no I/O); slot label still appears in failureReason as `(not set)` | VERIFIED | `readProjectGradleJavaHome` returns undefined immediately when `projectRoot === undefined`; `formatSlotLine` emits `'org.gradle.java.home: (not set)'` for the no-projectRoot branch |
| 6  | When every candidate fails, returned `error` starts with literal `Java not found.` and contains one human-readable line per slot | VERIFIED | `java-discovery.ts:439` `const lines: string[] = ['Java not found. Tried:'];` and loop appends one indented line per outcome; closing message at 443 |
| 7  | Module state `configuredJavaHome` set by `setJavaHome(s)` is read by BOTH `detectJava()` and `discoverJava()` | VERIFIED | `java-discovery.ts:45` declares `let configuredJavaHome`; `setJavaHome` writes it (line 52); `detectJava` reads at line 66; `discoverJava` reads at line 381 |
| 8  | `detectJava()` retains v1.5 byte-identical behavior: `execSync` + 10s timeout, 2-slot chain | VERIFIED | `java-discovery.ts:63-104` — same `execSync` shape as Phase 35; `tests/jdtls/client.test.ts` passes UNCHANGED through the shim (re-export at `client.ts:43`) |
| 9  | `client.ts` collapses to a re-export shim for discovery symbols + JDT LS process machinery only | VERIFIED | `src/jdtls/client.ts:43` `export { setJavaHome, detectJava, discoverJava, parseJavaVersion, resolveJavaExecutable } from './java-discovery.js';`. No local function definitions remain |
| 10 | `initJdtLsSession({ projectRoot? })` exists with default `{}`; zero-arg callsite at `src/index.ts:21` still works; `await discoverJava` replaces `detectJava()` | VERIFIED | `src/jdtls/startup.ts:43-44` — signature and `const java = await discoverJava({ projectRoot: opts.projectRoot });` |
| 11 | `retryDegradedJdtLsSessions()` exists, sweeps degraded projects with per-iteration projectRoot derivation; all 3 tool handlers invoke it | VERIFIED | `startup.ts:125-189` — `projectRoot` declared inside loop body at line 132; tool imports confirmed 2 occurrences each |
| 12 | After `retryDegradedJdtLsSessions` rescues a project (newSession.available === true), every fabric-mod child is re-synced via `syncFabricModToWorkspace(child, newSession, jarReader)` | VERIFIED | `src/jdtls/startup.ts:167-181` — `for (const child of project.children.values())` with `if (child.kind !== 'fabric-mod') continue;` inside the `if (newSession.available === true)` block; `await syncFabricModToWorkspace(child, newSession, jarReader)` at line 170 |
| 13 | Re-sync is gated on `newSession.available === true`; degraded reinits skip the sync loop | VERIFIED | Sync loop at lines 167-181 is inside `if (newSession.available === true) {` — not reachable when reinit stays degraded. Test "does NOT call syncFabricModToWorkspace when reinit stays degraded" passes |
| 14 | Per-child sync errors are swallowed via `logger.warn` and do NOT abort the sweep (D-04 contract preserved) | VERIFIED | Lines 174-179: per-child `catch (err)` calls `logger.warn('Workspace re-sync failed after JDT LS rescue', ...)` and continues. Test "swallows a per-child sync throw via logger.warn and continues to the next child" passes |
| 15 | The `jarReader` argument is the module singleton from `../tools/shared-jar-reader.js` | VERIFIED | `startup.ts:25` `import { jarReader } from '../tools/shared-jar-reader.js';`; forwarded at line 170 to `syncFabricModToWorkspace(child, newSession, jarReader)` |

**Score:** 15/15 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/jdtls/java-discovery.ts` | discoverJava / detectJava / setJavaHome / parseJavaVersion / resolveJavaExecutable / unescapePropertiesValue | VERIFIED | 487 lines; 9 exports including all required functions and 3 types |
| `src/jdtls/client.ts` | Re-export shim for discovery symbols, retains findJdtLs / startJdtLs / shutdownJdtLs | VERIFIED | Local definitions removed; re-export at line 43; JDT LS process machinery preserved |
| `src/jdtls/startup.ts` | initJdtLsSession({ projectRoot? }) + retryDegradedJdtLsSessions with post-rescue sync loop | VERIFIED | Both exports present; per-iteration projectRoot derivation per D-03/D-05; syncFabricModToWorkspace wired inside rescue-success gate (lines 167-181) |
| `src/tools/add-fabric-mod.ts` | Imports + invokes retryDegradedJdtLsSessions | VERIFIED | Import at line 11, call at line 80 |
| `src/tools/refresh-project.ts` | Imports + invokes retryDegradedJdtLsSessions | VERIFIED | Import at line 13, call at line 113 |
| `src/tools/refresh-project-members.ts` | Imports + invokes retryDegradedJdtLsSessions | VERIFIED | 2 occurrences (import + call) |
| `tests/jdtls/java-discovery.test.ts` | New test file covering JAVA-01..05 | VERIFIED | 593 lines, 8 describes, covers all 5 JAVA-NN requirements |
| `tests/jdtls/startup.test.ts` | Extended for projectRoot + retryDegradedJdtLsSessions + CR-01 post-rescue sync | VERIFIED | 18 tests total; 10 under retryDegradedJdtLsSessions (6 prior + 4 new CR-01 cases); `vi.mock` for workspace-sync.js and shared-jar-reader.js added at top |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/jdtls/java-discovery.ts` | `src/platform/index.ts` | named import of `javaBinaryName, javaBinaryInHome, commonJavaLocations, isWindows` | WIRED — line 28 |
| `src/jdtls/java-discovery.ts` | `src/project/gradle-parser.ts` | `parseGradleProperties` | WIRED — line 29, used at line 345 |
| `src/jdtls/client.ts` | `src/jdtls/java-discovery.ts` | named re-export | WIRED — line 43 |
| `src/jdtls/startup.ts` | `src/jdtls/java-discovery.ts` (through shim) | `discoverJava` import via `./client.js` | WIRED — line 19 |
| `src/jdtls/startup.ts` | `src/state/project-store.ts` | `projectStore.list()` for degraded sweep | WIRED — import line 24, call line 126 |
| `src/jdtls/startup.ts` | `src/jdtls/workspace-sync.ts` | `syncFabricModToWorkspace` post-rescue sync | WIRED — import line 21, call line 170 |
| `src/jdtls/startup.ts` | `src/tools/shared-jar-reader.ts` | `jarReader` singleton forwarded to syncFabricModToWorkspace | WIRED — import line 25, forwarded at line 170 |
| All 3 tool handlers | `src/jdtls/startup.ts` | `retryDegradedJdtLsSessions` import | WIRED — 2 occurrences each (import + call) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/jdtls/startup.ts:retryDegradedJdtLsSessions` | `newSession` (from `initJdtLsSession`) | Real JDT LS startup (mocked in tests) | Yes — `project.jdtls = newSession` atomic replacement | FLOWING |
| `src/jdtls/startup.ts:retryDegradedJdtLsSessions` | `child` (from `project.children.values()`) | `projectStore` populated by tool handlers | Yes — reads real fabric-mod child rootPath | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript type-check | `pnpm tsc --noEmit` | exit 0, no output | PASS |
| Phase 37 CR-01 unit tests (new 4 cases) | `pnpm test tests/jdtls/startup.test.ts --reporter=verbose` | 18/18 pass — all 4 new CR-01 cases green: "re-syncs every fabric-mod child after a successful rescue (CR-01)", "does NOT call syncFabricModToWorkspace when reinit stays degraded", "swallows a per-child sync throw via logger.warn and continues to the next child (D-04)", "surfaces syncFabricModToWorkspace warnings via logger.warn" | PASS |
| Full test suite | `pnpm test` | 70 files, 854 tests passed | PASS |
| client.test.ts unmodified (UNIX-01 commitment) | `git diff --name-only HEAD -- tests/jdtls/client.test.ts` | empty | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| JAVA-01 | 37-01, 37-02, 37-03, 37-04, 37-05 | Priority chain --java-home → org.gradle.java.home → JAVA_HOME → PATH → scanned common locations; post-rescue workspace re-sync | SATISFIED | `discoverJava` slot order in `java-discovery.ts:378-436`; post-rescue sync loop in `startup.ts:157-183`; tests cover all 5 slot winners + all 4 CR-01 behaviors |
| JAVA-02 | 37-01, 37-04 | Java <21 candidates skipped, not fatal | SATISFIED | `probeCandidate` returns `version-too-old` (not error); chain continues. Test `JAVA-02 version skip continuation` |
| JAVA-03 | 37-01, 37-04 | `org.gradle.java.home` backslash escapes decoded | SATISFIED | `unescapePropertiesValue` single-pass scanner (lines 162-209); called from `readProjectGradleJavaHome`. Test `JAVA-03 backslash unescape end-to-end` |
| JAVA-04 | 37-01, 37-04 | Vendor enumeration of common JDK install locations | SATISFIED | `enumerateParent` line 317; vendor layout map; `acceptEntry` filters; tests cover macOS bundle, Homebrew, Scoop, /opt prefix filter |
| JAVA-05 | 37-01, 37-04 | Per-candidate 3s timeout | SATISFIED | `execFileAsync(..., { timeout: 3_000, ... })`; SIGTERM/SIGKILL/killed → `'timed-out'`; formatted as `'timed out after 3s'`. Test `JAVA-05 per-candidate 3s timeout` |

Requirements UNIX-01 (Phase 35), UNIX-02 (Phase 36), UNIX-03 (Phase 39) are not Phase 37 requirements — no orphaned requirements.

All five JAVA-NN requirements are accounted for in plan frontmatter and implemented in the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/jdtls/java-discovery.ts` | 76-80 | `execSync("\"${javaPath}\" --version", ...)` shell-interpolated path | INFO | Pre-existing v1.5 behavior preserved under UNIX-01 byte-identical commitment; flagged WR-01, not introduced by this phase |
| `src/jdtls/java-discovery.ts` | 138-149 | `parseJavaVersion` regex unanchored | WARNING | Could misread `JAVA_TOOL_OPTIONS` preamble. WR-02. Pre-existing logic moved verbatim from Phase 35 |
| `src/jdtls/java-discovery.ts` | 253-259 | `acceptEntry` /opt filter incomplete vendor matrix | WARNING | Silently rejects `liberica-*`, `sapmachine-*`, etc. WR-03 |
| `src/jdtls/java-discovery.ts` | 317-323 | `enumerateParent` silently ignores EACCES | INFO | WR-04 |
| `src/jdtls/startup.ts` | 125-189 | `retryDegradedJdtLsSessions` has no concurrency guard | WARNING | Parallel tool invocations can race. WR-05 |
| `src/jdtls/java-discovery.ts` | 470-473 | `formatSlotLine` `'java on PATH'` `not-set` branch dead code | INFO | IN-01 |

None of these patterns block JAVA-01..05 achievement. All are pre-existing or scope-adjacent concerns flagged by code review for follow-up.

### Human Verification Required

#### 1. End-to-End Workspace Re-Sync After JDT LS Rescue (CR-01)

**Test:** Start the MCP server with no Java on PATH and no JAVA_HOME set so the default project initializes with `available: false`. Install Java 21+. Then call `add_fabric_mod` against the project. After the call succeeds (`jdtlsAvailable: true` in the response), call `find_definition` against any class in the newly-added mod's sources.

**Expected:** Real navigation results (definition jumps to the correct file). The new code in `retryDegradedJdtLsSessions` (startup.ts:167-181) iterates fabric-mod children and calls `syncFabricModToWorkspace(child, newSession, jarReader)` for each, so the rescued session's `.classpath` is populated before the function returns. No second `refresh_project` call should be required.

**Why human:** Requires a real JDT LS installation, a real Java 21+ runtime, and a real Minecraft mod project with source jars present in the Gradle cache. Unit tests (Test 1 in Task 2) assert that `syncFabricModToWorkspace` is called exactly twice (once per fabric-mod child, never for study-jar children) with the correct `newSession` and `jarReader` references — but cannot verify that JDT LS actually indexes the workspace and returns non-empty hover/definition results.

### Verifier Assessment

**CR-01 gap is closed.** `retryDegradedJdtLsSessions` now wires `syncFabricModToWorkspace` into the post-rescue path. The implementation in `src/jdtls/startup.ts:157-183` is correct:

- `syncFabricModToWorkspace` is imported from `./workspace-sync.js` (line 21) and `jarReader` from `../tools/shared-jar-reader.js` (line 25).
- The sync loop is inside `if (newSession.available === true)` — degraded reinits skip it.
- Each child call is wrapped in its own try/catch — a sync error in one child does not abort the sweep.
- `result.warning` is logged via `logger.warn`.
- `logger.info('JDT LS reinit succeeded ...')` fires after the loop, reflecting the fully-rescued state.

All four new `it()` cases in `tests/jdtls/startup.test.ts` (lines 485-558) pass:
1. "re-syncs every fabric-mod child after a successful rescue (CR-01)" — asserts exactly 2 invocations, correct newSession reference
2. "does NOT call syncFabricModToWorkspace when reinit stays degraded" — asserts mock never called when `discoverJava` returns null
3. "swallows a per-child sync throw via logger.warn and continues to the next child (D-04)" — first child throws, second still attempted, sweep resolves
4. "surfaces syncFabricModToWorkspace warnings via logger.warn" — warning text propagated to logger.warn

Full test suite: 854 tests across 70 files, zero failures. `pnpm tsc --noEmit` exits 0. `tests/jdtls/client.test.ts` unmodified (UNIX-01 byte-identical commitment upheld).

The only remaining item requiring human verification is the live end-to-end UAT (real JDT LS + real Java install + real mod project), which cannot be automated.

---

_Verified: 2026-05-16T07:21:00Z_
_Verifier: Claude (gsd-verifier)_
