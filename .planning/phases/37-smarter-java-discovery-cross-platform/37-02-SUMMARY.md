---
phase: 37-smarter-java-discovery-cross-platform
plan: 02
subsystem: jdtls
tags: [java, jdtls, discovery, async, re-export, shim, reinit, sweep, per-project]

requires:
  - phase: 37-smarter-java-discovery-cross-platform
    plan: 01
    provides: src/jdtls/java-discovery.ts (setJavaHome / detectJava / discoverJava / parseJavaVersion / resolveJavaExecutable / JavaDetected / JavaNotFound / JavaDetectResult)
provides:
  - src/jdtls/client.ts slimmed to re-export shim for the 5 discovery symbols + 3 result types (D-07/D-09/D-11 — one-milestone import-surface preservation)
  - src/jdtls/startup.ts initJdtLsSession({ projectRoot? }) — replaces sync detectJava() with async discoverJava({ projectRoot }) (D-10/D-06)
  - src/jdtls/startup.ts retryDegradedJdtLsSessions() — sweep that walks degraded-only projects, derives per-iteration projectRoot from each project's first fabric-mod child (D-03/D-05), cleans tempDir/dataDir, reinit's, swallows errors with logger.warn (D-04)
affects: [37-03, 37-04]

tech-stack:
  added: []
  patterns: [re-export-shim, async-discovery-injection, per-iteration-projectRoot-scope, atomic-jdtls-field-replacement, swallow-and-log-reinit-errors]

key-files:
  created: []
  modified:
    - src/jdtls/client.ts
    - src/jdtls/startup.ts

key-decisions:
  - "Re-export ALL FIVE discovery symbols + 3 result types unconditionally — no planner discretion. Existing import sites at src/index.ts:10, src/tools/remove-project.ts:9, tests/jdtls/startup.test.ts:27, tests/jdtls/client.test.ts:4 resolve identically (D-07/D-09/D-11)."
  - "initJdtLsSession parameter defaults to {} — zero-arg callsite at src/index.ts:21 (await initJdtLsSession()) type-checks unchanged (D-06). No src/index.ts edit needed."
  - "retryDegradedJdtLsSessions declares projectRoot inside the loop body so each iteration recomputes from the loop variable's children — NOT a captured outer-scope value, NOT the default project (D-03/D-05)."
  - "Reinit swallows exceptions and logs via logger.warn — tool handlers calling this sweep must not see throws (D-04 trigger semantics). On discoverJava-failure (newSession.available === false), the project stays degraded but with a fresh, possibly-more-informative failureReason."

patterns-established:
  - "Re-export shim with one-milestone window: collapses local definitions to `export { ... } from './module.js'` + `export type { ... } from './module.js'` while preserving import paths"
  - "Per-iteration projectRoot scope: derive scoped value inside `for (const x of iter)` loop body so each iteration uses its own loop variable, never a closure-captured outer"
  - "Degraded-only sweep filter: skip when `field?.available !== false` (treats missing-jdtls AND working-jdtls identically — only the explicit degraded case is touched)"
  - "Atomic JDT LS field replacement: `project.jdtls = newSession;` always overwrites — success and lingering-failure paths both produce the new session object"

requirements-completed: [JAVA-01, JAVA-05]

duration: ~7min
completed: 2026-05-16
---

# Phase 37 Plan 02: client.ts shim + startup.ts async + retry sweep Summary

**Collapsed `src/jdtls/client.ts` to a re-export shim for `setJavaHome` / `detectJava` / `discoverJava` / `parseJavaVersion` / `resolveJavaExecutable` (D-07), migrated `src/jdtls/startup.ts` to the async `discoverJava({ projectRoot? })` API with a new optional `{ projectRoot? }` parameter (D-10), and added the `retryDegradedJdtLsSessions()` sweep that walks `projectStore.list()`, filters to `jdtls?.available === false`, derives a per-iteration projectRoot from each project's first fabric-mod child (D-03/D-05), and atomically replaces `project.jdtls` after cleaning the prior tempDir/dataDir.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-16T12:52:15Z
- **Completed:** 2026-05-16T12:59:30Z (approx)
- **Tasks:** 2/2 completed (both `type="auto"`)
- **Files modified:** 2 (`src/jdtls/client.ts`, `src/jdtls/startup.ts`)

## Accomplishments

