---
phase: 1
slug: server-bootstrap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts (Wave 0 installs) |
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
| 01-01-01 | 01 | 1 | SERV-01 | integration | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | SERV-02 | integration | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | SERV-03 | integration | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | SERV-04 | integration | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | SERV-05 | integration | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` + `@types/node` installed as devDependencies
- [ ] `vitest.config.ts` created with TypeScript + ESM support
- [ ] `test/server.test.ts` — stubs for SERV-01 through SERV-05
- [ ] `pnpm test` script in package.json

*Wave 0 establishes test infrastructure before any feature work.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP handshake over real stdio | SERV-01 | Requires actual stdio pipe, not InMemoryTransport | Run `echo '{"jsonrpc":"2.0","method":"initialize",...}' | pnpm start` and verify response |

*All other behaviors have automated verification via InMemoryTransport.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
