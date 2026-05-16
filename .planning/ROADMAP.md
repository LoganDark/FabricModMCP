# Roadmap: FabricModMCP

## Milestones

- ✅ **v1.0 MVP** — Phases 1-10 (shipped 2026-04-14) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Study Jars** — Phases 11-14 (shipped 2026-04-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Symbol Resolution** — Phases 15-18 (shipped 2026-04-14) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Context Management** — Phases 19-22 (shipped 2026-04-15) — [archive](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 Project Rearchitecture** — Phases 23-27 (shipped 2026-04-15) — [archive](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Quality & Consistency** — Phases 28-34 (shipped 2026-04-16) — [archive](milestones/v1.5-ROADMAP.md)
- 🚧 **v1.6 Windows Support** — Phases 35-39 (started 2026-05-15)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-10) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Server Bootstrap (2/2 plans)
- [x] Phase 2: Project Discovery (2/2 plans)
- [x] Phase 3: Dependency Discovery and Jar Registry (2/2 plans)
- [x] Phase 4: Multi-Project Sessions (2/2 plans)
- [x] Phase 5: Project Metadata (2/2 plans)
- [x] Phase 6: Source Browsing (2/2 plans)
- [x] Phase 7: Search (2/2 plans)
- [x] Phase 8: Cascading Regex Engine (2/2 plans)
- [x] Phase 9: Semantic Navigation (3/3 plans)
- [x] Phase 10: Advanced LSP Browsing (3/3 plans)

**10 phases, 22 plans, 46 requirements satisfied, 327 tests**

</details>

<details>
<summary>✅ v1.1 Study Jars (Phases 11-14) — SHIPPED 2026-04-14</summary>

- [x] Phase 11: Types and Domain Logic (2/2 plans)
- [x] Phase 12: Existing Tool Integration (2/2 plans)
- [x] Phase 13: Study Jar Management Tools (2/2 plans)
- [x] Phase 14: JDT LS Workspace Sync (2/2 plans)

**4 phases, 8 plans, 10 requirements satisfied, 423 tests**

</details>

<details>
<summary>✅ v1.2 Symbol Resolution (Phases 15-18) — SHIPPED 2026-04-14</summary>

- [x] Phase 15: Enable Method Search (1/1 plans)
- [x] Phase 16: Member Parser Domain Module (2/2 plans)
- [x] Phase 17: Structured Member Output (2/2 plans)
- [x] Phase 18: Member Inspection & Context Lines (2/2 plans)

**4 phases, 7 plans, 7 requirements satisfied, 526 tests**

</details>

<details>
<summary>✅ v1.3 Context Management (Phases 19-22) — SHIPPED 2026-04-15</summary>

- [x] Phase 19: Line-Range Reading (2/2 plans)
- [x] Phase 20: Member Context Lines (2/2 plans)
- [x] Phase 21: Navigation Pagination (2/2 plans)
- [x] Phase 22: Verbosity Audit (3/3 plans)

**4 phases, 9 plans, 11 requirements satisfied, 592 tests**

</details>

<details>
<summary>✅ v1.4 Project Rearchitecture (Phases 23-27) — SHIPPED 2026-04-15</summary>

- [x] Phase 23: Type Foundation and ProjectStore (4/4 plans)
- [x] Phase 24: Dependency Namespacing (3/3 plans)
- [x] Phase 25: Child Management Tools (2/2 plans)
- [x] Phase 25.1: Tool Rework — INSERTED (4/4 plans)
- [x] Phase 26: JDT LS Workspace Unification (2/2 plans)
- [x] Phase 27: Migration Cleanup (absorbed by Phase 25.1)

**6 phases, 15 plans, 15 requirements satisfied, 665 tests**

</details>

<details>
<summary>✅ v1.5 Quality & Consistency (Phases 28-34) — SHIPPED 2026-04-16</summary>

- [x] Phase 28: Jar & Cache Bug Fixes (1/1 plans)
- [x] Phase 29: JDT LS & Workspace Bug Fixes (1/1 plans)
- [x] Phase 30: API Consistency (1/1 plans)
- [x] Phase 31: Data Exposure (1/1 plans)
- [x] Phase 32: Per-Child Jar Filtering (1/1 plans)
- [x] Phase 33: Build File Re-parsing (1/1 plans)
- [x] Phase 34: Documentation & Instructions (1/1 plans)

**7 phases, 7 plans, 26 requirements satisfied, 696 tests**

</details>

### 🚧 v1.6 Windows Support (Phases 35-39) — IN PROGRESS

- [ ] **Phase 35: Platform Helpers + Java Executable Resolution** — Establish `src/platform/index.ts` and make `spawn` work on Windows by appending `.exe` to absolute Java candidates; Unix code paths unchanged.
- [x] **Phase 36: Path / URI Handling Audit** — Migrate all `'file://' + path` and `uri.replace('file://', '')` sites to `pathToFileURL`/`fileURLToPath`; add ZIP-entry × `path.join` separator fix, path-traversal guard, and Windows-only EBUSY retry on temp cleanup. (completed 2026-05-16)
- [ ] **Phase 37: Smarter Java Discovery (cross-platform)** — New `src/jdtls/java-discovery.ts` with priority chain `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → common install locations; async sequential probes with 3s per-candidate timeout; `.properties` backslash unescape at the consumption site.
- [ ] **Phase 38: JDT LS Discovery on Windows** — Extend `findJdtLs` with Windows install locations; replace `process.env.HOME` with `os.homedir()`.
- [ ] **Phase 39: Windows End-to-End Validation** — Manual smoke test on a Windows machine; README "Windows Support" section; milestone-completion checkpoint.

## Phase Details

### Phase 35: Platform Helpers + Java Executable Resolution

**Goal**: Establish the `src/platform/index.ts` module and make Windows able to spawn `java.exe` at all. Foundation phase — without this, every subsequent Windows fix is unobservable. Unix-regression note: every helper's Unix branch returns today's literal verbatim (`'java'`, `join(home, 'bin', 'java')`), so Unix code paths are byte-identical to v1.5. This phase also encodes the milestone's UNIX-01 commitment: existing Unix `detectJava` behavior is preserved for users who don't supply new inputs.
**Depends on**: Nothing (first v1.6 phase; continues from completed Phase 34)
**Requirements**: WIN-01, UNIX-01
**Success Criteria** (what must be TRUE):
  1. `src/platform/index.ts` exports `isWindows`, `javaBinaryName()`, `javaBinaryInHome(home)`, `jdtlsCandidateDirs()`, and `commonJavaLocations()` with platform-branched implementations; Unix branches return today's literals verbatim.
  2. `resolveJavaExecutable(candidate)` helper in the JDT LS layer accepts an absolute Java path and returns a real file path on Windows (appending `.exe` if missing and the `.exe` variant exists on disk); bare `'java'` PATH lookups pass through unchanged on both platforms.
  3. `detectJava` candidate construction uses `javaBinaryName()` / `javaBinaryInHome()` so a Windows-resolved `javaPath` is always a literal file `spawn` can exec (no ENOENT on `C:\…\bin\java`).
  4. Existing v1.5 Unix `detectJava` tests pass unchanged; new tests with mocked `process.platform = 'win32'` verify `.exe` resolution and PATH-fallback behavior.
**Plans**: 2 plans
  - [ ] 35-01-PLAN.md — Create `src/platform/index.ts` (pure module with 5 platform-branched exports) + unit tests covering both Windows and Unix branches
  - [ ] 35-02-PLAN.md — Wire platform helpers into `src/jdtls/client.ts` `detectJava`, add new `resolveJavaExecutable` helper, and augment `tests/jdtls/client.test.ts` with Windows-mocked describes

### Phase 36: Path / URI Handling Audit

**Goal**: Wholesale migration to `pathToFileURL`/`fileURLToPath` across all 7 forward + 2 reverse URI sites; fix ZIP-entry-meets-`path.join` mixed-separator corruption; add ZIP path-traversal guard; add Windows-only EBUSY retry loop on temp-dir cleanup. Unix-regression note: `pathToFileURL` output is byte-identical to `'file://' + abspath` for the project's typical absolute paths without special characters; the ZIP-split-and-spread pattern (`join(dir, ...entryPath.split('/'))`) produces the same OS-native path on Unix and fixes the mixed-separator bug on Windows. UNIX-01 / UNIX-02 are the hard guardrails for this phase.
**Depends on**: Phase 35 (uses `isWindows` from the platform module)
**Requirements**: WIN-03, WIN-04, WIN-05, WIN-06, WIN-07, UNIX-02
**Success Criteria** (what must be TRUE):
  1. Every `'file://' + path` construction site in `src/jdtls/client.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/uri-mapper.ts`, and `src/tools/remove-project-member.ts` uses `pathToFileURL(absPath).href`; every `uri.replace('file://', '')` and `fileUriToPath` consumer uses `fileURLToPath`.
  2. `uri-mapper.ts` `fromFileUri` prefix match is case-insensitive on Windows (tolerates `C:` vs `c:` drive-letter casing); ZIP-entry-to-FS path boundaries use `join(dir, ...entryPath.split('/'))`.
  3. ZIP entry extraction rejects entries containing `..` segments before writing to disk; temp-dir cleanup on Windows retries on `EBUSY`/`EPERM` (3x with 100ms backoff) and only logs on final failure.
  4. URI round-trip test passes on representative inputs including `/private/var/folders/x y/file.java`, `/tmp/foo`, and (mocked-Windows) `C:\Foo\Bar baz#qux/file.java` — Unix output byte-identical to v1.5.
  5. All v1.5 tests still pass after the sweep; new tests cover Windows-mocked drive-letter casing, path-traversal rejection, and EBUSY retry.
**Plans**: 4 plans
  - [x] 36-01-PLAN.md — Create `src/platform/uri.ts` pure helper module + tests (WIN-03 / UNIX-02 foundation)
  - [x] 36-02-PLAN.md — Forward sweep (7 sites) + reverse sweep (1 site) across `client.ts`, `workspace-sync.ts`, `remove-project-member.ts`, `tool-helpers.ts` (WIN-03)
  - [x] 36-03-PLAN.md — `uri-mapper.ts` drive-letter case-fold (`prefixMatches` state machine) + internal `toFileUri` migration + Windows-mocked tests (WIN-05 / UNIX-02)
  - [x] 36-04-PLAN.md — `workspace-sync.ts` hardening: ZIP split-and-spread + traversal guard + `rm` retry options + tests (WIN-04 / WIN-06 / WIN-07)

### Phase 37: Smarter Java Discovery (cross-platform)

**Goal**: Extract Java discovery into `src/jdtls/java-discovery.ts` with an async `discoverJava({ projectRoot? })` implementing the priority chain `--java-home` → `org.gradle.java.home` (from project `gradle.properties`) → `JAVA_HOME` → `java` on PATH → scanned common install locations. Sequential async probes with a 3s per-candidate timeout. Apply `unescapePropertiesValue` at the consumer site for `org.gradle.java.home`. This is the one intentional cross-platform feature in v1.6 — but the Unix-regression contract still holds: users who don't set `org.gradle.java.home` and don't supply `--java-home` see no behavioral change (same `JAVA_HOME` → PATH chain as v1.5, same first-valid-≥21 outcome). Old `setJavaHome` / `detectJava` symbols remain as re-exports from `client.ts` for one milestone.
**Depends on**: Phase 35 (uses `resolveJavaExecutable`, `javaBinaryInHome`, `commonJavaLocations` from the platform module)
**Requirements**: JAVA-01, JAVA-02, JAVA-03, JAVA-04, JAVA-05
**Success Criteria** (what must be TRUE):
  1. `discoverJava({ projectRoot? })` resolves Java in priority order `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → `java` on PATH → common install locations, evaluating candidates sequentially (no parallel race — priority semantics preserved).
  2. Candidates that fail the Java 21+ probe are skipped (not fatal); discovery continues to the next candidate and only synthesizes the "no compatible Java found" error if every candidate failed.
  3. `org.gradle.java.home` is read from `<projectRoot>/gradle.properties` via the existing `parseGradleProperties`, with consumer-side `unescapePropertiesValue` decoding backslash escapes (`\\` → `\`, `\:` → `:`, `\u`, etc.) so `C:\Users\new\jdk` and `C:\\Users\\new\\jdk` both resolve to the same path.
  4. Each candidate probe uses async `execFile` with a 3s timeout so a misbehaving candidate (Defender scan, hung JVM) cannot stall startup.
  5. Common-install-location scan covers Adoptium / Microsoft / Oracle / Corretto / Zulu / IntelliJ `~/.jdks` / scoop on Windows and `/usr/lib/jvm/*` / `/Library/Java/JavaVirtualMachines/*/Contents/Home` / Homebrew openjdk on Unix.
  6. Existing `--java-home` precedence test (commit `4e94b4b`) extended and still passes; new tests verify priority order, version-skip continuation, backslash unescape, and per-candidate timeout.
**Plans**: 4 plans
  - [x] 37-01-PLAN.md — Create `src/jdtls/java-discovery.ts` with discoverJava + carry-over symbols (setJavaHome/detectJava/parseJavaVersion/resolveJavaExecutable) + unescapePropertiesValue + vendor map (JAVA-01..JAVA-05)
  - [ ] 37-02-PLAN.md — Slim `client.ts` to re-export shim; extend `initJdtLsSession({ projectRoot? })` + add `retryDegradedJdtLsSessions()` in `startup.ts` (JAVA-01)
  - [ ] 37-03-PLAN.md — Wire `retryDegradedJdtLsSessions()` into `add_fabric_mod`, `refresh_project`, `refresh_project_members` tool handlers (JAVA-01)
  - [ ] 37-04-PLAN.md — New `tests/jdtls/java-discovery.test.ts` (all 5 JAVA requirements) + extend `tests/jdtls/startup.test.ts` + full-suite regression (UNIX-01 byte-identical preservation)

### Phase 38: JDT LS Discovery on Windows

**Goal**: Extend `findJdtLs` with Windows-friendly install locations and replace `process.env.HOME` with `os.homedir()` cross-platform. Unix-regression note: the Unix branch of `jdtlsCandidateDirs()` returns the existing three paths (`~/.local/share/jdtls`, `/usr/local/share/jdtls`, `~/jdtls`) verbatim; `os.homedir()` returns the same value as `process.env.HOME` on Unix systems where `HOME` is set (the documented prerequisite).
**Depends on**: Phase 35 (uses `jdtlsCandidateDirs()` from the platform module)
**Requirements**: WIN-02
**Success Criteria** (what must be TRUE):
  1. `findJdtLs` probes Windows-conventional install locations when `process.platform === 'win32'`: `%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`, `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`.
  2. `process.env.HOME` is replaced by `os.homedir()` in `client.ts`; `grep -rn 'process.env.HOME' src/` returns no matches outside test fixtures.
  3. `JDTLS_HOME` env var override continues to work on both platforms; the improved "not found" error message lists the candidate paths actually probed.
  4. Unix `findJdtLs` tests pass unchanged; new tests mock `process.platform = 'win32'` and verify candidate ordering plus existence checks.
**Plans**: 4 plans
  - [x] 36-01-PLAN.md — Create `src/platform/uri.ts` pure helper module + tests (WIN-03 / UNIX-02 foundation)
  - [x] 36-02-PLAN.md — Forward sweep (7 sites) + reverse sweep (1 site) across `client.ts`, `workspace-sync.ts`, `remove-project-member.ts`, `tool-helpers.ts` (WIN-03)
  - [x] 36-03-PLAN.md — `uri-mapper.ts` drive-letter case-fold (`prefixMatches` state machine) + internal `toFileUri` migration + Windows-mocked tests (WIN-05 / UNIX-02)
  - [ ] 36-04-PLAN.md — `workspace-sync.ts` hardening: ZIP split-and-spread + traversal guard + `rm` retry options + tests (WIN-04 / WIN-06 / WIN-07)

### Phase 39: Windows End-to-End Validation

**Goal**: Milestone-completion checkpoint, not a code phase. Manual smoke test on a real Windows machine exercising the full happy path (`create_project` → `add_fabric_mod` → `find_definition` round-trip → cross-mod navigation), plus README "Windows Support" section documenting the priority chain and JDT LS install conventions. Unix-regression note: full v1.5 test suite must still be green on macOS and Linux — Windows-targeted changes in Phases 35-38 may not have introduced any Unix behavioral drift. Validates UNIX-03 (regression guard) end-to-end and confirms the WIN- and JAVA- requirements work in production, not just unit tests.
**Depends on**: Phases 35, 36, 37, 38
**Requirements**: UNIX-03
**Success Criteria** (what must be TRUE):
  1. On a real Windows machine, the MCP server starts under all four Java-discovery entry points (`--java-home`, `org.gradle.java.home`, `JAVA_HOME`, PATH only) and spawns JDT LS successfully end-to-end.
  2. `find_definition` and `find_references` return non-empty results on a Fabric mod project on Windows; cross-mod navigation works (per-project JDT LS workspace covers all children).
  3. Full v1.5 + v1.6 vitest suite passes on both macOS and Linux with zero new failures or skips (UNIX-03 regression guard).
  4. README has a "Windows Support" section documenting the Java priority chain, the JDT LS install locations probed, and known limitations (long paths, WSL note); CLAUDE.md "Technology Stack" reflects the priority chain.
**Plans**: 4 plans
  - [x] 36-01-PLAN.md — Create `src/platform/uri.ts` pure helper module + tests (WIN-03 / UNIX-02 foundation)
  - [x] 36-02-PLAN.md — Forward sweep (7 sites) + reverse sweep (1 site) across `client.ts`, `workspace-sync.ts`, `remove-project-member.ts`, `tool-helpers.ts` (WIN-03)
  - [x] 36-03-PLAN.md — `uri-mapper.ts` drive-letter case-fold (`prefixMatches` state machine) + internal `toFileUri` migration + Windows-mocked tests (WIN-05 / UNIX-02)
  - [ ] 36-04-PLAN.md — `workspace-sync.ts` hardening: ZIP split-and-spread + traversal guard + `rm` retry options + tests (WIN-04 / WIN-06 / WIN-07)

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-10 | v1.0 | 22/22 | Complete | 2026-04-14 |
| 11-14 | v1.1 | 8/8 | Complete | 2026-04-14 |
| 15-18 | v1.2 | 7/7 | Complete | 2026-04-14 |
| 19-22 | v1.3 | 9/9 | Complete | 2026-04-15 |
| 23-27 | v1.4 | 15/15 | Complete | 2026-04-15 |
| 28-34 | v1.5 | 7/7 | Complete | 2026-04-16 |
| 35 | v1.6 | 0/2 | Planned | — |
| 36 | v1.6 | 4/4 | Complete    | 2026-05-16 |
| 37 | v1.6 | 1/4 | In Progress|  |
| 38 | v1.6 | 0/? | Not started | — |
| 39 | v1.6 | 0/? | Not started | — |