- **client.ts shim (Task 1, D-07/D-09/D-11):** Removed local definitions of `configuredJavaHome`, `setJavaHome`, `detectJava`, `resolveJavaExecutable`, `parseJavaVersion` (lines 50, 52-58, 60-108, 110-136, 138-153 of the old file). Removed the now-unused imports `execSync` and `javaBinaryName / javaBinaryInHome / isWindows`. Inserted the unconditional re-export line for all five symbols + a `export type { ... }` line for `JavaDetectResult / JavaDetected / JavaNotFound`. Kept `findJdtLs`, `startJdtLs`, `waitForReady` (private), `shutdownJdtLs`, and the `JdtLsFound / JdtLsNotFound / JdtLsFindResult / JdtLsStartResult` type exports byte-identical.
- **startup.ts async migration (Task 2, D-06/D-10):** Replaced `const java = detectJava();` with `const java = await discoverJava({ projectRoot: opts.projectRoot });`. Changed signature from `initJdtLsSession()` to `initJdtLsSession(opts: { projectRoot?: string } = {})` — the `{}` default preserves the zero-arg callsite at `src/index.ts:21`. The rest of the body — early-return branches, tempDir/.project/.classpath setup, `startJdtLs`, the `proc.on('exit', ...)` degradation hook, and the `catch (err)` fallthrough — stays byte-identical because `discoverJava`'s `JavaNotFound.error` flows into `failureReason` exactly like `detectJava`'s did.
- **retryDegradedJdtLsSessions sweep (Task 2, D-03/D-04/D-05):** Free function exported from startup.ts. Iterates `projectStore.list()`, skips when `project.jdtls?.available !== false` (degraded-only filter). Inside each iteration, declares `let projectRoot: string | undefined`, scans `project.children.values()` for the first `kind === 'fabric-mod'` child and assigns `child.rootPath`. Captures the old `tempDir` / `dataDir`, cleans them via `cleanupTempDir` in best-effort try/catch (mirrors `src/index.ts:32-46` cleanupAllSessions). Calls `await initJdtLsSession({ projectRoot })` — the `projectRoot` symbol resolves to the per-iteration `let` declaration, never a closure capture. Assigns the new session atomically: `project.jdtls = newSession;`. On `newSession.available === true` logs `JDT LS reinit succeeded for project '${project.name}'`. On exception, swallows + `logger.warn('JDT LS reinit failed ...')` — never throws to caller (D-04).

## Task Commits

Each task was committed atomically:

1. **Task 1: Collapse client.ts to re-export shim for discovery symbols** — `05abdba` (refactor)
2. **Task 2: Extend initJdtLsSession({ projectRoot? }) + add retryDegradedJdtLsSessions** — `2c94175` (feat)

## Files Created/Modified

- `src/jdtls/client.ts` (MODIFIED) — Collapsed from 353 LOC to 234 LOC. Now a thin shim: re-exports the 5 discovery symbols + 3 result types from `./java-discovery.js`, owns `findJdtLs / startJdtLs / waitForReady / shutdownJdtLs` and the JDT LS launcher / LSP-init / readiness machinery unchanged.
- `src/jdtls/startup.ts` (MODIFIED) — Expanded from 91 LOC to 153 LOC. `initJdtLsSession` now accepts `{ projectRoot?: string } = {}` and `await`s `discoverJava`. New exported free function `retryDegradedJdtLsSessions(): Promise<void>` provides the per-project reinit sweep that Plan 03 will wire into tool handlers.

## Verification Results

**Per plan `<verification>` block:**

- `pnpm tsc --noEmit` exits 0 — **PASS** (zero type errors).
- `pnpm test tests/jdtls/client.test.ts` passes without modification — **PASS** (26/26 tests pass; the shim re-exports `parseJavaVersion`, `detectJava`, `setJavaHome` with byte-identical semantics inherited from `java-discovery.ts`).
- `git diff --name-only 41d45e2..HEAD` lists exactly `src/jdtls/client.ts` and `src/jdtls/startup.ts` — **PASS** (no other source touched).
- No file under `src/tools/` modified — **PASS** (`git diff --name-only 41d45e2..HEAD -- src/tools/` empty).

**Per-task acceptance criteria:**

