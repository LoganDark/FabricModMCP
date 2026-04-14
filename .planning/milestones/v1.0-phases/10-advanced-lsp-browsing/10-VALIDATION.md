---
phase: 10
slug: advanced-lsp-browsing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 10 — Validation Strategy

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
| 10-01-01 | 01 | 1 | ALSB-01 | unit | `npx vitest run tests/tools/list-members.test.ts -x` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | ALSB-02 | unit | `npx vitest run tests/tools/get-symbol-info.test.ts -x` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | ALSB-03 | unit | `npx vitest run tests/tools/type-hierarchy.test.ts -x` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | ALSB-04 | unit | `npx vitest run tests/tools/find-implementations.test.ts -x` | ❌ W0 | ⬜ pending |
| 10-01-05 | 01 | 1 | ALSB-05 | unit | `npx vitest run tests/tools/search-symbols.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/list-members.test.ts` — stubs for ALSB-01
- [ ] `tests/tools/get-symbol-info.test.ts` — stubs for ALSB-02
- [ ] `tests/tools/type-hierarchy.test.ts` — stubs for ALSB-03
- [ ] `tests/tools/find-implementations.test.ts` — stubs for ALSB-04
- [ ] `tests/tools/search-symbols.test.ts` — stubs for ALSB-05

Tests should follow the established pattern from find-definition.test.ts: mock jarReader, mock readFile, mock LspClient methods and endpoint.send(), use createTestPair for MCP server testing.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| jdt:// URI resolution for JDK types | ALSB-03 | Requires live JDT LS with JDK sources | Start JDT LS, query hierarchy for a class extending JDK type, verify jdt:// URIs resolve |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
