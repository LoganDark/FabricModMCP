---
phase: 9
slug: semantic-navigation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds (unit) / ~90 seconds (with JDT LS integration) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | NAV-01 | integration | `pnpm vitest run tests/tools/find-definition.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | NAV-02 | integration | `pnpm vitest run tests/tools/find-references.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | NAV-03 | integration | `pnpm vitest run tests/tools/find-definition.test.ts -x` | ❌ W0 | ⬜ pending |
| 09-01-04 | 01 | 1 | NAV-04 | unit | `pnpm vitest run tests/jdtls/context-extractor.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/jdtls/client.test.ts` — JDT LS spawn/init/shutdown lifecycle
- [ ] `tests/jdtls/workspace.test.ts` — source extraction and .classpath generation
- [ ] `tests/jdtls/uri-mapper.test.ts` — file URI <-> jar ID mapping
- [ ] `tests/jdtls/context-extractor.test.ts` — enclosing semantic unit extraction (NAV-04)
- [ ] `tests/tools/find-definition.test.ts` — NAV-01, NAV-03
- [ ] `tests/tools/find-references.test.ts` — NAV-02, NAV-03

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| JDT LS indexing completion timing | NAV-01, NAV-02 | Timing varies by hardware and project size | Load a real Fabric project, verify JDT LS becomes ready within 60s, then run find_definition |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
