# Phase 39: Windows End-to-End Validation - Research

**Researched:** 2026-05-24
**Domain:** Manual milestone-completion validation (Windows smoke test + user-facing docs)
**Confidence:** HIGH

## Summary

Phase 39 is a milestone-completion checkpoint for v1.6 "Windows Support" — not a code phase. Its plannable work decomposes into five logical buckets: (1) fixture preparation outside the repo, (2) a 4-row Java-discovery matrix exercising the canonical happy path on a real Windows machine, (3) checkbox-style evidence capture in `39-VERIFICATION.md`, (4) writing `docs/WINDOWS-SUPPORT.md` and the CLAUDE.md `### Platform Support` subsection by quoting verbatim from `src/jdtls/java-discovery.ts` and `src/platform/index.ts`, and (5) a UNIX-03 regression sweep (`pnpm test` green on macOS + Linux).

The phase consumes 18 locked decisions (D-01 through D-18) from CONTEXT.md plus the ROADMAP success-criterion 4 reword already applied in the CONTEXT.md commit. There are no library/framework choices left to research — every tool involved (vitest, pnpm, JDT LS, fabric-example-mod, MCP stdio transport) is already pinned. The research deliverables are therefore (a) the exact insertion point for the new `### Platform Support` subsection in CLAUDE.md, (b) verbatim copy of both priority chains from source, (c) a flagged gap in evidence-capture infrastructure, (d) a concrete sibling-mod design that exercises cross-mod navigation deterministically, and (e) the validation architecture that lets `/gsd:verify-phase` and `gsd-validator` template a meaningful VALIDATION.md for a manual phase.

**Primary recommendation:** Structure the plan as **5 plans** (matching the 5 logical buckets above), with a `checkpoint:human-verify` gate after Plan 2 (the matrix runs) because the maintainer must physically operate a Windows machine — no agent can complete that work. Reserve numbering room for `39-NN-PLAN.md` gap-closure plans per D-13/D-14. The single highest-risk finding from this research: **the "JDT LS spawn line" evidence required by D-04 does not exist in the current logger output** — `src/jdtls/client.ts:188` calls `spawn(javaPath, ...)` with no preceding `logger.info(...)` line. The planner must address this (see "Common Pitfalls" §1 and "Open Questions" §1).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test fixture (Area 1a)**
- **D-01:** Fixture is `fabric-example-mod` (cloned upstream) + a hand-authored sibling mod that imports a class from it. Stored outside the FabricModMCP repo (e.g., `~/dev/fmm-phase39-fixture/{example-mod,sibling-mod}/`). Sodium/Lithium/Iris real mods rejected.

**Test sequence (Area 1b)**
- **D-02:** Happy path × 4 Java-discovery entry-point matrix. Same 4-step happy path (`create_project` → `add_fabric_mod` → `find_definition` → `find_references` with cross-mod navigation) run four times, once per Java-discovery entry point. JDT LS spawn line captured per row.
- **D-03:** Between matrix runs: kill stray JDT LS processes (`Stop-Process` matching `java.exe` with `org.eclipse.equinox.launcher` in command line), `gradle --stop`, delete `<projectRoot>/.gradle/loom-cache/`.
- **D-04:** Verify which JDK was selected per matrix row (resolved `javaPath` from JDT LS spawn line). The 4 rows MUST resolve to different `javaPath` values (or document explicitly if user has only one JDK installed).
- **D-05:** Out of scope — full tool surface sweep. Only `create_project`, `add_fabric_mod`, `find_definition`, `find_references` exercised.

**Evidence capture (Area 1c)**
- **D-06:** Checkbox manifest in `39-VERIFICATION.md` (NOT a separate `39-VALIDATION-REPORT.md`). One-line per matrix row.
- **D-07:** Capture stdout/stderr ONLY for failures.
- **D-08:** Environment block at top of verification doc (~6 lines): Windows build, shell, JDK install method, Node.js version.
- **D-09:** Tradeoff acknowledged — future Windows-regression triage harder without full transcripts.

**Docs scope (Area 2)**
- **D-10:** Standalone `docs/WINDOWS-SUPPORT.md`; no README.md created in this phase. Top-level README remains absent until v1.7+.
- **D-11:** Required content for `docs/WINDOWS-SUPPORT.md`:
  1. Java discovery priority chain (5 slots).
  2. JDT LS install locations probed (5 slots: `JDTLS_HOME` env → `%LOCALAPPDATA%\jdtls` → `%PROGRAMFILES%\jdtls` → `%USERPROFILE%\jdtls` → `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`).
  3. Known limitations: 260-char path limit (`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` mitigation); WSL note.
  4. Installation pre-reqs (Java 21+, JDT LS milestone, Node.js 22+, pnpm).
- **D-12:** ROADMAP success criterion 4 reworded across 3 sites in `.planning/ROADMAP.md` (lines 104, 173, 180) — already applied in CONTEXT.md commit.

**Failure-handling protocol (Area 3)**
- **D-13:** Default protocol = fix-in-place inside Phase 39 (matches 36/37 4+1 precedent). Open `39-NN-PLAN.md` gap-closure plans.
- **D-14:** Pre-authorized escalation to Phase 40 if finding needs its own discuss-phase cycle.
- **D-15:** NOT acceptable — document-as-known-issue defer to v1.7. Exception: genuinely-environmental edge cases (AV interactions, etc.) documented in "Known limitations" block.

**CLAUDE.md update (Area 4)**
- **D-16:** New `### Platform Support` subsection INSIDE existing `## Technology Stack` section (sibling to "Language & Runtime", "MCP Framework", etc.). NOT a top-level section.
- **D-17:** Both priority chains inlined verbatim, not pointer-only.
- **D-18:** Drift mitigation — CLAUDE.md `### Platform Support` and `docs/WINDOWS-SUPPORT.md` both end with: "Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02. Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS)."

### Claude's Discretion

- `docs/WINDOWS-SUPPORT.md` length and tone (recommended target 80-150 lines).
- Format of priority chains in CLAUDE.md (numbered list vs table — numbered list under prose intro likely cleaner).
- Ordering inside `docs/WINDOWS-SUPPORT.md` (suggested: install pre-reqs → Java chain → JDT LS chain → known limitations).
- Whether to also add a Phase 39-specific entry to CHANGELOG.md / NOTES.md (no CHANGELOG.md exists — planner can defer or skip).
- ROADMAP Phase 39 "Plans" subsection cleanup — currently lists Phase 36 plans (copy-paste bug); rewrite during `/gsd:plan-phase 39`.

### Deferred Ideas (OUT OF SCOPE)

- Full v1.6 README.md — deferred to v1.7+.
- Full validation report markdown with screenshots + transcripts — explicitly rejected.
- Automated Windows CI runner — out of scope for v1.6.
- Tool reference / contributing guide — v1.7+.
- CHANGELOG.md start — deferred.
- Long-path-enable bit auto-detection — v1.7+.
- Probing VS Code's bundled JDT LS — REQUIREMENTS.md "Out of Scope".
- `--jdtls-home` CLI flag — deferred from Phase 38.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UNIX-03 | All v1.5 + v1.6 vitest tests pass unchanged after the refactor (regression guard) | This phase satisfies UNIX-03 by running `pnpm test` on macOS and Linux as the regression-guard step. Test infrastructure: vitest 4.x, 72 `.test.ts` files in `tests/` (verified via `find tests -name '*.test.ts'`). Phases 35-38 already added Windows-mocked describes via `setPlatform + vi.resetModules + dynamic import` (Phase 35 PATTERNS.md). No new test code is added in Phase 39 — UNIX-03 is satisfied by a full-suite green run, not new tests. |

