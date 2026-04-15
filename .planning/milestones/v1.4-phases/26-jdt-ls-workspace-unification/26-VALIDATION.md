---
phase: 26
slug: jdt-ls-workspace-unification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | LSP-01 | unit | `npx vitest run tests/jdtls/` | ✅ | ⬜ pending |
| 26-01-02 | 01 | 1 | LSP-01 | unit | `npx vitest run tests/jdtls/` | ✅ | ⬜ pending |
| 26-02-01 | 02 | 2 | LSP-01, LSP-02 | integration | `npx vitest run tests/tools/` | ✅ | ⬜ pending |
| 26-02-02 | 02 | 2 | LSP-02 | integration | `npx vitest run tests/tools/` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. JDT LS tests exist in `tests/jdtls/` and tool tests exist in `tests/tools/`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-mod find_definition with real JDT LS | LSP-02 | Requires JDT LS binary + Java 21 runtime | Load two fabric mods, call find_definition from mod A's source, verify result points into mod B's dependencies |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
