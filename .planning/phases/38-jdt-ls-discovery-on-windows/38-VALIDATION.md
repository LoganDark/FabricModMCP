---
phase: 38
slug: jdt-ls-discovery-on-windows
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-24
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm exec vitest run tests/jdtls/` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds (jdtls subset), ~15 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm exec vitest run tests/jdtls/`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 38-01-XX | 01 | 1 | WIN-02 | — | findJdtLs consumes jdtlsCandidateDirs() with deep probe | unit | `pnpm exec vitest run tests/jdtls/client.test.ts` | ✅ | ⬜ pending |
| 38-01-XX | 01 | 1 | WIN-02 | — | Multi-line failure message lists every probed candidate with skip reason | unit | `pnpm exec vitest run tests/jdtls/client.test.ts` | ✅ | ⬜ pending |
| 38-01-XX | 01 | 1 | WIN-02 | — | JDTLS_HOME failure branches return early with distinct messages | unit | `pnpm exec vitest run tests/jdtls/client.test.ts` | ✅ | ⬜ pending |
| 38-01-XX | 01 | 1 | UNIX-01 | — | Unix candidate ordering preserved byte-identical to v1.5 | unit | `pnpm exec vitest run tests/jdtls/client.test.ts` | ✅ | ⬜ pending |
| 38-01-XX | 01 | 1 | WIN-02 | — | `grep -rn 'process.env.HOME' src/` returns zero matches | unit | `pnpm exec vitest run tests/no-process-env-home.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/no-process-env-home.test.ts` — greps `src/` for `/process\.env\.HOME\b/` and asserts zero matches (planner may co-locate in another file instead — see CONTEXT.md D-09)

*If none: existing test infrastructure under tests/jdtls/ covers all other Phase 38 requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real JDT LS install at `%LOCALAPPDATA%\jdtls` resolved end-to-end on Windows | WIN-02 | Requires real Windows machine with JDT LS installed; covered by Phase 39 E2E checkpoint | Deferred to Phase 39 manual smoke test |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
