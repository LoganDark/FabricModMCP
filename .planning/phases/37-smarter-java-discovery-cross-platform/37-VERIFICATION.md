---
phase: 37-smarter-java-discovery-cross-platform
verified: 2026-05-16T06:25:00Z
status: gaps_found
score: 11/11 must-haves verified
overrides_applied: 0
developer_scope_decision: "2026-05-16: developer ruled CR-01 IN-SCOPE for Phase 37 — the retry hook's user-visible promise (Java install unlocks degraded JDT LS) is not actually delivered without workspace re-sync. Gap closure required."
gaps:
  - id: CR-01
    title: "retryDegradedJdtLsSessions does not re-sync fabric-mod sources after rescue"
    source: "37-REVIEW.md CR-01 (BLOCKER)"
    summary: "Tool handlers call syncFabricModToWorkspace against the OLD degraded session (no-op when available === false), then retryDegradedJdtLsSessions replaces project.jdtls with a fresh session whose tempDir has an empty .classpath. Response reports jdtlsAvailable: true, but JDT LS has indexed nothing — find_definition returns empty."
    affects: [add_fabric_mod, refresh_project, refresh_project_members]
    fix_sketch: "Inside retryDegradedJdtLsSessions, after each successful initJdtLsSession assignment, iterate project.children for kind === 'fabric-mod' children and call syncFabricModToWorkspace(child, project.jdtls, ...) against the new session. See 37-REVIEW.md CR-01 for the full snippet."
---

# Phase 37: Smarter Java Discovery (cross-platform) Verification Report

**Phase Goal:** "Smarter Java Discovery (cross-platform) — New src/jdtls/java-discovery.ts with priority chain --java-home → org.gradle.java.home → JAVA_HOME → PATH → common install locations; async sequential probes with 3s per-candidate timeout; .properties backslash unescape at the consumption site."

