---
phase: 36-path-uri-handling-audit
plan: 02
subsystem: jdtls,tools
tags: [uri, file-url, windows-support, lsp-boundary, refactor, sweep]

requires:
  - src/platform/uri.ts (Plan 01 — pathToFileUri / fileUriToPath)
provides:
  - 7 forward LSP-send sites converted to pathToFileUri(...)
  - 1 reverse LSP-receive site converted to fileUriToPath(...) inside try/catch
  - WIN-04 LSP-URI Pitfall 1 mitigation (join before pathToFileUri at all 4 workspace-sync sites)
affects:
  - Plan 03 (uri-mapper.ts — Plan 02 deliberately left `uriMapper.fromFileUri(loc.uri)` at tool-helpers.ts:347 untouched)
  - Plan 04 (still owns the ZIP-extract Pitfall 1 cases — workspace-sync entry-extraction sites Z1/Z2 unchanged)

tech-stack:
  added: []
  patterns:
    - Forward-sweep mechanical refactor (one-token swaps + import addition)
    - Defensive try/catch widening for LSP-receive boundary (Open Question 4 RESOLVED)

key-files:
  created: []
  modified:
    - src/jdtls/client.ts
    - src/jdtls/workspace-sync.ts
    - src/tools/remove-project-member.ts
    - src/tools/tool-helpers.ts

decisions:
  - "Chose the 'tight new try/catch immediately above the cache lookup' shape for the tool-helpers.ts:350 widening (the canonical example shape from PLAN <action>), not 'merge into existing try'. Rationale: keeps the fileUriToPath conversion's failure mode visually adjacent to the `if (!mapping) continue;` short-circuit pattern at line 348 — they read as a sequence of three skip-this-location guards (mapping check, uri-convert check, file-read check) rather than entangling URI parsing with file I/O inside one try."
  - "No v1.5 test expectations needed updating. The D-25 two-slash → three-slash wire change is observationally identical on Unix (`'file://' + '/abs'` already produces `file:///abs`), and no existing test pinned the Windows two-slash literal."

metrics:
  duration_seconds: ~120
  tasks_completed: 3
  files_created: 0
  files_modified: 4
  tests_added: 0
  total_tests_passing: 800
  completed: "2026-05-16T02:36:00Z"
---

# Phase 36 Plan 02: Forward + Reverse URI Sweep Summary

7 forward `'file://' + path` constructions across `src/jdtls/client.ts`, `src/jdtls/workspace-sync.ts`, and `src/tools/remove-project-member.ts` are now `pathToFileUri(...)` calls — three-slash form on the wire (WIN-03). The 1 reverse consumer at `src/tools/tool-helpers.ts:350` is now `fileUriToPath(loc.uri)` inside a defensive try/catch (RESEARCH Open Question 4 RESOLVED). Full vitest suite 800/800 green — UNIX-03 regression guard satisfied.

## Plan Goal

Mechanical sweep of all 8 `'file://'` boundary sites identified in 36-RESEARCH §Site List Verification to the Plan 01 helper module. No behavioral change beyond (a) the D-25 documented two-slash → three-slash wire shape (Windows-only observable difference) and (b) defensive `continue` past malformed LSP `Location.uri` values instead of crashing the navigation loop.

## What Was Built

### Forward sweep (7 sites, 4 new imports)

| File | Sites | Transformation |
| ---- | ----- | -------------- |
| `src/jdtls/client.ts` | 2 (`rootUri`, `workspaceFolders[0].uri` at initialize) | `'file://' + workspaceDir` → `pathToFileUri(workspaceDir)` |
| `src/jdtls/workspace-sync.ts` | 4 (didChangeWatchedFiles classpath notifications) | `'file://' + resolvedTempDir + '/.classpath'` → `pathToFileUri(join(resolvedTempDir, '.classpath'))` — `join` eliminates mixed-separator strings (WIN-04 LSP-URI Pitfall 1) |
| `src/tools/remove-project-member.ts` | 1 (didChangeWatchedFiles classpath notification in fabric-mod removal branch) | same `join`-then-`pathToFileUri` pattern |

All 4 affected files now import from `../platform/uri.js`.

### Reverse sweep (1 site, 1 try-block addition)

`src/tools/tool-helpers.ts` `processNavigationLocations` loop body before/after:

```
const filePath = loc.uri.replace('file://', '');     ← REMOVED
let source = sourceCache.get(filePath);
```

→

```
let filePath: string;
try {
    filePath = fileUriToPath(loc.uri);
} catch {
    continue;
}
let source = sourceCache.get(filePath);
```

The new tight try/catch with `continue` in its catch path mirrors the existing `if (!mapping) continue;` short-circuit one line above (line 347/348) — a malformed `Location.uri` from JDT LS is now treated like a missing jar mapping or a failed `readFile`: skip this location, continue processing the rest. Mitigates threat **T-36-02-01 (Tampering/DoS)** per the plan's `<threat_model>`.

The neighboring `uriMapper.fromFileUri(loc.uri)` call at line 347 is **deliberately untouched** — Plan 03 owns `src/jdtls/uri-mapper.ts`.

## Scope Locks Respected

| Locked-out site | Status | Reason |
| --------------- | ------ | ------ |
| `src/project/gradle-parser.ts:36` | byte-identical to HEAD | D-03 / out-of-scope (divergent Gradle-DSL semantics — two-slash `file://` + `~/` substitution) |
| `src/tools/remove-project-member.ts` lines 96/104 of HEAD (the two `rm` calls, now lines 97/105 after the import addition) | byte-identical to HEAD | D-17 scope lock — no `maxRetries` or other retry options added; PATTERNS Note 3 |
| `src/jdtls/uri-mapper.ts` | untouched (Plan 03 owns it) | Concurrent worktree-agent runs Plan 03 against this file |
| ZIP-extract Pitfall 1 sites in `workspace-sync.ts` extraction loops | untouched (Plan 04 owns them) | The 4 sites this plan touched are LSP-URI-side; ZIP-extract sites Z1/Z2 are entry-extraction-side |

