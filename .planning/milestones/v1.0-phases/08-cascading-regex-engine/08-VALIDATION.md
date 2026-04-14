---
phase: 8
slug: cascading-regex-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run tests/browsing/cascading-regex.test.ts` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run tests/browsing/cascading-regex.test.ts`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | CREG-01 | unit | `pnpm vitest run tests/browsing/cascading-regex.test.ts -t "cascading"` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | CREG-02 | unit | `pnpm vitest run tests/browsing/cascading-regex.test.ts -t "offset"` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | CREG-04 | unit | `pnpm vitest run tests/browsing/cascading-regex.test.ts -t "fail"` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | CREG-03 | unit | `pnpm vitest run tests/tools/locate-in-source.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/browsing/cascading-regex.test.ts` — stubs for CREG-01, CREG-02, CREG-04
- [ ] `tests/tools/locate-in-source.test.ts` — stubs for CREG-03

*Existing infrastructure covers test framework setup.*

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
