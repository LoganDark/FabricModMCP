# Phase 23: Type Foundation and ProjectStore - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Restructure the project model from a monolithic `LoadedProject` into a `Project` container with typed children (`FabricModChild`, `StudyJarChild`). Introduce a compatibility layer so all existing tools and 592+ tests continue passing unchanged. Create a "default" project at server startup. Remove `--project` CLI flags (defer CLI redesign to later).

</domain>

<decisions>
## Implementation Decisions

### Type hierarchy
- Discriminated union: `ProjectChild = FabricModChild | StudyJarChild` with a `kind` discriminant field
- Shared fields on union base: `name` + `kind` only — everything else is kind-specific
- `Project` holds `children: Map<string, ProjectChild>` (single map, not separate maps per kind)
- Plain interfaces + standalone functions (not classes) — matches existing codebase style

### FabricModChild shape
- `kind: 'fabric-mod'`
- Owns: `rootPath`, `gradleConfig`, `sourcesJar`, `fabricMod`, `dependencyJars`, `filterConfig`
- `dependencyJars` is a field directly on the child (not externally computed)
- `filterConfig` is per-child (not per-project) — different mods can have different filter rules
- Name is user-provided, defaulting to `fabric.mod.json` `id` field

### StudyJarChild shape
- `kind: 'study-jar'`
- Existing `StudyJar` fields preserved: `path`, `mtime`, `size`, `autoInclude`, `stats`
- Just adds `kind` discriminant to current shape

### Project shape
- Pure named container: `name`, `children` map, `jdtls` session (optional)
- No `rootPath` — projects don't have a root directory of their own
- No `filterConfig` — filters are per-child
- JDT LS session stays on Project (one workspace per project, covers all children — aligns with Phase 26)

### Compatibility layer
- `LoadedProject` becomes a type alias for `Project` (compile-time compat, no runtime cost)
- Compat accessor functions in `src/project/compat.ts`: `getDependencyJars(project)`, `getSourcesJar(project)`, `getGradleConfig(project)`, etc.
- Accessors resolve from the sole fabric mod child — throw `DomainError` if zero or >1 fabric mods exist
- Dedicated `compat.ts` module — easy to find, easy to delete in Phase 27
- Existing tools call compat accessors instead of direct field access (migration happens incrementally)

### Default project
- "default" project created at server startup (always, unconditionally) — satisfies CONT-05
- "default" is NOT auto-set as the default project in ProjectStore — existing `resolveProject()` single-project fallback logic handles it naturally
- "default" cannot be deleted during compat phase (invariant exists only for compat — future multi-project management will make it deletable)

### CLI changes
- Remove `--project` CLI flags entirely for now
- `load_project` MCP tool becomes the sole way to add fabric mods to projects
- CLI redesign deferred to a later phase

### Claude's Discretion
- Internal helper function signatures and naming
- Test factory implementation details
- Order of refactoring steps (which modules to update first)
- Error message wording for compat accessor failures

</decisions>

<specifics>
## Specific Ideas

- Compat accessors should have clear error messages like "No fabric mod loaded in project 'X'" — explicit about what's missing
- The compat layer is temporary scaffolding — optimize for easy deletion in Phase 27, not for elegance

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core types being restructured
- `src/project/types.ts` — Current LoadedProject, GradleConfig, DependencyEntry, FilterConfig, StudyJar type definitions
- `src/state/project-store.ts` — Current ProjectStore class with project map and resolution logic

### Project loading and dependencies
- `src/project/loader.ts` — Current loadProject() that creates LoadedProject instances
- `src/project/dependency-discovery.ts` — Dependency resolution strategies (must move to per-child)
- `src/project/dependency-resolver.ts` — Merges deps + study jars (getResolvedDependencies, getAllDependencies)
- `src/project/study-jar.ts` — Study jar creation, validation, collision detection

### Server entry point
- `src/index.ts` — CLI arg parsing and project loading at startup (--project flags being removed)
- `src/cli/args.ts` — CLI argument definitions (--project flag to remove)

### Integration surfaces
- `src/project/jar-reader.ts` — Per-project jar handle tracking
- `src/project/jar-registry.ts` — Filter application using FilterConfig
- `src/jdtls/types.ts` — JdtLsSession interface (stays on Project)

### Test factories
- `tests/state/project-store.test.ts` — makeMockProject() helper (needs updating)
- `tests/project/study-jar.test.ts` — makeProject() helper (needs updating)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProjectStore` class: Already has the right shape (Map + resolution logic) — needs updating to use new `Project` type but structure is sound
- `StudyJar` interface: Almost unchanged — just add `kind` discriminant
- `DomainError` class: Used for error reporting, compat accessors should use it

### Established Patterns
- All domain types are plain interfaces with standalone functions (no classes except ProjectStore)
- Error handling uses `DomainError` with `code`, `message`, `tried`, `suggestions` fields
- Tools use `resolveProjectSafely()` which wraps `projectStore.resolveProject()`

### Integration Points
- Every tool that accesses `project.dependencyJars`, `project.sourcesJar`, `project.gradleConfig`, `project.fabricMod`, or `project.filterConfig` needs compat accessor migration
- `loadProject()` in loader.ts currently returns `LoadedProject` — needs to return `FabricModChild` (or `Project` with the child already added)
- `createStudyJar()` currently takes a `LoadedProject` — needs to take a `Project`

</code_context>

<deferred>
## Deferred Ideas

- CLI redesign for --project flags — defer to future phase
- Multi-mod loading in a single command — Phase 25
- Making "default" project deletable — future multi-project management phase
- Study jar transitive dependency discovery (DISC-01/02) — future milestone

</deferred>

---

*Phase: 23-type-foundation-and-projectstore*
*Context gathered: 2026-04-15*
