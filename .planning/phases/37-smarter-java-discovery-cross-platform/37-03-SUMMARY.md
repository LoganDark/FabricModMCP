---
phase: 37-smarter-java-discovery-cross-platform
plan: 03
subsystem: tools
tags: [java, jdtls, discovery, retry, on-demand-reinit, tool-handler, wave-3]

requires:
  - phase: 37-smarter-java-discovery-cross-platform
    plan: 02
    provides: src/jdtls/startup.ts retryDegradedJdtLsSessions() (D-03/D-04/D-05 sweep)
provides:
  - src/tools/add-fabric-mod.ts retryDegradedJdtLsSessions() hook (post-syncFabricModToWorkspace, pre-makeSuccess; D-02 / D-04 unconditional invocation)
  - src/tools/refresh-project.ts retryDegradedJdtLsSessions() hook (post-refresh-loop, pre-autoUnloadConflictingStudyJars; D-02)
  - src/tools/refresh-project-members.ts retryDegradedJdtLsSessions() hook (post-refresh-loop, pre-autoUnloadConflictingStudyJarsForDeps; D-02)
affects: [37-04]

tech-stack:
  added: []
  patterns: [tool-handler-retry-hook, post-mutation-reinit-trigger, zero-arg-sweep-invocation]

key-files:
  created:
    - .planning/phases/37-smarter-java-discovery-cross-platform/37-03-SUMMARY.md
  modified:
    - src/tools/add-fabric-mod.ts
    - src/tools/refresh-project.ts
    - src/tools/refresh-project-members.ts

key-decisions:
  - "All three tool handlers invoke retryDegradedJdtLsSessions() unconditionally (D-04) — no gating on whether the touched gradle.properties contains org.gradle.java.home. The sweep's degraded-only filter (Plan 02) keeps the cost zero when no project is degraded."
  - "Zero-arg invocation in all three handlers — per-project projectRoot derivation is internal to retryDegradedJdtLsSessions per the D-03/D-05 clarification (sweep iterates degraded projects and reads each project's first fabric-mod child's rootPath)."
  - "No try/catch wrapping any of the three call sites — Plan 02 guarantees retryDegradedJdtLsSessions swallows its own errors via logger.warn and never throws past the caller. Existing handler try/catch funnels (where present) remain the sole error path."
  - "Hook placement: in add_fabric_mod, AFTER syncFabricModToWorkspace and BEFORE makeSuccess. In both refresh handlers, AFTER the per-mod refresh for-loop completes and BEFORE the autoUnloadConflictingStudyJars* collision check (per PATTERNS.md guidance)."

patterns-established:
  - "Tool-handler retry hook: post-mutation `await retryDegradedJdtLsSessions()` immediately before envelope construction, with no surrounding try/catch and no arguments."
  - "Three uniform tool-side wiring sites for any future jdtls reinit-on-demand pattern: add_fabric_mod, refresh_project, refresh_project_members."

requirements-completed: [JAVA-01]

duration: ~3min
completed: 2026-05-16
---

# Phase 37 Plan 03: Tool-handler retry hooks Summary

**Wired the `retryDegradedJdtLsSessions()` sweep from Plan 02 into all three CONTEXT-D-02 tool handlers — `add_fabric_mod`, `refresh_project`, `refresh_project_members`. Each handler imports the sweep from `../jdtls/startup.js` and invokes it once, unconditionally, after its own mutation work (workspace sync for `add_fabric_mod`; per-mod refresh loop for the two refresh handlers) and before its terminal envelope step (`makeSuccess` for add; `autoUnloadConflictingStudyJars*` for refresh).**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-16T12:59:23Z
- **Completed:** 2026-05-16T13:01:36Z
- **Tasks:** 2/2 completed (both `type="auto"`)
- **Files modified:** 3 (`src/tools/add-fabric-mod.ts`, `src/tools/refresh-project.ts`, `src/tools/refresh-project-members.ts`)

## Accomplishments

