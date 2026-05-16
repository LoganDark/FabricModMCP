---
phase: 36
slug: path-uri-handling-audit
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-15
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `36-RESEARCH.md` §"Validation Architecture (§5.5 Nyquist gate)".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | `vitest.config.ts` (testTimeout: 10000ms, env: node, include: `tests/**/*.test.ts`) |
| **Quick run command** | `pnpm test -- tests/platform/uri.test.ts tests/jdtls/uri-mapper.test.ts tests/jdtls/workspace-sync.test.ts tests/jdtls/client.test.ts` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~1–3s quick, ~10–30s full |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (full suite)

---

## Per-Task Verification Map

> One row per task across plans 01-04. Each task with side-effects maps to an `<automated>` test command (no `--watch` flags). Wave 0 stubs are explicitly listed below the table.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 36-01-T1 | 01 | 1 | WIN-03, UNIX-02 | T-36-01-NONE | Pure-module wrapper around `node:url` — no fs/child_process | unit (source-assertion) | `pnpm exec tsc --noEmit` | ✅ (creates `src/platform/uri.ts`) | ⬜ pending |
| 36-01-T2 | 01 | 1 | WIN-03, UNIX-02 | T-36-01-NONE | UNIX-02 round-trip identity; WIN-03 three-slash + percent-encoding | unit (vitest, platform-mocked) | `pnpm test -- tests/platform/uri.test.ts` | ✅ (creates `tests/platform/uri.test.ts`) | ⬜ pending |
| 36-01-T3 | 01 | 1 | (A2 gate, blocks WIN-05 fixtures) | T-36-01-NONE | `pathToFileUri('C:\\foo')` produces `file:///C:/foo` on darwin host | unit (vitest, host platform) | `pnpm test -- tests/platform/uri.test.ts` | ✅ (extends `tests/platform/uri.test.ts`) | ⬜ pending |
| 36-02-T1 | 02 | 2 | WIN-03 | T-36-02-02 | LSP `initialize` + `didChangeWatchedFiles` URIs use three-slash form via `pathToFileUri` | unit (vitest, source-assertion) | `pnpm test -- tests/jdtls/client.test.ts tests/tools/remove-project-member.test.ts` | ✅ (modifies `src/jdtls/client.ts`, `src/tools/remove-project-member.ts`) | ⬜ pending |
| 36-02-T2 | 02 | 2 | WIN-03, WIN-04 | T-36-02-01, T-36-02-02 | 4 `workspace-sync.ts` LSP-forward sites use `pathToFileUri(join(...))` (Pitfall 1 fix); `tool-helpers.ts:350` `fileUriToPath` enclosed in try/catch with `continue` (Open Question 4 RESOLVED) | unit (vitest, source-assertion) | `pnpm test -- tests/jdtls/workspace-sync.test.ts tests/tools/tool-helpers.test.ts` | ✅ (modifies `src/jdtls/workspace-sync.ts`, `src/tools/tool-helpers.ts`) | ⬜ pending |
| 36-02-T3 | 02 | 2 | UNIX-03 | (regression guard) | Full vitest suite green after forward/reverse sweep | regression (vitest, full suite) | `pnpm test` | n/a (verification only) | ⬜ pending |
| 36-03-T1 | 03 | 2 | WIN-05, UNIX-02 | T-36-03-01, T-36-03-02 | `prefixMatches` state machine + `toFileUri` migrates to `pathToFileUri` (Open Landmine 8); no `fs.realpath` (D-10) | unit (vitest + source-assertion) | `pnpm test -- tests/jdtls/uri-mapper.test.ts` | ✅ (modifies `src/jdtls/uri-mapper.ts`) | ⬜ pending |
| 36-03-T2 | 03 | 2 | WIN-05 | T-36-03-01, T-36-03-02 | Windows-mocked describes: uppercase/lowercase drive accept, different-drive reject, UNC byte-exact, jar-entry tail case-preserve | unit (vitest, platform-mocked) | `pnpm test -- tests/jdtls/uri-mapper.test.ts` | ✅ (extends `tests/jdtls/uri-mapper.test.ts`) | ⬜ pending |
| 36-04-T1 | 04 | 3 | WIN-04, WIN-06, WIN-07 | T-36-04-01, T-36-04-02, T-36-04-03, T-36-04-04, T-36-04-05 | ZIP split-and-spread + post-resolution traversal check + warn-log + throw at Z1/Z2; `maxRetries: 3, retryDelay: 100` at all 4 `rm` sites | unit (vitest + source-assertion) | `pnpm exec tsc --noEmit && pnpm test -- tests/jdtls/workspace-sync.test.ts` | ✅ (modifies `src/jdtls/workspace-sync.ts`) | ⬜ pending |
| 36-04-T2 | 04 | 3 | WIN-04, WIN-06, WIN-07 | T-36-04-01, T-36-04-02, T-36-04-03, T-36-04-04, T-36-04-05 | WIN-06 `rm` options assertion via `vi.mock('node:fs/promises', { ...actual })`; WIN-07 5 traversal-rejection cases (D-24); WIN-04 split-and-spread coverage | unit (vitest, partial mock + platform-mocked) | `pnpm test -- tests/jdtls/workspace-sync.test.ts` | ✅ (extends `tests/jdtls/workspace-sync.test.ts`) | ⬜ pending |
| 36-04-T3 | 04 | 3 | UNIX-01, UNIX-02, UNIX-03 | (regression guard) | Full vitest suite green after ZIP-hardening + `rm` retry land | regression (vitest, full suite) | `pnpm test` | n/a (verification only) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity check:** No 3 consecutive tasks lack `<automated>` verify — every task above has a command. T3 verification tasks (36-02-T3, 36-04-T3) are explicitly full-suite regression gates.

