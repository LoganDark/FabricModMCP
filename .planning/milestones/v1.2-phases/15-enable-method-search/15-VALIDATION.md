---
phase: 15
slug: enable-method-search
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test -- --reporter=dot` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- tests/tools/search-symbols.test.ts tests/jdtls/workspace-sync.test.ts tests/jdtls/client.test.ts -x`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | SRCH-01 | unit | `pnpm test -- tests/tools/search-symbols.test.ts -t "method" -x` | ✅ | ⬜ pending |
| 15-01-02 | 01 | 1 | SRCH-02 | unit | `pnpm test -- tests/jdtls/workspace-sync.test.ts -x` | ✅ | ⬜ pending |
| 15-01-03 | 01 | 1 | SRCH-04 | unit | `pnpm test -- tests/tools/search-symbols.test.ts -x` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/jdtls/workspace-sync.test.ts` — remove `waitForWorkspaceSync` describe block, update `syncStudyJarToWorkspace` test to NOT assert probe call
- [ ] `tests/tools/search-symbols.test.ts` — add explicit `containerName` assertion on method results (existing SAMPLE_SYMBOLS already includes methods)

*Existing infrastructure covers all phase requirements — no new test files or framework installs needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
