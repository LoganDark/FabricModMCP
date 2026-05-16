---
phase: 36-path-uri-handling-audit
plan: 03
subsystem: jdtls
tags: [uri, drive-letter, case-fold, windows-support, jar-mapper]

requires:
  - 36-01 (src/platform/uri.ts pathToFileUri + { windows: true } opt-in)
provides:
  - src/jdtls/uri-mapper.ts (createUriMapper with drive-letter case-fold + three-slash toFileUri)
affects:
  - src/tools/find-references.ts (consumer of UriMapper — observationally unchanged on Unix)
  - src/tools/find-definition.ts (idem)
  - src/tools/find-implementations.ts (idem)
  - src/tools/read-member.ts (idem)
  - src/tools/resolve-symbol-position.ts (idem)
  - src/tools/type-hierarchy.ts (idem)
  - src/tools/search-symbols.ts (idem)
  - src/tools/list-members.ts (idem)

tech-stack:
  added: []
  patterns:
    - Surgical drive-letter case-fold state machine (Phase 36 RESEARCH §"Drive-Letter Case-Fold Logic")
    - Platform-flip + dynamic-import test scaffolding (D-21 — Phase 35 carry-forward)
    - { windows: isWindows } pass-through to pathToFileUri (Plan 01 §A2 mitigation cascade)

key-files:
  created: []
  modified:
    - src/jdtls/uri-mapper.ts
    - tests/jdtls/uri-mapper.test.ts

decisions:
  - "Open Landmine 8 resolved YES (RESEARCH recommendation): toFileUri internally adopts pathToFileUri(normalizedTempDir, { windows: isWindows }) so emitted URIs are three-slash drive-letter form on Windows-flavor, which is the shape the new DRIVE_LETTER_URI regex matches."
  - "Plan 01 §A2 was resolved IN FAIL DIRECTION; this plan threads `{ windows: isWindows }` through every call site that builds a Windows-flavor URI on a non-Windows host (the SUT's internal prefix construction)."
  - "D-10 pure-string-compare honored: removed the pre-existing realpathSync(tempDir) symlink resolution. Callers in src/tools/* pass the same jdtls.tempDir value JDT LS receives via rootUri, so JDT LS's response URIs share the shape with our prefix — no canonical-path probe needed."
  - "UNIX-02 round-trip preserved: pathToFileUri('/path') produces 'file:///path', byte-identical to the prior `'file://' + path` concat on POSIX inputs. All 28 pre-existing uri-mapper tests still green."

metrics:
  duration_seconds: ~310
  tasks_completed: 2
  files_created: 0
  files_modified: 2
  tests_added: 9
  total_tests_passing: 809
  completed: "2026-05-16T09:39:48Z"
---

# Phase 36 Plan 03: uri-mapper Drive-Letter Case-Fold + toFileUri Migration Summary

`src/jdtls/uri-mapper.ts` gains a surgical Windows-only drive-letter case-fold in `fromFileUri` (the `prefixMatches` state machine — only byte 8 case-folded, every other byte byte-exact) and simultaneously migrates `toFileUri`'s URI emission to `pathToFileUri(normalizedTempDir)` so the on-the-wire URI is three-slash drive-letter form on Windows — the only shape `DRIVE_LETTER_URI = /^file:\/\/\/[A-Za-z]:/` matches.

## Plan Goal

Add drive-letter case-fold to `fromFileUri` (WIN-05) without leaking case-fold semantics into UNC URIs, DOS device URIs, jar-entry path tails, or any Unix URI (D-09 / D-11). Keep UNIX-02 round-trip byte-identical. Use pure string compare per D-10 (no `fs.realpath`, no `GetFinalPathNameByHandle`).

## What Was Built

### `src/jdtls/uri-mapper.ts` (modified)

