---
phase: 12
slug: existing-tool-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/project/dependency-resolver.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/project/dependency-resolver.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | INTG-01, INTG-02 | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "getResolvedDependencies"` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | INTG-01 | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "getAllDependencies"` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | INTG-01, INTG-02 | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "getDependenciesForTool"` | ❌ W0 | ⬜ pending |
| 12-01-04 | 01 | 1 | INTG-01 | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "CATEGORY_PRIORITY"` | ❌ W0 | ⬜ pending |
| 12-01-05 | 01 | 1 | INTG-02 | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "priority"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/project/dependency-resolver.test.ts` — stubs for INTG-01, INTG-02 (resolver logic, tool helper, priority sorting)
- No framework install needed (vitest already configured)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No `dependencyJars` access in tool files post-refactor | INTG-01, INTG-02 | Static analysis check | `grep -rn 'dependencyJars' src/tools/` — only refresh-dependencies.ts (write) and load-project.ts (initial load) should match |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