Source assertions confirming these locks:

```
$ git diff fb8e662..HEAD -- src/project/gradle-parser.ts
(empty — byte-identical)

$ git diff fb8e662..HEAD -- src/tools/remove-project-member.ts | grep -E "^[+-].*rm\("
(no rm-call lines in diff — UNTOUCHED)

$ grep -rn "'file://'" src/ | grep -vE 'gradle-parser\.ts|uri-mapper\.ts'
(none)
```

## Deviations from Plan

None — plan executed exactly as written. The PLAN's `<action>` for Task 2 explicitly offered two equivalent shapes for the tool-helpers.ts widening (new tight try/catch vs merging into the existing try); I chose the new-tight-try/catch shape and recorded the rationale in `decisions` above. This is a per-PLAN-allowed implementation choice, not a deviation.

## Authentication Gates

None — pure code refactor, no external services.

## Verification

| Check | Result |
| ----- | ------ |
| `pnpm exec tsc --noEmit` | exit 0 (clean) |
| `pnpm exec vitest run tests/jdtls/client.test.ts tests/tools/remove-project-member.test.ts` (Task 1) | 30/30 pass |
| `pnpm exec vitest run tests/jdtls/workspace-sync.test.ts tests/tools/{find-definition,find-references,find-implementations}.test.ts` (Task 2 — tool-helpers exercised via consumers) | 54/54 pass |
| `pnpm test` (Task 3 — full suite UNIX-03 regression guard) | 800/800 pass (same total as Plan 01 baseline) |
| `grep -rn "'file://'" src/ \| grep -vE 'gradle-parser\.ts\|uri-mapper\.ts'` | empty — forward/reverse sweep concern closed for this plan |
| `grep -c "from '../platform/uri.js'" src/tools/*.ts src/jdtls/*.ts` | 4 new consumers (client.ts, workspace-sync.ts, remove-project-member.ts, tool-helpers.ts) |
| `awk '/fileUriToPath\(loc\.uri\)/{found=1} found && /catch[^A-Za-z]/{print "ENCLOSED"; exit}' src/tools/tool-helpers.ts` | `ENCLOSED` (RESEARCH Open Question 4 RESOLVED compliance) |
| `grep -c "pathToFileUri(join(resolvedTempDir, '.classpath'))" src/jdtls/workspace-sync.ts` | 4 (WIN-04 LSP-URI Pitfall 1 fix at all 4 sites) |

## Threat Surface Scan

No new attack surface introduced beyond what the PLAN `<threat_model>` already enumerated:

- **T-36-02-01 (Tampering/DoS, mitigate):** `fileUriToPath(loc.uri)` at `tool-helpers.ts:350` is enclosed in a try/catch whose catch is `continue`. A malformed JDT LS `Location.uri` no longer aborts the entire navigation result loop — the offending location is skipped. **Mitigated as planned.**
- **T-36-02-02 (Tampering, accept):** All 7 forward sites construct URIs from server-controlled paths (workspace directory; `realpathSync`-resolved temp dir). No external input crosses these boundaries in this plan. **Accept disposition unchanged.**

No `pnpm install` was run in this plan — package legitimacy audit not triggered.

## Deferred Follow-ups

- **`remove-project-member.ts:97,105` (`rm` with `{ recursive: true, force: true }`) — no retry options added.** Locked out of D-17 scope. Candidate for a future quick follow-up if Windows-side flaky-AV-driver `EBUSY` errors are ever observed in production logs; trivial to add `maxRetries: 5, retryDelay: 100` to both calls. Surface in a future GSD quick task.
- **`gradle-parser.ts:36` still uses local `'file://'` string handling.** Out of scope per D-03 (divergent Gradle DSL semantics — two-slash form + `~/` substitution). Not a phase-36 concern; revisit only if a future feature unifies Gradle DSL parsing with the platform URI helper.
- **`uriMapper.fromFileUri(loc.uri)` at `tool-helpers.ts:347` is the next thing Plan 03 wires into.** Plan 03 may want to widen the same try/catch one line higher to defensively `continue` on `fromFileUri` returning a malformed result — but that is a Plan 03 design decision, not a Plan 02 deferred item.

## Self-Check: PASSED

- `[x]` `src/jdtls/client.ts` modified (1 import + 2 use sites)
- `[x]` `src/jdtls/workspace-sync.ts` modified (1 import + 4 use sites)
- `[x]` `src/tools/remove-project-member.ts` modified (1 import + 1 use site)
- `[x]` `src/tools/tool-helpers.ts` modified (1 import + 1 use site inside new try/catch)
- `[x]` Commit `0b5b3ca` (refactor: Task 1 — client.ts + remove-project-member.ts) present in `git log`
- `[x]` Commit `4a628f8` (refactor: Task 2 — workspace-sync.ts + tool-helpers.ts) present in `git log`
- `[x]` All 5 success criteria from PLAN.md met:
  1. 7 forward `'file://' + path` → `pathToFileUri(...)` ✓
  2. 1 reverse `uri.replace('file://', '')` → `fileUriToPath(...)` enclosed in try/`continue` ✓
  3. All 4 workspace-sync sites use `join(resolvedTempDir, '.classpath')` ✓
  4. `gradle-parser.ts` and `remove-project-member.ts:97,105` (post-import line shift; HEAD lines 96/104) byte-identical to HEAD ✓
  5. `pnpm test` exits 0 (800/800) ✓
