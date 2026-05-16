---
phase: 36
slug: path-uri-handling-audit
status: draft
nyquist_compliant: false
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

> Populated by `gsd-planner` as PLAN.md tasks are created. Each task with side-effects MUST map to either an `<automated>` test command or a Wave 0 stub. No `--watch` flags permitted (would block executor).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _(filled by planner)_ | | | | | | | | | |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test scaffolding gaps from `36-RESEARCH.md` §"Wave 0 Gaps":

- [ ] `tests/platform/uri.test.ts` — covers WIN-03 percent-encoding + three-slash output, UNIX-02 round-trip identity. New file; copy shape from `tests/platform/index.test.ts`.
- [ ] `tests/jdtls/uri-mapper.test.ts` — new `describe('fromFileUri on Windows', …)` block. Covers WIN-05 drive-letter case-fold (uppercase/lowercase match, different-drive mismatch, UNC byte-exact, DOS device byte-exact, jar-entry tail case-sensitive).
- [ ] `tests/jdtls/workspace-sync.test.ts` — new `describe('ZIP traversal rejection', …)` block. Covers WIN-07 (`..`, absolute Unix/Windows, `\`-traversal, trailing-sep edge case) + WIN-04 split-and-spread Windows-mocked round-trip.
- [ ] `tests/jdtls/workspace-sync.test.ts` — new `describe('rm retry options', …)` block. Covers WIN-06 (`vi.mock('node:fs/promises')` asserts options object passed at all 4 sites).
- [ ] `tests/jdtls/client.test.ts` — optional snapshot in `describe('startJdtLs URI form', …)` covering WIN-03 LSP-client URI assembly.
- [ ] Framework install: **none** — vitest, `node:url`, `node:path`, `node:fs/promises` already present.

---

## Manual-Only Verifications

All phase behaviors have automated verification via vitest with platform-mock helpers (`setPlatform + vi.resetModules + dynamic import`) — no manual Windows-host run is required for phase gate.

*Out-of-band confirmation: empirical Windows-host exercise of the temp-dir EBUSY retry path is welcome but NOT required for `/gsd:verify-work` to PASS. The unit-test assertions on `fs.rm` options-object identity are sufficient evidence per WIN-06 success criteria.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all 5 MISSING references above
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
