---
phase: 11
slug: types-and-domain-logic
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test -- --reporter=verbose` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- tests/project/jar-reader.test.ts tests/browsing/entry-index-cache.test.ts tests/project/study-jar.test.ts --reporter=verbose`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | INFRA-01 | unit | `pnpm test -- tests/project/jar-reader.test.ts -t "addProjectJar"` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | INFRA-01 | unit | `pnpm test -- tests/project/jar-reader.test.ts -t "removeProjectJar"` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | INFRA-01 | unit | `pnpm test -- tests/project/jar-reader.test.ts -t "removeProjectJar.*shared"` | ❌ W0 | ⬜ pending |
| 11-01-04 | 01 | 1 | INFRA-02 | unit | `pnpm test -- tests/browsing/entry-index-cache.test.ts -t "evict"` | ❌ W0 | ⬜ pending |
| 11-01-05 | 01 | 1 | SC-1 | unit | `pnpm test -- tests/project/study-jar.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-06 | 01 | 1 | SC-2 | unit | `pnpm test -- tests/project/study-jar.test.ts -t "evict"` | ❌ W0 | ⬜ pending |
| 11-01-07 | 01 | 1 | SC-3 | unit | `pnpm test -- tests/project/study-jar.test.ts -t "collision"` | ❌ W0 | ⬜ pending |
| 11-01-08 | 01 | 1 | SC-4 | integration | `pnpm test -- tests/project/study-jar.test.ts -t "refresh"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/project/study-jar.test.ts` — stubs for SC-1 through SC-4 (StudyJar type, lifecycle, collision detection, refresh survival)
- [ ] `tests/browsing/entry-index-cache.test.ts` — covers INFRA-02 (single-entry eviction)
- [ ] Extend `tests/project/jar-reader.test.ts` — covers INFRA-01 (add/remove per-project jar methods)

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
