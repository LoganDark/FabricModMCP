---
phase: 23
slug: type-foundation-and-projectstore
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 23-01-01 | 01 | 0 | CONT-02 | unit | `npx vitest run tests/project/types.test.ts -x` | ❌ W0 | ⬜ pending |
| 23-01-02 | 01 | 0 | CONT-06 | unit | `npx vitest run tests/project/compat.test.ts -x` | ❌ W0 | ⬜ pending |
| 23-01-03 | 01 | 0 | CONT-01, CONT-05 | unit | `npx vitest run tests/state/project-store.test.ts -x` | ✅ needs update | ⬜ pending |
| 23-01-04 | 01 | 0 | CONT-03 | unit | `npx vitest run tests/project/study-jar.test.ts -x` | ✅ needs update | ⬜ pending |
| 23-xx-xx | TBD | 1+ | CONT-01..06 | integration | `npx vitest run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/project/compat.test.ts` — covers CONT-06 (compat accessor functions, sole-mod resolution, error cases)
- [ ] `tests/project/types.test.ts` — covers CONT-02 (type guard tests, discriminated union correctness)
- [ ] Update `tests/state/project-store.test.ts` — covers CONT-01, CONT-05 (default project creation, new Project shape)
- [ ] Update `tests/project/study-jar.test.ts` — covers CONT-03 (study jars as project-level children)
- [ ] Update all tool test `makeMockProject()` helpers to return new `Project` shape

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Default project visible at startup | CONT-05 | Requires running MCP server | Start server, verify "default" project exists before any load_project call |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