Milestone-level requirements this phase **validates end-to-end** (not itself implementing — those phases are 35-38):

| ID | Description | Validation Path |
|----|-------------|-----------------|
| WIN-01 | JDT LS spawns successfully on Windows when Java home is supplied via `--java-home`, `JAVA_HOME`, or discovery | Matrix rows 1, 3, 4 exercise this — each happy path must produce a JDT LS spawn (proven by `find_definition` returning non-empty). |
| WIN-02 | `findJdtLs()` discovers JDT LS on Windows | Matrix preconditions — JDT LS install must be at one of the 4 candidate locations OR `JDTLS_HOME` set. All 4 rows depend on this. |
| WIN-03..07 | URI handling on Windows (drive-letter case, ZIP split, EBUSY retry, path-traversal) | Exercised indirectly via `add_fabric_mod` (Loom cache → workspace sync) and `find_definition` (JDT LS `Location.uri` → tool response). Failure here manifests as `find_definition` returning empty or `add_fabric_mod` throwing. |
| JAVA-01..05 | Smarter Java discovery priority chain, version-skip, properties unescape, scan, 3s timeout | Matrix rows 1, 2, 3, 4 directly exercise slots 1, 2, 3, 4 of the priority chain respectively. Slot 5 (common-location scan) only fires when slots 1-4 all fail — not directly exercised but assumed working from Phase 37 unit tests. |
| UNIX-01, UNIX-02 | Unix behavior byte-identical | UNIX-03 regression sweep covers — if any Phase 35/36 Windows fix regressed Unix, vitest catches it. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Test fixture (`fabric-example-mod` clone + sibling mod) | External (filesystem under `~/dev/fmm-phase39-fixture/`) | — | Lives OUTSIDE the repo per D-01. The fixture is data that the maintainer's MCP runs consume — no FabricModMCP code touches it. |
| 4× happy-path matrix execution | External (Windows machine + MCP server stdio + maintainer-driven Claude Code client) | — | Manual smoke test by maintainer. No CI runner. Each row drives the MCP server's `stdio` transport from a Claude Code session on Windows. |
| Evidence capture | Repo (`.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md`) | — | Single artifact produced by `/gsd:verify-phase`. Checkbox manifest + env block + per-row excerpts. |
| `docs/WINDOWS-SUPPORT.md` | Repo (new `docs/` directory) | — | First file in `docs/`; the dir is created by this phase. User-facing reference linked from future README. |
| `### Platform Support` in CLAUDE.md | Repo (`CLAUDE.md` `## Technology Stack` section, sibling subsection) | — | Inlined for session-context discoverability. Costs ~30-50 lines per session per D-16/D-17. |
| ROADMAP "Plans" subsection cleanup | Repo (`.planning/ROADMAP.md` lines 181-185) | — | Mechanical edit during `/gsd:plan-phase` — replace Phase 36 plan list with actual Phase 39 plans. |
| UNIX-03 regression sweep | External (developer's macOS + Linux machines) | Repo (`pnpm test` exit code) | `pnpm test` invocation; no new tests; existing suite must pass green. |
| Gap-closure plans (if matrix uncovers bugs) | Repo (`src/**`, `tests/**` — exception to "MUST NOT modify" per D-13) | — | Triggered only on failure. `39-NN-PLAN.md` for in-phase fixes; escalate to Phase 40 if any finding needs discuss-phase. |

## Standard Stack

This phase introduces **zero new libraries or framework choices**. Every tool involved is already pinned by the project's Technology Stack in CLAUDE.md.

### Core (already pinned, no version verification needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.x [VERIFIED: package.json devDependencies] | Regression suite execution | Already the project test runner; UNIX-03 satisfied by `pnpm test` (= `vitest run`) returning exit 0 on macOS and Linux. |
| pnpm | 10.26.0 [VERIFIED: package.json packageManager] | Package manager / script runner | Project-pinned; runs the test suite via `pnpm test`. |
| Eclipse JDT LS | Latest milestone [CITED: REQUIREMENTS.md, Phase 38 D-01] | Java language server (matrix validates spawn) | Validated as a black box — Phase 39 doesn't change how it's invoked. Phase 38 D-01 locks the launcher-jar probe pattern. |

### Supporting (fixture-side tools the maintainer needs on Windows)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Git for Windows | latest | Clone `fabric-example-mod` upstream | Once during fixture setup. |
| JDK 21+ (multiple installs) | 21+ [CITED: REQUIREMENTS.md JAVA-02] | Matrix requires distinct JDKs to prove slot independence (D-04) | Recommended: Adoptium Temurin 21 + Microsoft Build of OpenJDK 21 + one from PATH. Two distinct JDKs minimum lets the 4 matrix rows resolve to ≥2 different `javaPath` values; if user has only one JDK, D-04 says document explicitly in verification doc. |
| Fabric Loom (Gradle plugin) | Whatever upstream `fabric-example-mod` master uses | Builds the cloned upstream + sibling mod | Loom configures Yarn mappings + Minecraft sources; FabricModMCP reads the resulting `gradle.properties` and Loom cache. No version pin needed — clone master. |

**No installation step in this phase.** Every library this phase touches is already a dependency (`vitest`, `pnpm`, `glob`, etc.) or an external user-installed tool (Git, JDK, JDT LS milestone). [VERIFIED: package.json — no new dependencies needed.]

## Package Legitimacy Audit

> **N/A — this phase installs no packages.** Phase 39 is a docs + validation + manual-test phase. No `pnpm add`, no `npm install`, no new dependency lines in `package.json`. The slopcheck/registry-verification gate is not applicable.
>
> If a gap-closure plan (`39-NN-PLAN.md` per D-13) triggered by matrix failure needs a new dependency, that plan MUST run the Package Legitimacy Gate protocol itself before adding the dep.

## Architecture Patterns

### System Architecture Diagram

Data flow for the matrix execution:

```
[Maintainer on Windows]
       │
       ▼
[Claude Code (Windows)]
       │  (MCP stdio)
       ▼
[FabricModMCP server (Windows, tsx src/index.ts)]
       │
       ├─► [Java discovery: discoverJava({ projectRoot })]
       │       └─► slot 1..5 resolves → javaPath
       │
       ├─► [JDT LS discovery: findJdtLs()]
       │       └─► JDTLS_HOME or jdtlsCandidateDirs() match → jdtlsHome
       │
       ├─► [spawn(javaPath, [-jar, launcher.jar, ...])]   ◄── EVIDENCE TARGET (D-04)
       │       │
       │       ▼
       │   [JDT LS JVM process (stderr → logger.debug)]
       │       │
       │       ▼
       │   [LSP requests over stdio: definition, references]
       │       │
       │       ▼
       │   [JDT LS responses → tool result envelopes]
       │
       └─► [stdio response back to Claude Code]
                │
                ▼
       [Maintainer records: javaPath, find_definition N results, find_references N results]
                │
                ▼
       [.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md]
```

Between rows the maintainer executes the D-03 cleanup recipe (kill JDT LS, `gradle --stop`, delete loom-cache) and changes the Java-discovery entry-point precondition for the next row.

### Recommended Project Structure

```
.planning/phases/39-windows-end-to-end-validation/
├── 39-CONTEXT.md                  (exists — 190 lines, 18 locked decisions)
├── 39-RESEARCH.md                 (this file)
├── 39-01-PLAN.md ... 39-05-PLAN.md (created by /gsd:plan-phase 39)
├── 39-VERIFICATION.md             (created by /gsd:verify-phase 39 — D-06 manifest)
└── 39-VALIDATION.md               (created by gsd-validator — Validation Architecture section below)

docs/                              (CREATED by this phase)
└── WINDOWS-SUPPORT.md             (80-150 lines per D-11)

~/dev/fmm-phase39-fixture/         (OUTSIDE repo per D-01)
├── example-mod/                   (git clone https://github.com/FabricMC/fabric-example-mod)
│   └── src/main/java/net/fabricmc/example/ExampleMod.java   (canonical target for find_definition)
└── sibling-mod/                   (hand-authored, see Code Examples §1)
    ├── gradle.properties          (mirror upstream Loom baseline)
    ├── build.gradle.kts           (Loom + dependency on example-mod source set OR sibling project)
    └── src/main/java/com/example/sibling/SiblingMod.java   (imports net.fabricmc.example.ExampleMod)
```

### Pattern 1: Manual-Validation Phase Plan Structure

**What:** A phase whose work cannot be agent-executed end-to-end requires a `checkpoint:human-verify` task between agent-completable plans and human-completable plans.

**When to use:** Any phase where success criteria depend on physical hardware access (Windows machine), human-only observability (visual UI test, ergonomics), or external service interaction the agent has no credentials for.

**Example structure:**

```
Plan 1 (agent-executable): Write docs/WINDOWS-SUPPORT.md (read source, compose prose)
Plan 2 (agent-executable): Add ### Platform Support to CLAUDE.md
Plan 3 (agent-executable): ROADMAP "Plans" subsection cleanup
                ─── checkpoint:human-verify ───
Plan 4 (human-executable): Fixture creation + 4-row matrix execution + verification doc
Plan 5 (agent-executable): UNIX-03 regression sweep (pnpm test on macOS+Linux)
```

**Source:** Matches the `checkpoint:` task pattern referenced in `$HOME/.claude/get-shit-done/agents/gsd-planner.md` and existing in-repo plan precedent (Phase 38 plans use `task` directly; manual checkpoints are a planner construct). The verifier (`/gsd:verify-phase`) reads the checkbox state in `39-VERIFICATION.md` to gate plan-4 completion.

### Pattern 2: Verbatim Source Quoting for Drift Mitigation

**What:** When the same contract lives in 3+ sources (REQUIREMENTS, doc-comment header, prose docs, CLAUDE.md), each location MUST cross-reference the others with an explicit "Source of truth: …" footer (D-18).

**When to use:** Multi-source contracts where each surface answers a different question ("What is the chain?" in REQUIREMENTS; "How is it implemented?" in `java-discovery.ts:9-13`; "How does the user trigger each slot?" in `docs/WINDOWS-SUPPORT.md`).

**Example footer text (D-18 verbatim):**

```
Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02.
Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS).
```

This footer appears at the bottom of `docs/WINDOWS-SUPPORT.md` AND at the bottom of the new `### Platform Support` subsection in CLAUDE.md.

### Pattern 3: Checkbox Manifest Evidence (D-06)

**What:** One markdown checkbox per matrix row, with key one-line excerpts embedded in the same line, in `39-VERIFICATION.md`. No separate validation report file.

**Template:**

```markdown
## Environment

- Windows: 11 24H2 (Build 26100)
- Shell: PowerShell 7.4.6
- JDK installs:
  - Adoptium Temurin 21.0.5 at C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot\
  - Microsoft Build of OpenJDK 21.0.5 at C:\Program Files\Microsoft\jdk-21.0.5.11-hotspot\
- JDT LS: 1.41.0 at %LOCALAPPDATA%\jdtls
- Node.js: v22.13.0
- FabricModMCP: commit <SHA>

## Matrix

- [ ] **Row 1 — `--java-home`**: javaPath=`C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot\bin\java.exe`, find_definition returned N=1, find_references returned N=3 (cross-mod sibling-mod → example-mod)
- [ ] **Row 2 — `org.gradle.java.home`**: javaPath=`C:\Program Files\Microsoft\jdk-21.0.5.11-hotspot\bin\java.exe`, …
- [ ] **Row 3 — `JAVA_HOME`**: javaPath=…
- [ ] **Row 4 — PATH only**: javaPath=…

## Failures

(none — or stdout/stderr pasted inline per D-07 if any row failed)
```

### Anti-Patterns to Avoid

- **Building a separate `39-VALIDATION-REPORT.md` file.** Explicitly rejected by D-06. All evidence lives in `39-VERIFICATION.md`.
- **Including screenshots or full transcripts in the verification doc.** D-09 trades archival completeness for ship velocity.
- **Treating the matrix as automatable.** Three of the four entry points (`org.gradle.java.home`, `JAVA_HOME`, PATH-only) require modifying real environment state on a real Windows machine. Don't plan a CI workflow.
- **Putting `### Platform Support` as a top-level `## Platform Support`.** D-16 says INSIDE `## Technology Stack`, sibling to "Language & Runtime" etc.
- **Using third-party real mods (Sodium / Lithium / Iris) as fixture.** D-01 rejected — failure modes conflate with FabricModMCP bugs.
- **Skipping the loom-cache delete between rows.** D-03 — a JDT LS workspace baked under JDK A will keep serving requests under JDK B's spawn line, defeating D-04.
- **Trusting that the JDT LS spawn line is logger-visible today.** **It is NOT** — see Common Pitfalls §1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Validation report format | Custom markdown validation-report template | `39-VERIFICATION.md` standard layout produced by `/gsd:verify-phase` | D-06 explicitly rejects a separate validation report. The verifier already templates this doc. |
| Checkpoint between agent + human work | Inline "STOP AND ASK USER" prose in a plan task | `checkpoint:human-verify` task type | The planner has a first-class construct for agent/human handoff; ad-hoc prose is ignored by the executor. |
| Documenting priority chains | Paraphrase from memory | Quote verbatim from `src/jdtls/java-discovery.ts:8-13` doc-comment and `src/platform/index.ts:60-87` `jdtlsCandidateDirs()` body | D-18 drift mitigation requires quotes that match source; paraphrase introduces drift on the first refactor. |
| Sibling-mod scaffolding | Custom mod template from scratch | Copy upstream `fabric-example-mod` `gradle.properties` + `build.gradle.kts` + change `mod_id`, add `dependencies { implementation(project(":example-mod")) }` (or include the source set) | Loom is finicky — the canonical baseline already works. Diff-minimal sibling. |
| Verification-doc structure | New ad-hoc layout | Existing `38-VERIFICATION.md` / `37-VERIFICATION.md` pattern as template | Phases 36-38 already established the standard layout; the verifier reads it consistently. |
| Logging the resolved `javaPath` for evidence | Asking the maintainer to scrape JDT LS stderr line-by-line | Either (a) accept Windows Task Manager / Process Hacker observation of the JDT LS child's command-line argv0, OR (b) add a single `logger.info` line in `src/jdtls/client.ts:startJdtLs` body — but that's a `src/**` modification, see Open Questions §1 | Process-tree introspection is the cheapest evidence path that doesn't violate "MUST NOT modify src/**". |

**Key insight:** This phase has *zero* novel engineering — every artifact follows an established repo or GSD-framework pattern. The planner's job is to compose the existing patterns in the right order with a `checkpoint:human-verify` gate at the right place.

## Runtime State Inventory

> **Trigger evaluation:** Phase 39 is NOT a rename/refactor/migration phase. It produces new docs files (`docs/WINDOWS-SUPPORT.md`), one new section in `CLAUDE.md`, one new verification doc, and one ROADMAP edit. No runtime state migration is involved.

Section omitted — non-applicable to a manual-validation/docs phase.

## Common Pitfalls

### Pitfall 1: JDT LS Spawn Line Evidence Does Not Exist Today

**What goes wrong:** D-04 mandates capturing the resolved `javaPath` from the JDT LS spawn line per matrix row. The CONTEXT.md assumes such a log line exists in the server's output. It does not.

**Why it happens:** [VERIFIED: `grep -n logger src/jdtls/client.ts`] The `startJdtLs` function at `src/jdtls/client.ts:159-261` calls `spawn(javaPath, [...args])` at line 188 with no preceding `logger.info(...)` that records `javaPath`. The only spawn-adjacent log output is `logger.debug('JDT LS stderr', { data: ... })` at line 254 (and `language/status` events at line 275 inside `waitForReady`) — neither emits the resolved `javaPath`. At `logger.setLevel('info')` (the default in `src/logging/logger.ts:8`) the maintainer sees NOTHING from `startJdtLs` until `JDT LS process exited with code N` (line 90 of `startup.ts`, warn-level).

**How to avoid:** Three viable options the planner must pick from:
1. **Scrape via Windows Task Manager / Get-Process** — the maintainer captures the JDT LS child's command-line argv (argv[0] = `javaPath`) using PowerShell `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*org.eclipse.equinox.launcher*' } | Select-Object CommandLine` while the matrix row's `find_definition` is in flight. Zero `src/**` modification. Cumbersome but compliant with the "MUST NOT modify src/**" rule.
2. **Run server with `logger.setLevel('debug')`** — `src/jdtls/java-discovery.ts:368-370` does emit `logger.debug('Java candidate skipped', { candidate, reason })` per failed candidate. The *successful* slot doesn't emit anything by symmetry (it returns immediately on first success). So debug level helps with the failed-slot audit trail but still does not directly emit the successful `javaPath`. Partial mitigation only.
3. **Add one `logger.info('Spawning JDT LS', { javaPath, jdtlsHome })` line** in `src/jdtls/client.ts:startJdtLs` immediately before the `spawn` call at line 188. This is a `src/**` modification. CONTEXT.md "MUST NOT modify src/**" carves out an exception ONLY for gap-closure plans triggered by failures (D-13). The planner must decide whether observability-gap is itself a "finding" that justifies a gap-closure plan, OR escalate to ask the user during planning. Recommendation: **treat this as a known-before-execution gap and pre-authorize a one-line addition** (matches the spirit of D-13 — the matrix cannot satisfy D-04 without it; deferring discovery of this gap to phase execution wastes a manual-test cycle).

**Warning signs:** When the maintainer asks "where does javaPath show up in the logs?" or sends a failed-row report missing the javaPath field.

### Pitfall 2: Java-Discovery Slot Leakage Between Matrix Rows

**What goes wrong:** Row 1 (`--java-home`) sets the module-state `configuredJavaHome` in `java-discovery.ts:45` via `setJavaHome(s)`. If the MCP server is not restarted between rows, that module state persists — Row 2 (`org.gradle.java.home`) will silently use slot 1 (still set from Row 1) and resolve to the wrong `javaPath`. The matrix is then meaningless.

**Why it happens:** Module state in TypeScript ESM persists for the lifetime of the process. The CLI `--java-home` flag only takes effect at startup via `src/cli/`. D-03 covers the JDT LS process and the Loom cache but does not explicitly say "restart the MCP server between rows."

**How to avoid:** Add an explicit "restart the MCP server" step to the inter-row D-03 recipe. The planner should expand D-03's bullet list in the manual-test plan to:
- Kill JDT LS processes
- `gradle --stop`
- Delete `<projectRoot>/.gradle/loom-cache/`
- **Restart the MCP server** (Ctrl+C in Claude Code's MCP-server pane; then reissue with the next row's discovery precondition)
- **Verify**: between rows clear `JAVA_HOME` (Row 1, 2, 4), unset `--java-home` flag (Rows 2, 3, 4), remove `org.gradle.java.home` from `gradle.properties` (Rows 1, 3, 4).

**Warning signs:** Two adjacent rows report the same `javaPath` despite different preconditions.

### Pitfall 3: Phase 38 Per-Project Workspace Re-sync Subtlety

**What goes wrong:** Cross-mod `find_references` (Row 1's "sibling-mod uses ExampleMod, jump from definition to references") depends on Phase 37 CR-01 (gap closure 37-05-PLAN.md) wiring `syncFabricModToWorkspace` into `retryDegradedJdtLsSessions`. If the first `add_fabric_mod` (example-mod) succeeds but JDT LS was degraded at server startup (Java not yet found), the rescue path must re-sync; if `find_references` is run before the second `add_fabric_mod` (sibling-mod) is synced into the rescued workspace, references will be empty.

**Why it happens:** [VERIFIED: `src/jdtls/startup.ts:167-181`] The rescue loop iterates `project.children.values()` and syncs each fabric-mod child into the freshly-created workspace. This happens at `add_fabric_mod` time, but only when JDT LS was previously degraded. If the matrix executes `add_fabric_mod(example-mod)` → `add_fabric_mod(sibling-mod)` → `find_references` with no startup degradation, no rescue is needed and the path is uneventful. The pitfall is specific to startup-failure-then-recovery cases.

**How to avoid:** The maintainer should explicitly verify after `add_fabric_mod` of each child that JDT LS reports `available: true` (look for `JDT LS reinit succeeded` log entries if rescue happened). The matrix happy-path assumes no degradation; if a row hits degradation, the verifier doc captures it as an unexpected condition.

**Warning signs:** `find_definition` returns results but `find_references` returns empty — symptom of workspace containing only the definition's mod but not the referencing mod.

### Pitfall 4: Long-Path 260-Char Limit Hits `tmpdir()` Workspace

**What goes wrong:** [VERIFIED: `src/jdtls/startup.ts:68`] `initJdtLsSession` writes `tempDir = join(tmpdir(), 'mcp-jdtls-' + randomUUID())`. On Windows `tmpdir()` typically resolves to `C:\Users\<username>\AppData\Local\Temp\` which is ~40-60 chars before the `mcp-jdtls-<uuid>` (37 chars) suffix. ZIP extractions of dependency source jars (`workspace-sync.ts`) add `dep-<id>\net\fabricmc\fabric\impl\...\<deep-class>.java` paths. A long Fabric API namespace can easily push past 260 chars on a username like `LoganDarkSandboxedUserAccount`.

**Why it happens:** The 260-char `MAX_PATH` constant predates modern Windows. Node 22 enables long-path support automatically when the `LongPathsEnabled` registry value is `1` (Windows 10 1607+), but the user must opt in via Group Policy or registry. [CITED: REQUIREMENTS.md "Out of Scope" — UNC `\\?\C:\…` conversion deferred until empirically observed.]

**How to avoid:** `docs/WINDOWS-SUPPORT.md` "Known limitations" block (D-11.3) documents this with mitigation: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` registry setting OR Group Policy. The matrix may not hit this in practice with a default username but the doc must call it out.

**Warning signs:** `add_fabric_mod` throws an `ENOENT` or `ENAMETOOLONG` error during workspace extraction; `find_definition` returns empty after a previously-successful `add_fabric_mod`.

### Pitfall 5: ROADMAP Phase 39 "Plans" List Is Stale (Copy-Paste Bug)

**What goes wrong:** [VERIFIED: `.planning/ROADMAP.md:181-185`] The Phase 39 "Plans" subsection currently lists Phase 36 plans (`36-01-PLAN.md` through `36-04-PLAN.md`) — clearly a copy-paste artifact from a prior ROADMAP edit. If `/gsd:plan-phase 39` doesn't rewrite this subsection, the ROADMAP will be self-contradictory after Phase 39 plans are written.

**How to avoid:** The planner's first ROADMAP touch in Plan 3 (or whichever plan touches ROADMAP.md) replaces lines 181-185 with the actual Phase 39 plan list. Explicit task in the plan: "Replace ROADMAP lines 181-185 (`36-0X-PLAN.md` entries) with `39-0X-PLAN.md` entries reflecting the actual Phase 39 plans."

**Warning signs:** Verifier sees `36-01-PLAN.md` references in the Phase 39 section after Phase 39 ships.

### Pitfall 6: `fabric-example-mod` Master Branch Targets Latest MC Version

**What goes wrong:** [CITED: GitHub repo description, search results] The `master` branch of `fabric-example-mod` tracks the latest stable Minecraft release. By the time Phase 39 is executed, the upstream may have advanced; the Yarn mappings hash will differ; the Loom version may bump. The fixture is *deliberately* untyped on MC version (D-01: "well-known-good gradle.properties").

**How to avoid:** The maintainer clones whatever master is at fixture-creation time and the matrix runs against THAT version. The verification doc's environment block (D-08) records the cloned commit SHA. Future re-runs of the fixture either re-clone or pin to that SHA.

**Warning signs:** Gradle build fails during the upstream clone build — likely a transient upstream incompatibility unrelated to FabricModMCP.

## Code Examples

Verified patterns from official sources and existing repo code:

### Example 1: Sibling-Mod Minimal Source That Exercises Cross-Mod Navigation

```java
// ~/dev/fmm-phase39-fixture/sibling-mod/src/main/java/com/example/sibling/SiblingMod.java
//
// Minimal scaffold: implements ModInitializer (required by Loom to load),
// imports a class from fabric-example-mod (exercises per-project JDT LS workspace
// cross-mod navigation), and references one of its members so find_references
// from ExampleMod returns this file as a result.
package com.example.sibling;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.example.ExampleMod;   // <-- cross-mod import; JDT LS resolves this

public class SiblingMod implements ModInitializer {
	@Override
	public void onInitialize() {
		// Reference an ExampleMod symbol so find_references on ExampleMod has
		// a non-trivial result. Field LOGGER is canonical in fabric-example-mod's
		// ExampleMod class (per FabricMC convention since 1.19).
		System.out.println("SiblingMod loaded; ExampleMod LOGGER name: "
			+ ExampleMod.LOGGER.getName());
	}
}
```

**Cross-mod navigation test in the matrix:**

- `find_definition(file=SiblingMod.java, line=N, col=M)` where line N points to `ExampleMod` → expect navigation INTO `fabric-example-mod`'s `ExampleMod.java`, proving per-project JDT LS workspace covers both children.
- `find_references(file=ExampleMod.java, line=N, col=M)` where line N points to the class declaration → expect at least one result in `SiblingMod.java`, proving reverse direction works.

**Source:** Pattern derived from FabricMC official template ([Fabric Template Mod Generator](https://fabricmc.net/develop/template/)) + cross-mod dependency conventions ([Fabric Loom Documentation](https://docs.fabricmc.net/develop/loom/)).

### Example 2: Verbatim Quote of Java Priority Chain from `src/jdtls/java-discovery.ts:8-13`

Use this verbatim in both `docs/WINDOWS-SUPPORT.md` and the CLAUDE.md `### Platform Support` subsection:

```
Slot order for `discoverJava`:
  1. `--java-home` (module-state `configuredJavaHome`)
  2. `org.gradle.java.home` from `<projectRoot>/gradle.properties`
  3. `JAVA_HOME` env var
  4. `java` on PATH (libuv handles PATH lookup + PATHEXT on Windows)
  5. Scan common install locations from `commonJavaLocations()` with
     vendor-aware layout map
```

**Source:** [VERIFIED: `src/jdtls/java-discovery.ts` lines 8-13, doc-comment header, read 2026-05-24]

### Example 3: Verbatim JDT LS Candidate Chain from `src/platform/index.ts:70-87`

Use this verbatim:

```
Windows (in priority order):
  1. $JDTLS_HOME (env var; if set, must contain plugins/org.eclipse.equinox.launcher_*.jar)
  2. %LOCALAPPDATA%\jdtls
  3. %ProgramFiles%\jdtls
  4. %USERPROFILE%\jdtls
  5. %LOCALAPPDATA%\nvim-data\mason\packages\jdtls

Linux / macOS (in priority order):
  1. $JDTLS_HOME (env var; if set, must contain plugins/org.eclipse.equinox.launcher_*.jar)
  2. ~/.local/share/jdtls
  3. /usr/local/share/jdtls
  4. ~/jdtls
```

**Source:** [VERIFIED: `src/platform/index.ts:70-87` `jdtlsCandidateDirs()` function body, read 2026-05-24] Note: `JDTLS_HOME` is consumed by `src/jdtls/client.ts:findJdtLs` BEFORE iterating `jdtlsCandidateDirs()`, so it logically heads each chain even though it's not in the function body itself. [VERIFIED: `src/jdtls/client.ts:117-134`]

### Example 4: CLAUDE.md Insertion Point

[VERIFIED: `CLAUDE.md` read 2026-05-24] The new `### Platform Support` subsection inserts inside the `<!-- GSD:stack-start source:research/STACK.md -->` block. Suggested insertion point:

```
... (existing) ...
| @types/node | 22.x | Node.js type definitions | Match Node.js 22 LTS runtime. | HIGH |

### Platform Support              ← NEW SUBSECTION INSERTS HERE

FabricModMCP runs on Linux, macOS, and Windows ... (prose intro) ...

#### Java Discovery Priority Chain
1. ...
2. ...

#### JDT LS Install Locations (probed in priority order)
1. ...

Known limitations: ...

Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02.
Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS).

### Supporting Libraries          ← EXISTING — sibling subsection after new one
... (existing) ...
```

**Rationale:** Sibling to existing "Language & Runtime", "MCP Framework", etc. (D-16). Recommend placing between "Build & Development" and "Supporting Libraries" so the platform context bridges runtime-tooling and library choices.

### Example 5: Manual-Verification Checkpoint Plan Task

```yaml
# 39-04-PLAN.md (example task)
tasks:
  - id: 39-04-T01
    type: checkpoint:human-verify
    description: |
      Maintainer executes the 4-row Java-discovery matrix on a Windows machine.
      Records evidence per matrix row in 39-VERIFICATION.md per D-06/D-07/D-08.

      Prerequisites (assert before proceeding):
        - Windows machine accessible
        - Fixture at ~/dev/fmm-phase39-fixture/{example-mod,sibling-mod}/ built green
        - JDT LS installed at one of the candidate locations (or JDTLS_HOME set)
        - At least one JDK 21+ installed; ideally 2+ to make D-04 meaningful

      Between rows: kill JDT LS processes, `gradle --stop`,
      delete `<projectRoot>/.gradle/loom-cache/`, RESTART the MCP server
      (clears module-state `configuredJavaHome`).

      Completion criteria: all 4 checkboxes in 39-VERIFICATION.md ticked,
      env block populated, no unresolved failure-row stdout/stderr blocks.
    blocks_on_failure: true
```

**Source:** Pattern from GSD planner agent docs (`$HOME/.claude/get-shit-done/agents/gsd-planner.md` checkpoint task type).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 35-38 Windows fixes hidden behind unit tests with mocked `process.platform = 'win32'` | Phase 39 manual smoke test on real Windows | This phase | Surfaces real-environment failures (long paths, AV interactions, drive letter case) that mocks can't catch. |
| README "Windows Support" section (ROADMAP original wording) | Standalone `docs/WINDOWS-SUPPORT.md` | CONTEXT.md commit, this phase | The repo has no README yet; deferring the README to v1.7 unblocks Windows-doc shipping in v1.6. |
| Manual notes about JDK install paths scattered in commit messages | Verbatim priority chain quoted in CLAUDE.md + `docs/WINDOWS-SUPPORT.md` with cross-references (D-18) | This phase | Drift mitigation across 3+ sources; future refactor must touch all sites. |

**Deprecated / outdated:**
- ROADMAP success criterion 4 prior wording ("README has a 'Windows Support' section") — reworded in CONTEXT.md commit; the README is deferred to v1.7+.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fabric-example-mod` master branch builds cleanly with the user's installed Loom + Yarn at fixture-creation time | Code Examples §1, Pitfall 6 | If upstream master is broken, fixture-build step blocks the matrix. Mitigation: maintainer can pin to a known-good tag (e.g., `1.21.4`) instead of `master`. |
| A2 | `ExampleMod.LOGGER` is a public static field in `net.fabricmc.example.ExampleMod` on the master branch | Code Examples §1 | If field is private or renamed, sibling-mod reference fails to compile. WebSearch confirmed the pattern was canonical in 1.19+. If wrong, maintainer substitutes any other public symbol from ExampleMod (e.g., the class itself in a `new ExampleMod()` reference). |
| A3 | The maintainer has at least 2 distinct JDK 21+ installs available on the Windows machine to make D-04's "MUST resolve to different javaPath values" actionable | Standard Stack | If only 1 JDK installed, D-04 says document explicitly. Not blocking. |
| A4 | The "MUST NOT modify src/**" constraint extends to a one-line `logger.info` addition for javaPath observability | Common Pitfalls §1, Open Questions §1 | If a one-line log addition is permitted (treating observability gap as a pre-known finding under D-13 spirit), the planner can add the line in Plan 3 or 4 and remove a chunk of manual scraping work. If forbidden, maintainer uses Get-CimInstance workaround. |
| A5 | The fabric-example-mod build process produces a Loom cache structure that FabricModMCP's `src/project/loom-cache.ts` recognizes | Phase 39 happy path | If Loom's cache structure changed in a recent release, `add_fabric_mod` fails. Mitigation: gap-closure plan per D-13. |
| A6 | Sibling-mod uses Loom's `dependencies { implementation(project(":example-mod")) }` syntax OR is co-loaded via a single FabricModMCP project containing both as fabric-mod children | Project Structure | The "imports a class" requirement of D-01 can be satisfied two ways: real Gradle dependency (heavier) or FabricModMCP's per-project workspace sees both children without a Gradle dep (lighter, matches how the v1.4 multi-project architecture works — the JDT LS workspace concatenates classpaths). The latter is correct per CLAUDE.md "Multi-Project Support". The sibling does NOT need a Gradle dep on example-mod for the matrix to work. |
| A7 | The maintainer's MCP client on Windows is Claude Code (not a custom CLI MCP harness) | Architecture diagram | If a CLI harness is used, evidence capture format may differ slightly. Not blocking — checkbox manifest is harness-agnostic. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (It is not empty — A1, A4 in particular are worth discuss-phase-style confirmation.)

## Open Questions (RESOLVED)

1. **Does the "MUST NOT modify src/**" rule permit a single `logger.info` line in `src/jdtls/client.ts:startJdtLs` to satisfy D-04 evidence capture?**
   - **What we know:** D-04 requires `javaPath` evidence per matrix row. The current code emits no such log at info level. CONTEXT.md "Files this phase MUST NOT modify" includes `src/**` "EXCEPT gap-closure plans triggered by failures per D-13". An observability gap blocking D-04 satisfaction is arguably a pre-execution gap, not a post-execution failure — making the exception ambiguous.
   - **What's unclear:** Whether to treat this as a Plan 0 (preamble) one-line addition with its own tiny test, OR have the maintainer use PowerShell `Get-CimInstance` process-tree scraping each row.
   - **Recommendation:** Surface this in `/gsd:plan-phase 39`'s plan-checker pass; if the user prefers pure docs+validation (no `src/**` touch), document the process-tree scraping recipe in Plan 4's task spec. Otherwise add the line in Plan 0 (or fold into Plan 4 as a 1-line pre-step). My recommended default: **add the one line** — the entire point of D-04 evidence is to make slot regressions detectable, and the cost is 1 LOC + 1 test assertion.
   - **RESOLVED:** Plan 04 captures `javaPath` via PowerShell `Get-CimInstance Win32_Process`; D-13 gap-closure `39-06-PLAN.md` auto-triggers ONLY if PowerShell capture fails on the maintainer's Windows host.

2. **What MC version / Yarn mappings does the fixture target?**
   - **What we know:** D-01 says clone upstream `fabric-example-mod` — by default master. CLAUDE.md Sources jar path notes show FabricModMCP handles both per-project (Loom 1.16+) and global cache layouts.
   - **What's unclear:** Whether maintainer prefers latest master (forward-looking) or a pinned tag (reproducible).
   - **Recommendation:** Plan 4 task explicitly says "clone master at fixture-creation time; record the commit SHA in 39-VERIFICATION.md env block". Don't pin in advance.
   - **RESOLVED:** Plan 04 clones `fabric-example-mod` at master and records the commit SHA in 39-VERIFICATION.md's environment block.

3. **Does the regression sweep (UNIX-03) require running on BOTH macOS and Linux, or can macOS-only suffice if no recent CI runs have happened on Linux?**
   - **What we know:** ROADMAP success criterion 3 says "macOS and Linux"; UNIX-03 in REQUIREMENTS.md says "all v1.5 tests pass unchanged after the refactor" (no explicit OS list).
   - **What's unclear:** Whether the maintainer has Linux access. CONTEXT.md doesn't gate on this.
   - **Recommendation:** Plan 5 task says "run `pnpm test` on macOS (developer's primary machine — verified via env). If Linux machine available, run there too and append second exit-0 verification. Otherwise document as 'Linux not verified in this phase' in 39-VERIFICATION.md." Aligns with D-15's spirit (genuinely-environmental edge case explicit-document escape valve).
   - **RESOLVED:** Plan 05 requires macOS exit-0 as the primary UNIX-03 gate; Linux is best-effort with an explicit "Linux not verified in this phase" note allowed if the maintainer has no Linux machine accessible.

4. **Should `docs/WINDOWS-SUPPORT.md` include a Troubleshooting section quoting the multi-line `JDT LS not found.` and `Java not found.` failure messages from Phase 37/38?**
   - **What we know:** D-11 lists "Java priority chain, JDT LS install locations, known limitations, installation pre-reqs". Doesn't mention troubleshooting.
   - **What's unclear:** Whether the section is in scope.
   - **Recommendation:** Add a short Troubleshooting section quoting the existing error-message format as a useful real-world artifact. Marginal cost (~10-15 lines). Pure win for discoverability. Falls under "Claude's Discretion: tone and length".
   - **RESOLVED:** Plan 01 explicitly excludes a Troubleshooting section from `docs/WINDOWS-SUPPORT.md` (length budget 80-150 lines; the Phase 37/38 multi-line error messages already self-document the chain).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Real Windows machine | 4-row matrix execution | ✗ (this machine is macOS M4 Max) | — | None — the matrix is by definition Windows-only. The maintainer must execute the matrix from a Windows host (or VM with adequate JDK/JDT LS). |
| pnpm | UNIX-03 regression sweep | ✓ (assumed — project is pnpm-managed) | 10.26.0 [VERIFIED: package.json] | None — required to run tests. |
| vitest | UNIX-03 regression sweep | ✓ | 4.x [VERIFIED: package.json] | None. |
| Git for Windows | Fixture clone on Windows | Unknown (maintainer-side) | latest | None — required to clone fabric-example-mod. |
| JDK 21+ (at least one) | JDT LS spawn | Unknown (maintainer-side; required by every matrix row) | 21+ | None — JDT LS requires Java 21+ runtime (CLAUDE.md). |
| JDK 21+ (second distinct install) | D-04 multi-`javaPath` proof | Unknown | 21+ | D-04 documents explicitly if only one JDK available. |
| JDT LS milestone | Every matrix row | Unknown | Latest | None — JDT LS install required (or `JDTLS_HOME` env var). |
| Node.js 22+ on Windows | MCP server runtime | Unknown | 22+ [CITED: CLAUDE.md] | None — MCP server requires Node 22+. |
| `fabric-example-mod` upstream | Fixture | ✓ (public GitHub repo) | master | If GitHub is unreachable on Windows host, defer the matrix until network restored. |
| Linux machine | UNIX-03 regression sweep (second OS) | Unknown | — | If unavailable, document "Linux not verified in this phase" per Open Questions §3. |

**Missing dependencies with no fallback:**
- Real Windows host with JDK 21+, JDT LS, Node 22+, Git, pnpm. The matrix cannot execute without these. Plan 4's checkpoint:human-verify task must assert these as preconditions before the maintainer starts.

**Missing dependencies with fallback:**
- Second distinct JDK install — D-04 covers the single-JDK case with explicit documentation.
- Linux machine — Open Questions §3 covers macOS-only fallback.

## Validation Architecture

> Validation Architecture is REQUIRED per `.planning/config.json` `workflow.nyquist_validation: true` [VERIFIED: file read 2026-05-24].

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x [VERIFIED: package.json devDependencies] |
| Config file | `/Users/LoganDark/Documents/Projects/FabricModMCP/vitest.config.ts` [VERIFIED] (`include: ['tests/**/*.test.ts']`, `testTimeout: 10000`) |
| Quick run command | `pnpm test -- --reporter=dot` (existing — narrows output for fast iteration) |
| Full suite command | `pnpm test` |
| Phase-specific test command | N/A — Phase 39 adds no new tests. Existing 72 test files exercise UNIX-03 implicitly. |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UNIX-03 | Full v1.5 + v1.6 vitest suite green on macOS and Linux | smoke (full suite) | `pnpm test` (must return exit 0; zero new failures, zero new skips compared to Phase 38 baseline) | ✅ existing |
| WIN-01 (validation) | JDT LS spawns under all 4 Java-discovery entry points on Windows | manual-only | N/A — checkpoint:human-verify | Manual (39-VERIFICATION.md) |
| WIN-02 (validation) | `findJdtLs` discovers JDT LS on Windows | manual-only (precondition for every row) | N/A | Manual |
| WIN-03..07 (validation) | URI/path handling on Windows | manual-only (indirectly exercised by `add_fabric_mod` + `find_definition`) | N/A | Manual |
| JAVA-01..05 (validation) | Priority chain slots on Windows | manual-only (Rows 1-4 directly exercise slots 1-4) | N/A | Manual |
| UNIX-01, UNIX-02 (regression) | Unix byte-identical preservation | unit + smoke | `pnpm test tests/jdtls/ tests/platform/` (UNIX-mocked describes already exist from Phases 35/36) | ✅ existing |

