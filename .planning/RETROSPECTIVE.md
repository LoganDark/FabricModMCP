# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-14
**Phases:** 10 | **Plans:** 22 | **Tasks:** 41

### What Was Built
- Full MCP server with 21 tools for Minecraft mod development assistance
- Auto-discovery of Minecraft sources and dependency jars from Gradle/Loom cache
- Hierarchical source browsing, glob search, and cascading regex position identification
- JDT LS integration for semantic navigation (find-definition, find-references, type hierarchy, implementations)
- Multi-project sessions for side-by-side version comparison workflow

### What Worked
- Layered domain → tool architecture kept tools thin and domain logic independently testable (327 tests)
- Deferring JDT LS to Phase 9 reduced early risk — server was fully useful for browsing/search without it
- node-stream-zip delivered excellent jar I/O performance (72ms full scan of 6,622 files)
- Dual mapping-era detection worked cleanly — auto-detected from Gradle config, no user intervention needed
- Post-phase DRY cleanup sessions (6 quick tasks) consolidated shared abstractions effectively

### What Was Inefficient
- ROADMAP.md progress table got out of sync with actual completion (only 2 of 10 phases marked complete in checkboxes)
- Some decisions were duplicated between STATE.md and PROJECT.md before the pattern was clarified
- PROJ-10 (manual jar path override) was carried through planning and Phase 3 before being descoped — could have been cut earlier

### Patterns Established
- Domain modules export pure functions; tool layer does Zod validation and MCP wiring
- SharedJarReader singleton for cross-tool handle reuse with ref counting
- SourceAdapter pattern (jar + filesystem) for uniform source access
- EntryIndex with module-level caching for repeated browsing performance
- LSP tool pattern: didOpen → request → didClose with try/finally cleanup
- DomainError for user-facing errors; makeSuccess/makeError for response envelopes

### Key Lessons
- Auto-discovery > manual configuration: PROJ-10 was never needed because auto-discovery worked reliably
- Cascading regex is a powerful position-identification primitive that composes well with LSP
- Quick task workflow is effective for post-phase cleanup and DRY refactoring
- 2-day timeline for 10 phases shows GSD workflow efficiency at scale

## Milestone: v1.1 — Study Jars

**Shipped:** 2026-04-14
**Phases:** 4 | **Plans:** 8

### What Was Built
- StudyJar type system with granular jar handle add/remove and per-key cache eviction
- Two-mode dependency resolver integrating study jars into all 11 existing tools
- Four MCP tools (add, remove, list, configure) for study jar lifecycle management
- Incremental JDT LS workspace sync with classpath regeneration and probe-based readiness detection
- 96 new tests (327 → 423), zero regressions

### What Worked
- Building on v1.0's layered architecture made study jar integration smooth — domain module first, then tool wiring
- getDependenciesForTool pattern unified study jar resolution across all 11 existing tools with minimal per-tool changes
- Incremental workspace sync avoided expensive full-rebuild on every add/remove
- Test-first approach in Phase 13 (plan 02 was dedicated test plan) caught edge cases early
- Domain service module (Phase 11 plan 02) as standalone unit made Phase 12 integration cleaner

### What Was Inefficient
- All 4 phases completed in a single day — planning overhead was proportionally high for the code volume (754 lines net)
- Phase 11 plan 02 (domain service) could have been merged with plan 01 — the split added ceremony for a small module
- 20 pre-existing TypeScript errors (index signature mismatch) remain unfixed from v1.0 — carried as tech debt

### Patterns Established
- Study jar IDs used `study:` namespace prefix (later removed in v1.3 quick task — plain names with collision detection)
- Two-mode resolver: getResolvedDependencies for default views, getAllDependencies for explicit selection
- Probe-based readiness detection for JDT LS (workspace/symbol query '*')
- Warning-on-failure-only pattern for optional workspace sync operations
- Pre-validate all names before mutation in batch operations (fail-fast)

### Key Lessons
- Small milestones (4 phases) ship fast but planning-to-code ratio is higher — consider bundling with related features
- The dependency resolver abstraction was the highest-leverage change — touched every tool file but made study jars "just work"
- JDT LS hot-reload behavior (classpath changes) needs empirical validation — flagged as human verification item

## Milestone: v1.2 — Symbol Resolution

**Shipped:** 2026-04-14
**Phases:** 4 | **Plans:** 7 | **Tasks:** 12

