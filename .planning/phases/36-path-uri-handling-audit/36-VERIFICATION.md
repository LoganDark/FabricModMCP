---
phase: 36-path-uri-handling-audit
verified: 2026-05-16T03:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 36: Path / URI Handling Audit — Verification Report

**Phase Goal:** Wholesale migration to `pathToFileURL`/`fileURLToPath` across all 7 forward + 1 reverse URI sites (gradle-parser.ts:36 OUT OF SCOPE — divergent semantics); fix ZIP-entry-meets-`path.join` mixed-separator corruption via split-and-spread; add ZIP path-traversal guard (post-resolution descendant check); add Windows-only EBUSY/EPERM retry on temp-dir cleanup via `fs.rm` options. Drive-letter case-insensitivity on Windows URI receive in `uri-mapper.ts` `fromFileUri`. UNIX-01 (byte-identical Unix happy-path) and UNIX-02 (round-trip identity) are hard guardrails.

**Verified:** 2026-05-16T03:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `src/platform/uri.ts` exists as pure module with `pathToFileUri` / `fileUriToPath` exports | VERIFIED | File present (64 LOC); imports only `node:url`; A2 mitigation applied — signature is `(absPath: string, opts?: { windows?: boolean }): string` matching the required shape exactly |
| 2 | All 7 forward `'file://' + path` sites converted to `pathToFileUri(...)` | VERIFIED | `grep -rn "'file://'" src/` returns no matches at all (even gradle-parser.ts uses regex form `/^file:\/\//`, not the literal `'file://'` token); 2 in client.ts (lines 246, 279), 4 in workspace-sync.ts (lines 110, 148, 218, 267), 1 in remove-project-member.ts (line 84) |
| 3 | Reverse consumer in tool-helpers.ts converted to `fileUriToPath(loc.uri)` inside try/catch | VERIFIED | `tool-helpers.ts:353` `fileUriToPath(loc.uri)` enclosed in try at line 352 with `catch { continue; }` at line 354 |
| 4 | All 4 workspace-sync.ts LSP-URI sites use `join(resolvedTempDir, '.classpath')` before `pathToFileUri` (WIN-04 Pitfall 1) | VERIFIED | All 4 sites read `pathToFileUri(join(resolvedTempDir, '.classpath'))` |
| 5 | uri-mapper.ts `fromFileUri` accepts case-flipped drive letter on Windows; rejects different drives; non-drive-letter URIs byte-exact (WIN-05 / D-09 / D-11) | VERIFIED | `DRIVE_LETTER_URI = /^file:\/\/\/[A-Za-z]:/` regex anchors to drive-letter shape only; `prefixMatches` case-folds only byte 8, byte-exact elsewhere; UNC URIs naturally excluded by regex (4 slashes vs 3); test suite has 5 Windows describes covering 9 cases |
| 6 | `toFileUri` emits three-slash form via `pathToFileUri(normalizedTempDir, { windows: isWindows })` (Open Landmine 8) | VERIFIED | `uri-mapper.ts:101` `baseUri = pathToFileUri(normalizedTempDir, { windows: isWindows })`; `toFileUri:135` returns `${baseUri}/${dirName}/${entryPath}` |
| 7 | No `fs.realpath` in uri-mapper.ts (D-10 pure string compare) | VERIFIED | `grep -c "realpath" src/jdtls/uri-mapper.ts` = 0; pre-existing `realpathSync` was removed in Plan 03 |
| 8 | Both ZIP-extraction sites (Z1, Z2) implement split-and-spread + post-resolution descendant check with trailing-sep guard (WIN-04 / WIN-07) | VERIFIED | `grep -c "resolve(targetPath).startsWith(resolve(depDir) + sep)" src/jdtls/workspace-sync.ts` = 2; `entryPath.split('/')` × 2; `logger.warn('ZIP traversal rejected', ...)` × 2; throw on rejection × 2 |
| 9 | All 4 `rm` sites in workspace-sync.ts pass `{ maxRetries: 3, retryDelay: 100 }` (WIN-06) | VERIFIED | `grep -c "maxRetries: 3, retryDelay: 100" src/jdtls/workspace-sync.ts` = 4 (lines 55, 69, 227, 257); no `isWindows` guard |
| 10 | remove-project-member.ts:96,104 (now 97, 105 after import addition) `rm` calls untouched per D-17 lock | VERIFIED | `grep -c "maxRetries" src/tools/remove-project-member.ts` = 0; lines 97 and 105 still read `{ recursive: true, force: true }` only |
| 11 | gradle-parser.ts:36 local `fileUriToPath` untouched (D-03 — divergent Gradle DSL semantics) | VERIFIED | Function still present at line 36, still uses `uri.replace(/^file:\/\//, '')` + `~/` substitution; no import of platform/uri.js |
| 12 | UNIX-01 / UNIX-02 guardrails — full vitest suite passes, byte-identical Unix happy-path | VERIFIED | `pnpm test` reports 819/819 passing in 69 test files (1.32s); `pnpm exec tsc --noEmit` exits 0; UNIX-02 round-trip identity tests at `tests/platform/uri.test.ts:24-40` cover `/tmp/foo`, `/private/var/folders/x y/file.java`, `/tmp/path%with#odd$chars` |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/platform/uri.ts` | New pure helper module with two exports | VERIFIED | 64 LOC; named-import from `node:url` only; no fs/child_process/project imports; A2-mitigated signature `pathToFileUri(absPath, opts?: { windows?: boolean })` |
| `src/jdtls/client.ts` | F1+F2 forward sites converted | VERIFIED | Lines 246, 279 — `pathToFileUri(workspaceDir)` × 2; import from `../platform/uri.js` present |
| `src/jdtls/workspace-sync.ts` | F3-F6 + Z1+Z2 + M1-M4 hardening | VERIFIED | 4 × `pathToFileUri(join(resolvedTempDir, '.classpath'))`; 2 × split-and-spread + traversal check; 4 × `{ maxRetries: 3, retryDelay: 100 }`; logger imported; node:path expanded to `{ join, dirname, resolve, sep }` |
| `src/jdtls/uri-mapper.ts` | Drive-letter case-fold via `prefixMatches` + `toFileUri` migration | VERIFIED | `DRIVE_LETTER_URI` regex defined; `prefixMatches` state machine; `pathToFileUri(normalizedTempDir, { windows: isWindows })` × 1 (cached as `baseUri`); `isWindows` and `pathToFileUri` imports; pre-existing `realpathSync` removed |
| `src/tools/remove-project-member.ts` | F7 forward site converted; rm calls untouched | VERIFIED | Line 84 — `pathToFileUri(join(resolvedTempDir, '.classpath'))`; lines 97/105 `rm` calls byte-identical to v1.5 (no retry options) |
| `src/tools/tool-helpers.ts` | R1 reverse consumer converted inside try/catch | VERIFIED | Line 353 `fileUriToPath(loc.uri)` inside try at line 352, catch `continue` at line 354-356 |
| `tests/platform/uri.test.ts` | UNIX-02 round-trip + WIN-03 + A2 coverage | VERIFIED | 5 describes, 7 it cases — 3 UNIX-02 round-trip + 1 WIN-03 three-slash + 1 WIN-03 percent-encoding + 2 A2 (fail regression guard + opt-in success) |
| `tests/jdtls/uri-mapper.test.ts` | 4+ Windows-mocked describes for case-fold | VERIFIED | 5 Windows describes at lines 212, 233, 251, 278, 304 (9 new it cases) |
| `tests/jdtls/workspace-sync.test.ts` | WIN-04 / WIN-06 / WIN-07 describes | VERIFIED | 3 new describes at lines 720 (WIN-06), 842 (WIN-07), 1014 (WIN-04); `vi.mock('node:fs/promises'...)` with `...actual` spread at line 27 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| src/jdtls/client.ts | src/platform/uri.ts | `import { pathToFileUri } from '../platform/uri.js'` | WIRED | Import present; 2 use sites |
| src/jdtls/workspace-sync.ts | src/platform/uri.ts | named import `pathToFileUri` | WIRED | Import at line 13; 4 use sites |
| src/jdtls/workspace-sync.ts | src/logging/logger.ts | named import `logger` | WIRED | Import at line 14; 2 `logger.warn` calls in traversal rejection paths |
| src/tools/remove-project-member.ts | src/platform/uri.ts | named import `pathToFileUri` | WIRED | Import present; 1 use site (line 84) |
| src/tools/tool-helpers.ts | src/platform/uri.ts | named import `fileUriToPath` | WIRED | Import present; 1 use site (line 353) inside try/catch |
| src/jdtls/uri-mapper.ts | src/platform/index.ts | named import `isWindows` | WIRED | Line 25; used in `prefixMatches` Windows branch gate + `{ windows: isWindows }` opt-in |
| src/jdtls/uri-mapper.ts | src/platform/uri.ts | named import `pathToFileUri` | WIRED | Line 26; used at `baseUri` construction (line 101) feeding both `prefix` and `toFileUri` |
| tests/platform/uri.test.ts | src/platform/uri.ts | static + dynamic imports | WIRED | Static at line 2 (for UNIX-02 describes); dynamic at line 47 (for WIN-03 Windows-mocked describe) |
| tests/jdtls/uri-mapper.test.ts | src/jdtls/uri-mapper.ts | dynamic `await import` after `setPlatform('win32')` | WIRED | 9 dynamic re-imports in Windows-mocked describes |

### Cross-Cutting Checks (per verification brief)

| # | Check | Command | Result | Status |
|---|-------|---------|--------|--------|
| 1 | Site sweep completeness | `grep -rn "'file://'" src/ \| grep -vE 'gradle-parser\.ts'` | empty | PASS (even gradle-parser.ts no longer matches the literal `'file://'` token because it uses regex `/^file:\/\//`) |
| 2 | No `realpath` in uri-mapper.ts | `grep -c "realpath" src/jdtls/uri-mapper.ts` | 0 | PASS |
| 3 | `fs.rm` retry options at all 4 workspace-sync sites | `grep -c "maxRetries: 3" src/jdtls/workspace-sync.ts` | 4 | PASS (≥ 4 required) |
| 4 | remove-project-member.ts rm calls untouched | `grep -c "maxRetries" src/tools/remove-project-member.ts` | 0 | PASS |
| 5 | ZIP traversal post-resolution check | `grep -c "resolve(targetPath).startsWith(resolve(depDir) + sep)" src/jdtls/workspace-sync.ts` | 2 | PASS (≥ 1 required; both Z1+Z2) |
| 6 | Reverse-consumer try/catch | tool-helpers.ts:353 `fileUriToPath(loc.uri)` inside try/catch | catch at line 354 | PASS |
| 7 | A2 mitigation honest deviation — pathToFileUri signature | `grep -A 0 "export function pathToFileUri" src/platform/uri.ts` | `(absPath: string, opts?: { windows?: boolean }): string` | PASS (exact match to required signature) |
| 8 | Full test suite | `pnpm test` | 819/819 passing | PASS |
| 8b | tsc clean | `pnpm exec tsc --noEmit` | exit 0 | PASS |
| 9 | UNIX-02 round-trip identity | tests/platform/uri.test.ts | 3 inputs covered: `/tmp/foo`, `/private/var/folders/x y/file.java`, `/tmp/path%with#odd$chars` | PASS |
| 10 | UNIX-01 happy-path | `fs.rm` retry no-op on Unix | First-attempt success path documented; D-19 always-on with no Windows guard | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| WIN-03 | 36-01, 36-02 | JDT LS accepts `file://` URIs constructed for Windows workspace and classpath paths — drive letter as path component (not host), three-slash form, spaces percent-encoded | SATISFIED | `pathToFileUri` wraps `pathToFileURL(p).href` (always three-slash); WIN-03 describe in tests/platform/uri.test.ts asserts three-slash form + percent-encoding |
| WIN-04 | 36-02, 36-04 | ZIP-entry paths join correctly with Windows filesystem paths (no mixed `\`/`/` corruption) | SATISFIED | LSP-URI side: 4 sites in workspace-sync.ts use `join(resolvedTempDir, '.classpath')`. ZIP-extract side: 2 sites use `entryPath.split('/')` + spread into `join(depDir, ...segments)` |
| WIN-05 | 36-03 | Drive-letter case differences round-trip correctly through `fromFileUri`/`toFileUri` | SATISFIED | `prefixMatches` state machine in uri-mapper.ts; 5 Windows describes (9 it cases) in tests/jdtls/uri-mapper.test.ts cover accept-case-flip / reject-different-drive / UNC byte-exact / tail case-preserve / round-trip |
| WIN-06 | 36-04 | Temp-dir cleanup on Windows handles transient EBUSY from antivirus/indexer with a brief retry loop | SATISFIED | All 4 `rm` sites in workspace-sync.ts pass `{ maxRetries: 3, retryDelay: 100 }`; WIN-06 describe asserts via `vi.mock('node:fs/promises')` partial mock |
| WIN-07 | 36-04 | ZIP entry extraction rejects path-traversal entries (`../`) before writing to disk | SATISFIED | Post-resolution descendant check at both Z1/Z2; logger.warn + throw on rejection; WIN-07 describe with 5 D-24 traversal cases |
| UNIX-02 | 36-01, 36-03 | URI round-trip output on Unix paths byte-identical to v1.5 | SATISFIED | tests/platform/uri.test.ts asserts `fileUriToPath(pathToFileUri(p)) === p` for 3 representative inputs; Unix `pathToFileUri('/path')` produces `'file:///path'` byte-identical to v1.5 `'file://' + '/path'` |

All 6 phase requirement IDs from PLAN frontmatters accounted for. No orphaned requirements found.

### Anti-Patterns Scan

| File | Pattern Searched | Result | Severity |
|------|-----------------|--------|----------|
| src/platform/uri.ts | TBD/FIXME/XXX/HACK | none | OK |
| src/jdtls/uri-mapper.ts | TBD/FIXME/XXX/HACK | none | OK |
| src/jdtls/workspace-sync.ts | TBD/FIXME/XXX/HACK | none | OK |
| src/jdtls/client.ts | TBD/FIXME/XXX/HACK | none | OK |
| src/tools/remove-project-member.ts | TBD/FIXME/XXX/HACK | none | OK |
| src/tools/tool-helpers.ts | TBD/FIXME/XXX/HACK | none | OK |

### Decisions D-01 through D-25 Audit

| Decision | Status | Evidence |
|----------|--------|----------|
| D-01 (sibling module `src/platform/uri.ts`) | HONORED | File present, pure module |
| D-02 (uri-mapper keeps domain method shape, uses helpers internally) | HONORED | Public surface `{ toFileUri, fromFileUri }` unchanged; helper used at `baseUri` only |
| D-03 (7 forward + 1 reverse sweep; gradle-parser.ts:36 out of scope) | HONORED | All sites converted; gradle-parser.ts:36 byte-identical |
| D-04/D-05/D-06/D-07 (Unix-shaped tool API; Windows paths at disk layer) | HONORED | No tool API changes; URI conversion at LSP boundary only |
| D-08/D-09 (case-fold only byte 8) | HONORED | `prefixMatches` slices [0:8], [8] case-folded, [9:prefix.length] byte-exact |
| D-10 (pure string compare; no `fs.realpath`) | HONORED | 0 realpath references in uri-mapper.ts |
| D-11 (UNC/DOS device/Win32 namespace byte-exact) | HONORED | Regex `/^file:\/\/\/[A-Za-z]:/` naturally excludes these forms |
| D-12 (post-resolution descendant check) | HONORED | Inlined `resolve(targetPath).startsWith(resolve(depDir) + sep)` at Z1+Z2 |
| D-13 (trailing-sep guard via `+ sep`) | HONORED | `+ sep` present at both sites |
| D-14 (throw on rejection, reuse existing rm catch) | HONORED | Existing try/catch + rm runs cleanup on traversal throw |
| D-15 (warn-level log of rejected entry) | HONORED | `logger.warn('ZIP traversal rejected', { depDir, entryPath })` × 2 |
| D-16 (threat model — user-supplied study jars) | HONORED | Documented in PLAN 04 threat model |
| D-17 (rm retry at 4 sites in workspace-sync.ts, NOT remove-project-member.ts) | HONORED | 4 sites in workspace-sync, 0 in remove-project-member |
| D-18 (linear backoff via `retryDelay: 100`) | HONORED | Node native linear retry semantics |
| D-19 (always-on retry, no isWindows guard) | HONORED | 0 `if (isWindows)` around rm in workspace-sync.ts |
| D-20 (preserve existing catch structures) | HONORED | M3's inline `try { rm } catch {}` swallow preserved; M1/M2/M4 unchanged surroundings |
| D-21 (Phase 35 test scaffolding reuse) | HONORED | `setPlatform + vi.resetModules + dynamic import` pattern in all new Windows-mocked describes |
| D-22 (UNIX-02 round-trip inputs) | HONORED | `/tmp/foo`, `/private/var/folders/x y/file.java`, `/tmp/path%with#odd$chars` all tested |
| D-23 (drive-letter round-trip + UNC byte-exact) | HONORED | 4 describes cover accept-case-flip, reject-different-drive, UNC byte-exact, tail case-preserve |
| D-24 (5 traversal rejection cases) | HONORED | 5 it cases in WIN-07 describe (case (b) implemented as `'../../etc/passwd.java'` per RESEARCH worked example, documented in SUMMARY decisions) |
| D-25 (two-slash → three-slash expected on Unix) | HONORED | Plan 02 SUMMARY notes no test expectations needed updating because Unix `'file://' + '/abs'` is already `'file:///abs'` |

### Open Question / Open Landmine Resolution Audit

| Item | Resolution | Status |
|------|-----------|--------|
| Open Question 4 (try/catch around `fileUriToPath(loc.uri)`) | Widened — tight try/catch with `continue` | VERIFIED at tool-helpers.ts:352-356 |
| Open Landmine 8 (`toFileUri` migrating internally to `pathToFileUri`) | YES — adopted via `baseUri = pathToFileUri(normalizedTempDir, { windows: isWindows })` | VERIFIED at uri-mapper.ts:101 / 136 |
| A2 (host-darwin auto-detection assumption) | FAILED — mitigation applied: signature upgraded to `(absPath, opts?: { windows?: boolean })` | VERIFIED at src/platform/uri.ts:40; both A2 regression-guard and opt-in tests present |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly | `pnpm exec tsc --noEmit` | exit 0 | PASS |
| Full test suite passes | `pnpm test` | 819/819 in 69 files, 1.32s | PASS |
| No `'file://'` literal escapes (excl. gradle-parser) | `grep -rn "'file://'" src/ \| grep -vE 'gradle-parser\.ts'` | empty | PASS |
| Phase-wide `'file://'` gate (full) | `grep -rn "'file://'" src/` | empty (gradle-parser uses regex `/^file:\/\//`, not the literal token) | PASS |

### Human Verification Required

None. All claims in the verification brief are programmatically verifiable via grep + tsc + vitest and were confirmed at the codebase level. No visual / real-time / external-service behaviors are introduced by this phase — it is a pure refactor + hardening of internal URI handling and ZIP extraction.

### Gaps Summary

No gaps. Phase 36 goal is achieved.

- Site sweep: complete (8 boundary sites swept; gradle-parser.ts:36 correctly out of scope per D-03 with documented divergent semantics).
- ZIP hardening: complete (split-and-spread + post-resolution descendant check with trailing-sep guard at both Z1/Z2).
- rm retry: complete (4 sites in workspace-sync.ts; D-17 scope lock honored at remove-project-member.ts).
- Drive-letter case-fold: complete (surgical state machine bounded to byte 8 + Windows + drive-letter regex gate; UNC/DOS device/Unix all byte-exact).
- A2 mitigation: applied honestly — Plan 01 SUMMARY documents the empirical failure and the wrapper signature upgrade; Plan 03 threads `{ windows: isWindows }` through the SUT to use the upgrade.
- UNIX-01 / UNIX-02 guardrails: preserved (full suite 819/819 green; round-trip identity asserted on 3 inputs; rm retry options are no-op on first-attempt success).

---

_Verified: 2026-05-16T03:00:00Z_
_Verifier: Claude (gsd-verifier)_
