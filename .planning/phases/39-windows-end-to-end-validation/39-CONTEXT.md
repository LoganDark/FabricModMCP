# Phase 39: Windows End-to-End Validation - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Milestone-completion checkpoint for v1.6 "Windows Support" — NOT a code phase. The maintainer manually exercises the FabricModMCP stack on a real Windows machine to prove that Phases 35-38 (platform helpers, URI sweep, smarter Java discovery, JDT LS discovery) integrate correctly under all four Java-discovery entry points. The phase produces three artifacts:

1. **Test fixture** — `fabric-example-mod` (cloned) plus a hand-authored sibling mod that imports a class from it, kept under a fixture directory outside the repo for reuse on future Windows checkpoints.
2. **Validation evidence** — checkbox-style manifest with key one-line excerpts (JDT LS spawn line, find_definition result, find_references result) per Java-discovery matrix row, captured in `39-VERIFICATION.md` (NOT a separate `39-VALIDATION-REPORT.md` file). No screenshots, no full transcripts.
3. **Public docs** — standalone `docs/WINDOWS-SUPPORT.md` (NOT a README section — see ROADMAP success criterion 4 reword below) + a new `## Platform Support` subsection inside the existing `## Technology Stack` block in `CLAUDE.md` that inlines both priority chains (Java + JDT LS).

Locked by ROADMAP / REQUIREMENTS (not re-asked in discussion):
- Java-discovery entry-point matrix: `--java-home` flag, `org.gradle.java.home` from `gradle.properties`, `JAVA_HOME` env var, PATH only. Each must independently spawn JDT LS end-to-end on Windows.
- Happy path: `create_project` → `add_fabric_mod` → `find_definition` → `find_references` (with cross-mod navigation across the two sibling mods, exercising the per-project JDT LS workspace).
- UNIX-03 regression guard: full v1.5 + v1.6 vitest suite must pass on macOS and Linux with zero new failures or skips.
- Known limitations to document: Windows long-path 260-char limit, WSL note.

Out of scope (deferred to v1.7+ or explicitly excluded):
- Full v1.6 README from scratch (deferred; standalone `docs/WINDOWS-SUPPORT.md` replaces the README "Windows Support" section requirement).
- Full-tool MCP surface sweep (not in success criteria; URI sweep Phase 36 + macOS/Linux test suite already cover non-happy-path tools).
- Screenshots / full validation report markdown (user explicitly chose checkbox-only evidence).
- Sodium / Lithium / Iris real-world third-party mods as test fixture (third-party build breaks conflate with FabricModMCP bugs).
- Automated CI Windows runner (manual smoke test by maintainer is the deliverable).

ROADMAP edit applied during this discussion: success criterion 4 was reworded from "README has a 'Windows Support' section" to `docs/WINDOWS-SUPPORT.md` standalone. Two other ROADMAP sites referencing the README section were updated for consistency.

</domain>

<decisions>
## Implementation Decisions

### Test fixture (Area 1a)

- **D-01: Fixture is `fabric-example-mod` (cloned upstream) + a hand-authored sibling mod that imports a class from it.** Stored outside the FabricModMCP repo (e.g., `~/dev/fmm-phase39-fixture/{example-mod,sibling-mod}/`) so it can be reused for future Windows checkpoints without polluting the repo. The upstream clone serves as the canonical Loom baseline (well-known-good `gradle.properties` and `build.gradle.kts`); the sibling mod is a minimal scaffold (one `ModInitializer`, one class that imports from `fabric-example-mod`) that deterministically exercises the per-project JDT LS workspace's cross-mod navigation. Sodium/Lithium/Iris-class real mods are rejected because their multi-GB Gradle caches + JDK pinning + native deps create failure modes that cannot be distinguished from FabricModMCP bugs.

### Test sequence (Area 1b)

- **D-02: Happy path × 4 Java-discovery entry-point matrix.** The same 4-step happy path (`create_project` → `add_fabric_mod` → `find_definition` → `find_references` with cross-mod navigation) is run four times, once per Java-discovery entry point. The expected JDT LS spawn line is captured from each run to prove the correct JDK was selected (not just "some JDK").
- **D-03: Between matrix runs, kill orphaned daemons and delete cached workspaces.** Specifically:
  - Kill any stray JDT LS processes (`Stop-Process` matching `java.exe` with `org.eclipse.equinox.launcher` in command line, or fully exit the MCP server between runs).
  - Stop any running Gradle daemons (`gradle --stop`) so a daemon spawned under one JDK doesn't leak into the next run.
  - Delete the per-project Loom cache (`<projectRoot>/.gradle/loom-cache/`) so the JDT LS workspace is rebuilt under the new JDK.
