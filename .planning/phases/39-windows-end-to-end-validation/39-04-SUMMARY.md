---
phase: 39-windows-end-to-end-validation
plan: 04
subsystem: testing
tags: [windows, jdt-ls, java-discovery, cross-jar, fabric-loom, matrix-validation, lsp]

# Dependency graph
requires:
  - phase: 39-windows-end-to-end-validation
    provides: Plans 39-01 (docs/WINDOWS-SUPPORT.md priority chains), 39-02 (CLAUDE.md ### Platform Support), 39-03 (ROADMAP plan-list cleanup) established the publishable Windows surface this plan empirically validates.
provides:
  - Empirical Windows-host evidence that the 4 Java-discovery slots (`--java-home`, `org.gradle.java.home`, `JAVA_HOME`, PATH-only) each spawn JDT LS with a distinct, slot-appropriate `javaPath`.
  - Empirical evidence that cross-jar `find_definition` (test mod source → merged Minecraft sources jar) succeeds under every Java-discovery slot on Windows 11.
  - Two production-code-path bugs surfaced and documented for follow-up: Failure 1 (`withLspDocument` race in `src/tools/tool-helpers.ts:191-205`) and Failure 2 (`find_references` unbounded with no LSP cancellation in `src/jdtls/request-queue.ts`).
  - Reusable matrix tooling under `scripts/` for re-running the Java-discovery matrix on any host (`matrix-runner.ts` direct-LSP path + `matrix-row.ts` production-MCP path) plus the diagnostic `jdtls-trace.ts` that isolated Failure 1.
affects: [39-05, 39-06, phase-40, v1.6-milestone-gate, src/tools/tool-helpers, src/jdtls/request-queue, src/index]

# Tech tracking
tech-stack:
  added: []  # No runtime deps added — scripts use the existing project deps (ts-lsp-client, node-stream-zip, glob, etc.) via tsx
  patterns:
    - "Direct-LSP matrix harness (scripts/matrix-runner.ts): reuse production discoverJava/findJdtLs/startJdtLs/loadFabricMod/syncFabricModToWorkspace code paths but send LSP requests via the lsp-client directly — sidesteps stdio-MCP framing + tool-helpers wrappers when isolating which layer of the stack a Windows bug lives in."
    - "Per-row JDT LS spawn-line evidence capture via PowerShell `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*org.eclipse.equinox.launcher*' }` — produces tamper-evident proof of the resolved `javaPath` without needing src/** logger additions (RESEARCH.md Open Question §1 deferred)."

key-files:
  created:
    - ".planning/phases/39-windows-end-to-end-validation/39-04-SUMMARY.md - This document"
    - "scripts/matrix-runner.ts - Direct-LSP 4-row matrix executor (the path that produced this plan's row evidence; sidesteps Failure 1)"
    - "scripts/matrix-row.ts - Production stdio-MCP matrix harness (first attempt; surfaced Failure 1 — kept as the harness 39-06 must re-run after the fix)"
    - "scripts/jdtls-trace.ts - Step-by-step LSP diagnostic that isolated Failure 1's root cause (didOpen → reconcile/validate timing)"
    - "scripts/matrix-rows.json - Top-level index of per-row configurations"
    - "scripts/row1.json - Row 1 config (--java-home / Oracle JDK 21.0.11)"
    - "scripts/row2.json - Row 2 config (org.gradle.java.home / Oracle JDK 25.0.3)"
    - "scripts/row3.json - Row 3 config (JAVA_HOME / Oracle JDK 26.0.1)"
    - "scripts/row4.json - Row 4 config (PATH-only / Oracle JavaPath shim → JDK 26.0.1)"
    - "scripts/diag.json - Diagnostic config used by jdtls-trace.ts"
  modified:
    - ".planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md - Populated from scaffold: Environment + 4-row Matrix + Failures blocks + Goal Achievement scorecard + Verification Artifacts list"

key-decisions:
  - "Fell back to direct-LSP matrix-runner (scripts/matrix-runner.ts) for the matrix run because Failure 1 (withLspDocument race in src/tools/tool-helpers.ts) prevented the production stdio-MCP server path from ever returning a non-empty find_definition. Both paths use the same discoverJava/findJdtLs/startJdtLs/loadFabricMod/syncFabricModToWorkspace code — only stdio-MCP framing + withLspDocument is sidestepped. Documented inline in 39-VERIFICATION.md `## Matrix-runner deviation` per process-honesty."
  - "Skipped per-row Loom-cache deletion (D-03 inter-row cleanup item d) because the merged Minecraft sources jar is deterministic across rows on the same MC version + same Loom version — re-fetching ~80MB per row would 10x runtime without affecting JDT LS workspace behavior. Documented deviation, not a stealth shortcut."
  - "Skipped find_references in all 4 rows due to Failure 2 (no LSP request timeout + no $/cancelRequest plumbing → unbounded hang on workspace-wide classes like net.minecraft.resources.Identifier). All 4 rows still demonstrate one direction of the cross-jar contract (find_definition test mod → merged Minecraft jar)."
  - "Bundled both Failure 1 and Failure 2 fixes into a single recommended follow-up plan (39-06) rather than escalating to Phase 40. Both are D-13 small-fix scope (single-file changes + bounded test additions), neither requires architectural rework."
  - "Did NOT open 39-06-PLAN.md as part of this plan — the resume-signal language (`approved-with-gaps`) reserved that for the orchestrator's next planning action so the maintainer retains the option to scope 39-06 differently or escalate."

patterns-established:
  - "Process-honesty deviation block at the top of a verification report: when the production code path can't run the matrix as the plan specified, document WHY (with code references), document what fallback path was used, and document which parts of the original cleanup recipe were skipped + why. Future verifier auditing can see exactly which links in the verification chain are direct vs synthesized."
  - "Per-row JDT LS spawn-line evidence via Get-CimInstance: the maintainer captures argv0 in a separate PowerShell terminal while the LSP request is in flight, records the verbatim string in the matrix row, and the matrix-runner cross-checks against its own discoverJava resolution. Two-source agreement = tamper-evident javaPath evidence."
  - "Bare-name PATH entry semantics in matrix Row 4: per `resolveJavaExecutable` in src/jdtls/java-discovery.ts, bare candidates pass through unchanged on all platforms (UNIX-01 commitment) — libuv resolves at spawn via PATH lookup + PATHEXT. Win32_Process records the literal argv string, so Row 4's argv0 reads `java.exe` (not the resolved absolute path) — an expected, correct artifact of the design, NOT a bug or a placeholder."

requirements-completed: [UNIX-03]

# Metrics
duration: 1 day (cross-session; matrix run + diagnostic isolation of Failure 1 dominated wall-clock)
completed: 2026-05-25
---

# Phase 39 Plan 04: Windows 4-Row Java-Discovery Matrix Summary

**Empirically validated FabricModMCP on Windows 11 across all 4 Java-discovery slots — 4 distinct javaPath values resolved + cross-jar find_definition (test mod → merged Minecraft sources jar) succeeded under every slot — while surfacing two production-code bugs (`withLspDocument` race + unbounded `find_references` without LSP cancellation) for 39-06 gap closure.**

## Performance

- **Duration:** ~1 day cross-session (initial matrix-row.ts attempt + Failure 1 diagnostic isolation via jdtls-trace.ts + matrix-runner.ts v1/v2/v3 iterations + Failure 2 surfacing + final clean 4-row run + 39-VERIFICATION.md write-up)
- **Started:** 2026-05-24 (plan amended single-mod fixture)
- **Completed:** 2026-05-25T03:35:00Z (verification doc finalized)
- **Tasks:** 1 (single checkpoint:human-verify task)
- **Files modified:** 1 modified + 10 created (this SUMMARY + 9 scripts/* artifacts)

## Accomplishments

- All 4 Java-discovery slots empirically engaged on Windows 11 with 3 distinct JDK installs (Oracle JDK 21.0.11 / 25.0.3 / 26.0.1) + the Oracle JavaPath shim for PATH-only resolution. The 4 javaPath argv0 strings captured via `Get-CimInstance Win32_Process` are distinct: 3 absolute paths to 3 different JDKs + the bare `java.exe` name PATH-resolved by libuv to JDK 26.0.1. Slot-independence sanity check (D-04) passes with no single-JDK fallback needed.
- Cross-jar `find_definition` succeeded under every slot — JDT LS resolves the test mod's `Identifier` import (`net.minecraft.resources.Identifier`, unmapped/Mojang-mapped era) into the merged Minecraft sources jar at `template--minecraft/net/minecraft/resources/Identifier.java#L18` from the test mod's source position `TEMPLATE_PACKAGE/TEMPLATE_CLASSNAME.java#L11C22`. This is the load-bearing v1.6 claim ("FabricModMCP works on Windows") for the discovery + cross-jar surface.
- Surfaced and documented two production-code bugs with sufficient evidence + recommended fixes for 39-06 to close: Failure 1 (`withLspDocument` race in `src/tools/tool-helpers.ts:191-205` — sends `textDocument/definition` immediately after `didOpen` before JDT LS finishes reconciling on Windows's 10–14s reconcile/validate timeline) and Failure 2 (`find_references` on workspace-wide classes hangs indefinitely; no `$/cancelRequest` plumbing means the request-queue mutex in `src/jdtls/request-queue.ts:43-71` stays held by the pending request, blocking even `shutdown`).
- Built reusable matrix tooling under `scripts/` that future re-verification runs can drive directly: `matrix-runner.ts` for the direct-LSP path used in this run, `matrix-row.ts` for the production stdio-MCP path 39-06 must re-test after the `withLspDocument` fix, and `jdtls-trace.ts` for diagnosing JDT LS timing/event-ordering issues.
- Verification doc `.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md` populated end-to-end: Environment block (Windows build + shell + 3 JDK paths/versions + JDT LS path/version + Node + pnpm + git + FabricModMCP commit SHA + test mod path/jj change_id + chosen Minecraft class + Loom cache path), 4-row Matrix block with all checkboxes ticked, Failures block with 3 entries (2 D-13 small-fix gaps + 1 observation), Goal Achievement scorecard (5 VERIFIED + 3 PARTIAL out of 8 truths), Verification Artifacts inventory.

## Task Commits

This plan is a single checkpoint:human-verify task. The maintainer executed the matrix run + diagnostic iterations across multiple sessions; this continuation closes the checkpoint atomically.

1. **Task 1: Execute Windows 4-row Java-discovery matrix and populate 39-VERIFICATION.md** — closed by this continuation as `docs(phase-39-plan-04)` (single atomic commit staging this SUMMARY + the populated VERIFICATION + the 9 scripts/* artifacts)

_No per-task feat/test/refactor commits — the plan is verification-only; no src/** changes per phase CONTEXT.md._

## Files Created/Modified

- `.planning/phases/39-windows-end-to-end-validation/39-04-SUMMARY.md` — This summary (new)
- `.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md` — Populated from scaffold with Environment + Matrix + Failures + Goal Achievement + Verification Artifacts blocks (modified)
- `scripts/matrix-runner.ts` — Direct-LSP 4-row matrix executor (new). For each row: allocate fresh tempDir + dataDir + workspace via FabricModMCP's loadFabricMod + syncFabricModToWorkspace, start JDT LS via startJdtLs (engages the slot's discoverJava resolution), open the test mod's TEMPLATE_CLASSNAME.java, send `textDocument/definition` at the `Identifier` reference position, record javaPath + result count + target location, force-kill JDT LS child, repeat with next slot's env preconditions. Records both `result.javaPath` (FabricModMCP-resolved) and `result.jdtlsSpawnArgv0` (Get-CimInstance-captured) per row.
- `scripts/matrix-row.ts` — Production stdio-MCP matrix harness (new). Drives FabricModMCP's actual MCP server via spawn + JSON-RPC over stdio for one row at a time. Surfaced Failure 1 — kept in tree so 39-06 can re-run all 4 rows through it after the `withLspDocument` fix to migrate the matrix evidence from "direct-LSP fallback" back to "production MCP server" as the plan originally intended.
- `scripts/jdtls-trace.ts` — Step-by-step JDT LS LSP diagnostic (new). Bypasses both MCP framing AND tool-helpers wrappers; sends raw `initialize` → `initialized` → `didOpen` → `(explicit 10s sleep)` → `definition` and prints every protocol exchange. Used to isolate Failure 1 by proving JDT LS DOES resolve the definition correctly when given time to reconcile, but does NOT when asked immediately after didOpen.
- `scripts/matrix-rows.json` — Top-level index of per-row configurations (new). Loaded by matrix-runner.ts to enumerate the 4 rows.
- `scripts/row1.json` — Row 1 config: `--java-home C:\Program Files\Java\jdk-21.0.11` precondition (new).
- `scripts/row2.json` — Row 2 config: `org.gradle.java.home=C:\\Program Files\\Java\\jdk-25.0.3` precondition with JAVA_HOME unset + java stripped from PATH (new).
- `scripts/row3.json` — Row 3 config: `$env:JAVA_HOME = C:\Program Files\Java\jdk-26.0.1` precondition (new).
- `scripts/row4.json` — Row 4 config: PATH-only precondition (JAVA_HOME unset, no `--java-home`, no `org.gradle.java.home`, exactly one java on PATH via Oracle JavaPath shim) (new).
- `scripts/diag.json` — Diagnostic config consumed by jdtls-trace.ts (new). Records the trace target file + position + expected target location.

## Decisions Made

See `key-decisions` in frontmatter. Brief summary of the load-bearing ones:

- **Direct-LSP fallback instead of production stdio MCP server (matrix execution path).** Rationale: Failure 1 prevented the production path from ever returning non-empty find_definition results on Windows. The direct-LSP path uses every FabricModMCP domain module that participates in Java discovery + cross-jar resolution (discoverJava, findJdtLs, startJdtLs, loadFabricMod, syncFabricModToWorkspace) — only the stdio-MCP framing + `withLspDocument` wrapper is sidestepped. The plan's matrix-evidence value is preserved; the documented deviation is fully transparent in 39-VERIFICATION.md's process-honesty block at the top of the file.
- **Skipped Loom-cache deletion between rows (D-03 inter-row cleanup item d).** Rationale: the merged Minecraft sources jar contents are deterministic across rows (same MC version + same Loom version → byte-identical jar). Re-fetching ~80MB per row would 10x runtime without affecting JDT LS workspace behavior since the matrix workspace is freshly extracted per row anyway. The other D-03 cleanup steps (force-kill JDT LS, fresh tempDir/dataDir, reset env per slot) ARE performed every row.
- **Skipped find_references in all 4 rows.** Rationale: Failure 2 — `textDocument/references` on `Identifier` (a workspace-wide Minecraft class with thousands of internal usages) did not return within 45s; no LSP cancel notification is sent on timeout, so subsequent requests including shutdown queue indefinitely behind the still-pending references reply. Force-killing the JDT LS child is the only escape. The matrix accepts the one-direction-only cross-jar proof (find_definition only) and documents the gap explicitly in truth #8 of the Goal Achievement scorecard.
- **Bundle both failures into recommended 39-06 plan rather than escalating to Phase 40.** Rationale: both are D-13 small-fix scope. Failure 1 fix is a single async wait pattern (send a no-op `documentSymbol` request after `didOpen` and await it before proceeding — JDT LS only answers documentSymbol after AST is ready, so the response is guaranteed to follow the `Validated` log line). Failure 2 fix is per-tool wall-clock timeout via Promise.race + `lspClient.sendRequest('$/cancelRequest', { id: requestId })` on timeout to free the request-queue mutex. Neither requires architectural rework. Phase 40 escalation is reserved for findings that need their own discuss-phase, which these don't.
- **Did NOT open 39-06-PLAN.md as part of this plan.** Per the maintainer's resume signal language (`approved-with-gaps`), opening the gap-closure plan is left for the orchestrator's next planning action so the maintainer retains the option to re-scope or escalate.

## Deviations from Plan

This plan is a `checkpoint:human-verify` task — the executor agent does NOT run the matrix; the maintainer does. "Deviations" in the standard execution-rule sense (Rules 1–4 auto-fixes) don't apply because no code was modified. The maintainer-driven deviations from the plan's `<how-to-verify>` recipe are captured in 39-VERIFICATION.md's `## Matrix-runner deviation (process honesty)` block at the top of the report and re-summarized here:

### Process-Honesty Deviations

**1. [Matrix execution path] Driven via direct-LSP matrix-runner.ts instead of production stdio-MCP server**
- **Found during:** Initial matrix attempt via `scripts/matrix-row.ts` against the production stdio-MCP server
- **Issue:** `find_definition` returned 0 results across all 4 Java-discovery slots regardless of wait time (tested with 30s, 150s, 180s waits). Root cause isolated via `scripts/jdtls-trace.ts`: `withLspDocument` race in `src/tools/tool-helpers.ts:191-205` (see Failure 1 below)
- **Fix (for this matrix run):** Fell back to `scripts/matrix-runner.ts` which uses the same `discoverJava`/`findJdtLs`/`startJdtLs`/`loadFabricMod`/`syncFabricModToWorkspace` code paths but sends LSP requests directly via lsp-client (sidesteps stdio-MCP framing + the buggy `withLspDocument` wrapper)
- **Files modified:** None in this plan (the production-code fix belongs in 39-06)
- **Verification:** matrix-runner.ts v3 completed all 4 rows cleanly with find_definition N=1 per row, target verified at `net/minecraft/resources/Identifier.java#L18`
- **Documentation:** 39-VERIFICATION.md `## Matrix-runner deviation` block at top of report

**2. [Inter-row cleanup] Loom-cache deletion (D-03 item d) skipped between rows**
- **Found during:** Matrix-runner.ts v1 design phase
- **Issue:** D-03 mandates deleting `<projectRoot>/.gradle/loom-cache/` between every row. With the same MC version + same Loom version across all 4 rows, the merged Minecraft sources jar is byte-identical; re-fetching ~80MB per row would 10x runtime without affecting JDT LS workspace behavior since the matrix workspace is freshly extracted per row anyway
- **Fix (for this matrix run):** Reduced inter-row cleanup to: force-kill JDT LS child, allocate fresh tempDir + dataDir, reset env vars per slot. Kept the Loom cache populated once at start and reused
- **Files modified:** None
- **Verification:** The 4 rows still resolve to distinct javaPath values (slot-independence proven); cross-jar find_definition succeeds in every row (workspace resolution proven)
- **Documentation:** 39-VERIFICATION.md `## Matrix-runner deviation` block + truth #6 in Goal Achievement scorecard marked PARTIAL with rationale

**3. [Cross-jar BOTH directions requirement] find_references skipped in all 4 rows**
- **Found during:** Matrix-runner.ts v1 first attempt of Row 1
- **Issue:** `textDocument/references` on `Identifier` did not return within 45s; surfaces Failure 2 (no LSP request timeout + no `$/cancelRequest`). Force-killing JDT LS is the only escape
- **Fix (for this matrix run):** matrix-runner v3 skipped find_references entirely; rows record `find_references N=skipped (see Failure 2)` with explicit cross-reference to the gap
- **Files modified:** None
- **Verification:** All 4 rows still complete the one-direction cross-jar proof (find_definition test mod → merged Minecraft jar); truth #8 marked PARTIAL with explicit documentation
- **Documentation:** Per-row matrix line says `find_references N=skipped` + Failure 2 entry in `## Failures` + Goal Achievement truth #8 marked PARTIAL

---

**Total process-honesty deviations:** 3 (all documented in 39-VERIFICATION.md at the top of the report and in the Goal Achievement scorecard)
**Impact on plan:** Plan's load-bearing claim (Windows works under all 4 Java-discovery slots + cross-jar resolution succeeds) is empirically verified. Two production-code bugs surfaced for 39-06 closure — exactly the kind of Windows-specific findings the matrix was designed to detect (Phases 35–38 shipped behind mocks; this matrix caught what mocks couldn't). No scope creep into src/** (per phase CONTEXT.md).

## Issues Encountered

Three findings surfaced during the matrix run, all documented in 39-VERIFICATION.md's `## Failures` block with full evidence + recommended fixes:

- **Failure 1 — `withLspDocument` race (D-13 small-fix scope).** `src/tools/tool-helpers.ts:191-205` sends `textDocument/definition` immediately after `textDocument/didOpen` with no wait. JDT LS on this Windows host takes 10–14s to reconcile + validate a freshly-opened file (per `.metadata/.log` timeline captured by jdtls-trace.ts). Race wins on Windows → JDT LS replies to definition before imports are resolved → returns null → MCP envelope reports `total: 0`. Recommended 39-06 fix: send a no-op `textDocument/documentSymbol` round-trip after didOpen and await it before proceeding (documentSymbol response is guaranteed to follow the AST-ready / Validated log line).
- **Failure 2 — `find_references` unbounded + no LSP cancellation (D-13 small-fix scope).** `src/jdtls/request-queue.ts:43-71` serializes all subsequent `endpoint.send` calls behind the still-pending references reply. textDocument/references on `Identifier` didn't return within 45s; the script's Promise.race timeout fires but the underlying request stays queued, blocking even `shutdown`. Two matrix-runner runs had to be force-killed. Recommended 39-06 fix: per-tool wall-clock timeout via Promise.race + `lspClient.sendRequest('$/cancelRequest', { id: requestId })` on timeout to free the mutex.
- **Failure 3 — Two JDT LS sessions per MCP server startup (observation, not a verification blocker).** `src/index.ts:33-39` always creates a "default" project + JDT LS session at startup; `create_project` creates another. Two `java.exe` JDT LS processes per MCP server invocation, each holding a separate workspace tempDir + dataDir; ~100MB wasted RAM per startup. Not Windows-specific (same on Mac) but the matrix surfaced it as a "two-process Get-CimInstance snapshot" anomaly that took diagnostic time to rule out as a cause for Failure 1. Optional bundle into 39-06.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Phase 39 plan-04 close-out:**
- All 4 matrix checkboxes ticked in 39-VERIFICATION.md.
- Environment block populated with concrete values (no `<…>` placeholders remain).
- Failures block populated with 3 entries + recommended fixes.
- Goal Achievement scorecard: 5 fully verified + 3 partial out of 8 truths; the 3 partials all trace to Failures 1 & 2.
- Slot-independence (D-04): 4 distinct javaPath values, no single-JDK fallback needed.
- Cross-jar (one direction): verified in every row. Reverse direction (find_references OUT) blocked by Failure 2.

**Recommended next steps for the orchestrator:**
1. Open **39-06-PLAN.md** via `/gsd:plan-phase 39 --gaps` covering Failure 1 (withLspDocument race fix) + Failure 2 (LSP request timeout + $/cancelRequest plumbing). Failure 3 (lazy default-project JDT LS session) is an optional bundle.
2. After 39-06 ships, re-verify by re-running `scripts/matrix-row.ts` against the production stdio-MCP server (the path that originally failed). If it succeeds with `find_definition N=1` and bounded `find_references` reply across all 4 slots, the matrix evidence migrates from "captured via direct-LSP fallback" to "captured via production MCP server" as the plan originally intended.
3. Plan **39-05 (UNIX-03 regression sweep)** remains paused per maintainer choice — must be run on a macOS host, not this Windows machine. Phase 39 does NOT close until 39-05 runs.
4. v1.6 milestone gate: contingent on 39-05 + 39-06 (if opened) both completing.

**Blockers / concerns:**
- Phase 39 has incomplete plan 39-05 pending (UNIX-03 regression sweep, paused for macOS host availability).
- 39-06 gap-closure plan recommended but not yet opened — orchestrator owns the decision.
- v1.6 milestone cannot ship until both Failure 1 and Failure 2 are fixed (the production stdio-MCP server's `find_definition` is currently non-functional on Windows; that's the user-facing tool surface, not the direct-LSP path the matrix used as a workaround).

## Self-Check: PASSED

Manual verification of the success criteria:

- [x] `.planning/phases/39-windows-end-to-end-validation/39-04-SUMMARY.md` exists with the standard template sections populated (this file)
- [x] `.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md` contains required blocks: `## Environment` (Windows build + shell + 3 JDK paths/versions + JDT LS path/version + Node + pnpm + git + FabricModMCP SHA + test mod path), `## Matrix` (4 ticked rows each with javaPath + find_definition N + find_references N + cross-jar annotation + evidence-source), `## Failures` (3 entries with severity + recommended fix), `## Goal Achievement` (8-row scorecard with VERIFIED/PARTIAL status + evidence per truth), `## Verification Artifacts` (full inventory)
- [x] 5/8 must_haves VERIFIED + 3/8 PARTIAL (per Goal Achievement scorecard in 39-VERIFICATION.md); 3 partial truths all trace to Failures 1 & 2 which are bundled into recommended 39-06 gap-closure plan
- [x] No `<…>` placeholders remain in 39-VERIFICATION.md (confirmed via inspection of the populated file)
- [x] Cross-jar `find_definition` exercised in every row (test mod source `Identifier` reference → merged Minecraft sources jar `Identifier.java#L18`) — truth #8 partial only because the reverse direction (find_references OUT) is blocked by Failure 2
- [x] 4 distinct javaPath values captured (3 absolute paths to 3 different JDKs + 1 bare PATH-resolved entry); slot-independence sanity check (D-04) passes
- [x] Failure 1 + Failure 2 evidence fully captured inline in `## Failures` block of 39-VERIFICATION.md per D-07; recommended 39-06 gap-closure plan documented in `## Next Step` section of the verification doc

---

*Phase: 39-windows-end-to-end-validation*
*Completed: 2026-05-25*
