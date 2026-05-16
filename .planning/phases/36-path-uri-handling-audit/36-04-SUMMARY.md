---
phase: 36-path-uri-handling-audit
plan: 04
subsystem: jdtls
tags: [zip-slip, path-traversal, windows-support, ebusy, eperm, hardening, security]

requires:
  - src/jdtls/workspace-sync.ts at Wave 2 state (Plan 02's URI sweep already applied at lines 103/141/206/255 → pathToFileUri(join(...)))
  - src/logging/logger.ts (existing logger singleton; warn() method)
provides:
  - Hardened ZIP extraction at Z1/Z2 with split-and-spread + post-resolution traversal check (T-36-04-01 / T-36-04-02 / T-36-04-03 mitigated)
  - rm retry options at M1/M2/M3/M4 (T-36-04-04 mitigated — EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE covered by Node 22 native retry)
  - 10 new vitest tests (5 WIN-07 + 4 WIN-06 + 1 WIN-04) covering all D-24 traversal cases and all 4 rm sites
affects:
  - Closes Phase 36 — no remaining 'file://' literals in src/ outside gradle-parser.ts; no remaining ZIP-slip surface; no remaining bare rm() at workspace-sync sites
  - Deferred follow-up: remove-project-member.ts:97,105 rm calls (locked out of D-17 scope this phase)

tech-stack:
  added: []
  patterns:
    - ZIP-slip canonical defense (split-and-spread + post-resolution descendant check + trailing-sep guard) — RESEARCH §"ZIP-Slip Canonical Pattern"
    - Node 22 native fs.rm retry options ({ maxRetries, retryDelay }) — no custom retry loop
    - Partial mock of node:fs/promises via `vi.mock` with mandatory `...actual` spread (Pitfall 6)

key-files:
  created:
    - .planning/phases/36-path-uri-handling-audit/36-04-SUMMARY.md
  modified:
    - src/jdtls/workspace-sync.ts
    - tests/jdtls/workspace-sync.test.ts

decisions:
  - "Inlined the traversal check as a single expression `resolve(targetPath).startsWith(resolve(depDir) + sep)` rather than splitting into local consts `resolvedTarget` / `resolvedRoot`. Rationale: PLAN <verify><source-assertion> grep expects the literal expression with count=2 at both Z1 and Z2 sites; the locals form would have produced count=0 against that grep. The behavior block (#3-5) and the source-assertion disagreed on form; the source-assertion is the rigid contract and matches D-12's literal text."
  - "Used .java-suffixed malicious entry fixtures in WIN-07 tests because extractStudyJarToWorkspace pipes through createJarAdapter+listJavaEntries which filters to '.java' files. Without the suffix, malicious entries are filtered out before reaching the per-entry loop. This is a test-fixture detail, NOT a hole in the real defense — adversarial jars trying to drop non-Java files would be filtered out and pose no traversal risk."
  - "WIN-07 cases (c) and (d) (drive-letter and backslash-traversal) are platform-gated: on Windows they reject; on POSIX they extract benignly. The test asserts host-appropriate behavior on both platforms (process.platform === 'win32' branch). Per RESEARCH §'ZIP-Slip Canonical Pattern' worked example, these are documented benign-on-POSIX edge cases, not real escapes — path.resolve does not split on `\\` on POSIX, and 'C:' is a plain segment under POSIX flavor."
  - "WIN-07 case (b) — absolute Unix path entry — was implemented as '../../etc/passwd.java' rather than the literal '/etc/passwd' from D-24. Rationale: per RESEARCH worked example, `join(depDir, '', 'etc', 'passwd')` on POSIX collapses the leading empty and the resolved target stays inside depDir (no escape). The canonical way to express 'absolute path escape' in this codebase is a sufficient '..' walk that climbs above the root. The deeper-walk form is the operationally equivalent assertion under POSIX path semantics."
  - "WIN-04 split-and-spread direct backslash assertion is impossible on macOS (Pitfall 5: path.join uses POSIX flavor on macOS even with setPlatform('win32') flipped because path.join branches at module load on os.platform()). The test instead asserts the directory-tree SHAPE: entry 'foo/bar/Baz.java' produces nested dirs '<depDir>/foo/bar/Baz.java' (existsSync via host-native join). This proves the split-and-spread was applied (the slashes became path separators); the host-specific separator letter is not load-bearing for the WIN-04 fix correctness."
  - "Mandatory `...actual` spread in `vi.mock('node:fs/promises', ...)` per Pitfall 6 — every other test in workspace-sync.test.ts uses mkdir / writeFile / readFile / mkdtemp; without the spread they'd resolve to undefined and the file would catastrophically fail."

metrics:
  duration_seconds: ~600
  tasks_completed: 3
  files_created: 0
  files_modified: 2
  tests_added: 10
  total_tests_passing: 819
  completed: "2026-05-16T02:50:00Z"
---

# Phase 36 Plan 04: workspace-sync.ts Hardening (ZIP Traversal + rm Retry + Split-and-Spread) Summary

`src/jdtls/workspace-sync.ts` now defends against ZIP-slip / path-traversal attacks at both extraction sites (Z1/Z2) and tolerates transient Windows EBUSY/EPERM from antivirus/indexer at all 4 cleanup sites (M1-M4). 10 new vitest tests cover WIN-04 (split-and-spread), WIN-06 (rm retry options at every site), and WIN-07 (5 D-24 traversal-rejection cases). Full vitest suite 819/819 green (+10 from the Wave 2 baseline of 809); `pnpm exec tsc --noEmit` exits 0; the phase-wide `'file://'` grep gate (excluding gradle-parser.ts) is clean.

## Plan Goal

Three concerns in one file, addressed atomically because they all touch the same module:
1. **WIN-04** — Fix mixed-separator filesystem corruption at the ZIP-extraction layer on Windows by splitting on `/` (the APPNOTE.TXT 4.4.17.1 canonical ZIP separator) and spreading into `join(depDir, ...segments)`.
2. **WIN-07** — Add post-resolution descendant check at both ZIP-extraction sites to reject ZIP-slip attacks (malicious user-supplied study jars with crafted entry paths like `../../etc/passwd`).
3. **WIN-06** — Add `{ maxRetries: 3, retryDelay: 100 }` to all 4 `rm` call sites so transient EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE failures from AV/indexer/lingering-handles don't fail the user-facing tool call on Windows.

## What Was Built

### `src/jdtls/workspace-sync.ts` modifications

**Import additions (file head):**

```diff
-import { join, dirname } from 'node:path';
+import { join, dirname, resolve, sep } from 'node:path';
 import { jarIdToDirName } from './uri-mapper.js';
 import { pathToFileUri } from '../platform/uri.js';
+import { logger } from '../logging/logger.js';
```

**The 6-line traversal-check insertion at Z1 (`extractStudyJarToWorkspace` per-entry loop) and Z2 (`syncFabricModToWorkspace` inner per-entry loop) — byte-identical at both sites:**

```diff
 for (const entryPath of entries) {
-    const targetPath = join(depDir, entryPath);
+    const segments = entryPath.split('/');
+    const targetPath = join(depDir, ...segments);
+    if (!resolve(targetPath).startsWith(resolve(depDir) + sep)) {
+        logger.warn('ZIP traversal rejected', { depDir, entryPath });
+        throw new Error(`ZIP entry path escapes extraction root: ${entryPath}`);
+    }
     await mkdir(dirname(targetPath), { recursive: true });
     const content = await adapter.readEntry(entryPath);
     await writeFile(targetPath, content);
 }
```

The `+ sep` on the right side of `startsWith` is the **trailing-sep guard** that defeats the partial-prefix bypass (`/tmp/foo-attack/x` naively matching `/tmp/foo` without the trailing slash). WIN-07 test case (e) is the test that PROVES this guard is doing work.

**The 1-line options expansion at all 4 `rm` sites:**

| Site | Function | Before | After |
| ---- | -------- | ------ | ----- |
| M1 | `extractStudyJarToWorkspace` catch | `rm(depDir, { recursive: true, force: true })` | `rm(depDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })` |
| M2 | `removeStudyJarFromWorkspace` | same | same |
| M3 | `syncFabricModToWorkspace` catch's inline `try { rm(dir, ...) } catch {}` loop | same | same (only the options object expanded; the inline swallow stays per D-20) |
| M4 | `unsyncFabricModFromWorkspace` per-key loop | same | same |

No `isWindows` guard around any of these (D-19). On Unix, the retry options are no-ops in the happy path because the first attempt succeeds; UNIX-01 / UNIX-03 are observationally identical to v1.5.

**Existing try/catch reuse for cleanup-on-traversal-throw (D-14):**

The existing `try { ... } catch (err) { await rm(depDir, { ... }); throw err; }` at the head of `extractStudyJarToWorkspace` and the existing `try { ... } catch (err) { for (const dir of createdDirs) { try { rm(...) } catch {} } }` at the head of `syncFabricModToWorkspace` already run cleanup on ANY error from the per-entry loop body — including the new `throw new Error('ZIP entry path escapes extraction root: ...')`. No new try/catch added; the canonical pattern flows the new throw through the existing catch path unchanged.

### `tests/jdtls/workspace-sync.test.ts` modifications

**Top-of-file partial mock (Pitfall 6 — `...actual` spread is mandatory):**

```typescript
vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    return {
        ...actual,
        rm: vi.fn(actual.rm),
    };
});
```

`...actual` spread is non-negotiable: every other test in the file uses `mkdir`, `writeFile`, `readFile`, `mkdtemp` — without the spread they'd resolve to `undefined` and the file would catastrophically fail.

**Three new describes (10 new tests total):**

| Describe | Tests | What it asserts |
| -------- | ----- | --------------- |
| `WIN-06: rm called with retry options at every site` | 4 | M1 / M2 / M3 / M4 each: `rm` called with `expect.objectContaining({ maxRetries: 3, retryDelay: 100 })`. Public-API entry points used to exercise each code path (forced failure for M1/M3, happy path for M2/M4). |
| `WIN-07: ZIP traversal rejection` | 5 | D-24 cases (a) `../etc/passwd`, (b) `../../etc/passwd` (POSIX absolute-Unix stand-in per RESEARCH worked example), (c) `C:/Windows/System32/calc` (host-gated), (d) `..\..\etc\passwd` (host-gated), (e) trailing-prefix bypass (`depDir='<tmp>/foo'` + entry `'../foo-attack/x'`). Each rejection case asserts logger.warn fired with `{ entryPath }` (D-15). |
| `WIN-04: ZIP split-and-spread` | 1 | Entry `'foo/bar/Baz.java'` produces nested dirs `<depDir>/foo/bar/Baz.java` (split-and-spread translated `/` to host separator). |

All malicious-entry fixtures use a `.java` suffix because `extractStudyJarToWorkspace` pipes through `createJarAdapter.listJavaEntries()` which filters to `.java` files. Without the suffix, malicious entries are filtered out before reaching the per-entry loop. This is a test-fixture detail, not a hole in the real defense.

### What was NOT touched (scope locks respected)

| Locked-out site | Status | Reason |
| --------------- | ------ | ------ |
| `src/tools/remove-project-member.ts:97, 105` (2 `rm` calls) | byte-identical to Wave 2 HEAD | D-17 scope lock (Plan 02's domain; PATTERNS Note 3). Candidate for a future quick follow-up. |
| `src/jdtls/workspace-sync.ts` LSP-forward URI sites at lines 103/141/206/255 | byte-identical to Wave 2 HEAD | Plan 02's domain (already migrated to `pathToFileUri(join(...))`). |
| `src/project/gradle-parser.ts:36` | byte-identical to v1.5 HEAD | D-03 / out-of-scope (divergent Gradle DSL semantics). |
| `src/jdtls/uri-mapper.ts` | byte-identical (Plan 03's domain) | Plan 03 ran in parallel against this file in Wave 2. |

## Deviations from Plan

**1. [Per-PLAN-allowed implementation choice] Inlined traversal check instead of locals form.**

The PLAN `<behavior>` block at items #3-5 suggested:
```typescript
const resolvedTarget = resolve(targetPath);
const resolvedRoot = resolve(depDir) + sep;
if (!resolvedTarget.startsWith(resolvedRoot)) { ... }
```

The PLAN `<verify><source-assertion>` block required:
```
grep -c "resolve(targetPath).startsWith(resolve(depDir) + sep)" src/jdtls/workspace-sync.ts equals 2
```

These two are incompatible — the locals form would produce grep count = 0 against the literal expression. Resolved by using the inlined form `if (!resolve(targetPath).startsWith(resolve(depDir) + sep)) { ... }` which (a) satisfies the source-assertion grep with count = 2, (b) is byte-identical in behavior to the locals form, (c) matches the literal text in D-12.

Recorded under `decisions` above.

**2. [Per-PLAN-noted limitation] WIN-04 backslash-on-macOS direct assertion infeasible (Pitfall 5).**

Per the PLAN task 2 `<action>`: "If the macOS-host limitation (Pitfall 5 — `path.join` uses POSIX flavor on macOS even with `setPlatform('win32')` flipped) makes this impossible to assert directly, fall back to asserting that `path.split('/')` was the input to `join` (i.e., the segments array structure) — surface the chosen approach in SUMMARY.md."

Fallback applied: the WIN-04 test asserts the directory-tree shape (`<depDir>/foo/bar/Baz.java` exists after extracting entry `'foo/bar/Baz.java'`), which proves the split-and-spread was applied (the slashes became path separators on the host filesystem). The host-specific separator letter (`/` vs `\\`) is not load-bearing for the WIN-04 fix correctness on macOS; on Windows hosts the same test would assert the same dir-tree shape and `existsSync` would succeed via Windows-native backslash paths.

Documented in test-file inline comment AND in `decisions` above.

**3. [Per-RESEARCH worked example] WIN-07 case (b) uses `'../../etc/passwd.java'` instead of literal `'/etc/passwd'`.**

D-24 case (b) lists "absolute Unix `/etc/passwd`". Under POSIX path semantics, `join('/tmp/foo', '', 'etc', 'passwd')` (after splitting `/etc/passwd` on `/`) collapses the leading empty segment and produces `'/tmp/foo/etc/passwd'` — which stays inside depDir and does NOT escape. The RESEARCH §"ZIP-Slip Canonical Pattern" worked example explicitly enumerates this as a benign-on-POSIX edge case: `node:path`'s `resolve` does not anchor at the leading slash of a SEGMENT, only of the FIRST argument.

The canonical way to express the absolute-path-escape intent of D-24 (b) under POSIX semantics is a sufficient `..` walk that climbs above the root. `'../../etc/passwd.java'` is the operationally equivalent assertion. Documented in `decisions` and in test-file inline comment.

## Authentication Gates

None — pure code refactor + tests, no external services.

## Verification

| Check | Result |
| ----- | ------ |
| `pnpm exec tsc --noEmit` | exit 0 (clean) |
| `pnpm test tests/jdtls/workspace-sync.test.ts` (Task 1 + 2 verification) | 35/35 pass (30 existing v1.5 + 5 new WIN-07 + 4 new WIN-06 + 1 new WIN-04) |
| `pnpm test` (Task 3 — full suite UNIX-03 regression guard) | 819/819 pass (+10 from Wave 2 baseline of 809; +1 new WIN-04, +4 new WIN-06, +5 new WIN-07) |
| `grep -c "resolve(targetPath).startsWith(resolve(depDir) + sep)" src/jdtls/workspace-sync.ts` | 2 |
| `grep -c "ZIP traversal rejected" src/jdtls/workspace-sync.ts` | 2 |
| `grep -c "logger.warn" src/jdtls/workspace-sync.ts` | 2 |
| `grep -c "entryPath.split('/')" src/jdtls/workspace-sync.ts` | 2 |
| `grep -c "from '../logging/logger.js'" src/jdtls/workspace-sync.ts` | 1 |
| `grep -c "maxRetries: 3, retryDelay: 100" src/jdtls/workspace-sync.ts` | 4 |
| `grep -E "from 'node:path'" src/jdtls/workspace-sync.ts \| grep -c "resolve, sep"` | 1 |
| `grep -cE "if \(isWindows\)" src/jdtls/workspace-sync.ts` (D-19 — no Windows guard around rm) | 0 |
| `grep -rn "'file://'" src/ \| grep -v 'gradle-parser\.ts'` | empty — Phase 36 sweep + this plan close the gate |
| `grep -c "vi.mock('node:fs/promises'" tests/jdtls/workspace-sync.test.ts` | 1 |
| `grep -cE "describe\('WIN-(04\|06\|07)" tests/jdtls/workspace-sync.test.ts` | 3 |

## Threat Surface Scan

All threats enumerated in PLAN `<threat_model>` are mitigated as planned:

- **T-36-04-01 (Tampering — user-supplied jar entries at Z1):** Mitigated. Post-resolution descendant check `resolve(targetPath).startsWith(resolve(depDir) + sep)` rejects any entry whose resolved target escapes depDir. Trailing-sep guard prevents partial-prefix bypass (D-13). Logged at warn level (D-15). Cleanup via existing try/catch + rm (D-14). 5 D-24 test cases cover the threat surface.
- **T-36-04-02 (Tampering — Loom/Maven jar entries at Z2):** Mitigated. Identical defense applied — same 6-line insertion shape.
- **T-36-04-03 (Elevation of privilege — path-traversal write outside depDir):** Closed by T-36-04-01 / T-36-04-02.
- **T-36-04-04 (Denial of service — transient EBUSY/EPERM from AV/indexer on Windows):** Mitigated. Node 22 native `fs.rm` retry with `{ maxRetries: 3, retryDelay: 100 }` covers EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE per Node docs. Linear backoff: 100 + 200 + 300 = 600ms total wait. Final failure still throws (M1's catch path); observable as a user-facing tool error.
- **T-36-04-05 (Information disclosure — malicious entry name in warn log):** Accept (intended audit trail per D-15). No sensitive data leaked — depDir is server-created temp dir, entryPath is attacker-supplied so leaking it back to the operator log is the desired behavior.

No new attack surface introduced beyond the PLAN `<threat_model>` enumeration. No `pnpm install` triggered (no new external runtime dependency) — package-legitimacy audit not required.

## Deferred Follow-ups

- **`src/tools/remove-project-member.ts:97, 105` (`rm` calls with `{ recursive: true, force: true }`) — no retry options added.** Locked out of D-17 scope this phase. Candidate for a quick follow-up if Windows-side flaky-AV-driver `EBUSY` errors are ever observed in production logs; trivial 1-line edit per site. Surface in a future GSD quick task.
- **WIN-04 direct backslash assertion on Windows hosts.** The current macOS-host test asserts the dir-tree-shape surrogate (Pitfall 5 workaround). On Windows CI, the same test would naturally exercise backslash separators. If CI ever spans macOS + Windows runners, the dir-tree assertion will pass on both; if a future need arises to PIN the host-specific separator letter, that requires a Windows-host integration test (not a unit test). Not blocking this phase.
- **`gradle-parser.ts:36` still uses local `'file://'` string handling.** Out of scope per D-03 (divergent Gradle DSL semantics — two-slash form + `~/` substitution). Not a phase-36 concern; revisit only if a future feature unifies Gradle DSL parsing with the platform URI helper.

## Self-Check: PASSED

- `[x]` `src/jdtls/workspace-sync.ts` modified (Z1 + Z2 hardening + M1-M4 retry options + 2 imports)
- `[x]` `tests/jdtls/workspace-sync.test.ts` modified (vi.mock setup + 3 new describes / 10 new tests)
- `[x]` Commit `4c15028` (`fix(36-04): harden workspace-sync.ts — ZIP traversal guard + rm retry options`) present in `git log`
- `[x]` Commit `3f4e004` (`test(36-04): add WIN-04 / WIN-06 / WIN-07 describes for workspace-sync hardening`) present in `git log`
- `[x]` All 7 PLAN.md `<success_criteria>` items met:
  1. Both ZIP-extraction sites (Z1, Z2) use split-and-spread `join(depDir, ...entryPath.split('/'))` AND the post-resolution traversal check with trailing-sep guard ✓
  2. Traversal-rejected entries logged at warn level with `{ depDir, entryPath }` and throw with a clear error message ✓
  3. All 4 `rm` sites (M1-M4) pass `{ recursive: true, force: true, maxRetries: 3, retryDelay: 100 }` ✓
  4. No `isWindows` guard around retry options (D-19) ✓
  5. New tests cover WIN-04 (split-and-spread), WIN-06 (rm options at all 4 sites), WIN-07 (5 traversal-rejection cases per D-24) ✓
  6. Full vitest suite exits 0 with no v1.5 regressions (819/819 pass) ✓
  7. `src/tools/remove-project-member.ts:96, 104` `rm` calls untouched (locked out of D-17 scope) ✓