| Change | Where | Purpose |
| ------ | ----- | ------- |
| New imports | top of file | `isWindows` from `../platform/index.js`, `pathToFileUri` from `../platform/uri.js` |
| `DRIVE_LETTER_URI` regex | module level | `/^file:\/\/\/[A-Za-z]:/` — anchored three-slash drive-letter shape; UNC/DOS device/Unix URIs do NOT match |
| `baseUri` + `prefix` | inside `createUriMapper` | `const baseUri = pathToFileUri(normalizedTempDir, { windows: isWindows })`; `const prefix = \`${baseUri}/\`` — single source of truth for the URI prefix shape |
| `prefixMatches(uri, prefix)` | inside `createUriMapper` | Windows branch: head bytes 0–7 byte-exact, byte 8 case-fold, bytes 9..prefix.length byte-exact. Else branch: `uri.startsWith(prefix)` byte-exact. |
| `toFileUri` body | inside `createUriMapper` | Emits `${baseUri}/${dirName}/${entryPath}` — three-slash form on Windows-flavor |
| `fromFileUri` body | inside `createUriMapper` | Replaces `if (!uri.startsWith(prefix)) return null;` with `if (!prefixMatches(uri, prefix)) return null;` |
| `realpathSync` removed | top of file + body | D-10 — pure string compare, no symlink-resolving API |

The `{ windows: isWindows }` opt-in to `pathToFileUri` is the Plan 01 §A2 cascade: on a darwin host with `process.platform === 'win32'` mocked (vitest tests), the host's POSIX-flavor `pathToFileURL` would treat `'C:\\…'` as a relative POSIX path and emit `file:///<cwd>/C:%5C…`. The explicit `{ windows: true }` forces Node into Windows-flavor mode regardless of host. In production the flag is redundant — when the host is Windows, host-detection already matches the path flavor.

### `tests/jdtls/uri-mapper.test.ts` (modified)

Scaffolding added at file top:

- Expanded vitest import to include `vi` and `afterEach`.
- `originalPlatform` capture, `setPlatform` helper, `afterEach` restore — mirrors Phase 35's `tests/platform/index.test.ts` pattern (D-21).

5 new describes appended at end of file (9 new it cases):

| Describe | It cases | Validates |
| -------- | -------- | --------- |
| `Windows: fromFileUri accepts uppercase or lowercase drive letter` | 2 | Both `file:///C:/…` and `file:///c:/…` round-trip to `{ jar, entryPath }` against an uppercase-stored prefix (WIN-05 motivating case) |
| `Windows: fromFileUri rejects different drive letter` | 2 | `file:///D:/…` and `file:///d:/…` both return `null` against a C: prefix (D-09 — drive identity preserved) |
| `Windows: fromFileUri does NOT case-fold UNC URIs` | 2 | UNC-shaped prefix vs uppercase server-name URI rejects (byte-exact compare, D-11); UNC round-trip with byte-matching case accepts |
| `Windows: fromFileUri preserves jar-entry tail case` | 2 | Mixed-case path tail returned byte-exact even when drive letter was folded; `foo/Bar.java` and `foo/bar.java` map to distinct entryPaths (D-09) |
| `Windows: fromFileUri round-trip via toFileUri` | 1 | `toFileUri` emits `file:///C:/Users/test/Temp/xyz/…` matching the case-fold regex; `fromFileUri(toFileUri(…))` round-trips |

All 9 new it cases use the dynamic-import pattern: `setPlatform('win32'); vi.resetModules(); const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');`. This is mandatory because `isWindows` in `src/platform/index.ts` is module-load-time — only after `vi.resetModules()` does the uri-mapper see the mocked `process.platform`.

The pre-existing 28 tests are unchanged in this commit; the existing `tempDir = '/tmp/jdtls-test'` fixture still produces `prefix = 'file:///tmp/jdtls-test/'` (byte-identical to the v1.5 `'file://' + '/tmp/jdtls-test' + '/'` concat) because `pathToFileUri('/tmp/jdtls-test')` on a POSIX host produces `file:///tmp/jdtls-test` — same prefix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Removed pre-existing `realpathSync(tempDir)` to honor D-10**

- **Found during:** Task 1
- **Issue:** `src/jdtls/uri-mapper.ts` previously called `realpathSync(tempDir)` to resolve macOS `/tmp` → `/private/var/…` symlinks. The plan's `<behavior>` and `<verify>` explicitly require `grep -c "realpath" src/jdtls/uri-mapper.ts equals 0` (D-10 — "pure string compare, no canonical-path probing"). The pre-existing code violated this even before the plan's changes.
- **Fix:** Removed the `realpathSync` import and the try/catch block that called it. `normalizedTempDir` now derives from the raw `tempDir` argument (trailing-slash strip only). Production callers (`src/tools/*`) pass the same `jdtls.tempDir` value that JDT LS receives via `rootUri` (see `src/jdtls/client.ts` `rootUri`-construction site), so JDT LS's response URIs share the shape with our prefix without any canonical-path probe.
- **Files modified:** `src/jdtls/uri-mapper.ts`
- **Commit:** `cf3dbe4`
- **Risk noted:** If JDT LS internally canonicalizes the workspace root via `Files.realpath` (Eclipse/JDT behavior is not contractually documented), the response URIs may carry the resolved-symlink form while our prefix carries the unresolved form. This would manifest only on macOS (Unix `/tmp` is canonical on linux; `os.tmpdir()` on darwin returns `/var/folders/…` which symlinks to `/private/var/folders/…`). The user's D-10 directive and the plan's explicit `equals 0` verify require this be a pure-string compare; the issue, if it materializes, is for a follow-up phase to address by canonicalizing at the `rootUri`-construction site in Plan 02's scope (`src/jdtls/client.ts`), not by re-introducing `realpath` here.