**Verified:** 2026-05-16T06:25:00Z
**Status:** gaps_found (developer ruled CR-01 in-scope on 2026-05-16)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (merged from ROADMAP SCs + Plan must_haves)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | `discoverJava({ projectRoot? })` evaluates 5 slots in the locked order --java-home → org.gradle.java.home → JAVA_HOME → PATH → scan and returns the first Java 21+ hit | VERIFIED | `src/jdtls/java-discovery.ts:361-445` — `discoverJava` body shows sequential blocks for each slot with `if (outcome.kind === 'success') return returnSuccess(outcome);` short-circuit; slot labels appear in canonical order at lines 380, 393, 407, 421, 429 |
| 2   | A candidate that returns Java <21 does NOT abort discovery; chain continues to next candidate | VERIFIED | `probeCandidate` at `java-discovery.ts:299` returns `{ kind: 'version-too-old', version }` (not error); `discoverJava` only short-circuits on `kind === 'success'`. Test `tests/jdtls/java-discovery.test.ts` describes "JAVA-02 version skip continuation" passes |
| 3   | Per-candidate probes use `execFile` with 3000ms timeout; SIGTERM/SIGKILL/killed classified as `timed out after 3s` | VERIFIED | `java-discovery.ts:292-295` `execFileAsync(resolved, ['--version'], { timeout: 3_000, encoding: 'utf-8' })`; lines 302-304 classify `signal === 'SIGTERM' \|\| signal === 'SIGKILL' \|\| killed === true` as `'timed-out'`; `formatReason` line 484 emits `'timed out after 3s'` |
| 4   | `org.gradle.java.home` values pass through `unescapePropertiesValue` (decodes `\\`, `\:`, `\=`, `\t`, `\n`, `\r`, `\f`, `\uXXXX`; unknown `\X` drops backslash) | VERIFIED | `unescapePropertiesValue` at `java-discovery.ts:162-209` is a single-pass scanner; `readProjectGradleJavaHome` at line 348 calls `unescapePropertiesValue(raw)`. Test file has 8+ unit tests for the helper |
| 5   | When `projectRoot` is undefined the `org.gradle.java.home` slot is silently skipped (no I/O); slot label still appears in failureReason as `(not set)` | VERIFIED | `readProjectGradleJavaHome` line 338 returns undefined immediately when `projectRoot === undefined`; `formatSlotLine` line 459 emits `'org.gradle.java.home: (not set)'` for the no-projectRoot branch |
| 6   | When every candidate fails, returned `error` starts with literal `Java not found.` and contains one human-readable line per slot | VERIFIED | `java-discovery.ts:439` `const lines: string[] = ['Java not found. Tried:'];` and the loop at 440-442 appends one indented line per outcome; closing message at 443. Tests assert prefix and per-slot strings |
| 7   | Module state `configuredJavaHome` set by `setJavaHome(s)` is read by BOTH `detectJava()` and `discoverJava()` | VERIFIED | `java-discovery.ts:45` declares `let configuredJavaHome`; `setJavaHome` writes it (line 52); `detectJava` reads at line 66; `discoverJava` reads at line 381 |
| 8   | `detectJava()` retains v1.5 byte-identical behavior: `execSync` + 10s timeout, 2-slot chain | VERIFIED | `java-discovery.ts:63-104` — same `execSync` shell-command shape as Phase 35; tests `tests/jdtls/client.test.ts` pass UNCHANGED through the shim (re-export at `client.ts:43`) |
| 9   | `client.ts` collapses to a re-export shim for discovery symbols + JDT LS process machinery only | VERIFIED | `src/jdtls/client.ts:43` `export { setJavaHome, detectJava, discoverJava, parseJavaVersion, resolveJavaExecutable } from './java-discovery.js';`. No local function definitions remain for these names |
| 10  | `initJdtLsSession({ projectRoot? })` exists with default `{}`; zero-arg callsite at `src/index.ts:21` still works; `await discoverJava` replaces `detectJava()` | VERIFIED | `src/jdtls/startup.ts:41-42` — `export async function initJdtLsSession(opts: { projectRoot?: string } = {}): Promise<JdtLsSession>` and `const java = await discoverJava({ projectRoot: opts.projectRoot });` |
| 11  | `retryDegradedJdtLsSessions()` exists, sweeps degraded projects with per-iteration projectRoot derivation; all 3 tool handlers invoke it | VERIFIED | `startup.ts:123-164` — `projectRoot` declared inside loop body at line 130; iterates `project.children.values()` for first `kind === 'fabric-mod'`. Wired into all three tools: `add-fabric-mod.ts:11,80`, `refresh-project.ts:13,113`, `refresh-project-members.ts` (grep returned 2 occurrences each) |

