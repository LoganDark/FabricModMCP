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

## Cross-Milestone Trends

| Metric | v1.0 | v1.1 | v1.2 | v1.3 |
|--------|------|------|------|------|
| Phases | 10 | 4 | 4 | 4 |
| Plans | 22 | 8 | 7 | 9 |
| Tasks | 41 | ~66 | 12 | 17 |
| LOC | 5,336 | 6,030 | 6,863 | 7,281 |
| Tests | 327 | 423 | 526 | 592 |
| Timeline | 2 days | 1 day | 1 day | 1 day |
| Requirements | 46/46 | 10/10 | 7/7 | 11/11 |
