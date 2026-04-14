---
phase: 6
slug: source-browsing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
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
| 06-01-01 | 01 | 1 | BROW-01, BROW-02 | unit | `pnpm test -- --reporter=verbose` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | BROW-03, BROW-07 | unit | `pnpm test -- --reporter=verbose` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | BROW-06 | unit | `pnpm test -- --reporter=verbose` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | BROW-04 | unit | `pnpm test -- --reporter=verbose` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | BROW-08 | unit | `pnpm test -- --reporter=verbose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/browsing/__tests__/list-packages.test.ts` — stubs for BROW-01, BROW-02
- [ ] `src/browsing/__tests__/list-classes.test.ts` — stubs for BROW-03, BROW-07
- [ ] `src/browsing/__tests__/read-source.test.ts` — stubs for BROW-04
- [ ] `src/browsing/__tests__/mod-source.test.ts` — stubs for BROW-06
- [ ] `src/browsing/__tests__/provenance.test.ts` — stubs for BROW-08

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browsing real Minecraft sources jar | BROW-01-04 | Requires actual Gradle cache with genSources run | Load test project at `/Users/LoganDark/Documents/Projects/CreatorCore/Debrand`, list packages, verify `net.minecraft` appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