### What Was Built
- Method search unlock: JDT LS includeSourceMethodDeclarations enabled, readiness probe removed
- Member parser domain module: TypeReference (6 variants), MemberReference types, import resolver with 4-stage cascade, detail string parser
- Structured member output: enrichSymbols pipeline with FQNs wired into list_members and search_symbols
- read_member MCP tool: FQN-based member source extraction with Javadoc, annotations, overload support, inner class handling
- locate_in_source context lines: optional parameter extending matches to whole line boundaries with surrounding context
- 103 new tests (423 → 526), zero regressions

### What Worked
- Phase 18 (added after initial roadmap) integrated smoothly — building blocks from Phases 16-17 made it a natural extension
- Parallel execution of Plans 18-01 and 18-02 worked cleanly despite shared file edits (additive, non-overlapping changes)
- symbol-transform extraction (18-01 deviation) was the right call — reduced duplication between list-members and read-member
- enrichOne null-detail fallback (17-02 deviation) caught a real edge case for constructors/fields before it became a bug
- Discussion → plan → execute pipeline efficiently captured user decisions (FQN format, overload handling, context result shape)

### What Was Inefficient
- createResolvePackage was designed, implemented, tested, but never used in production — multi-jar inline approach was always needed
- VALIDATION.md files created for all 4 phases but none formally signed off (nyquist_compliant stays false)
- Phase 18 was added post-roadmap — could have been anticipated during v1.2 requirements if "inspection parity" was decomposed earlier

### Patterns Established
- `Class#method()` / `Class#field:` FQN scheme matching Javadoc convention
- EnrichedSymbol discriminated union pattern (method/field/class variants with no nullable fields)
- Multi-jar resolvePackage built inline rather than using single-EntryIndex helper
- Decoration scanning (Javadoc + annotations) via upward line traversal from LSP range start
- Shared symbol-transform module for LSP response normalization across tools

