---
phase: 39
slug: windows-end-to-end-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-24
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test -- run` |
| **Full suite command** | `pnpm test -- run` |
| **Estimated runtime** | ~30-60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- run` (regression guard for UNIX-03)
- **After every plan wave:** Run `pnpm test -- run`
- **Before `/gsd:verify-work`:** Full suite must be green on macOS AND Linux (UNIX-03)
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 39-01-* | 01 | 1 | UNIX-03 | — | docs only — no code, suite must stay green | regression | `pnpm test -- run` | ✅ | ⬜ pending |
| 39-02-* | 02 | 1 | UNIX-03 | — | CLAUDE.md edits — no code, suite must stay green | regression | `pnpm test -- run` | ✅ | ⬜ pending |
| 39-03-* | 03 | 1 | UNIX-03 | — | ROADMAP plan-list rewrite — docs only | regression | `pnpm test -- run` | ✅ | ⬜ pending |
| 39-04-* | 04 | 2 | WIN-01..WIN-07 / JAVA-01..JAVA-05 / UNIX-02 | — | Manual matrix on Windows — evidence per row | manual | see Manual-Only block | N/A (manual) | ⬜ pending |
| 39-05-* | 05 | 3 | UNIX-03 | — | Regression sweep on macOS + Linux | regression | `pnpm test -- run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

This is a docs + validation phase. No new test files are required; the v1.5 + v1.6 vitest suite already exists and is the regression-guard surface for UNIX-03.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP server starts under `--java-home` on Windows, spawns JDT LS, full happy path completes | WIN-01..WIN-07, JAVA-01..JAVA-05, UNIX-02 | Requires real Windows host (UNIX-03 manual matrix per D-02) | Run happy path `create_project` → `add_fabric_mod` → `find_definition` → `find_references` with the test fixture under `--java-home <path>`. Capture JDT LS spawn line (proves resolved `javaPath`), find_definition result count, find_references result count. |
| MCP server starts under `org.gradle.java.home`, spawns JDT LS, full happy path completes | JAVA-01..JAVA-05 | Requires real Windows host | Set `org.gradle.java.home` in fixture's `gradle.properties`; restart MCP server with cache cleared per D-03; run happy path; capture spawn line + result counts. |
| MCP server starts under `JAVA_HOME` env, spawns JDT LS, full happy path completes | JAVA-01..JAVA-05 | Requires real Windows host | Set `JAVA_HOME` env var; restart MCP server with cache cleared per D-03; run happy path; capture spawn line + result counts. |
| MCP server starts under PATH-only Java, spawns JDT LS, full happy path completes | JAVA-01..JAVA-05 | Requires real Windows host | Unset all prior overrides; restart MCP server with cache cleared per D-03; run happy path; capture spawn line + result counts. |
| Cross-mod navigation finds `ExampleMod` symbols from the sibling mod | WIN-02 (per-project JDT LS workspace) | Requires real Windows host + cross-mod fixture | In each matrix row, `find_definition` on `ExampleMod.LOGGER` from a sibling-mod source file must return a non-empty result located inside the example-mod source jar (or example-mod source dir). |
| Long-path / WSL limitations documented with workaround | WIN-* milestone framing | Behavioral / documentation check | After Plan 01 ships, `docs/WINDOWS-SUPPORT.md` contains the 260-char-limit mitigation (registry / Group Policy) and the WSL2 note. |

Between rows (D-03) the maintainer MUST: (a) fully exit the MCP server (resets module-state `configuredJavaHome` per RESEARCH.md pitfall #3), (b) run `gradle --stop`, (c) delete `<fixtureRoot>/.gradle/loom-cache/`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies *(Plan 04 tasks are manual — covered by the Manual-Only block above)*
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify *(Plans 01/02/03/05 are all `pnpm test -- run`-guarded; Plan 04 is the manual matrix)*
- [ ] Wave 0 covers all MISSING references *(no Wave 0 needed)*
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter *(flip to true once plan-checker passes)*

**Approval:** pending