---

## Wave 0 Requirements

Test scaffolding gaps from `36-RESEARCH.md` §"Wave 0 Gaps":

- [x] `tests/platform/uri.test.ts` — created in Plan 01 Task 2 (UNIX-02 + WIN-03) and extended in Plan 01 Task 3 (A2 gate).
- [x] `tests/jdtls/uri-mapper.test.ts` — extended in Plan 03 Task 2 with 4 Windows-mocked describes.
- [x] `tests/jdtls/workspace-sync.test.ts` — extended in Plan 04 Task 2 with WIN-04 / WIN-06 / WIN-07 describes (`describe('ZIP traversal rejection', …)`, `describe('rm retry options', …)`, `describe('ZIP split-and-spread', …)`).
- [x] `tests/jdtls/workspace-sync.test.ts` — `vi.mock('node:fs/promises', { ...actual, rm: vi.fn(actual.rm) })` partial-mock added in Plan 04 Task 2.
- [ ] `tests/jdtls/client.test.ts` — OPTIONAL snapshot in `describe('startJdtLs URI form', …)` covering WIN-03 LSP-client URI assembly. Not required for phase gate; existing coverage in `tests/jdtls/client.test.ts` + the source-assertion in Plan 02 Task 1 is sufficient.
- [x] Framework install: **none** — vitest, `node:url`, `node:path`, `node:fs/promises` already present.

**`wave_0_complete: false`** because the optional `client.test.ts` snapshot is not added. All 4 mandatory boxes are checked; the optional 5th is skipped per its OPTIONAL designation in RESEARCH §"Wave 0 Gaps".

---

## Manual-Only Verifications

All phase behaviors have automated verification via vitest with platform-mock helpers (`setPlatform + vi.resetModules + dynamic import`) — no manual Windows-host run is required for phase gate.

*Out-of-band confirmation: empirical Windows-host exercise of the temp-dir EBUSY retry path is welcome but NOT required for `/gsd:verify-work` to PASS. The unit-test assertions on `fs.rm` options-object identity are sufficient evidence per WIN-06 success criteria.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all 4 MANDATORY references above (5th is optional and skipped)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (full suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-15