### Key Lessons
- Building domain primitives first (Phases 16-17) then wiring tools (Phase 17-18) is the right sequence — each phase had a clean dependency chain
- The FQN format decision (#-separator, no parameter types) was locked early in discuss-phase and never needed revision
- Parallel plan execution saves time when changes are additive to shared files — the key is non-overlapping edits
- Adding phases to an in-progress milestone works fine when they're natural extensions of the existing work

### Cost Observations
- Model mix: primarily opus for execution and planning, sonnet for verification and plan checking
- 4 phases completed in a single session continuation
- Phase 18 end-to-end (discuss → plan → execute → verify) took ~20 minutes of wall clock

## Milestone: v1.3 — Context Management

**Shipped:** 2026-04-15
**Phases:** 4 | **Plans:** 9 | **Tasks:** 17

### What Was Built
- read_source line-range support (startLine/lineCount) with per-response metadata on all code paths
- read_member context expansion (linesBefore/linesAfter) with member position metadata
- Generic pagination utility wired into find_references, find_implementations, find_definition
- Compact-by-default output system with category-based DETAIL_PARAMS and strip functions
- 66.5% response size reduction measured across benchmark classes (229K full -> 77K compact)
- 66 new tests (526 -> 592), zero regressions

### What Worked
- All 4 phases were architecturally independent — could have been parallelized if desired
- sliceLines pure utility approach made line-range bulletproof with 11 edge-case tests before wiring
- Category-based detail schemas (navigation/member/class/locate/source) scaled better than per-tool schemas
- Verbosity audit phase last (after controls existed) gave real data to optimize against
- Quick tasks for post-milestone cleanup (study prefix removal, innerClasses flag split) were effective

### What Was Inefficient
- Phase 22 Plan 02 took 12min (3x average) — audit report generation + test updates across many files
- Gap closure plan (22-03) existed only to add 4 missing opt-in tests — could have been caught in 22-01/02
- Two quick tasks (study prefix, innerClasses split) were discovered during description review, not planned

### Patterns Established
- DETAIL_PARAMS with category-based schemas and strip functions for opt-in verbosity
- Destructuring rest pattern for clean field stripping (type-safe, no explicit delete)
- applyPagination generic utility with PaginatedResult envelope (total/offset/hasMore)
- sliceLines pure utility for line-range extraction with clamping semantics
- Study jar plain name IDs with collision detection at add time and auto-unload on refresh

### Key Lessons
- Compact-by-default is the right trade-off for MCP tools — agents can opt in when they need detail
- Measuring real response sizes (Phase 22 audit) was essential — gut feel about "worst offenders" was wrong
- Description/instruction review after building reveals API inconsistencies that automated tests miss
- Quick task workflow catches post-milestone polish items efficiently

### Cost Observations
- 9 plans executed across ~34 minutes of wall clock
- Phase 22 was the most expensive (3 plans, 18min) due to cross-cutting changes across many tool files
- 2 quick tasks added ~10min for study prefix removal and innerClasses flag split

## Milestone: v1.4 — Project Rearchitecture

**Shipped:** 2026-04-15
**Phases:** 6 | **Plans:** 15 | **Tasks:** 31

### What Was Built
- Composable project containers: Project/FabricModChild/StudyJarChild discriminated union hierarchy
- Namespaced dependency resolution with mod-name prefixes and scope parameter on all jar-aware tools
- Multi-mod support with auto-suffix collision handling and per-child jar lifecycle
- 28-tool taxonomy: 5 lifecycle, 6 info/refresh, 17 browsing — zero compatibility shims
- Unified JDT LS workspace per project with cross-mod semantic navigation
- Default project with JDT LS session at startup
- 73 new tests (592 -> 665), +969 net LOC

### What Worked
- Incremental migration via compat layer (Phase 23) then native rework (Phase 25.1) kept tests green throughout
- Phase 25.1 insert was the right call — doing compat removal as a separate focused phase was cleaner than mixing it into Phase 25
- Per-child jar handle lifecycle (addProjectJar/removeProjectJar) avoided disruptive full-project rebuilds during scoped refresh
- Namespace resolution module was high-leverage — bare ID backward compat "just worked" for single-mod case
- oldModForUnsync spread pattern in refresh tools preserved old dep list for clean workspace unsync before resync

### What Was Inefficient
- Phase 27 (Migration Cleanup) was planned but Phase 25.1 absorbed all its work — Phase 27 was redundant
- Compat layer was built in Phase 23 then removed in Phase 25.1 — ~400 lines of temporary code that existed for 3 phases
- Nyquist validation files created for all phases but none completed (wave_0_complete: false across the board)
- Three requirement texts (CONT-01, DEP-04, TOOL-02) referenced old tool names after Phase 25.1 renames — stale docs

### Patterns Established
- `activeProject`/`activeChild` for user-selected defaults (not "default" which collides with the project name)
- Category-based source adapter dispatch (`dep.category === 'mod-source'`) replacing magic string checks
- `getRootPathForScope` helper in tool-helpers for direct child access without compat
- jarIdToDirName mapping (`/` -> `--`) for namespace-safe directory names in JDT LS workspace
- initJdtLsSession encapsulating detect-Java + find-JDT-LS + start + graceful-degradation

### Key Lessons
- Inserted phases (25.1) can absorb planned-but-not-yet-started phases (27) — check for overlap before planning
- Breaking clients is fine when all clients are LLMs — aggressive rework beats backward compat in this context
- One JDT LS workspace per project is architecturally simpler and more capable than per-child workspaces
- The default project should have full capabilities from the start — lazy init creates confusing UX gaps

### Cost Observations
- 6 phases, 15 plans executed in a single day
- Phase 25.1 was the most expensive (4 plans, 22min) due to cross-cutting tool rework across 30+ files
- Phase 27 cost zero execution time (retroactively complete)
- Integration checker (sonnet) validated all 5 E2E flows and 15 requirement wirings

## Milestone: v1.5 — Quality & Consistency

**Shipped:** 2026-04-16
**Phases:** 7 | **Plans:** 7 | **Tasks:** 14

### What Was Built
- Bug fixes: race-safe jar handles, cache eviction leak, cycle-safe type hierarchy, inner class source reading, JDT LS cleanup, workspace sync rollback
- Unified API: limit+hasMore on all paginated tools, consistent parameter naming, z.enum validation
- Per-child jar filtering (fixed cross-mod filter leakage)
- Build file re-parsing on refresh with version/ID change warnings
- Data exposure: JDT LS status, declared build deps, jar locations, inner class FQNs
- Complete documentation: SERVER_INSTRUCTIONS with 5 new sections, all 28 tool descriptions accurate, CLAUDE.md filled
- 31 new tests (665 -> 696), +292 net LOC

### What Worked
- 4-agent parallel audit before the milestone provided exhaustive, prioritized findings — zero guesswork during execution
- One plan per phase kept execution fast and focused — 7 phases completed in a single session
- Bug fixes first (28-29), then API changes (30), then behavior (32-33), then docs last (34) — correct dependency order
- Quick task for tech debt after audit caught the remaining items before milestone completion
- Per-phase verification caught the stale import (Phase 32) and description gap (Phase 34) immediately

### What Was Inefficient
- SUMMARY.md frontmatter `requirements_completed` was empty for Phases 28 and 33 — executors didn't populate it, only verifiers caught it
- The 4-agent audit took ~15 minutes of wall clock — significant upfront cost, but paid for itself in zero rework during execution
- Phase 34 (documentation) was the most token-heavy because the executor had to cross-reference every tool file against descriptions

### Patterns Established
- Pre-milestone comprehensive audit → milestone driven entirely by findings
- `reloadFabricModConfig` helper pattern: extract shared logic from tool into loader module
- Per-child filtering pattern: iterate children independently, merge after filtering
- Inner class position hint pattern: `innerClass: { name, startLine }` metadata on source results
- Signal handler cleanup pattern: iterate projectStore for all sessions on SIGINT/SIGTERM

### Key Lessons
- A thorough audit before a quality milestone eliminates ambiguity — every phase had clear, unambiguous work
- "Discuss phase → all clear → write CONTEXT.md directly" is the right flow for audit-driven work
- The audit identified issues (activeChild description mismatch, pagination inconsistency) that would have been hard to find any other way
- Quick tasks are effective for post-audit tech debt cleanup that doesn't fit into the phase structure

### Cost Observations
- 7 plans executed in ~26 minutes total
- Audit itself: ~15 minutes (4 parallel agents)
- Most expensive phase: Phase 34 (documentation, 5min) — cross-referencing 28 tool files
- Cheapest phase: Phase 32 (per-child filtering, 1min) — single function refactor

## Milestone: v1.6 — Windows Support

**Shipped:** 2026-05-25
**Phases:** 5 (35-39) | **Plans:** 18 | **Commits:** 106

### What Was Built
- Cross-platform Java discovery (`src/jdtls/java-discovery.ts`) with async 5-slot priority chain (`--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → vendor-aware install scan), 3s per-candidate timeout
- New `src/platform/index.ts` module with 5 platform-branched helpers (`isWindows`, `javaBinaryName`, `javaBinaryInHome`, `jdtlsCandidateDirs`, `commonJavaLocations`); every Unix branch returns v1.5 literals verbatim
- `resolveJavaExecutable()` to fix libuv's PATHEXT-blindness on absolute Java paths — `child_process.spawn` now succeeds with `C:\…\bin\java.exe`
- `findJdtLs()` extended with Windows install conventions (`%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`, Mason package); `os.homedir()` replaces `process.env.HOME` everywhere
- Wholesale URI / path migration to `pathToFileURL` / `fileURLToPath` across 7 forward + 2 reverse sites; drive-letter case-fold round-trip; ZIP entry split-and-spread; ZIP path-traversal guard; Windows-only EBUSY retry on temp-dir cleanup
- 8.3 short-name URI canonicalization in `uri-mapper` so JDT LS's long-name `Location.uri` matches our prefix (Phase 39-06 gap closure)
- `docs/WINDOWS-SUPPORT.md` + new `### Platform Support` subsection in `CLAUDE.md`, both inlining verbatim priority chains with D-18 cross-reference footer

### What Worked
- **Phase-35-as-foundation pattern.** A single `src/platform/index.ts` module owned every platform branch from one place; every subsequent Windows fix routed through it. Made the UNIX-01 byte-identical contract trivial to enforce (every Unix branch returned a v1.5 literal verbatim).
- **The cross-host-safe `setPlatform + vi.resetModules + dynamic import` test pattern.** Let macOS contributors mock `process.platform = 'win32'` and exercise Windows code paths without a Windows host. Enabled Phases 35-38 to ship without a real Windows machine.
- **Phase 39-04 maintainer matrix on a real Windows 11 host.** 4-row evidence (one row per Java-discovery slot) gave high-confidence proof the production stack works end-to-end, not just in mocked tests. Surfaced 2 real bugs (`withLspDocument` race + unbounded `find_references`) that mocked tests had missed.
- **Plan-04 → 39-06 gap-closure loop.** The matrix found the 8.3 short-name URI mismatch on Windows; 39-06 closed it; re-verification confirmed the fix. Then code review caught CR-02 — the trailing-separator strip used `/\/+$/` (POSIX-only) and would have defeated its own Windows fix. The review-then-fix loop caught a real regression before milestone close.
- **Sequential async candidate probes with per-candidate timeout.** Preserved priority semantics (no parallel race) while bounding worst-case startup time at `4 × 3s = 12s`.

### What Was Inefficient
- **`audit-open` false positives.** The CLI reports 22 quick-task slugs as "missing" despite the files being on disk with complete PLAN.md + SUMMARY.md. Wasted review time spot-checking; would be worth fixing upstream.
- **Phase summary `key_files` frontmatter often empty.** Code-review scoping fell back from SUMMARY-tier to git-diff tier on Phase 39, then required manual `--files` override to focus on the actual source change. Plan executors could be more disciplined about populating `key_files.modified` in SUMMARY frontmatter.
- **No CI matrix runner.** Linux UNIX-03 sweep was deferred to a future human test because the maintainer's primary host is macOS. A CI runner (GitHub Actions Linux + Windows) would have closed both human-UAT items automatically.
- **`milestone.complete` CLI does not reorganize ROADMAP.md or update inline requirement checkboxes.** Created the archives, then left ROADMAP.md still showing "🚧 IN PROGRESS" and 2 unchecked requirements (WIN-01, UNIX-01) despite both being validated. Manual cleanup followed.

### Patterns Established
- **Platform helper module pattern.** A single `src/platform/index.ts` owns all `process.platform === 'win32'` branches; Unix branches return v1.5 literals byte-identical. New cross-platform work should add helpers here rather than scatter platform conditionals.
- **`setPlatform + vi.resetModules + dynamic import` test pattern.** Lets any host run Windows-mocked tests deterministically; locked in by `tests/platform-helpers.test.ts` and reused across `tests/jdtls/client.test.ts` / `tests/jdtls/java-discovery.test.ts` / `tests/jdtls/uri-mapper.test.ts`.
- **D-18 cross-reference footer for dual-published docs.** When the same content lives in `docs/WINDOWS-SUPPORT.md` and `CLAUDE.md`, both end with a footer pointing readers to REQUIREMENTS.md + the implementing source files. Keeps the two surfaces consistent under future edits.
- **Re-export shim for renamed/relocated symbols.** `src/jdtls/client.ts` was collapsed to a re-export shim for `setJavaHome`/`detectJava`/`discoverJava`/`parseJavaVersion`/`resolveJavaExecutable`. Lets one milestone of importers migrate gracefully before removal.

### Key Lessons
- **Trailing-separator regexes are platform-specific.** `/\/+$/` only strips POSIX separators. Always use `/[\\/]+$/` for path canonicalization that runs on Windows — CR-02 was a real regression that defeated its own Windows fix, caught only by code review.
- **Tests that pass on macOS can hide Windows-specific bugs.** Phase 39-04's real-Windows-host matrix surfaced 2 production bugs (`withLspDocument` race; unbounded `find_references`) that 869 unit tests had all greenlit. A maintainer-matrix step at milestone-close is high-leverage.
- **JDT LS `Location.uri` replies use long-name paths even when the workspace was created at a 8.3 short-name tempDir.** Prefix matching against the original tempDir misses; canonicalize via `realpathSync.native` at mapper construction time.
- **Code review catches what verification misses.** The verifier confirmed Phase 39-06's 8.3 fix was wired correctly; code review then noticed the trailing-separator regex defeated it on Windows-backslash inputs. Both gates are necessary.

### Cost Observations
- 5 phases, 18 plans, 106 commits over 10 days
- Most expensive phase: Phase 37 (Smarter Java Discovery — 5 plans, async refactor + 23-test lockdown + retry-degraded-sessions sweep)
- Cheapest phase: Phase 38 (single plan; new `findJdtLs` Windows paths + `os.homedir()` site)
- Mock-Windows-from-macOS pattern (`setPlatform + vi.resetModules + dynamic import`) let 4/5 phases ship without a Windows host
- Phase 39-04 maintainer matrix on a real Windows 11 host was the highest-leverage 15 minutes of the milestone — caught 2 bugs unit tests missed
- Code review added 7 commits but caught CR-02, a regression that would have defeated the 39-06 Windows fix in production

## Cross-Milestone Trends

| Metric | v1.0 | v1.1 | v1.2 | v1.3 | v1.4 | v1.5 | v1.6 |
|--------|------|------|------|------|------|------|------|
| Phases | 10 | 4 | 4 | 4 | 6 | 7 | 5 |
| Plans | 22 | 8 | 7 | 9 | 15 | 7 | 18 |
| Tasks | 41 | ~66 | 12 | 17 | 31 | 14 | 21 |
| LOC (src) | 5,336 | 6,030 | 6,863 | 7,281 | 8,250 | 8,542 | 10,357 |
| Tests | 327 | 423 | 526 | 592 | 665 | 696 | 872 |
| Timeline | 2 days | 1 day | 1 day | 1 day | 1 day | 1 day | 10 days |
| Requirements | 46/46 | 10/10 | 7/7 | 11/11 | 15/15 | 26/26 | 15/15 |
