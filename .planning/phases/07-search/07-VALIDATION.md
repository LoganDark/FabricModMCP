---
phase: 7
slug: search
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test -- --reporter=verbose` |
| **Full suite command** | `pnpm test -- --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --reporter=verbose`
- **After every plan wave:** Run `pnpm test -- --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | SRCH-01, SRCH-02 | unit | `pnpm test -- src/browsing/__tests__/search.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | SRCH-03 | unit | `pnpm test -- src/browsing/__tests__/search.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | SRCH-04 | unit | `pnpm test -- src/browsing/__tests__/search.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | SRCH-05 | unit | `pnpm test -- src/browsing/__tests__/search.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | SRCH-01 | integration | `pnpm test -- src/tools/__tests__/search-classes.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/browsing/__tests__/search.test.ts` — stubs for search domain logic (pattern matching, kind filtering, pagination, scoping)
- [ ] `src/tools/__tests__/search-classes.test.ts` — stubs for MCP tool integration

*Existing test infrastructure (vitest, fixtures) covers framework needs.*

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
