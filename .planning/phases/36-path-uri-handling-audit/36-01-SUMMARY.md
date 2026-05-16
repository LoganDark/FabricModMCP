---
phase: 36-path-uri-handling-audit
plan: 01
subsystem: platform
tags: [uri, file-url, platform-helper, foundation, windows-support]

requires: []
provides:
  - src/platform/uri.ts (pathToFileUri, fileUriToPath)
affects:
  - Plan 02 (forward URI sweep — 7 sites in src/jdtls/, src/tools/)
  - Plan 03 (uri-mapper case-fold + workspace-sync hardening)
  - Plan 04 (reverse URI sweep — tool-helpers.ts:350)

tech-stack:
  added: []   # No new dependencies — wraps node:url builtins
  patterns:
    - Pure-helper sibling module pattern (Phase 35 carry-forward)
    - Platform-flip + dynamic-import test scaffolding (D-21 carry-forward)
    - Opt-in `{ windows: true }` parameter for cross-host Windows fixtures (A2 mitigation)

key-files:
  created:
    - src/platform/uri.ts
    - tests/platform/uri.test.ts
  modified: []

decisions:
  - "A2 RESOLVED IN FAIL DIRECTION on darwin host: pathToFileURL('C:\\foo') does NOT auto-detect Windows shape; mitigation applied — pathToFileUri signature upgraded to (absPath, opts?: { windows?: boolean })."
  - "Default branch of pathToFileUri unchanged — production callsites continue to work without code changes (host matches path flavor in production)."
  - "isFileUri convenience helper deferred (D-discretion) — no callsite needs it yet."

metrics:
  duration_seconds: ~150
  tasks_completed: 3
  files_created: 2
  files_modified: 0
  tests_added: 7
  total_tests_passing: 800
  completed: "2026-05-16T09:29:41Z"
---

# Phase 36 Plan 01: URI Helper Sibling Module Summary

The new `src/platform/uri.ts` exports two pure helpers — `pathToFileUri(absPath, opts?: { windows?: boolean })` and `fileUriToPath(uri)` — wrapping `node:url`'s `pathToFileURL` / `fileURLToPath`. This is the foundation every downstream plan in Phase 36 (Plans 02, 03, 04) imports from to replace the brittle `'file://' + path` / `uri.replace('file://', '')` pattern.

## Plan Goal

Create `src/platform/uri.ts` (pure module, no fs/child_process/project imports) and `tests/platform/uri.test.ts` covering WIN-03 three-slash form / percent-encoding, UNIX-02 round-trip identity, AND the A2 darwin-host assertion that locks the wrapper signature. **No consumer wiring yet** — that happens in Plans 02, 03, 04.

## What Was Built

### `src/platform/uri.ts` (53 LOC, pure module)

| Export | Signature | Wraps | Purpose |
| ------ | --------- | ----- | ------- |
| `pathToFileUri` | `(absPath: string, opts?: { windows?: boolean }) => string` | `pathToFileURL(p, opts).href` | Path → three-slash `file://` URI |
| `fileUriToPath` | `(uri: string) => string` | `fileURLToPath(u)` | `file://` URI → native path |

File-header docstring mirrors `src/platform/index.ts` (Phase 35 sibling) — purpose declaration + pure-module contract + downstream-consumer enumeration. JSDoc on each function with `@param`/`@returns`. Single named-import from `node:url` only — no fs, no child_process, no project imports.

### `tests/platform/uri.test.ts` (7 it cases, 5 describes)

| Describe | It cases | Validates |
| -------- | -------- | --------- |
| `UNIX-02 round-trip identity` | 3 | `fileUriToPath(pathToFileUri(p)) === p` for `/tmp/foo`, `/private/var/folders/x y/file.java` (space → `%20`), `/tmp/path%with#odd$chars` (literal `%` + `#`) |
| `WIN-03 three-slash form (Windows-mocked)` | 1 | Output starts with `file:///`; URL constructor accepts the result |
| `WIN-03 percent-encoding` | 1 | Spaces become `%20`; no raw space survives after the scheme |
| `A2: host-darwin auto-detection of Windows-shaped paths` | 2 | Host-default fails to auto-detect Windows shape (regression guard) AND `{ windows: true }` opt-in succeeds on any host |

Scaffolding mirrors `tests/platform/index.test.ts` (D-21): `originalPlatform` capture, `setPlatform` helper, `vi.resetModules` + dynamic import, `afterEach` restore.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] A2 darwin-host assumption FAILED — wrapper signature upgraded**

