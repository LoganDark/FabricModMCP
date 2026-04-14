---
phase: 3
slug: dependency-discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test -- --run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PROJ-09 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | PROJ-07 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | BROW-05 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | PROJ-08 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | PROJ-07 | integration | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/jar-registry.test.ts` — stubs for jar identifier scheme, source jar discovery
- [ ] `tests/pom-parser.test.ts` — stubs for POM XML parsing and dependency tree traversal
- [ ] `tests/jar-reader.test.ts` — stubs for node-stream-zip entry reading
- [ ] `tests/include-exclude.test.ts` — stubs for include/exclude filtering with glob patterns

*Existing vitest infrastructure from Phase 1/2 covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Discovery against real Gradle cache | PROJ-07 | Requires real project with `genSources` run | Load `/Users/LoganDark/Documents/Projects/CreatorCore/Debrand`, verify dependency count |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
