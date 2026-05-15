---
phase: 35
slug: platform-helpers-java-executable-resolution
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-15
updated: 2026-05-15
---

# Phase 35 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | `vitest.config.ts` (testTimeout 10000ms, env node, include tests/**/*.test.ts) |
| **Quick run command** | `pnpm test -- tests/platform/ tests/jdtls/client.test.ts` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~1s quick / ~10-30s full |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- tests/platform/ tests/jdtls/client.test.ts`
- **After every plan wave:** Run `pnpm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green (v1.5 baseline 696 + new tests, expect ≥ 706 total)
- **Max feedback latency:** 30 seconds (full suite worst case)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 35-01-01 | 01 | 1 | WIN-01, UNIX-01 | T-35-01, T-35-02, T-35-03 | Pure module exports — no I/O attack surface; env-var reads have safe fallbacks | unit (compile) | `pnpm exec tsc --noEmit` | ❌ W0 (creates src/platform/index.ts) | ⬜ pending |
| 35-01-02 | 01 | 1 | WIN-01, UNIX-01 | T-35-01 | Branch coverage proves Unix UNIX-01 literals are byte-identical to v1.5 | unit | `pnpm test -- tests/platform/index.test.ts` | ❌ W0 (creates tests/platform/index.test.ts) | ⬜ pending |
| 35-02-01 | 02 | 2 | WIN-01, UNIX-01 | T-35-04, T-35-05, T-35-06 | TOCTOU race accepted (sub-ms); JAVA_HOME EoP accepted (already-existing risk); --version probe rejects non-Java binaries | unit (compile + regression) | `pnpm exec tsc --noEmit && pnpm test -- tests/jdtls/client.test.ts -t detectJava` | ✅ existing (modifies src/jdtls/client.ts) | ⬜ pending |
| 35-02-02 | 02 | 2 | WIN-01, UNIX-01 | T-35-04, T-35-05 | Windows-mocked end-to-end verifies .exe path resolution; Unix passthrough verified (no existsSync call) | unit | `pnpm test -- tests/jdtls/client.test.ts` | ✅ existing (modifies tests/jdtls/client.test.ts) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/platform/index.ts` — new file, no existing test scaffolding; Plan 01 Task 1 creates it.
- [ ] `tests/platform/index.test.ts` — new test file; Plan 01 Task 2 creates it.
- [x] vitest framework — already installed (devDep 4.1.4); no install needed.
- [x] TypeScript compiler — already available via `pnpm exec tsc` (devDep 6.0.2); no install needed.
- [x] `tests/jdtls/client.test.ts` — already exists with v1.5 baseline; Plan 02 Task 2 augments it.

*New describe blocks added to `tests/jdtls/client.test.ts` by Plan 02 Task 2: `resolveJavaExecutable on Windows`, `resolveJavaExecutable on Unix`, `detectJava on Windows`. The four existing `detectJava` tests at lines 62-109 act as UNIX-01 regression guard and MUST pass byte-identical.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end JDT LS spawn on a real Windows machine with `JAVA_HOME` set | WIN-01 (production validation) | Phase 35 mocks `process.platform` for unit tests; full Windows validation is deferred to Phase 39 per RESEARCH.md "Environment Availability" — no Windows CI runner for v1.6 | Deferred to Phase 39: run the MCP server on Windows, set `JAVA_HOME=C:\Program Files\Java\jdk-21`, observe that `child_process.spawn` succeeds (no ENOENT) and JDT LS reaches ServiceReady. |
| Assumption A1 verification (libuv applies PATHEXT for bare-name spawns on Windows) | WIN-01 (foundation for bare-`'java.exe'` candidate) | Cannot be mocked — requires actual Windows libuv behavior | Deferred to Phase 39: on a real Windows machine with `java.exe` only on PATH (no `JAVA_HOME` set), confirm `detectJava` returns `javaPath: 'java.exe'` and `startJdtLs` spawns it without ENOENT. |

*All Phase 35 unit-testable behavior has automated verification via mocked `process.platform` + mocked `existsSync` + mocked `execSync`.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (or Wave 0 file-creation dependencies satisfied within the same plan)
- [x] Sampling continuity: every task has an automated gate; no 3-consecutive-tasks-without-verify gap
- [x] Wave 0 covers all MISSING references (`src/platform/index.ts` and `tests/platform/index.test.ts` created in Plan 01)
- [x] No watch-mode flags (all commands are one-shot `pnpm test --` invocations)
- [x] Feedback latency < 35s (quick gate ~1s, full suite ~10-30s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — Wave 0 file creation gated on Plan 01 Task 1 / Task 2 execution.
