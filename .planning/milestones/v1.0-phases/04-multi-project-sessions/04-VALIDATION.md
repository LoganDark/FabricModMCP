---
phase: 4
slug: multi-project-sessions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x |
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
| 04-01-01 | 01 | 1 | PROJ-02 | unit | `pnpm vitest run tests/state/project-store.test.ts -t "naming"` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | PROJ-02 | unit | `pnpm vitest run tests/state/project-store.test.ts -t "resolve"` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | PROJ-03 | unit | `pnpm vitest run tests/state/project-store.test.ts -t "multiple"` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | PROJ-04 | unit | `pnpm vitest run tests/tools/list-projects.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-05 | 01 | 1 | PROJ-05 | unit | `pnpm vitest run tests/tools/unload-project.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-06 | 01 | 1 | PROJ-05 | unit | `pnpm vitest run tests/project/jar-reader.test.ts -t "per-project"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/state/project-store.test.ts` — stubs for PROJ-02, PROJ-03 (naming, resolution, multiple projects)
- [ ] `tests/tools/load-project.test.ts` — stubs for PROJ-02, PROJ-03 (load via tool)
- [ ] `tests/tools/unload-project.test.ts` — stubs for PROJ-05 (unload + handle cleanup)
- [ ] `tests/tools/list-projects.test.ts` — stubs for PROJ-04
- [ ] `tests/tools/set-default-project.test.ts` — stubs for PROJ-02 (default resolution)
- [ ] `tests/cli/args.test.ts` — stubs for multiple `--project` flag parsing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Multiple projects loaded via CLI flags at startup | PROJ-03 | Requires actual Gradle projects on disk | Start server with `--project /path1 --project /path2`, verify both appear in `list-projects` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
