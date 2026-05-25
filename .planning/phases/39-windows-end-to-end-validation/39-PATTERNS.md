# Phase 39: Windows End-to-End Validation - Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 5 (1 new docs file, 2 modify-in-place repo docs, 1 new planning artifact, 1 optional tiny code addition)
**Analogs found:** 5 / 5

## File Classification

Phase 39 is a milestone-completion validation phase. Its file footprint is overwhelmingly user-facing prose + planning artifacts, with at most one one-line code addition. There are no "controllers" or "services" in the conventional sense — the analogy here is structured technical prose with cross-references, and the analogs live in (a) source doc-comment headers, (b) prior phase verification docs, (c) the existing `CLAUDE.md` Technology Stack block, and (d) the `.planning/ROADMAP.md` Plans subsection format.

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `docs/WINDOWS-SUPPORT.md` (NEW) | user-facing prose doc | static reference | `src/jdtls/java-discovery.ts:1-20` doc-comment header + `src/platform/index.ts:57-87` jsdoc for `jdtlsCandidateDirs` | role-match (no standalone repo docs exist yet — this is the first; closest "structured priority-chain prose" is in source doc-comments) |
| `CLAUDE.md` `### Platform Support` subsection (MODIFY) | session-context doc subsection | static reference | `CLAUDE.md:47-52` `### Java Language Server Integration` + `CLAUDE.md:53-63` `### Gradle Project Parsing` | exact (sibling subsection inside `## Technology Stack` per D-16) |
| `.planning/ROADMAP.md` Phase 39 Plans subsection (MODIFY — lines 181-185) | planning artifact | static reference | `.planning/ROADMAP.md:118-120` (Phase 35 Plans), `:133-138` (Phase 36 Plans, 4+1), `:151-156` (Phase 37 Plans, 4+1), `:168-169` (Phase 38 Plans, 1) | exact (replace stale Phase 36 copy-paste with real Phase 39 list, matching the surrounding Phases 35-38 format) |
| `.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md` (NEW) | phase verification doc | static reference | `.planning/phases/38-jdt-ls-discovery-on-windows/38-VERIFICATION.md` (entire file) | exact — produced by `/gsd:verify-phase` using its standard template; only the matrix-checkbox shape is phase-39-specific (per D-06) |
| `src/jdtls/client.ts` one-line `logger.info('Spawning JDT LS', { javaPath, jdtlsHome })` (OPTIONAL, recommended per RESEARCH.md Open Question §1) | code (observability) | one-shot at spawn | `src/jdtls/startup.ts:182` `logger.info('JDT LS reinit succeeded for project ...')` + `src/index.ts:39` `logger.info('Default project created', { jdtlsAvailable: ... })` | exact (same logger API, info level, structured-data second-arg shape) |

## Pattern Assignments

---

### `docs/WINDOWS-SUPPORT.md` (NEW — user-facing prose doc)

**Primary content sources (verbatim quote per D-17/D-18):**

**Analog A — Java priority chain text** at `src/jdtls/java-discovery.ts:8-13` (doc-comment header):

```
 * Slot order for `discoverJava`:
 *   1. `--java-home` (module-state `configuredJavaHome`)
 *   2. `org.gradle.java.home` from `<projectRoot>/gradle.properties`
 *   3. `JAVA_HOME` env var
 *   4. `java` on PATH (libuv handles PATH lookup + PATHEXT on Windows)
 *   5. Scan common install locations from `commonJavaLocations()` with
 *      vendor-aware layout map
```

Quote this VERBATIM (drop the leading ` * ` jsdoc gutter) in the "Java Discovery Priority Chain" section. Drift mitigation per D-18 — paraphrase introduces inconsistency the next time the chain is refactored.

**Analog B — JDT LS candidate chain** at `src/platform/index.ts:70-87` (function body of `jdtlsCandidateDirs`):

```typescript
export function jdtlsCandidateDirs(): string[] {
	const home = homedir();
	if (isWindows) {
		const localAppData = process.env.LOCALAPPDATA ?? pathWin32.join(home, 'AppData', 'Local');
		const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
		return [
			pathWin32.join(localAppData, 'jdtls'),
			pathWin32.join(programFiles, 'jdtls'),
			pathWin32.join(home, 'jdtls'),
			pathWin32.join(localAppData, 'nvim-data', 'mason', 'packages', 'jdtls'),
		];
	}
	return [
		pathPosix.join(home, '.local', 'share', 'jdtls'),
		'/usr/local/share/jdtls',
		pathPosix.join(home, 'jdtls'),
	];
}
```