### Sampling Rate

- **Per task commit (agent-completable plans only):** `pnpm test -- --reporter=dot` — ~10s runtime on a developer machine.
- **Per wave merge:** `pnpm test` (full suite) on macOS.
- **Phase gate:** Full suite green on macOS AND on Linux if accessible (per Open Questions §3); matrix complete on Windows; verification doc checkboxes all ticked; gap-closure plans (if any) all closed; ROADMAP "Plans" subsection updated; `docs/WINDOWS-SUPPORT.md` exists; CLAUDE.md `### Platform Support` exists; cross-references per D-18 present.

### Wave 0 Gaps

- [ ] **No new test files needed.** Existing test infrastructure satisfies UNIX-03. The only new "infrastructure" is the `checkpoint:human-verify` task type, which is a planner construct, not a test file.
- [ ] **(Conditional)** If Open Questions §1 resolves toward "add `logger.info('Spawning JDT LS', { javaPath, jdtlsHome })` in `src/jdtls/client.ts:startJdtLs`": add a one-line test in `tests/jdtls/client.test.ts` asserting the log call (using `vi.spyOn(logger, 'info')`). Otherwise no test changes.
- [ ] **39-VERIFICATION.md template** — produced by `/gsd:verify-phase` reading the standard verifier layout + D-06/D-07/D-08 specifics. No file to write in advance.

