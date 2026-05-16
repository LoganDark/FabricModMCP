---
phase: 37-smarter-java-discovery-cross-platform
plan: 01
subsystem: jdtls
tags: [java, jdtls, discovery, gradle, properties, vendor-map, async, execFile]

requires:
  - phase: 35-platform-helpers-java-executable-resolution
    provides: commonJavaLocations(), javaBinaryName(), javaBinaryInHome(), isWindows from src/platform/index.ts
provides:
  - src/jdtls/java-discovery.ts NEW domain module with carry-overs (setJavaHome / detectJava / parseJavaVersion / resolveJavaExecutable) and new async API (discoverJava)
  - unescapePropertiesValue helper implementing Java Properties escape spec (\\\\, \\:, \\=, \\t/\\n/\\r/\\f, \\uXXXX, unknown \\X)
  - Vendor layout map (depth1 / mac-bundle / homebrew / scoop) + acceptEntry filter (D-16) + parseVersionHint
  - discoverJava: 5-slot async priority chain (--java-home → org.gradle.java.home → JAVA_HOME → java on PATH → commonJavaLocations scan) with 3s per-candidate timeout, skip-on-fail, multi-line failureReason
affects: [37-02, 37-03, 37-04]

tech-stack:
  added: [node:util.promisify, node:child_process.execFile (timeout-capped async probe)]
  patterns: [single-pass-properties-unescape, vendor-aware-jdk-enumeration, slot-chain-with-skip-on-fail, multi-line-failureReason]

key-files:
  created: [src/jdtls/java-discovery.ts]
  modified: []

key-decisions:
  - "Single-pass scanner for unescapePropertiesValue (chained .replace() cannot honor \\\\u0043 → literal \\u0043)"
  - "Slot 1 (--java-home) reads module-state configuredJavaHome via the existing setJavaHome path so src/index.ts:14 callsite is preserved"
  - "Slot 2 (org.gradle.java.home) is silently skipped when opts.projectRoot is undefined — no I/O attempted, slot still appears in failureReason as '(not set)' per D-21"
  - "Slot 5 enumeration sort is descending by parseVersionHint so newest JDK in each parent is probed first; tie-breakers and entries with no digit hint sort last but are still probed (real version comes from --version)"
  - "probeCandidate classifies thrown errors with signal === 'SIGTERM' / 'SIGKILL' OR killed === true as 'timed-out' to cover Node version differences in execFile timeout signaling"
  - "Failure synthesizer emits exactly 'Java not found. Tried:' as line 1 — existing tests in tests/jdtls/startup.test.ts:78, tests/tools/get-project-info.test.ts:177, tests/tools/create-project.test.ts:84 use toContain('Java not found') (D-18 non-negotiable)"
  - "client.ts NOT modified this plan — re-export shim lands in Plan 02 (D-07); tests/jdtls/client.test.ts (26 tests) keeps passing byte-identically"

patterns-established:
  - "Vendor-aware layout map: keyed by parent path (exact match or suffix), maps to one of {depth1, mac-bundle, homebrew, scoop} for candidate construction"
  - "readdir miss-tolerance: enumerate returns [] on any error (parent doesn't exist is not an error condition)"
  - "Slot-chain orchestrator: build candidate / probe / record outcome per slot, return immediately on first success, otherwise synthesize multi-line failureReason from accumulated outcomes"
  - "Per-candidate logger.debug skip events keyed by candidate path + outcome kind (volume bounded by candidate count)"

requirements-completed: [JAVA-01, JAVA-02, JAVA-03, JAVA-04, JAVA-05]

duration: ~25min
completed: 2026-05-16
---

# Phase 37 Plan 01: Java Discovery Module Carve-Out Summary

**Created `src/jdtls/java-discovery.ts` owning sync `detectJava` (byte-identical v1.5) + async `discoverJava` 5-slot priority chain (--java-home → org.gradle.java.home → JAVA_HOME → java on PATH → commonJavaLocations scan) with 3s per-candidate execFile timeout, vendor-aware JDK enumeration, and multi-line `Java not found.` failureReason.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-16T12:25:00Z (approx — worktree base + reset)
- **Completed:** 2026-05-16T12:49:30Z
- **Tasks:** 2/2 completed (both `type="auto"`)
- **Files modified:** 1 new (`src/jdtls/java-discovery.ts`, 487 lines)

## Accomplishments

