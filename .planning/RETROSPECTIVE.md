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

## Cross-Milestone Trends

| Metric | v1.0 |
|--------|------|
| Phases | 10 |
| Plans | 22 |
| Tasks | 41 |
| LOC | 5,336 |
| Tests | 327 |
| Timeline | 2 days |
| Requirements | 46/46 |