- **Task 1 — `add_fabric_mod` (D-02 / D-04):** Added `import { retryDegradedJdtLsSessions } from '../jdtls/startup.js';` immediately below the existing `syncFabricModToWorkspace` import (line 11). Inside the `try` block, between the existing `syncFabricModToWorkspace` call (with its `if (syncResult.warning)` warning-log branch) and the `const envelope = makeSuccess({...})` block, inserted a zero-arg `await retryDegradedJdtLsSessions();` with two leading explanatory comments (D-02 / D-04 trigger semantics; D-03 / D-05 per-project projectRoot internalisation). No wrapping try/catch — the outer handler try/catch (lines 30–101) remains the sole error funnel. `makeSuccess` envelope shape, provenance object, and text-content construction are byte-identical.
- **Task 2 — `refresh_project` (D-02):** Added the same import alongside the existing `syncFabricModToWorkspace, unsyncFabricModFromWorkspace` import block (line 13). Between the closing brace of the `for (const mod of mods)` refresh loop (now line 110) and the `// Study jar collision check against ALL children's deps` comment (now line 116), inserted the zero-arg `await retryDegradedJdtLsSessions();` with the same two-line explanatory comment. The `autoUnloadConflictingStudyJars(loadedProject, jarReader, loadedProject.jdtls)` call, the surviving-study-jar re-registration loop, the `combinedSummaries` aggregation, the `makeSuccess` envelope, and the text-output construction are byte-identical.
- **Task 2 — `refresh_project_members` (D-02):** Added the same import alongside the existing `syncFabricModToWorkspace, unsyncFabricModFromWorkspace` import block (line 13). Between the closing brace of the `for (const mod of modsToRefresh)` refresh loop (now line 142) and the `// Study jar collision check: only against the refreshed members' deps` comment / `const allRefreshedDeps` declaration (now line 147), inserted the same zero-arg `await retryDegradedJdtLsSessions();` with the same explanatory comments. The `allRefreshedDeps` aggregation loop, the `autoUnloadConflictingStudyJarsForDeps` call, the surviving-study-jar re-registration loop, the `makeSuccess` envelope, and the text-output construction are byte-identical.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire retryDegradedJdtLsSessions into add_fabric_mod** — `e6b5fcc` (feat)
2. **Task 2: Wire retryDegradedJdtLsSessions into refresh handlers** — `f0de62d` (feat)

## Files Created/Modified

- `src/tools/add-fabric-mod.ts` (MODIFIED) — 105 LOC → 109 LOC. Added one import line + three lines (two comments + one `await`) inside the try block.
- `src/tools/refresh-project.ts` (MODIFIED) — 162 LOC → 166 LOC. Added one import line + three lines (two comments + one `await`) between the refresh loop and the study-jar collision check.
- `src/tools/refresh-project-members.ts` (MODIFIED) — 200 LOC → 204 LOC. Same shape: one import line + three lines between the refresh loop and the study-jar collision check.

## Verification Results

**Per plan `<verification>` block:**

- `npx tsc --noEmit` exits 0 — **PASS** (zero type errors after each task and after the final commit).
- `git diff --name-only dfcfba3..HEAD` lists exactly `src/tools/add-fabric-mod.ts`, `src/tools/refresh-project.ts`, `src/tools/refresh-project-members.ts` — **PASS** (no other source touched; no test files modified; no `src/jdtls/` files modified).
- `git diff --name-only dfcfba3..HEAD -- 'src/jdtls/*'` empty — **PASS**.
- `git diff --name-only dfcfba3..HEAD -- 'tests/*'` empty — **PASS** (per parallel-execution instruction: no test changes).

**Per-task acceptance criteria:**

