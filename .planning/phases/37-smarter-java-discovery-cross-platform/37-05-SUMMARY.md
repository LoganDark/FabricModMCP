---
phase: 37-smarter-java-discovery-cross-platform
plan: 05
subsystem: jdtls/startup
tags: [gap-closure, cr-01, workspace-sync, retry-hook]
requirements: [JAVA-01]
gap_closure: true
depends_on:
  - 37-04
dependency_graph:
  requires:
    - retryDegradedJdtLsSessions (Plan 02 — initJdtLsSession({ projectRoot }))
    - syncFabricModToWorkspace (existing — workspace-sync.ts:165)
    - jarReader singleton (existing — tools/shared-jar-reader.ts)
  provides:
    - post-rescue fabric-mod workspace re-sync
    - rescued workspace .classpath repopulation
  affects:
    - src/jdtls/startup.ts (retryDegradedJdtLsSessions)
    - tests/jdtls/startup.test.ts (retryDegradedJdtLsSessions describe)
tech_stack:
  added: []
  patterns:
    - per-child try/catch inside an outer try/catch (D-04 swallow-and-log)
    - vi.mock on multiple sibling modules at the top of a test file
key_files:
  created: []
  modified:
    - src/jdtls/startup.ts
    - tests/jdtls/startup.test.ts
decisions:
  - "Emit logger.info('JDT LS reinit succeeded ...') AFTER the sync loop so the success log reflects the fully-rescued (workspace populated) state."
  - "Wrap each per-child syncFabricModToWorkspace call in its own try/catch (inner) — outer try/catch on initJdtLsSession remains as defense-in-depth. Per-child failure does NOT abort the sweep."
  - "Surface result.warning via logger.warn (one log per warned child) — mirrors the canonical caller pattern at add-fabric-mod.ts:74-76."
  - "Mock workspace-sync.js and shared-jar-reader.js with vi.mock at file top — opaque jarReader stub is sufficient because syncFabricModToWorkspace is the only consumer and it is mocked."
metrics:
  duration: "~15 minutes"
  tasks_completed: 2
  files_modified: 2
  tests_added: 4
  tests_total: 854
  completed: "2026-05-16"
---

# Phase 37 Plan 05: Post-Rescue Workspace Re-Sync (CR-01 Gap Closure) Summary

Closed CR-01 from `37-REVIEW.md` / `37-VERIFICATION.md`: `retryDegradedJdtLsSessions` now re-syncs every `fabric-mod` child into the freshly-created workspace after a successful JDT LS rescue, so the rescued session's `.classpath` is repopulated and `find_definition` returns real navigation results without a follow-up `refresh_project` call.

## Tasks Executed

### Task 1 — Wire post-rescue `syncFabricModToWorkspace` (commit `a6db728`)

**File modified:** `src/jdtls/startup.ts`

- Added two named imports alongside the existing module imports:
  - `import { syncFabricModToWorkspace } from './workspace-sync.js';`
  - `import { jarReader } from '../tools/shared-jar-reader.js';`
- Inside `retryDegradedJdtLsSessions`, extended the `if (newSession.available === true)` block to iterate `project.children.values()`, filter `child.kind === 'fabric-mod'`, and `await syncFabricModToWorkspace(child, newSession, jarReader)` for each.
- Wrapped each per-child call in its own try/catch:
  - On throw: `logger.warn('Workspace re-sync failed after JDT LS rescue', { project, child, error: String(err) })`, sweep continues.
  - On `result.warning`: `logger.warn(\`Workspace re-sync after JDT LS rescue for '${child.name}': ${result.warning}\`)`.
- Emit `logger.info('JDT LS reinit succeeded ...')` AFTER the loop completes — the success log now reflects the fully-rescued (workspace populated) state.
- Study-jar children skipped (only fabric-mod children own `dependencyJars` that need workspace extraction).
- Degraded reinits (`newSession.available === false`) skip the sync loop entirely — explicit gate prevents accidental sync on a still-failed session.

**Acceptance criteria checked:**

| AC | Expected | Actual |
|----|----------|--------|
| `grep -c "syncFabricModToWorkspace" src/jdtls/startup.ts` | ≥ 2 | 2 (1 import + 1 call site) |
| `grep -c "from '../tools/shared-jar-reader.js'"` | 1 | 1 |
| `grep -c "from './workspace-sync.js'"` | 1 | 1 |
| `grep -c "kind === 'fabric-mod'"` | ≥ 2 | 2 (per-iter projectRoot derivation + new re-sync loop) |
| call inside `retryDegradedJdtLsSessions` (awk) | ≥ 1 | 1 |
| call inside rescue-success gate (awk) | ≥ 1 | 1 |
| `grep -cE "logger\\.warn.*[Ww]orkspace re-sync"` | ≥ 1 | 2 (throw branch + warning branch) |
| `pnpm tsc --noEmit` | exits 0 | exits 0 |
| `git diff --name-only HEAD -- src/` | `src/jdtls/startup.ts` only | matches |
| `git diff --name-only HEAD -- tests/jdtls/client.test.ts` | empty | empty |

### Task 2 — Cover post-rescue re-sync in `tests/jdtls/startup.test.ts` (commit `687a986`)

**File modified:** `tests/jdtls/startup.test.ts`