- **D-04: Verify which JDK was selected per matrix row.** Each row's evidence must include the resolved `javaPath` (visible in JDT LS spawn line) so a "JAVA_HOME row that silently picked up --java-home" regression is detectable. The 4 rows MUST resolve to different `javaPath` values (or the same one if user only has one JDK installed; in that case, document that in the verification doc).
- **D-05: Out of scope — full tool surface sweep.** Only the happy-path tools (`create_project`, `add_fabric_mod`, `find_definition`, `find_references`) are exercised. Tools like `read_class`, `search_classes`, `add_study_jar`, `remove_project_member`, etc. are not part of the matrix. Their Windows path handling is covered by Phase 36 unit tests on mocked `process.platform = 'win32'`.

### Evidence capture (Area 1c)

- **D-06: Checkbox manifest with key one-line excerpts; NO full validation report markdown.** All evidence lives in `39-VERIFICATION.md` (the standard phase verification doc produced by `/gsd:verify-phase`). Structure per matrix row:
  ```
  - [ ] --java-home: javaPath = C:\..., JDT LS spawn line = "<...>", find_definition returned <N> results, find_references returned <N> results
  ```
  No separate `39-VALIDATION-REPORT.md`, no screenshots, no full transcripts.
- **D-07: Capture stdout/stderr ONLY for failures.** Successful matrix rows get the one-line excerpt above. Failed rows get the full stdout/stderr appended inline in the verification doc (or pasted into a gap-closure plan if Area 3 escalation triggers).
- **D-08: Environment block at top of verification doc.** One short block listing Windows build (e.g., "Windows 11 24H2"), shell used (PowerShell vs cmd.exe vs Git Bash), JDK install method (winget / Adoptium installer / portable zip), and Node.js version. ~6 lines. Future regressions correlate against this block.
- **D-09: Tradeoff acknowledged.** The maintainer explicitly accepted that future Windows-regression triage will be harder without full transcripts. The decision favors ship velocity for v1.6 over forensic archival of this specific run.

### README / docs scope (Area 2)

