---
phase: 13
slug: study-jar-management-tools
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/tools/{tool-name}.test.ts -x` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/tools/{tool-name}.test.ts -x`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | STUDY-01 | integration | `npx vitest run tests/tools/add-study-jar.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | STUDY-01 | integration | `npx vitest run tests/tools/add-study-jar.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 1 | STUDY-02 | integration | `npx vitest run tests/tools/remove-study-jar.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-01-04 | 01 | 1 | STUDY-03 | integration | `npx vitest run tests/tools/list-study-jars.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-01-05 | 01 | 1 | STUDY-04 | integration | `npx vitest run tests/tools/configure-study-jar.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/add-study-jar.test.ts` — stubs for STUDY-01 (add, errors)
- [ ] `tests/tools/remove-study-jar.test.ts` — stubs for STUDY-02 (remove, batch, errors)
- [ ] `tests/tools/list-study-jars.test.ts` — stubs for STUDY-03 (list, empty)
- [ ] `tests/tools/configure-study-jar.test.ts` — stubs for STUDY-04 (toggle, errors)
- [ ] Test helper: reuse `createTestZip` pattern from `tests/project/study-jar.test.ts` or extract to shared helper

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