- Added two new `vi.mock(...)` blocks at the top alongside the existing `client.js` / `logger.js` mocks:
  - `'../../src/jdtls/workspace-sync.js'` → `{ syncFabricModToWorkspace: vi.fn() }`
  - `'../../src/tools/shared-jar-reader.js'` → `{ jarReader: {} }` (opaque stub — no methods are called from within the sweep)
- Imported the mocked `syncFabricModToWorkspace` and bound it via `vi.mocked()` as `mockSyncFabricModToWorkspace`.
- Added four new `it()` cases inside the existing `describe('retryDegradedJdtLsSessions', ...)` block (after the "skips projects with no jdtls field" case):
  1. **`re-syncs every fabric-mod child after a successful rescue (CR-01)`** — seeds two fabric-mod children + one study-jar; asserts exactly 2 invocations, both with the same reassigned `project.jdtls` reference, child names cover both fabric mods.
  2. **`does NOT call syncFabricModToWorkspace when reinit stays degraded`** — `discoverJava` returns `null`, so `initJdtLsSession` short-circuits to a degraded session; asserts the mock was never called.
  3. **`swallows a per-child sync throw via logger.warn and continues to the next child (D-04)`** — first child throws, second resolves; asserts both children attempted, `mockLoggerWarn` got a "re-sync" message, sweep resolves without throwing.
  4. **`surfaces syncFabricModToWorkspace warnings via logger.warn`** — sync returns `{ synced: true, warning: 'partial extraction skipped 2 entries' }`; asserts `logger.warn` received a call containing the warning text.
- `tests/jdtls/client.test.ts` was NOT modified — Plan 02 shim contract preserved (mandated quality gate).

**Acceptance criteria checked:**

| AC | Expected | Actual |
|----|----------|--------|
| `grep -c "vi\\.mock\\('\\.\\./\\.\\./src/jdtls/workspace-sync\\.js'"` | 1 | 1 |
| `grep -c "vi\\.mock\\('\\.\\./\\.\\./src/tools/shared-jar-reader\\.js'"` | 1 | 1 |
| `grep -c "mockSyncFabricModToWorkspace"` | ≥ 4 | 11 |
| `it()` count inside `describe('retryDegradedJdtLsSessions')` (awk) | ≥ 10 (6 existing + 4 new) | 10 |
| `pnpm tsc --noEmit` | exits 0 | exits 0 |
| `pnpm test tests/jdtls/startup.test.ts` | all green | 18/18 pass |
| `pnpm test` (full suite) | ≥ 854 pass, 0 fail | 854/854 pass |
| `git diff --name-only HEAD -- tests/` | `tests/jdtls/startup.test.ts` only | matches |
| `git diff --name-only HEAD -- tests/jdtls/client.test.ts` | empty | empty |

## Verification (plan-level)

- `pnpm tsc --noEmit` → exits 0.
- `pnpm test tests/jdtls/startup.test.ts tests/jdtls/client.test.ts tests/jdtls/java-discovery.test.ts` → 63 tests pass.
- `pnpm test` (full suite) → 854 tests pass, zero failures.
- `git diff --name-only HEAD~2..HEAD` → `src/jdtls/startup.ts`, `tests/jdtls/startup.test.ts` only.
- Inside `retryDegradedJdtLsSessions`: `project.jdtls = newSession;` → `if (newSession.available === true) {` → `for (const child of project.children.values())` with `if (child.kind !== 'fabric-mod') continue;` → `await syncFabricModToWorkspace(child, newSession, jarReader)` wrapped in try/catch → `logger.info('JDT LS reinit succeeded ...')`.

## Success Criteria

1. `retryDegradedJdtLsSessions` re-syncs every fabric-mod child of each rescued project against the new `JdtLsSession` before returning — verified via code-grep AC + Test 1. ✅
2. Re-sync is gated on `newSession.available === true`; degraded reinits skip the sync loop — verified via Test 2. ✅
3. Per-child sync errors are swallowed via `logger.warn` and do NOT abort the sweep (D-04 contract) — verified via Test 3. ✅
4. `syncFabricModToWorkspace` warnings are surfaced via `logger.warn` — verified via Test 4. ✅
5. Only `src/jdtls/startup.ts` and `tests/jdtls/startup.test.ts` modified; `tests/jdtls/client.test.ts` untouched — verified via `git diff --name-only`. ✅
6. Full test suite remains green (850 prior + 4 new = 854 total). ✅
7. Post-this-plan, the human UAT scenario "Workspace re-sync after JDT LS rescue (CR-01)" can be exercised: after `add_fabric_mod` against a project with a degraded default JDT LS session, `find_definition` returns real navigation results without a second `refresh_project` call. (Manual UAT — requires real JDT LS install; out of scope for autonomous verification.)

## Deviations from Plan

None — both tasks executed exactly as specified.

The task ordering in the plan placed implementation (Task 1) before tests (Task 2), so Task 2 (marked `tdd="true"`) was effectively test-after rather than canonical RED→GREEN. All four new test cases passed on first run against the Task 1 implementation, which is the expected outcome given that Task 1's code already satisfied the asserted behavior. No RED-phase commit was created because the production code (already committed in Task 1) made the tests green from the start.

## Self-Check

- `src/jdtls/startup.ts` exists and contains `syncFabricModToWorkspace` (1 import + 1 call site).
- `tests/jdtls/startup.test.ts` exists and contains 4 new `it()` cases under `describe('retryDegradedJdtLsSessions')`.
- Commit `a6db728` exists in `git log`.
- Commit `687a986` exists in `git log`.

## Self-Check: PASSED