**Score:** 11/11 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/jdtls/java-discovery.ts` | discoverJava / detectJava / setJavaHome / parseJavaVersion / resolveJavaExecutable / unescapePropertiesValue | VERIFIED | 487 lines; 9 exports including all required functions and 3 types |
| `src/jdtls/client.ts` | Re-export shim for discovery symbols, retains findJdtLs / startJdtLs / shutdownJdtLs | VERIFIED | Local definitions removed; re-export present at line 43; JDT LS process machinery preserved |
| `src/jdtls/startup.ts` | initJdtLsSession({ projectRoot? }) + retryDegradedJdtLsSessions | VERIFIED | Both exports present; per-iteration projectRoot derivation per D-03/D-05 |
| `src/tools/add-fabric-mod.ts` | Imports + invokes retryDegradedJdtLsSessions | VERIFIED | Import at line 11, call at line 80 (after `syncFabricModToWorkspace`, before `makeSuccess`) |
| `src/tools/refresh-project.ts` | Imports + invokes retryDegradedJdtLsSessions | VERIFIED | Import at line 13, call at line 113 (after for-loop, before `autoUnloadConflictingStudyJars`) |
| `src/tools/refresh-project-members.ts` | Imports + invokes retryDegradedJdtLsSessions | VERIFIED | grep returned 2 occurrences (import + call) |
| `tests/jdtls/java-discovery.test.ts` | New test file covering JAVA-01..05 | VERIFIED | 593 lines, 8 describes (≥7 required), 21 references to `unescapePropertiesValue`, 19 to `setPlatform`, 3 to `timed out after 3s` |
| `tests/jdtls/startup.test.ts` | Extended for projectRoot + retryDegradedJdtLsSessions | VERIFIED | `mockDiscoverJava` constant at line 39; new describes at lines 266 and 377 covering projectRoot passthrough + retry sweep including per-project root regression (D-03/D-05) |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `src/jdtls/java-discovery.ts` | `src/platform/index.ts` | named import of `javaBinaryName, javaBinaryInHome, commonJavaLocations, isWindows` | WIRED — line 28 |
| `src/jdtls/java-discovery.ts` | `src/project/gradle-parser.ts` | `parseGradleProperties` | WIRED — line 29, used at line 345 |
| `src/jdtls/client.ts` | `src/jdtls/java-discovery.ts` | named re-export | WIRED — line 43 |
| `src/jdtls/startup.ts` | `src/jdtls/java-discovery.ts` (through shim) | `discoverJava` import via `./client.js` | WIRED — line 19 imports `discoverJava` from `./client.js`; used at line 42 |
| `src/jdtls/startup.ts` | `src/state/project-store.ts` | `projectStore.list()` iteration for degraded sweep | WIRED — import line 23, call line 124 |
| All 3 tool handlers | `src/jdtls/startup.ts` | `retryDegradedJdtLsSessions` import | WIRED — confirmed by grep returning 2 occurrences in each handler |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript type-check | `pnpm tsc --noEmit` | exit 0, no output | PASS |
| Phase 37 unit tests | `pnpm test tests/jdtls/java-discovery.test.ts tests/jdtls/startup.test.ts tests/jdtls/client.test.ts` | 3 files, 63 tests passed | PASS |
| Full test suite | `pnpm test` | 70 files, 850 tests passed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| JAVA-01 | 37-01, 37-02, 37-03, 37-04 | Priority chain --java-home → org.gradle.java.home → JAVA_HOME → PATH → scanned common locations | SATISFIED | `discoverJava` slot order in `java-discovery.ts:378-436`; tests `discoverJava priority order` cover all 5 slot winners |
| JAVA-02 | 37-01, 37-04 | Java <21 candidates are skipped, not fatal | SATISFIED | `probeCandidate` returns `version-too-old` (line 299) which is NOT `success`; chain continues. Test `JAVA-02 version skip continuation` |
| JAVA-03 | 37-01, 37-04 | `org.gradle.java.home` backslash escapes decoded | SATISFIED | `unescapePropertiesValue` single-pass scanner (lines 162-209) handles `\\`, `\:`, `\=`, `\t/n/r/f`, `\uXXXX`, unknown `\X`; called from `readProjectGradleJavaHome` line 348. Test `JAVA-03 backslash unescape end-to-end` |
| JAVA-04 | 37-01, 37-04 | Vendor enumeration of common JDK install locations | SATISFIED | `enumerateParent` line 317; `vendorLayoutFor` supports depth1/mac-bundle/homebrew/scoop layouts; `acceptEntry` filters /opt and homebrew. Tests describe `JAVA-04 vendor enumeration` covering macOS bundle, Homebrew openjdk filter, Scoop, /opt prefix filter |
| JAVA-05 | 37-01, 37-04 | Per-candidate 3s timeout | SATISFIED | `execFileAsync(..., { timeout: 3_000, ... })` at `java-discovery.ts:292-295`; SIGTERM/SIGKILL/killed → `'timed-out'` classification → formatted as `'timed out after 3s'`. Test `JAVA-05 per-candidate 3s timeout` |

All five JAVA-NN requirements are accounted for in plan frontmatter and implemented in the codebase. No orphaned requirements detected.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src/jdtls/java-discovery.ts` | 76-80 | `execSync("\"${javaPath}\" --version", ...)` shell-interpolated path | INFO | Pre-existing v1.5 behavior preserved under UNIX-01 byte-identical commitment; flagged by code review as WR-01 but not introduced by this phase |
| `src/jdtls/java-discovery.ts` | 138-149 | `parseJavaVersion` regex unanchored — first numeric token in `stdout+stderr` could shadow real version | WARNING | Could cause `Picked up JAVA_TOOL_OPTIONS: -Xmx2048m` style preamble to be misread. Code review WR-02. Pre-existing logic moved verbatim from Phase 35. |
| `src/jdtls/java-discovery.ts` | 253-259 | `acceptEntry` /opt filter rejects `liberica-*`, `sapmachine-*`, etc. | WARNING | Silently-incomplete vendor matrix; code review WR-03 |
| `src/jdtls/java-discovery.ts` | 317-323 | `enumerateParent` catches all readdir errors, no breadcrumb on EACCES | INFO | Code review WR-04 |
| `src/jdtls/startup.ts` | 123-164 | `retryDegradedJdtLsSessions` has no concurrency guard | WARNING | Parallel tool invocations can race; code review WR-05 |
| `src/jdtls/java-discovery.ts` | 470-473 | `formatSlotLine` `'java on PATH'` `not-set` branch is dead code | INFO | IN-01 |