- Carved out `setJavaHome` / `detectJava` / `parseJavaVersion` / `resolveJavaExecutable` byte-identically from `client.ts` — the source file itself is untouched this plan (D-09); `tests/jdtls/client.test.ts` (26 tests) keeps passing.
- Added `unescapePropertiesValue` Java-Properties escape decoder as a single-pass scanner (chained `.replace()` would mis-handle `\\u0043` → literal `C`).
- Added vendor-aware enumeration plumbing: `vendorLayoutFor` (depth1 / mac-bundle / homebrew / scoop), `candidateFromEntry`, `acceptEntry` (D-16 `/opt` JDK prefix list + Homebrew `openjdk*` filter), `parseVersionHint`.
- Implemented `discoverJava({ projectRoot? })` orchestrator: sequential 5-slot evaluation, first 21+ success short-circuits per D-15, `logger.debug` per skip per D-20, multi-line `Java not found. Tried:`-prefixed failureReason with per-slot labels (D-21) and outcome reasons (D-22).
- Runtime smoke test confirmed discoverJava returns `{ javaPath: "java", version: 26 }` on the dev host (slot 4 — `java on PATH`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create java-discovery.ts with carry-over symbols + unescape helper + vendor map** — `1002322` (feat)
2. **Task 2: Implement async discoverJava orchestrator with 5-slot chain + multi-line failureReason** — `6d5c5ab` (feat)

## Files Created/Modified

- `src/jdtls/java-discovery.ts` (NEW, 487 LOC) — Domain module owning Java discovery for JDT LS. Exports `setJavaHome`, `detectJava`, `discoverJava`, `parseJavaVersion`, `resolveJavaExecutable`, `unescapePropertiesValue`, `JavaDetected` / `JavaNotFound` / `JavaDetectResult` types.

## Verification Results

**Per plan `<verification>` block:**

- File `src/jdtls/java-discovery.ts` exists with both carry-over and new symbols — **PASS** (487 lines).
- `pnpm tsc --noEmit` exits 0 — **PASS** (no errors).
- No other file modified — **PASS** (`git diff --name-only 45841f1..HEAD` lists only the new file).
- No back-import from `./client.js` — **PASS** (`grep -cE '\\bfrom .\\./client\\.js\\b'` returns 0).
- `pnpm test tests/jdtls/client.test.ts` still passes — **PASS** (26/26 tests pass; existing Phase 35 surface preserved since `client.ts` is untouched).

**Per-task acceptance criteria spot-check:**

- All 8 acceptance greps in Task 1 pass (setJavaHome / detectJava / parseJavaVersion / resolveJavaExecutable / unescapePropertiesValue exports = 1 each, execSync ≥1, execFileAsync line = 1, no space-indented lines).
- All Task 2 acceptance greps pass (discoverJava export = 1, CandidateOutcome type = 1, `promisify(execFile)` = 1, `timeout: 3_000` appears, `'Java not found. Tried:'` literal = 1 occurrence via `grep -F`, `logger.debug.*Java candidate skipped` = 2 occurrences inside the `record()` helper, `commonJavaLocations` ≥1, `parseGradleProperties|gradle.properties` ≥2).
- Slot order in source: `--java-home` (L380) → `org.gradle.java.home` (L393) → `JAVA_HOME` (L407) → `java on PATH` (L421) → `commonJavaLocations()` (L429) — **canonical order**.
- Inline `unescapePropertiesValue` spec checks:
  - `unescapePropertiesValue('C:\\\\\\\\Users\\\\\\\\foo')` (JS 12-char) → `'C:\\\\Users\\\\foo'` (JS 10-char) ✓
  - `unescapePropertiesValue('\\u0043:')` (7-char source) → `'C:'` ✓
  - `unescapePropertiesValue('C:/Users/foo')` → `'C:/Users/foo'` (no-op) ✓
- Runtime smoke: `await discoverJava()` returns `{ javaPath: "java", version: 26 }` on this host (slot 4 — PATH lookup).

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — all new surface is covered by the plan's existing `<threat_model>` (T-37-01..T-37-05). The single-pass `unescapePropertiesValue` scanner (T-37-01 mitigation), `execFile` arg-array form with 3s timeout (T-37-02 / T-37-03 mitigation), and D-16 `/opt` prefix filter (T-37-03 mitigation) are all implemented as designed.

## Known Stubs

None — `discoverJava` and `detectJava` are both fully wired and functional. Plans 02 / 03 / 04 will wire `discoverJava` into the rest of the system (re-export shim, startup.ts migration, tool-handler retry hook, tests).

## Self-Check: PASSED

**Files verified:**
- FOUND: `src/jdtls/java-discovery.ts` (487 LOC, `[ -f ]` succeeds)

**Commits verified:**
- FOUND: `1002322` (Task 1 — carry-overs + unescape + vendor map)
- FOUND: `6d5c5ab` (Task 2 — discoverJava orchestrator)
