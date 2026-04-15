---
phase: 25
slug: child-management-tools
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run -x` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run -x`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | TOOL-02 | unit+integration | `npx vitest run tests/tools/load-project.test.ts -x` | TBD | ⬜ pending |
| 25-01-02 | 01 | 1 | CONT-04 | unit | `npx vitest run tests/project/loader.test.ts -x` | TBD | ⬜ pending |
| 25-02-01 | 02 | 2 | DEP-04 | unit+integration | `npx vitest run tests/tools/refresh-dependencies.test.ts -x` | TBD | ⬜ pending |
| 25-02-02 | 02 | 2 | TOOL-01, TOOL-03 | integration | `npx vitest run tests/tools/ -x` | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. vitest and test helpers (factories.ts) already exist with namespaced ID support from Phase 24.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Multi-mod JDT LS workspace functions correctly | CONT-04 | Requires real JDT LS + Java 21 runtime | Load two fabric mods, verify find-definition works across both |
| Tool results display namespaced IDs in MCP inspector | TOOL-03 | Requires MCP client integration | Call list_packages with two mods loaded, verify IDs are namespaced |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
