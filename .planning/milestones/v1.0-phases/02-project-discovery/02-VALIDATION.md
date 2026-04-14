---
phase: 2
slug: project-discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PROJ-01 | integration | `pnpm vitest run tests/project/loader.test.ts -t "loads yarn-era project"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | PROJ-01 | unit | `pnpm vitest run tests/project/loader.test.ts -t "rejects"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | PROJ-06 | unit | `pnpm vitest run tests/project/gradle-parser.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | PROJ-06 | unit | `pnpm vitest run tests/project/loom-cache.test.ts -t "yarn"` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | PROJ-11 | unit | `pnpm vitest run tests/project/gradle-parser.test.ts -t "yarn era"` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | PROJ-11 | unit | `pnpm vitest run tests/project/gradle-parser.test.ts -t "unobfuscated"` | ❌ W0 | ⬜ pending |
| 02-01-07 | 01 | 1 | PROJ-11 | unit | `pnpm vitest run tests/project/loom-cache.test.ts -t "unobfuscated"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/project/gradle-parser.test.ts` — stubs for PROJ-06, PROJ-11 (parsing)
- [ ] `tests/project/loom-cache.test.ts` — stubs for PROJ-06, PROJ-11 (path resolution)
- [ ] `tests/project/loader.test.ts` — stubs for PROJ-01 (integration)
- [ ] `tests/project/fabric-mod.test.ts` — stubs for fabric.mod.json parsing
- [ ] `tests/fixtures/` — test fixture files (mock gradle.properties, build.gradle.kts, fabric.mod.json)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *None* | — | — | — |

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