- **D-10: Standalone `docs/WINDOWS-SUPPORT.md`; no README.md created in this phase.** The repo's top-level `README.md` remains absent; deferred to v1.7+. The Windows Support content lives at `docs/WINDOWS-SUPPORT.md` and is the canonical user-facing Windows documentation for v1.6.
- **D-11: Required content for `docs/WINDOWS-SUPPORT.md`:**
  1. Java discovery priority chain (5 slots: `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → `commonJavaLocations()` scan).
  2. JDT LS install locations probed (5 slots in order: `JDTLS_HOME` env → `%LOCALAPPDATA%\jdtls` → `%PROGRAMFILES%\jdtls` → `%USERPROFILE%\jdtls` → `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`).
  3. Known limitations: Windows 260-char path limit (with mitigation: enable long-path support via `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` registry key OR Group Policy); WSL note (WSL2 works because it's effectively Linux from FabricModMCP's perspective — `process.platform === 'linux'` — but cross-FS access between Windows and WSL is slow; recommend running fully inside WSL2 if hitting Windows-native quirks).
  4. Installation pre-reqs link / pointer: Java 21+ install, JDT LS milestone download, Node.js 22+, pnpm.
- **D-12: ROADMAP success criterion 4 reworded as part of this phase.** Three sites in `.planning/ROADMAP.md` updated to reference `docs/WINDOWS-SUPPORT.md` instead of "README 'Windows Support' section":
  - Phase 39 one-liner in the milestone bullet list (line 104).
  - Phase 39 `**Goal**:` paragraph (line 173).
  - Phase 39 Success Criterion 4 (line 180).

  This reword is intentional and committed alongside CONTEXT.md so the criterion matches the chosen artifact. Verifier (`/gsd:verify-phase`) MUST check against the reworded criterion.

### Failure-handling protocol (Area 3)

- **D-13: Default protocol = fix-in-place inside Phase 39 (matches Phase 36/37 4+1 precedent).** If the Windows smoke test reveals bugs, the default action is to open additional gap-closure plans inside Phase 39 (e.g., `39-NN-PLAN.md`) and block the milestone until they're done. Aligns with Phase 36 (4 original + 1 gap closure) and Phase 37 (4 original + 1 gap closure: CR-01) precedents.
- **D-14: Pre-authorized escalation to Phase 40.** If ANY single finding looks bigger than a gap-closure plan — i.e., needs its own discuss-phase cycle (architectural rework, long-path-enable bit design question, antivirus-interference workaround design, etc.) — escalate immediately: scaffold a new Phase 40 via `/gsd:phase` add, run `/gsd:discuss-phase 40`, and v1.6 ships only when both 39 and 40 close. The escalation threshold is "needs its own discuss-phase" — not bug count or severity in isolation.
- **D-15: NOT acceptable — document-as-known-issue defer to v1.7.** This phase's milestone is literally branded "Windows Support"; shipping v1.6 with known Windows bugs would undermine the milestone's meaning. The only exception is genuinely-environmental edge cases that cannot reasonably be fixed in code (e.g., a specific antivirus + OneDrive interaction that requires user configuration, not FabricModMCP code changes); those go in the `docs/WINDOWS-SUPPORT.md` "Known limitations" block with workaround instructions.

### CLAUDE.md update (Area 4)

- **D-16: New `## Platform Support` subsection INSIDE the existing `## Technology Stack` section.** Sibling to "Language & Runtime", "MCP Framework", "Schema Validation", "Jar/ZIP File Reading", "Java Language Server Integration", "Gradle Project Parsing", "Build & Development", "Supporting Libraries". NOT a top-level `## Platform Support` section parallel to Technology Stack.
- **D-17: Both priority chains are inlined verbatim, not pointer-only.** Java chain (5 slots) + JDT LS chain (5 slots) are written out in full. The maintainer explicitly chose discoverability over context-window economy.
- **D-18: Drift mitigation.** Because the chains now live in 3+ sources (REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02, `src/jdtls/java-discovery.ts` doc-comment header, `src/jdtls/client.ts` `findJdtLs`, CLAUDE.md, `docs/WINDOWS-SUPPORT.md`), each location MUST cross-reference the others. CLAUDE.md `## Platform Support` and `docs/WINDOWS-SUPPORT.md` both end with: "Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02. Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS)."

### Claude's Discretion

- **`docs/WINDOWS-SUPPORT.md` length and tone.** Planner / executor decide. Recommended target: 80-150 lines, technical but not exhaustive (assume Minecraft modder + Claude Code user audience; no need to explain what `%LOCALAPPDATA%` is).
- **Format of priority chains in CLAUDE.md.** Numbered list vs table — planner's call. Match the surrounding section formatting (the existing Technology Stack subsections use 5-column tables for tech choices; the chains are different content shape, so a numbered list under a short prose intro is likely cleaner).
- **Ordering inside `docs/WINDOWS-SUPPORT.md`.** Suggested order: install pre-reqs → Java priority chain → JDT LS priority chain → known limitations (long paths, WSL). Planner may reorder.
- **Whether to also add a Phase 39-specific entry to CHANGELOG.md / NOTES.md.** No CHANGELOG.md exists in the repo today (verified via `ls`). Planner can defer or skip.
- **ROADMAP Phase 39 "Plans" subsection cleanup.** The current `.planning/ROADMAP.md` Phase 39 "Plans" list (lines 181-185) erroneously lists Phase 36 plans (`36-01-PLAN.md` through `36-04-PLAN.md`) — clearly a copy-paste bug from a prior ROADMAP edit. The roadmapper / planner will rewrite this subsection during `/gsd:plan-phase 39` to list the actual Phase 39 plans. NOT addressed in this CONTEXT.md commit because the plan list isn't known yet.
- **Whether to bundle the ROADMAP reword commit with the CONTEXT.md commit OR commit separately.** Bundled in this commit (see git_commit step of discuss-phase workflow).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & milestone scope
- `.planning/REQUIREMENTS.md` — UNIX-03 is the explicit phase requirement (full v1.5 test suite passes unchanged post-refactor). WIN-01 through WIN-07, JAVA-01 through JAVA-05, UNIX-01, UNIX-02 are all milestone-level requirements that this phase validates end-to-end (NOT itself implementing — those phases are 35-38). "Out of Scope" section explicitly excludes auto-downloading JDT LS, probing VS Code's bundled JDT LS, custom URI schemes, registry probing.
- `.planning/ROADMAP.md` §"Phase 39: Windows End-to-End Validation" (post-reword) — success criteria 1-4. Criterion 4 reworded in this CONTEXT.md commit to reference `docs/WINDOWS-SUPPORT.md` instead of a README section. Two upstream sites (line 104 milestone bullet, line 173 Goal paragraph) updated for consistency.
- `.planning/PROJECT.md` — Project-level constraints (performance, no caching of extracted files, strongly typed tool interfaces, extensible architecture).

### Phase 35-38 carry-forward (the work being validated)
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-CONTEXT.md` — WIN-01 + UNIX-01 contract: `isWindows`, `javaBinaryName()`, `javaBinaryInHome()`, `jdtlsCandidateDirs()`, `commonJavaLocations()`, `resolveJavaExecutable()`. Unix branches byte-identical to v1.5.
- `.planning/phases/36-path-uri-handling-audit/36-CONTEXT.md` — WIN-03/04/05/06/07 + UNIX-02: `pathToFileURL`/`fileURLToPath` migration, ZIP split-and-spread, drive-letter case-fold, EBUSY retry, path-traversal guard.
- `.planning/phases/37-smarter-java-discovery-cross-platform/37-CONTEXT.md` — JAVA-01 through JAVA-05: `discoverJava` priority chain (5 slots), 3s per-candidate timeout, `unescapePropertiesValue`, vendor map, common-install scan.
- `.planning/phases/38-jdt-ls-discovery-on-windows/38-CONTEXT.md` — WIN-02: `findJdtLs` consumes `jdtlsCandidateDirs()`, JDTLS_HOME deep validation, multi-line failure message, `process.env.HOME` → `os.homedir()` migration with grep regression test.

### Files this phase creates / modifies
- `docs/WINDOWS-SUPPORT.md` — NEW. Standalone user-facing Windows documentation. Contents per D-11. Cross-references REQUIREMENTS.md + java-discovery.ts + client.ts per D-18.
- `CLAUDE.md` §"Technology Stack" — modify. New `### Platform Support` subsection per D-16/D-17/D-18. Inlines both priority chains.
- `.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md` — NEW (produced via `/gsd:verify-phase`). Checkbox-style manifest per D-06/D-07/D-08.
- `.planning/ROADMAP.md` — already modified in this CONTEXT.md commit (3 reword sites per D-12); also needs Phase 39 "Plans" subsection cleanup during `/gsd:plan-phase` (Claude's discretion item above).

### Files this phase MUST NOT modify
- Anything under `src/` (this is a docs + validation phase; no code changes EXCEPT gap-closure plans triggered by failures per D-13).
- `tests/**` (UNIX-03 requires existing tests to pass UNCHANGED).
- `.planning/REQUIREMENTS.md` (no requirement changes; only validation).
- Phase 35-38 CONTEXT.md / PLAN.md / VERIFICATION.md (sealed prior-phase artifacts).

### Implementation references (read-only — sources of truth for the priority chains)
- `src/jdtls/java-discovery.ts` lines 9-13 (doc-comment header) — Java priority chain (5 slots) literal listing.
- `src/jdtls/java-discovery.ts` lines 378-432 (`discoverJava` body) — slot-by-slot probe implementation; verify chain order matches `docs/WINDOWS-SUPPORT.md` exactly.
- `src/jdtls/client.ts` `findJdtLs` — JDT LS install-location probe; consumes `jdtlsCandidateDirs()` from `src/platform/index.ts`.
- `src/platform/index.ts` `jdtlsCandidateDirs()` (lines 70-87 per Phase 38 context) — Windows + Unix JDT LS candidate dir definitions.
- `src/platform/index.ts` `commonJavaLocations()` — fallback Java scan locations (Phase 37 / Phase 35 work).

### External specs
- [Eclipse JDT LS install layout](https://github.com/eclipse-jdtls/eclipse.jdt.ls#download-or-build) — referenced by `docs/WINDOWS-SUPPORT.md` install pre-reqs section.
- [Fabric example mod](https://github.com/FabricMC/fabric-example-mod) — canonical Loom baseline test fixture (D-01).
- [Microsoft Docs: Long Paths in Windows 10+](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation) — referenced by `docs/WINDOWS-SUPPORT.md` "Known limitations" block for the 260-char limit mitigation guidance.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The Java priority chain doc-comment** at `src/jdtls/java-discovery.ts:9-13` is already authoritative prose; `docs/WINDOWS-SUPPORT.md` and `CLAUDE.md` §"Platform Support" can quote it near-verbatim instead of paraphrasing (reduces drift).
- **The JDT LS probe table** is encoded in `src/platform/index.ts` `jdtlsCandidateDirs()` (Phase 35 work) — extract the candidate order from the source rather than from memory when writing docs.
- **The "tried slot" multi-line failure messages** (`Java not found.` / `JDT LS not found.` first-line prefixes from Phases 37/38) are user-facing error output that documents the priority chain implicitly. `docs/WINDOWS-SUPPORT.md` "Troubleshooting" subsection (if added — Claude's discretion) can quote these as examples.

### Established Patterns
- **Standalone docs/ dir** — none exists yet (`ls docs/` would fail). Phase 39 creates `docs/` for the first time. Future docs (e.g., `docs/ARCHITECTURE.md` in v1.7) can land there.
- **Phase verification docs** — `.planning/phases/NN-{slug}/NN-VERIFICATION.md` is the standard verification artifact location (produced by `/gsd:verify-phase`). D-06 puts the validation evidence there.
- **`.planning/phases/NN-{slug}/NN-CONTEXT.md`** — this file. Pattern matches Phases 35-38.
- **ROADMAP success-criterion rewords are non-trivial** — they require updating 2-3 places (one-liner, Goal paragraph, criterion line). The discuss-phase workflow allows this when the discussion produces a deviation from the original wording.

### Integration Points
- **CLAUDE.md is loaded into every Claude session** — D-16's new subsection adds ~30-50 lines to every session's context. Acceptable per maintainer's decision to prioritize discoverability.
- **`docs/WINDOWS-SUPPORT.md` will eventually be linked from a future README.md** (deferred to v1.7+). The link target stays stable: `./docs/WINDOWS-SUPPORT.md`.
- **The validation matrix runs against the MCP server's `stdio` transport** — the maintainer drives the runs from Claude Code itself (or a CLI MCP test harness) on the Windows machine. No HTTP transport involved.

</code_context>

<specifics>
## Specific Ideas

- Test fixture lives OUTSIDE the FabricModMCP repo (e.g., `~/dev/fmm-phase39-fixture/{example-mod,sibling-mod}/`) so it can be reused for future Windows checkpoints without polluting the repo or its test suite.
- Per matrix row, the JDT LS spawn line is the load-bearing evidence: it contains the resolved `javaPath`, which proves which slot of the priority chain was actually selected. A regression where slot 3 (`JAVA_HOME`) silently overrides slot 1 (`--java-home`) is undetectable from the find_definition output alone.
- WSL framing: WSL2 is effectively Linux from FabricModMCP's perspective (`process.platform === 'linux'`); recommend it as an escape hatch for users hitting Windows-native quirks, but do NOT treat native Windows as unsupported (the whole milestone exists to make native Windows work).
- ROADMAP success criterion 4 reworded in 3 sites in the same commit as CONTEXT.md so `/gsd:verify-phase` checks against the updated criterion.
- The user explicitly traded future regression-triage cost for ship velocity on the evidence-capture decision (D-09). Document this so a future Windows regression doesn't surface a "why didn't we keep transcripts" complaint without context.

</specifics>

<deferred>
## Deferred Ideas

- **Full v1.6 README.md** — deferred to v1.7+. Standalone `docs/WINDOWS-SUPPORT.md` is the v1.6 Windows-user touchpoint; npm/GitHub visitors see no README on the repo root until v1.7. Tradeoff acknowledged: looks unfinished on GitHub/npm registry.
- **Full validation report markdown with screenshots + transcripts** — explicitly rejected in this phase (D-06/D-09). If future Windows regression triage becomes painful, revisit this decision in v1.7 (could add a `docs/validation-reports/v1.6-windows.md` retroactively).
- **Automated Windows CI runner** — out of scope for v1.6. Manual smoke test by the maintainer is the v1.6 deliverable. v1.7+ could add GitHub Actions Windows runners for the unit-test suite (the integration matrix would remain manual).
- **Tool reference / contributing guide** — both out of scope; they belong in a future v1.7+ README phase.
- **CHANGELOG.md** — no CHANGELOG.md exists in the repo currently. Whether to start one is deferred (not blocking v1.6 ship).
- **Long-path-enable bit auto-detection in FabricModMCP** — if Windows 260-char limit causes real-world breakage, v1.7+ could add a startup probe that warns when `LongPathsEnabled` is off. Not in scope for v1.6.
- **Probing VS Code's bundled JDT LS** — REQUIREMENTS.md "Out of Scope" (patched and not guaranteed upstream-compatible).
- **`--jdtls-home` CLI flag** — deferred from Phase 38; not added in Phase 39. `JDTLS_HOME` env var remains the only JDT LS override.

</deferred>

---

*Phase: 39-windows-end-to-end-validation*
*Context gathered: 2026-05-24*