Task 1 (10 ACs):
- `grep -c "function setJavaHome" src/jdtls/client.ts` → 0 — **PASS**
- `grep -c "function detectJava" src/jdtls/client.ts` → 0 — **PASS**
- `grep -c "function parseJavaVersion" src/jdtls/client.ts` → 0 — **PASS**
- `grep -c "function resolveJavaExecutable" src/jdtls/client.ts` → 0 — **PASS**
- `grep -c "let configuredJavaHome" src/jdtls/client.ts` → 0 — **PASS**
- `grep -c "from './java-discovery.js'" src/jdtls/client.ts` → 2 (one value re-export, one type re-export — at least 1 required) — **PASS**
- Re-export line contains all five names verbatim on one line: `export { setJavaHome, detectJava, discoverJava, parseJavaVersion, resolveJavaExecutable } from './java-discovery.js';` — **PASS** (visual inspection + `grep -cE "export \{[^}]*setJavaHome[^}]*detectJava[^}]*discoverJava[^}]*parseJavaVersion[^}]*resolveJavaExecutable[^}]*\} from './java-discovery\.js'"` returns 1).
- `grep -c "execSync" src/jdtls/client.ts` → 0 — **PASS**
- `grep -cE "function findJdtLs|function startJdtLs|function shutdownJdtLs" src/jdtls/client.ts` → 3 — **PASS**
- `pnpm tsc --noEmit` exits 0 — **PASS**
- `pnpm test tests/jdtls/client.test.ts` passes unchanged — **PASS** (26/26).

Task 2 (12 ACs):
- `grep -c "export async function initJdtLsSession(opts: { projectRoot" src/jdtls/startup.ts` → 1 — **PASS**
- `grep -c "detectJava" src/jdtls/startup.ts` → 0 — **PASS**
- `grep -c "await discoverJava" src/jdtls/startup.ts` → 1 — **PASS**
- `grep -c "export async function retryDegradedJdtLsSessions" src/jdtls/startup.ts` → 1 — **PASS**
- `grep -c "projectStore\.list" src/jdtls/startup.ts` → 1 — **PASS**
- `grep -c "cleanupTempDir" src/jdtls/startup.ts` → 3 (import + 2 call sites — AC required at least 1) — **PASS**
- `grep -c "kind === 'fabric-mod'" src/jdtls/startup.ts` → 1 — **PASS**
- `grep -cE "logger\.info.*reinit succeeded" src/jdtls/startup.ts` → 1 — **PASS**
- `grep -cE "logger\.warn.*reinit failed" src/jdtls/startup.ts` → 1 — **PASS**
- **D-03/D-05 per-iteration projectRoot inspection** — **PASS**: `awk '/export async function retryDegradedJdtLsSessions/,/^}/' src/jdtls/startup.ts | grep -nE 'for \(const project|let projectRoot|await initJdtLsSession\('` shows order `for (const project of projectStore.list())` → `let projectRoot: string | undefined;` (declared inside loop body) → `await initJdtLsSession({ projectRoot })`. Module-scope grep `grep -nE '^(let|const) projectRoot' src/jdtls/startup.ts` returns no results — no outer-scope projectRoot exists.
- `pnpm tsc --noEmit` exits 0 — **PASS**
- `src/index.ts` byte-unchanged — **PASS** (`git diff --name-only HEAD -- src/index.ts` empty after Task 2 commit; full plan diff `git diff --name-only 41d45e2..HEAD -- src/index.ts` also empty).

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — all new surface is covered by the plan's existing `<threat_model>`:
- T-37-06 (rootPath provenance for discoverJava): `projectRoot` is read from a `FabricModChild.rootPath` which was already validated by `loadFabricMod` upstream; mitigation in place.
- T-37-07 (DoS via repeated degraded sweep): degraded-only filter (`project.jdtls?.available !== false` skip) keeps the per-call cost proportional to the count of currently-degraded projects only; healthy and missing-jdtls projects are not probed.
- T-37-08 (cleanupTempDir trust boundary): `tempDir / dataDir` strings come exclusively from a prior server-allocated `initJdtLsSession` call (`tmpdir()` + `randomUUID()`); same trust profile as the existing `src/index.ts:32-46 cleanupAllSessions`.

## Known Stubs

None — both modified files are fully wired and functional. `retryDegradedJdtLsSessions` is callable end-to-end (Plan 03 will plumb it into tool handlers as the trigger).

## Self-Check: PASSED

**Files verified:**
- FOUND: `src/jdtls/client.ts` (234 LOC, `[ -f ]` succeeds)
- FOUND: `src/jdtls/startup.ts` (153 LOC, `[ -f ]` succeeds)

**Commits verified:**
- FOUND: `05abdba` (Task 1 — client.ts shim)
- FOUND: `2c94175` (Task 2 — startup.ts async + retry sweep)
