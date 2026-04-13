---
phase: 5
slug: project-metadata
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | META-04 | unit | `npx vitest run src/project/__tests__/dependency-discovery.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | META-04 | unit | `npx vitest run src/project/__tests__/dependency-discovery.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | META-01, META-02, META-03, META-05 | unit | `npx vitest run src/tools/__tests__/get-project-metadata.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | META-01, META-02, META-03, META-04, META-05 | integration | `npx vitest run src/tools/__tests__/get-project-metadata.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/project/__tests__/dependency-discovery.test.ts` — extend existing tests for provenance chain tracking
- [ ] `src/tools/__tests__/get-project-metadata.test.ts` — stubs for metadata tool response shape

*Existing test infrastructure (vitest, fixtures) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| File size on disk reported for jars | META-03 | Requires actual jar files on filesystem | Load test project, query metadata with jar inventory, verify sizes are non-zero integers |

*Most behaviors have automated verification via unit tests with mock data.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