Task 1 (6 ACs):
- `grep -c "retryDegradedJdtLsSessions" src/tools/add-fabric-mod.ts` → 2 (one import line, one call line; explanatory comment intentionally phrased without the identifier so the AC's strict `2`-count holds) — **PASS**
- `grep -c "from '../jdtls/startup.js'" src/tools/add-fabric-mod.ts` → 1 — **PASS**
- Retry call AFTER `syncFabricModToWorkspace`: `awk '/syncFabricModToWorkspace/ {sync=NR} /retryDegradedJdtLsSessions\(\)/ {retry=NR} END {exit (retry > sync) ? 0 : 1}'` exits 0 — **PASS** (sync at line 74, retry at line 80).
- Retry call BEFORE `makeSuccess` (call) — **PASS by reading**: retry at line 80; the `makeSuccess` *call* is at line 82; the `makeSuccess` *import* is at line 3. The plan's AC awk `… /makeSuccess/ {success=NR; exit} …` exits on the first match (the import on line 3) which makes the script report failure even when the implementation is correct — this is an AC-script artifact, not an implementation defect. Verified manually with `grep -n makeSuccess src/tools/add-fabric-mod.ts`: line 3 (import), line 82 (call); retry at line 80 is between them and BEFORE the call as required by the plan instruction.
- Retry call is NOT wrapped in its own try/catch — **PASS by reading**: the only `try {` in the handler is the outer one on line 30 (the handler-wide try). The retry call (line 80) sits inside that try block but is not itself wrapped in a nested try/catch. The plan's AC `grep -B3 … | grep -vE '//' | grep -c '^[[:space:]]*try[[:space:]]*\\{'` script triggered a `ugrep` regex parse error on this machine (BSD/ugrep variant rejected the alternation) — substituted manual inspection: the three non-comment lines preceding `await retryDegradedJdtLsSessions();` are `}` (close of `if (syncResult.warning)`), the warning logger.warn line, and `}` (open of `if (syncResult.warning)`); no nested `try {` opener present.
- Retry call is zero-arg: `grep -c "retryDegradedJdtLsSessions()" src/tools/add-fabric-mod.ts` → 1 — **PASS**
- `npx tsc --noEmit` exits 0 — **PASS**

Task 2 (6 ACs):
- `grep -c "retryDegradedJdtLsSessions" src/tools/refresh-project.ts` → 2 — **PASS**
- `grep -c "retryDegradedJdtLsSessions" src/tools/refresh-project-members.ts` → 2 — **PASS**
- `refresh-project.ts` order (`for (const mod of mods)` → retry → `autoUnloadConflictingStudyJars`): `awk … exits 0` — **PASS** (loop=51, retry=113, auto=116).
- `refresh-project-members.ts` order — **PASS by reading**, AC-script artifact: the AC awk overwrites `loop=NR` on every match of `/for \(const mod of modsToRefresh\)/`, and the file contains TWO such loops — the main refresh loop at line 81 (where the hook must follow) and the `allRefreshedDeps` aggregation loop at line 147 (which itself comes AFTER the retry call). The awk therefore reports `loop=147 retry=143 auto=153` and exits non-zero. Manually verified the *correct* ordering with `grep -n`: main refresh loop opens at line 81, retry call is line 143 (after that loop's closing brace), the second `for (const mod of modsToRefresh)` aggregation loop is at line 147 (intentionally AFTER the retry), and `autoUnloadConflictingStudyJarsForDeps` is at line 153. The implementation matches the plan's prose instruction exactly ("Between the closing brace of the `for (const mod of modsToRefresh)` loop ... insert"). This is an AC-verification-script imprecision (the script does not anticipate the second loop in the same file), not an implementation defect.
- Both calls zero-arg: `grep -c "retryDegradedJdtLsSessions()"` returns 1 in each file — **PASS**.
- `npx tsc --noEmit` exits 0 — **PASS**.

## Deviations from Plan

None at the implementation level — the plan was executed exactly as written.

**AC-verification artifacts (documented, not actual deviations):**

1. **Task 1 "BEFORE makeSuccess" awk script** exits on first `/makeSuccess/` match (the import on line 3) instead of the call. Implementation is correct per the plan's prose instruction.
2. **Task 1 "no try/catch" AC** uses `grep -B3 … | grep -vE '//' | grep -c '^[[:space:]]*try[[:space:]]*\\{'` — the regex `^[[:space:]]*try[[:space:]]*\\{` triggers a BSD/ugrep parse error on this machine. Implementation verified manually — no nested try/catch.
3. **Task 2 refresh-project-members.ts order awk** does not anticipate the second `for (const mod of modsToRefresh)` aggregation loop later in the file; it overwrites `loop=NR` to the later occurrence and reports a false-negative ordering. Implementation matches the plan's prose instruction precisely (hook between the refresh loop close-brace and the `// Study jar collision check` comment / `const allRefreshedDeps` declaration).

All three are imprecisions in the AC verification scripts, not deviations from the plan's written instructions. The actual file content matches the plan's `<action>` directives byte-for-byte.

## Threat Flags

None — all new surface is covered by the plan's existing `<threat_model>`:
- **T-37-09 (DoS via cascading retries):** the degraded-only filter inside `retryDegradedJdtLsSessions` (Plan 02) keeps the typical cost at zero (no degraded projects ⇒ no probing). Worst case is the 36s upper bound on a fresh post-add or post-refresh call when several projects are still degraded — explicitly accepted by D-04.
- **T-37-10 (Repudiation via path leaks in logs):** the only new log lines added in this plan are `logger.warn`/`logger.info` lines inside `retryDegradedJdtLsSessions` itself (already in Plan 02) — the tool handlers do not log Java paths.
- **Trust boundary `tool handler → retry hook`:** no untrusted user input flows into the zero-arg invocation; the sweep reads `projectStore` directly.

## Known Stubs

None — all three handlers are fully wired and functional. The retry call is a no-op when no projects are degraded (Plan 02's filter); when a project is degraded, the sweep derives the project's own `projectRoot` from its first fabric-mod child and reinit's atomically.

## Self-Check: PASSED

**Files verified:**
- FOUND: `src/tools/add-fabric-mod.ts` (109 LOC, `[ -f ]` succeeds)
- FOUND: `src/tools/refresh-project.ts` (166 LOC, `[ -f ]` succeeds)
- FOUND: `src/tools/refresh-project-members.ts` (204 LOC, `[ -f ]` succeeds)

**Commits verified:**
- FOUND: `e6b5fcc` (Task 1 — add_fabric_mod hook)
- FOUND: `f0de62d` (Task 2 — both refresh handlers' hooks)

**Scope guardrails verified:**
- `git diff --name-only dfcfba3..HEAD -- 'src/jdtls/*'` empty — **PASS** (no jdtls/ source touched).
- `git diff --name-only dfcfba3..HEAD -- 'tests/*'` empty — **PASS** (no test files touched, per parallel-execution instruction).
- `git diff --name-only dfcfba3..HEAD -- '.planning/STATE.md' '.planning/ROADMAP.md'` empty at this point — **PASS** (orchestrator owns those writes, per parallel-execution instruction).