- **Found during:** Task 3
- **Issue:** RESEARCH §A2 flagged a MEDIUM-risk assumption that `pathToFileURL('C:\\foo')` on a darwin host would auto-detect the Windows-shaped input and emit `file:///C:/foo`. Empirically on this host (M4 Max macOS, Node 22, `pathToFileURL` from `node:url`), the assumption does NOT hold — `'C:\\foo'` is parsed as a relative POSIX path, resolved against cwd, and emitted as `file:///<cwd>/C:%5Cfoo`.
- **Fix:** Applied the RESEARCH §A2 mitigation path explicitly anticipated by the plan. Upgraded `pathToFileUri` signature from `(absPath: string) => string` to `(absPath: string, opts?: { windows?: boolean }) => string`. When `opts.windows === true`, delegates to `pathToFileURL(absPath, { windows: true }).href`. Default branch unchanged — production callsites are unaffected (host matches path flavor in production). The A2 test was reshaped from a single must-pass assertion into a pair: a "host-default does NOT auto-detect" regression guard and an "opt-in succeeds" verification.
- **Files modified:** `src/platform/uri.ts`, `tests/platform/uri.test.ts`
- **Commit:** `6d88ba6`
- **Downstream impact (REQUIRED for Plan 03):** Plan 03 Task 2's Windows-mocked fixture-construction sites MUST pass `{ windows: true }` to `pathToFileUri` when synthesizing Windows-shaped URIs for assertion-target prefixes. Plain `pathToFileUri('C:\\Users\\test\\Temp\\xyz')` on darwin CI will produce a cwd-relative URI, not a Windows-flavored one. The drive-letter-case-fold regex `DRIVE_LETTER_URI = /^file:\/\/\/[A-Za-z]:/` in `src/jdtls/uri-mapper.ts` requires the three-slash drive-letter shape — so any test fixture that constructs the expected URI prefix from a Windows-path string must use the `{ windows: true }` opt-in.

## Authentication Gates

None — pure code/test work, no external services.

## Verification

| Check | Result |
| ----- | ------ |
| `pnpm exec tsc --noEmit` | exit 0 (clean) |
| `pnpm exec vitest run tests/platform/uri.test.ts` | 7/7 pass |
| `pnpm exec vitest run` (full suite) | 800/800 pass (793 prior + 7 new) |
| `grep -rn "from '../platform/uri" src/` | empty — no consumer wiring yet |
| Pure-module contract | `grep "from 'node:fs\|node:child_process\|from '\\.\\./" src/platform/uri.ts` returns nothing |

## A2 Outcome Record (per `<output>` requirement)

**A2 FAILED on host darwin. Wrapper upgraded to `pathToFileUri(absPath: string, opts?: { windows?: boolean })` per RESEARCH §A2 mitigation.** Default branch unchanged; opt-in adds Windows-flavor pass-through. Plan 03 picks up the upgrade.

## Deferred Follow-ups

- **`isFileUri(uri: string): boolean` convenience helper not added.** D-discretion explicitly defers this until a callsite needs it. Simplest impl when needed: `uri.startsWith('file://')`. Out of scope until empirically demanded.
- **No further parameterization of `pathToFileURL` beyond `{ windows: true }`.** Node's API also accepts `pathToFileURL` with no extra options today; if a future need arises (e.g., explicit POSIX-flavor opt-in for symmetry), add it then.
- **No `fileUriToPath` opt-in for Windows host on darwin.** `fileURLToPath` already auto-detects URI shape (`file:///C:/foo` round-trips to `C:\foo` only on a Windows host; on darwin it returns `/C:/foo`). The reverse direction is not currently needed cross-host by any planned consumer. Surface if Plan 03/04 hits a snag.

## Threat Surface Scan

No new attack surface introduced. `src/platform/uri.ts` is a pure stdlib wrapper with no external input handling, no fs I/O, no `child_process`. Threat model in PLAN.md `<threat_model>` says `T-36-01-NONE` / `accept` — confirmed.

## Self-Check: PASSED

- `[x]` `src/platform/uri.ts` exists at expected path
- `[x]` `tests/platform/uri.test.ts` exists at expected path
- `[x]` Commit `e3bf822` (feat: uri.ts) present in `git log`
- `[x]` Commit `9e3b67d` (test: UNIX-02 + WIN-03) present in `git log`
- `[x]` Commit `6d88ba6` (test: A2 + wrapper upgrade) present in `git log`
- `[x]` All success criteria from PLAN.md met:
  1. `src/platform/uri.ts` exports `pathToFileUri` and `fileUriToPath` ✓
  2. Module is pure (no fs, no child_process, no project imports) ✓
  3. Tests cover UNIX-02 (≥3 inputs), WIN-03 three-slash, WIN-03 percent-encoding, A2 host-darwin ✓
  4. All tests pass; full suite 800/800 green ✓
  5. No `src/` consumer wiring (deferred to downstream plans) ✓
  6. A2 outcome (FAILED, wrapper upgrade applied) recorded above ✓
