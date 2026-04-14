---
phase: 18
slug: member-inspection-context-lines
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --no-coverage` |
| **Full suite command** | `npx vitest run --no-coverage` |
| **Estimated runtime** | ~14 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --no-coverage`
- **After every plan wave:** Run `npx vitest run --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 14 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | read_member FQN parsing | unit | `npx vitest run tests/browsing/member-fqn.test.ts` | ✅ | ⬜ pending |
| 18-01-02 | 01 | 1 | read_member source extraction | unit | `npx vitest run tests/tools/read-member.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 2 | locate_in_source context lines | unit | `npx vitest run tests/tools/locate-in-source.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/tools/read-member.test.ts` — stubs for read_member tool tests

*Existing infrastructure covers locate_in_source context lines (test file already exists).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| read_member with live JDT LS | End-to-end member extraction | Requires JDT LS workspace with real Minecraft project | Load a Minecraft project, call read_member with a known FQN, verify source includes Javadoc |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 14s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