*(If no gaps: "None — existing test infrastructure covers all phase requirements.")*

### Validation Strategy for Manual Phase

Standard "test command → green/red" doesn't apply to D-02's manual matrix. Validation reduces to **checkbox state in `39-VERIFICATION.md`**:

- 4 matrix-row checkboxes ticked AND
- 4 distinct (or documented-as-same) `javaPath` values recorded AND
- `find_definition` returned non-empty per row AND
- `find_references` returned non-empty per row (with cross-mod result for rows that test cross-mod) AND
- environment block (D-08) populated AND
- no unresolved failure-row stdout/stderr blocks (i.e., either no failures, OR every failure has a corresponding `39-NN-PLAN.md` gap-closure plan that is itself complete)

The verifier (`/gsd:verify-phase 39`) compares the verification doc against this rubric. The validator (`gsd-validator`) takes this rubric and generates the `39-VALIDATION.md` Nyquist-sampling sheet.

## Security Domain

> `security_enforcement` is not explicitly set in `.planning/config.json` — treat as enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | N/A — Phase 39 introduces no auth surface. MCP server uses stdio with no network boundary. |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A — local-user-only execution. |
| V5 Input Validation | no | N/A for Phase 39 itself; existing input validation (Zod schemas in `src/tools/descriptions.ts`) covers the underlying tools. The matrix exercises happy-path inputs only. |
| V6 Cryptography | no | N/A |
| V12 Files & Resources | partial | The docs note Windows long-path 260-char limit (D-11.3); ZIP path-traversal guard (WIN-07) is covered by Phase 36 and validated indirectly by `add_fabric_mod` succeeding. Phase 39 does not modify file-handling code. |