Express this as a numbered list per OS in the "JDT LS Install Locations" section. Source order is load-bearing — do NOT reorder. Note that `JDTLS_HOME` is consumed by `findJdtLs` at `src/jdtls/client.ts:117-134` BEFORE this list iterates, so it heads each OS's chain even though it's not in the function body itself.

**Analog C — Prose tone and structure** from the existing jsdoc at `src/platform/index.ts:57-69`:

```
/**
 * Candidate directories that may contain a JDT LS installation.
 *
 * Windows: four paths in priority order — `%LOCALAPPDATA%\jdtls`,
 * `%PROGRAMFILES%\jdtls`, `~\jdtls`, and the Mason (nvim) package path.
 * Missing env vars fall back to fixed literals so the function never
 * returns empty-string traversals.
 *
 * Unix: three paths verbatim from v1.5 (UNIX-01) — `~/.local/share/jdtls`,
 * `/usr/local/share/jdtls`, and `~/jdtls`.
 */
```

Use this dash-separated `Windows: ... — A, B, C, ...` / `Unix: ... — A, B, C, ...` shape as the prose template. The audience is Minecraft modders + Claude Code users (per D's "Claude's Discretion" length/tone note), so do not over-explain `%LOCALAPPDATA%`.

**Required footer (D-18 verbatim — exactly this string at the bottom of the doc):**

```
Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02.
Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS).
```

**Top-level structure recommendation** (matches D-11 + RESEARCH.md's "Claude's Discretion" suggested order):
1. Brief intro (1 paragraph; mention Windows + WSL2 + macOS/Linux supported)
2. Installation pre-reqs (Java 21+, JDT LS milestone, Node.js 22+, pnpm) — bullet list with links
3. Java Discovery Priority Chain (Analog A verbatim)
4. JDT LS Install Locations (Analog B as numbered list per OS)
5. Known Limitations
   - 260-char path limit + `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` mitigation
   - WSL note (WSL2 = Linux from FabricModMCP's perspective; cross-FS access between Windows and WSL is slow — recommend full-WSL2 if hitting Windows-native quirks)
6. (Optional, Claude's Discretion per RESEARCH.md Open Question §4) Troubleshooting — quote the multi-line `Java not found. Tried:` / `JDT LS not found. Tried:` failure messages from Phase 37/38 as real-world artifacts
7. Footer (D-18 verbatim string above)

**Target length:** 80-150 lines (per CONTEXT.md Claude's Discretion).

---

### `CLAUDE.md` `### Platform Support` subsection (MODIFY)

**Analog:** `CLAUDE.md:47-52` (the existing `### Java Language Server Integration` subsection) and `CLAUDE.md:53-63` (the existing `### Gradle Project Parsing` subsection).

**Insertion point** (RESEARCH.md Example 4 — VERIFIED via CLAUDE.md read 2026-05-24): between the existing `### Build & Development` block (ends at line 70: `| @types/node | 22.x | Node.js type definitions | Match Node.js 22 LTS runtime. | HIGH |`) and the existing `### Supporting Libraries` block (begins at line 71).

**Existing-subsection structure template** (from `CLAUDE.md:53-63`, `### Gradle Project Parsing`):

```markdown
### Gradle Project Parsing
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Custom parser (properties + regex) | N/A | Extract Minecraft version, mappings, loader version, Fabric API version | Fabric Loom projects follow a rigid convention: ... | HIGH |
# gradle.properties -- Java Properties format, trivially parseable
- **Sources jar path:** Loom writes the merged Minecraft sources jar to one of two locations depending on Loom version:
  - **Per-project cache (newer Loom, e.g. 1.16-SNAPSHOT used by MC 1.19+):** `...` ...
  - **Global cache (older Loom, fallback):** `...` ...
```

**Observation:** The Gradle Project Parsing subsection uses a small intro table THEN a free-form bullet list with bold-key + colon-prose entries (`- **Per-project cache (...):** ...`). This is the closest in-document analog for a subsection whose content is "structured prose with priority chains," NOT a pure 5-column choice table. The chains are a different content shape than the surrounding tech-choice tables (per CONTEXT.md Claude's Discretion); a numbered list under a short prose intro is the right call.

**Recommended layout for `### Platform Support`:**

```markdown
### Platform Support

FabricModMCP supports Linux, macOS, and Windows. The MCP server itself runs as a Node 22+ process; the JDT LS child process runs on Java 21+. The two priority chains below are the authoritative discovery contract — see the footer for the source-of-truth pointer.

#### Java Discovery Priority Chain

1. `--java-home` CLI flag (module-state `configuredJavaHome`)
2. `org.gradle.java.home` from `<projectRoot>/gradle.properties`
3. `JAVA_HOME` env var
4. `java` on PATH (libuv handles PATH lookup + PATHEXT on Windows)
5. Scan common install locations from `commonJavaLocations()` with vendor-aware layout map

#### JDT LS Install Locations (probed in priority order)

`JDTLS_HOME` env var heads each list (consumed by `findJdtLs` before the per-OS candidates).

**Windows:**
1. `%LOCALAPPDATA%\jdtls`
2. `%PROGRAMFILES%\jdtls`
3. `%USERPROFILE%\jdtls`
4. `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`

**Linux / macOS:**
1. `~/.local/share/jdtls`
2. `/usr/local/share/jdtls`
3. `~/jdtls`

Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02.
Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS).
```

**Critical formatting notes:**
- The new subsection is `### Platform Support` (3 hashes), NOT `## Platform Support` (D-16 — it lives INSIDE `## Technology Stack`, sibling to "Build & Development" / "Supporting Libraries").
- Bold-prefix prose lines (`**Windows:**` / `**Linux / macOS:**`) match the bullet style at `CLAUDE.md:58-63`.
- Sub-subsection headers (`#### Java Discovery Priority Chain`) use 4 hashes — new convention for this subsection, but fits the markdown hierarchy. If the planner prefers, drop them and use bold-prose intro lines (`**Java Discovery Priority Chain**`) — sibling subsections do not use `####` today, so the planner's call is a tone vs hierarchy tradeoff. **Recommendation:** use bold-prose intro lines (no `####`) to match surrounding sibling subsections.
- The footer is verbatim D-18 string. Required at the bottom of BOTH this subsection AND `docs/WINDOWS-SUPPORT.md`.

**Drift impact:** D-16 acknowledges this adds ~30-50 lines to every Claude session's context (CLAUDE.md is loaded into every session). Acceptable per maintainer's discoverability-priority decision.

---

### `.planning/ROADMAP.md` Phase 39 Plans subsection (MODIFY — lines 181-185)

**Analog (best match — Phase 36 Plans subsection, 4+1 pattern matching D-13):** `.planning/ROADMAP.md:133-138`:

```markdown
**Plans**: 5 plans (4 original + 1 gap closure)
  - [x] 36-01-PLAN.md — Create `src/platform/uri.ts` pure helper module + tests (WIN-03 / UNIX-02 foundation)
  - [x] 36-02-PLAN.md — Forward sweep (7 sites) + reverse sweep (1 site) across `client.ts`, `workspace-sync.ts`, `remove-project-member.ts`, `tool-helpers.ts` (WIN-03)
  - [x] 36-03-PLAN.md — `uri-mapper.ts` drive-letter case-fold (`prefixMatches` state machine) + internal `toFileUri` migration + Windows-mocked tests (WIN-05 / UNIX-02)
  - [x] 36-04-PLAN.md — `workspace-sync.ts` hardening: ZIP split-and-spread + traversal guard + `rm` retry options + tests (WIN-04 / WIN-06 / WIN-07)
```

**Format pattern:**
1. Header line: `**Plans**: N plans` (or `N plans (X original + Y gap closure)` if the 4+1 precedent applies).
2. Each plan: `  - [ ] NN-NN-PLAN.md — <one-line description> (<requirement IDs>)` — exactly two spaces of indent, dash, space, checkbox, space, plan filename, em-dash with surrounding spaces, description, parenthesized requirement IDs.
3. Checkboxes start `[ ]` (incomplete); flip to `[x]` after `/gsd:verify-phase` marks the plan complete (per Phase 36-38 precedent).

**Stale content to replace** at lines 181-185 (RESEARCH.md Pitfall §5 — VERIFIED via ROADMAP read 2026-05-24):

```markdown
**Plans**: 5 plans (4 original + 1 gap closure)
  - [x] 36-01-PLAN.md — Create `src/platform/uri.ts` pure helper module + tests (WIN-03 / UNIX-02 foundation)
  - [x] 36-02-PLAN.md — Forward sweep (7 sites) + reverse sweep (1 site) across `client.ts`, `workspace-sync.ts`, `remove-project-member.ts`, `tool-helpers.ts` (WIN-03)
  - [x] 36-03-PLAN.md — `uri-mapper.ts` drive-letter case-fold (`prefixMatches` state machine) + internal `toFileUri` migration + Windows-mocked tests (WIN-05 / UNIX-02)
  - [ ] 36-04-PLAN.md — `workspace-sync.ts` hardening: ZIP split-and-spread + traversal guard + `rm` retry options + tests (WIN-04 / WIN-06 / WIN-07)
```

This is a verbatim copy of Phase 36's Plans subsection — clearly a copy-paste artifact. The planner's `/gsd:plan-phase 39` writes the real Phase 39 plans here once it has decided the plan list. Each plan line cites UNIX-03 (the only declared phase requirement) or "(validation)" for the manual matrix plans.

**Header line shape after rewrite:** Use `**Plans**: N plans` initially (no `4+1` until/unless gap closure triggers). If gap-closure plans (`39-NN-PLAN.md` per D-13) get added, update the header line in a follow-up commit to `N plans (M original + K gap closure)` matching Phase 36/37 precedent.

---

### `.planning/phases/39-windows-end-to-end-validation/39-VERIFICATION.md` (NEW)

**Analog:** `.planning/phases/38-jdt-ls-discovery-on-windows/38-VERIFICATION.md` (entire file — closest sibling, most recent verification doc; same templater).

**Template owner:** `/gsd:verify-phase` produces this file from its standard layout. Phase 39 does NOT write this file in any plan — it is produced as the output of the verifier step. PATTERNS.md lists it here so the planner knows the verifier-templated layout is the one to expect.

**Frontmatter pattern** (verbatim from `38-VERIFICATION.md:1-7`):

```
---
phase: 39-windows-end-to-end-validation
verified: <ISO-8601 timestamp>
status: passed | failed
score: <truths verified>/<total truths>
overrides_applied: 0
---
```

**Top-level section order** (from 38-VERIFICATION.md):
1. `# Phase 39: Windows End-to-End Validation — Verification Report`
2. `**Phase Goal:** ...` / `**Verified:** ...` / `**Status:** ...` / `**Re-verification:** ...`
3. `## Goal Achievement`
4. `### Observable Truths (Roadmap Success Criteria + PLAN must_haves)` — table with `#`, `Truth`, `Status`, `Evidence` columns
5. `### Required Artifacts` — table with `Artifact`, `Expected`, `Status`, `Details`
6. `### Key Link Verification` — table
7. `### Data-Flow Trace (Level 4)`
8. `### Behavioral Spot-Checks` — table with `Behavior`, `Command`, `Result`, `Status`
9. `### Probe Execution`
10. `### Requirements Coverage` — table

**Phase 39-specific content (per D-06/D-07/D-08):** The Phase 39 verification doc inserts a `## Environment` block and a `## Matrix` block, NOT the standard truth/artifact tables alone. RESEARCH.md Pattern 3 gives the exact template:

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
- fabric-example-mod: commit <SHA>

## Matrix

- [ ] **Row 1 — `--java-home`**: javaPath=`C:\...\java.exe`, find_definition N=<n>, find_references N=<n> (cross-mod sibling-mod → example-mod)
- [ ] **Row 2 — `org.gradle.java.home`**: javaPath=`C:\...\java.exe`, find_definition N=<n>, find_references N=<n>
- [ ] **Row 3 — `JAVA_HOME`**: javaPath=`C:\...\java.exe`, find_definition N=<n>, find_references N=<n>
- [ ] **Row 4 — PATH only**: javaPath=`C:\...\java.exe`, find_definition N=<n>, find_references N=<n>

## Failures

(none — or stdout/stderr pasted inline per D-07 if any row failed)
```

These two blocks slot into the standard verifier template AFTER `## Goal Achievement` and BEFORE `### Probe Execution`. The verifier reads the Matrix checkbox state to gate plan-4 completion (per RESEARCH.md Pattern 1).

---

### `src/jdtls/client.ts` — optional one-line `logger.info` addition (OPTIONAL — recommended per RESEARCH.md Pitfall §1 / Open Question §1)

**Analog A — call shape:** `src/index.ts:39`:

```typescript
logger.info('Default project created', { jdtlsAvailable: initialProject.jdtls.available });
```

**Analog B — closer call shape (info level, after a major child-process or workspace lifecycle event):** `src/jdtls/startup.ts:182`:

```typescript
logger.info(`JDT LS reinit succeeded for project '${project.name}'`);
```

**Existing surrounding pattern** in `src/jdtls/client.ts` (debug-only logger calls):
- Line 138, 143 — `logger.debug('JDT LS candidate skipped', { candidate: dir, reason: ... })`
- Line 254 — `logger.debug('JDT LS stderr', { data: chunk.toString().trimEnd() })`
- Line 275 — `logger.debug('JDT LS language/status', { params })`

**Recommended insertion** (per RESEARCH.md Common Pitfalls §1 recommendation):

```typescript
// src/jdtls/client.ts — immediately BEFORE the spawn() call at line 188

logger.info('Spawning JDT LS', { javaPath, jdtlsHome });

const proc = spawn(javaPath, [
	'-Declipse.application=org.eclipse.jdt.ls.core.id1',
	// ... existing args ...
], {
	stdio: ['pipe', 'pipe', 'pipe'],
});
```

**Why info level (not debug):** D-04 evidence MUST be visible at default log level so the maintainer doesn't need to re-run rows with `--log-level=debug`. Existing info-level emissions (`Default project created`, `Server started`, `Removed members...`, `JDT LS reinit succeeded`) follow the "log once per significant lifecycle event" convention — JDT LS spawn is exactly such an event.

**Why `{ javaPath, jdtlsHome }` not just `{ javaPath }`:** D-04 specifically calls out `javaPath` evidence. `jdtlsHome` is symmetric (proves which JDT LS install was selected), trivial to add, and useful for any future WIN-02 regression check.

**Required test (per RESEARCH.md Wave 0 Gaps):** Add a `vi.spyOn(logger, 'info')` assertion in `tests/jdtls/client.test.ts` verifying the spawn-time log call shape:

```typescript
const infoSpy = vi.spyOn(logger, 'info');
// ... arrange a successful startJdtLs call with mocked spawn ...
expect(infoSpy).toHaveBeenCalledWith('Spawning JDT LS', { javaPath: expect.any(String), jdtlsHome: expect.any(String) });
```

Analog for the spy test shape: `tests/jdtls/client.test.ts:458-479` (Phase 38's `logger.debug` spy pattern — per `38-VERIFICATION.md:#8`).

**Authority for this code change:** The constraint "Files this phase MUST NOT modify: anything under `src/`" in `39-CONTEXT.md` has an explicit carve-out for gap-closure plans triggered by failures (D-13). RESEARCH.md Open Question §1 argues this observability gap is itself a pre-known finding that justifies the same carve-out spirit — without the log line, D-04 evidence cannot be captured at info level, defeating the matrix's primary purpose. **Planner must surface this to the user in plan-checker pass** and either (a) add the line in an early/preamble plan (recommended), or (b) document the PowerShell `Get-CimInstance` process-tree scraping recipe in Plan 4's task spec as a no-`src/**`-touch alternative.

---

## Shared Patterns

### Verbatim Source Quoting + Cross-Reference Footer (D-18)

**Apply to:** Both `docs/WINDOWS-SUPPORT.md` AND the `CLAUDE.md ### Platform Support` subsection.

**Pattern:** Quote priority chains verbatim from source doc-comments (`src/jdtls/java-discovery.ts:8-13` and `src/platform/index.ts:70-87` body) rather than paraphrasing. End each location with the exact D-18 footer string:

```
Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02.
Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS).
```

**Rationale:** The same contract lives in 3+ sources (REQUIREMENTS.md WIN/JAVA IDs, `java-discovery.ts` doc-comment, `platform/index.ts` function body, CLAUDE.md, `docs/WINDOWS-SUPPORT.md`). The cross-reference footer ensures any reader can find the implementation without grep-discovery, and the verbatim-quote convention reduces drift to a single editing site (the source comment) instead of N parallel paraphrases.

### Phase Plans Subsection Format (ROADMAP convention)

**Apply to:** `.planning/ROADMAP.md` Phase 39 Plans subsection rewrite (lines 181-185).

**Pattern** (from Phase 36/37/38 precedent at lines 118-120, 133-138, 151-156, 168-169):

```markdown
**Plans**: N plans
  - [ ] NN-NN-PLAN.md — <one-line description> (<requirement IDs>)
  - [ ] NN-NN-PLAN.md — <description> (<requirements>)
  ...
```

Update the header to `**Plans**: N plans (M original + K gap closure)` only after gap-closure plans (`39-NN-PLAN.md` per D-13) get added in a follow-up commit.

### Verification Doc Frontmatter + Section Layout

**Apply to:** `39-VERIFICATION.md` (produced by `/gsd:verify-phase`).

**Pattern:** Identical to `38-VERIFICATION.md`. The verifier handles this — the planner does not write the verification doc directly. Phase-39-specific additions (Environment block, Matrix block, Failures block) slot between `## Goal Achievement` and `### Probe Execution`.

### Logger Call Convention (if the optional `src/jdtls/client.ts` change happens)

**Source:** `src/index.ts:39`, `src/jdtls/startup.ts:182`, plus `src/jdtls/client.ts:138,143,254,275` for the data-shape convention.

**Pattern:** `logger.info('<significant lifecycle event>', { keyA, keyB })` — present-tense gerund or past-tense verb in the message, structured-data object in the second argument with snake-free camelCase keys.

```typescript
logger.info('Spawning JDT LS', { javaPath, jdtlsHome });
```

This matches `src/index.ts:39` shape exactly (`logger.info('Default project created', { jdtlsAvailable: ... })`).

## No Analog Found

No files in this phase fall into the "no analog" bucket. Every artifact has either an in-repo analog (verification doc, ROADMAP Plans subsection, CLAUDE.md sibling subsection, logger call) or an in-source analog (priority chain doc-comments, jsdoc prose tone). The closest thing to "no analog" is the standalone `docs/WINDOWS-SUPPORT.md` itself — no `docs/` directory exists today, so this is the first file there — but the content shape (structured prose + priority chains + footer) is well-precedented by the source doc-comments quoted above.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All files have at least a role-match analog; see Pattern Assignments above. |

## Metadata

**Analog search scope:**
- `src/jdtls/java-discovery.ts:1-60` — Java priority chain doc-comment header
- `src/jdtls/client.ts:150-260` — `startJdtLs` spawn site for the optional logger.info insertion
- `src/jdtls/startup.ts:182` — closest existing `logger.info` lifecycle-event call
- `src/index.ts:39,47,66,73` — info-level call shape precedents
- `src/platform/index.ts:50-134` — `jdtlsCandidateDirs` and `commonJavaLocations` jsdoc + body
- `src/logging/logger.ts` — logger contract (default level `info`)
- `CLAUDE.md:19-152` — `## Technology Stack` block (insertion point for `### Platform Support`)
- `.planning/ROADMAP.md:100-185` — Phase 35-39 plans, milestone bullet list, plans subsection format
- `.planning/phases/38-jdt-ls-discovery-on-windows/38-VERIFICATION.md` — closest verification doc analog
- `.planning/phases/38-jdt-ls-discovery-on-windows/38-01-PLAN.md` — plan frontmatter and structure convention
- `.planning/phases/{36,37,38}/` — sibling phase artifact directories for layout reference

**Files scanned:** 11

**Pattern extraction date:** 2026-05-24

**Key insight for the planner:** Phase 39 has *zero* novel structural engineering. Every artifact has a recent in-repo or in-source analog. The planner's job is to compose existing patterns in the right order with the `checkpoint:human-verify` gate at the right place (between agent-completable docs+ROADMAP plans and the human-executable Windows matrix plan, per RESEARCH.md Pattern 1). The single decision point that needs maintainer input is the optional `src/jdtls/client.ts` `logger.info` addition (RESEARCH.md Open Question §1) — surface this in the plan-checker pass.