**2. [Rule 2 — Critical correctness] `{ windows: isWindows }` opt-in threaded into SUT prefix construction**

- **Found during:** Task 1
- **Issue:** The plan's `<action>` for Task 1 instructed using `pathToFileUri(normalizedTempDir)` without specifying the `{ windows: true }` opt-in. But Plan 01 §A2's mitigation cascade (per `36-01-SUMMARY.md`) explicitly notes that on a darwin host with `process.platform === 'win32'` mocked, a Windows-shaped input to bare `pathToFileUri` would NOT auto-detect — it would resolve as a relative POSIX path. Without the opt-in, the Windows-mocked tests in Task 2 would never see a Windows-flavor `prefix`, so the case-fold regex would never match and every Windows test would fail.
- **Fix:** Pass `{ windows: isWindows }` to `pathToFileUri` at the SUT's prefix-construction site. In production this is a no-op (host = Windows = win32-flavor). Under vitest with mocked `process.platform === 'win32'`, `isWindows === true` triggers the opt-in and the SUT emits a Windows-flavor URI on a non-Windows host. This matches the parallel_execution context's stated requirement for "every fixture-construction site that synthesizes a Windows-shaped URI from a Windows-shaped path on the darwin host" — the SUT itself is one such site when its tests mock the platform.
- **Files modified:** `src/jdtls/uri-mapper.ts`
- **Commit:** `cf3dbe4`

### Architectural Decisions

None — Open Landmine 8 (toFileUri internal migration) was resolved YES per RESEARCH recommendation and is documented above. Open Question 1 (drive-letter case-fold needed at all) was resolved YES per CONTEXT D-08.

## Authentication Gates

None — pure code/test work, no external services, no JDT LS startup.

## Verification

| Check | Result |
| ----- | ------ |
| `pnpm test tests/jdtls/uri-mapper.test.ts` | 37/37 pass (28 prior + 9 new) |
| `pnpm test` (full suite) | 809/809 pass (800 prior + 9 new) |
| `pnpm exec tsc --noEmit` | exit 0 (clean) |
| `grep -c "realpath" src/jdtls/uri-mapper.ts` | 0 (D-10 honored) |
| `grep -cE "'file://' \\+\|\`file://\\$\\{" src/jdtls/uri-mapper.ts` | 0 (no two-slash concat remains) |
| `grep -c "from '../platform/index.js'" src/jdtls/uri-mapper.ts` | 1 (isWindows import) |
| `grep -c "from '../platform/uri.js'" src/jdtls/uri-mapper.ts` | 1 (pathToFileUri import) |
| `grep -c "DRIVE_LETTER_URI" src/jdtls/uri-mapper.ts` | 2 (definition + use in prefixMatches) |
| `grep -c "prefixMatches" src/jdtls/uri-mapper.ts` | 3 (jsdoc + definition + use in fromFileUri) |
| `grep -c "pathToFileUri(normalizedTempDir" src/jdtls/uri-mapper.ts` | 2 (called once at prefix construction; baseUri reused in toFileUri) |
| `grep -c "describe('Windows: fromFileUri" tests/jdtls/uri-mapper.test.ts` | 5 (4 required + 1 round-trip bonus) |
| `grep -c "setPlatform('win32')" tests/jdtls/uri-mapper.test.ts` | 11 (9 it cases + 2 from new pattern usage) |
| `grep -c "vi.resetModules" tests/jdtls/uri-mapper.test.ts` | 11 (afterEach + per-test pattern) |
| `grep -c "await import('\\.\\./\\.\\./src/jdtls/uri-mapper\\.js')" tests/jdtls/uri-mapper.test.ts` | 9 (one per Windows-mocked it case) |