### Known Threat Patterns for Phase 39 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious dependency jar with `..\` path-traversal in ZIP entries | Tampering | Phase 36's `workspace-sync.ts` traversal guard rejects before write [VERIFIED: Phase 36 D-12]. Phase 39 validates the guard works on real Windows. |
| Stale JDT LS process pinned to old JDK between matrix rows | Repudiation (slot leakage falsifies evidence) | D-03 cleanup recipe + Pitfall 2 expansion (restart MCP server between rows) |
| Documentation drift — chain in docs disagrees with code | Information Disclosure (misleading user docs) | D-18 cross-reference footer; verbatim quote of source comment per Example 2/3 |

No new attack surface introduced by Phase 39 itself. The phase validates that prior phases' defenses work in production.

## Sources

### Primary (HIGH confidence)

- `src/jdtls/java-discovery.ts:8-13` — Java priority chain doc-comment header [VERIFIED: file read 2026-05-24]
- `src/jdtls/java-discovery.ts:378-436` — slot-by-slot `discoverJava` body [VERIFIED]
- `src/platform/index.ts:70-87` `jdtlsCandidateDirs()` body [VERIFIED]
- `src/jdtls/client.ts:114-151` `findJdtLs` body [VERIFIED]
- `src/jdtls/client.ts:159-261` `startJdtLs` body — spawn line at 188 [VERIFIED]
- `src/jdtls/startup.ts:43-190` `initJdtLsSession` + `retryDegradedJdtLsSessions` [VERIFIED]
- `src/logging/logger.ts` — logger contract, default level `info` [VERIFIED]
- `vitest.config.ts` — test framework config [VERIFIED]
- `package.json` — dependency manifest, pnpm packageManager [VERIFIED]
- `.planning/phases/39-windows-end-to-end-validation/39-CONTEXT.md` — 18 locked decisions [VERIFIED: full read]
- `.planning/REQUIREMENTS.md` — UNIX-03 + milestone-level requirements [VERIFIED]
- `.planning/ROADMAP.md` — Phase 39 spec, success criteria 1-4 [VERIFIED]
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-CONTEXT.md` — does not exist on disk [VERIFIED: ENOENT; only RESEARCH/PATTERNS/SUMMARY/VALIDATION/VERIFICATION exist for Phase 35]
- `.planning/phases/36-path-uri-handling-audit/36-CONTEXT.md` — URI sweep contract [VERIFIED]
- `.planning/phases/37-smarter-java-discovery-cross-platform/37-CONTEXT.md` — priority chain implementation contract [VERIFIED]
- `.planning/phases/38-jdt-ls-discovery-on-windows/38-CONTEXT.md` — JDT LS discovery contract [VERIFIED]

### Secondary (MEDIUM confidence)

- [GitHub — FabricMC/fabric-example-mod repo description](https://github.com/FabricMC/fabric-example-mod) — confirms repo exists, master branch, 2.2k stars [VERIFIED via WebSearch; raw file fetch failed with 404 but search snippets confirmed `ExampleMod` class implements `ModInitializer` with a `LOGGER` field in 1.19+ versions]
- [Fabric Template Mod Generator](https://fabricmc.net/develop/template/) — canonical sibling-mod scaffolding source
- [Fabric Loom Documentation](https://docs.fabricmc.net/develop/loom/) — cross-mod dependency conventions
- [Microsoft Docs: Long Paths in Windows 10+](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation) — referenced by D-11.3 known-limitations block

### Tertiary (LOW confidence — flagged for validation)

- `ExampleMod.LOGGER` is the public static field exercised by Example 1 sibling-mod — derived from WebSearch snippets only; raw file fetch returned 404 from multiple branch URLs (master, 1.21.4, 1.19, 1.18). The maintainer should verify the actual class shape at fixture-clone time and adjust sibling-mod source if `LOGGER` is private or renamed. [ASSUMED: pattern documented in WebSearch result snippets but not directly verified]

## Metadata

**Confidence breakdown:**
- User constraints: HIGH — copied verbatim from CONTEXT.md, no interpretation
- Phase requirements: HIGH — REQUIREMENTS.md + ROADMAP read directly
- Architectural responsibility map: HIGH — every tier ownership verified against existing repo structure
- Standard stack: HIGH — zero new libraries; everything verified via package.json
- Architecture patterns: HIGH — three patterns derived from existing repo precedents + GSD planner agent docs
- Don't hand-roll: HIGH — every item validated against existing repo structure
- Common pitfalls §1 (spawn-line evidence gap): HIGH — verified by grep against `src/jdtls/client.ts`; no info-level logger.info exists at the spawn site
- Common pitfalls §2 (slot leakage): HIGH — verified by reading `src/jdtls/java-discovery.ts:45` module state
- Code examples: HIGH for Examples 2-4 (verbatim source quotes); MEDIUM for Example 1 (`ExampleMod.LOGGER` derivation — see Tertiary sources)
- Validation architecture: HIGH — vitest config + REQUIREMENTS.md UNIX-03 + manual checkbox rubric all verified
- Open questions: HIGH — every question has a verified factual basis

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days — Phase 39 is stable docs+validation work; nothing in the underlying source is expected to drift unless gap-closure plans modify `src/**`)