None of these anti-patterns block JAVA-01..05 achievement. They are scope-adjacent quality concerns flagged by code review for follow-up; the phase contract does not require them to be fixed in 37.

### Human Verification Required

#### 1. Workspace re-sync after JDT LS rescue (CR-01)

**Test:** Add a fabric mod to a project whose default JDT LS session was created with `available: false` (e.g. start the server with no Java on PATH, then install Java 21+, then call `add_fabric_mod` against a project that had no projectRoot at startup). After the call succeeds, attempt a `find_definition` against any class in the newly-added mod's sources.

**Expected:** Real navigation results (definition jumps to the correct file). Currently, per CR-01 in `37-REVIEW.md`, the response reports `jdtlsAvailable: true` but the new JDT LS session has an empty `.classpath` — `syncFabricModToWorkspace` runs at `add-fabric-mod.ts:73` against the OLD degraded session (which is a no-op when `available === false`), then `retryDegradedJdtLsSessions` at line 80 replaces `loadedProject.jdtls` with a fresh session whose tempDir was just created with an empty `.classpath` at `startup.ts:69`. No re-sync follows.

**Why human:** This concern is the responsibility of the developer because (a) it sits OUTSIDE the JAVA-01..05 requirements — those are strictly about discovery; (b) it requires real JDT LS, a real Java install, and a real Minecraft mod to observe; (c) the must_haves in the four plans for this phase do not mandate post-rescue workspace sync. Plan 02's retry must_have says only "assigns a fresh `initJdtLsSession({ projectRoot })` result to `project.jdtls` on success" — nothing about re-sync.

The developer must decide:
- **Accept as a known limitation** — the phase met its JAVA-NN contract; document the user-visible workflow gap as a follow-up issue.
- **Require a follow-up plan** to wire `syncFabricModToWorkspace` into `retryDegradedJdtLsSessions` (the fix sketched in 37-REVIEW.md CR-01).
- **Override the gap** with `overrides:` frontmatter accepting the deviation.

### Verifier Assessment

The phase achieves its stated goal: a new `src/jdtls/java-discovery.ts` exists with the documented priority-chain, the async probe with 3s timeout works, backslash unescape is implemented at the consumption site, and all 5 requirements are realized in code and tests. The full test suite (850 tests across 70 files) passes cleanly.

The CR-01 concern raised in code review is real but lives in territory the phase plans did NOT promise to cover. The phase's "Smarter Java Discovery" goal is about discovery, not about the cross-cutting workspace-rescue user flow that the retry hook enables. The reinit hook itself (Plan 02's Claude's-Discretion item) is implemented correctly to its own narrowly-stated contract; CR-01 is about an unwired consumer-side gap. The verifier therefore treats CR-01 as a `human_needed` decision rather than a `gaps_found` blocker against JAVA-01..05.

If the user-flow concern is treated as in scope for 37, the status should become `gaps_found`. The verifier explicitly defers that scope question to the developer.

---

_Verified: 2026-05-16T06:25:00Z_
_Verifier: Claude (gsd-verifier)_