Note: the verify floor was `>=4` for each Task 2 metric; we exceed all by including a bonus 5th describe (`round-trip via toFileUri`) and a couple of paired-assertion it cases (uppercase/lowercase, byte-exact accept/reject for UNC, distinct-entryPath case-sensitive tail).

## A2 Cascade Confirmation (per `<output>` requirement)

(a) **`toFileUri` internal migration to `pathToFileUri` — DONE.** Open Landmine 8 resolved YES. `toFileUri` returns `${pathToFileUri(normalizedTempDir, { windows: isWindows })}/${dirName}/${entryPath}` — three-slash drive-letter shape on Windows-flavor, byte-identical to v1.5 on Unix.

(b) **Plan 01 Task 3 A2 outcome confirmed FAILED on darwin host.** Per `36-01-SUMMARY.md`, the `pathToFileUri` signature was upgraded to `(absPath: string, opts?: { windows?: boolean }) => string`. This plan's Task 1 threads `{ windows: isWindows }` into the SUT's internal `pathToFileUri(normalizedTempDir, ...)` call, so the Windows-mocked tests in Task 2 see a Windows-flavor prefix on a darwin host. The opt-in is also accessible to test fixtures, though this plan's tests do not need to construct expected-URI strings via `pathToFileUri` directly — they use literal `'file:///C:/…'` strings asserted against the SUT.

(c) **UNIX-02 round-trip preserved.** `pathToFileUri('/path')` on a POSIX host produces `file:///path`, byte-identical to the prior `'file://' + '/path'` concat. The 28 pre-existing tests in `tests/jdtls/uri-mapper.test.ts` (which assert exact URI literals like `'file:///tmp/jdtls-test/minecraft/…'`) pass without modification.

(d) **No `fs.realpath` introduced — and the pre-existing `realpathSync` removed.** D-10 fully honored. See Deviation #1 above for the rationale and the latent macOS risk noted there.

## Threat Surface Scan

No new attack surface introduced. `src/jdtls/uri-mapper.ts` continues to consume `Location.uri` values from JDT LS only (low-trust-but-not-adversarial). The drive-letter case-fold is bounded to a single byte and gated by an anchored regex — a malicious URI cannot exploit case-fold to access a different file (UNC, DOS device, path segments, jar-entry tails all remain byte-exact). The threat register entries `T-36-03-01` (accept) and `T-36-03-02` (mitigate) are satisfied by the regex-gated, byte-8-scoped state machine.

## Out-of-Scope Items (Confirmed Untouched)

Per the parallel_execution context (Plan 02 concurrent worktree) and `<verification>`:

| File | Owner | Touched? |
| ---- | ----- | -------- |
| `src/jdtls/client.ts` | Plan 02 | NO |
| `src/jdtls/workspace-sync.ts` | Plan 02 | NO |
| `src/tools/remove-project-member.ts` | Plan 02 | NO |
| `src/tools/tool-helpers.ts` | Plan 02 / Plan 04 | NO |
| `src/project/gradle-parser.ts` | Out of scope (D-03 — divergent Gradle-DSL semantics) | NO |

## Self-Check: PASSED

- [x] `src/jdtls/uri-mapper.ts` modified — commit `cf3dbe4`
- [x] `tests/jdtls/uri-mapper.test.ts` modified — commit `4281afe`
- [x] Both commits present in `git log`:
  - `cf3dbe4 feat(36-03): add drive-letter case-fold + pathToFileUri prefix in uri-mapper`
  - `4281afe test(36-03): cover Windows drive-letter case-fold + tail case-preserve in uri-mapper`
- [x] All success criteria from PLAN.md met:
  1. `fromFileUri` accepts case-flipped drive letter on Windows; rejects different drive letter ✓
  2. UNC URIs byte-exact even on Windows ✓
  3. Jar-entry tail bytes case-sensitive ✓
  4. Unix behavior byte-identical to v1.5 (case-fold branch skipped on `!isWindows`) ✓
  5. `toFileUri` emits three-slash form via `pathToFileUri(normalizedTempDir, { windows: isWindows })` ✓
  6. No `fs.realpath` calls (and the pre-existing `realpathSync` was removed to honor the verify floor) ✓
  7. All targeted + full vitest suites pass (37/37 file-local; 809/809 full-suite); `pnpm exec tsc --noEmit` clean ✓
