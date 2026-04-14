---
phase: 21
slug: navigation-pagination
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --no-coverage` |
| **Full suite command** | `npx vitest run --no-coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --no-coverage`
- **After every plan wave:** Run `npx vitest run --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | NAV-01, NAV-02, NAV-03, NAV-04 | unit | `npx vitest run tests/tools/pagination.test.ts` | ❌ W0 | ⬜ pending |
| 21-02-01 | 02 | 2 | NAV-01 | integration | `npx vitest run tests/tools/find-references.test.ts` | ✅ | ⬜ pending |
| 21-02-02 | 02 | 2 | NAV-02 | integration | `npx vitest run tests/tools/find-implementations.test.ts` | ✅ | ⬜ pending |
| 21-02-03 | 02 | 2 | NAV-03 | integration | `npx vitest run tests/tools/find-definition.test.ts` | ✅ | ⬜ pending |
| 21-02-04 | 02 | 2 | NAV-04 | integration | `npx vitest run tests/tools/find-references.test.ts tests/tools/find-implementations.test.ts tests/tools/find-definition.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/pagination.test.ts` — unit tests for shared pagination utility

*Existing test infrastructure covers integration tests for all three navigation tools.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
