---
phase: 14
slug: jdtls-workspace-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/jdtls/workspace-sync.test.ts tests/tools/add-study-jar.test.ts tests/tools/remove-study-jar.test.ts tests/tools/list-study-jars.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/jdtls/workspace-sync.test.ts tests/tools/add-study-jar.test.ts tests/tools/remove-study-jar.test.ts tests/tools/list-study-jars.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | LSP-01 | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "extracts study jar"` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 1 | LSP-01 | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "classpath"` | ❌ W0 | ⬜ pending |
| 14-01-03 | 01 | 1 | LSP-01 | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "jarIdToDirName"` | ❌ W0 | ⬜ pending |
| 14-01-04 | 01 | 1 | LSP-02 | integration | `npx vitest run tests/tools/add-study-jar.test.ts -t "workspace sync"` | ❌ W0 | ⬜ pending |
| 14-01-05 | 01 | 1 | LSP-02 | integration | `npx vitest run tests/tools/remove-study-jar.test.ts -t "workspace"` | ❌ W0 | ⬜ pending |
| 14-01-06 | 01 | 1 | LSP-02 | integration | `npx vitest run tests/tools/list-study-jars.test.ts -t "workspaceSynced"` | ❌ W0 | ⬜ pending |
| 14-01-07 | 01 | 1 | LSP-02 | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "failure warning"` | ❌ W0 | ⬜ pending |
| 14-01-08 | 01 | 1 | LSP-02 | integration | `npx vitest run tests/tools/add-study-jar.test.ts -t "JDT LS unavailable"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/jdtls/workspace-sync.test.ts` — stubs for LSP-01, LSP-02 (unit tests for extraction, classpath, notification, failure)
- [ ] Updates to `tests/tools/add-study-jar.test.ts` — integration tests with mocked JDT LS workspace sync
- [ ] Updates to `tests/tools/remove-study-jar.test.ts` — integration tests for workspace cleanup
- [ ] Updates to `tests/tools/list-study-jars.test.ts` — workspaceSynced field tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Probe-based readiness detection timing | LSP-02 | Requires live JDT LS process with real classpath reload | Add a study jar via MCP tool, verify find_definition works for a class in the added jar within 120s |
| Incremental update (no full reload) | LSP-02 | Requires observing JDT LS behavior with real workspace | Monitor JDT LS logs during add/remove, verify no full initialization sequence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
