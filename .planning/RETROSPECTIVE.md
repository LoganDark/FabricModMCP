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
- `study:` namespace prefix for study jar IDs — collision avoidance with real dependencies
- Two-mode resolver: getResolvedDependencies for default views, getAllDependencies for explicit selection
- Probe-based readiness detection for JDT LS (workspace/symbol query '*')
- Warning-on-failure-only pattern for optional workspace sync operations
- Pre-validate all names before mutation in batch operations (fail-fast)

### Key Lessons
- Small milestones (4 phases) ship fast but planning-to-code ratio is higher — consider bundling with related features
- The dependency resolver abstraction was the highest-leverage change — touched every tool file but made study jars "just work"
- JDT LS hot-reload behavior (classpath changes) needs empirical validation — flagged as human verification item

## Cross-Milestone Trends

| Metric | v1.0 | v1.1 |
|--------|------|------|
| Phases | 10 | 4 |
| Plans | 22 | 8 |
| Tasks | 41 | ~66 |
| LOC | 5,336 | 6,030 |
| Tests | 327 | 423 |
| Timeline | 2 days | 1 day |
| Requirements | 46/46 | 10/10 |
