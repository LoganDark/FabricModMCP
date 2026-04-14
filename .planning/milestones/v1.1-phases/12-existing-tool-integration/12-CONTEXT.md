# Phase 12: Existing Tool Integration - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

All existing jar-aware tools see study jars through a unified dependency resolution path. Study jars become selectable via `jars` parameter using `study:name` or `study:*` glob patterns. Auto-include study jars appear in default results; non-auto-include ones are reachable only via explicit selection. Study jars never shadow real dependencies (lowest category priority).

</domain>

<decisions>
## Implementation Decisions

### Injection point — shared resolution function
- New shared resolver function(s) replace all direct `dependencyJars` access in tools
- Two-mode API:
  - `getResolvedDependencies(project)` — default set: real deps + `autoInclude=true` study jars
  - `getAllDependencies(project)` — everything including `autoInclude=false` study jars
- Tools call `getResolvedDependencies` for the default path (no `jars` parameter), and `getAllDependencies` when `jars` parameter is provided (so glob matching can find `autoInclude=false` jars)
- Returns a new `Map<string, DependencyEntry>` each call — no caching, no invalidation complexity
- Converts study jars via existing `studyJarToDependencyEntry()` at merge time

### Scope — all tools that touch dependencies
- Every tool that reads `dependencyJars` gets updated to call the resolver, not just the 3 with explicit `jars` parameters
- This includes `read_source`, `find_definition`, `find_references`, etc. — study jars are universally visible
- Single integration point means future tools automatically get study jar support

### Auto-include behavior
- `autoInclude=true` study jars are included in the default dependency set (returned by `getResolvedDependencies`)
- `autoInclude=false` study jars are excluded from defaults — only reachable via explicit `jars` parameter (e.g., `jars=['study:mylib']` or `jars=['study:*']`)
- The `jars` parameter is a strict whitelist — `jars=['study:*']` returns ONLY study jars, not study jars plus defaults. `jars=['study:*', 'minecraft']` returns study jars + minecraft.

### Shadowing behavior
- When a class exists in both a real dependency and a study jar, both entries appear in results
- Results are priority-sorted: real deps first (higher priority), study jars last (`'study': 4`)
- No deduplication, no warnings, no special indicators — the user sees both sources naturally
- Consistent across all tools: search, list, and read all follow priority ordering

### Read source resolution
- `read_source` resolves through the standard priority chain
- If a class exists in minecraft or a library, that version is returned (higher priority)
- If a class only exists in a study jar, the study jar version is returned
- No special-case logic for study jars in read resolution

### Staleness checks on use
- Staleness checks (mtime + size) happen when a tool actually reads from a jar, not during dependency resolution
- The resolver just reads current `studyJars` state without filesystem I/O
- This means resolution is fast (pure map merge), and staleness is caught at the point of jar entry access

### Claude's Discretion
- Exact function signatures and parameter names for the resolver
- Where the resolver lives (new file vs. existing `jar-registry.ts` vs. `tool-helpers.ts`)
- How to structure the tool updates (bulk refactor vs. incremental per-tool)
- Whether to add a shared utility for "resolve then filter by jars param" since that's a common two-step

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Dependency resolution pipeline
- `src/project/jar-registry.ts` — `matchesFilter()`, `getFilteredDependencies()` — current filtering logic that tools use
- `src/tools/tool-helpers.ts` — `filterDependenciesByJarPattern()` (picomatch glob matching), `CATEGORY_PRIORITY`, `sortByPriority()` — jar selection and ordering

### Study jar domain model
- `src/project/types.ts` — `StudyJar`, `DependencyEntry`, `LoadedProject`, `JarCategory` definitions
- `src/project/study-jar.ts` — `studyJarToDependencyEntry()`, `checkAndReopenIfStale()`, validation logic

### Jar-aware tools (must all be updated)
- `src/tools/list-packages.ts` — `jars` parameter, calls `getFilteredDependencies`
- `src/tools/list-classes.ts` — `jars` parameter, calls `getFilteredDependencies`
- `src/tools/search-classes.ts` — `jars` parameter, calls `getFilteredDependencies`
- `src/tools/read-source.ts` — reads from dependency jars via source adapter
- `src/tools/descriptions.ts` — shared `jars` parameter schema definition

### Supporting infrastructure
- `src/browsing/source-adapter.ts` — `SourceAdapter` interface, `createJarAdapter()` — used to read from jars
- `src/browsing/entry-index-cache.ts` — cache keyed by jar path, `getOrBuildIndex()`
- `src/project/shared-jar-reader.ts` — singleton `jarReader` instance
- `src/tools/refresh-dependencies.ts` — already wires staleness checks for study jars during refresh

### Test patterns
- `src/project/jar-reader.test.ts` — ref-counting behavior tests
- `src/browsing/entry-index.test.ts` — index building and query tests

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `studyJarToDependencyEntry()`: Already converts StudyJar → DependencyEntry with `study:name` ID and `category: 'study'`
- `filterDependenciesByJarPattern()`: Already uses picomatch — `study:*` will match study jar IDs out of the box
- `CATEGORY_PRIORITY`: Already has `'study': 4` (or needs it added) for priority sorting
- `matchesFilter()`: Study jars bypass this (they have their own autoInclude logic)

### Established Patterns
- All tools access dependencies through `loadedProject.dependencyJars` → tools switch to resolver function
- `getFilteredDependencies` → `filterDependenciesByJarPattern` two-step in each tool → resolver can unify this
- `sortByPriority()` already used in search and class listing — study jars automatically sort last

### Integration Points
- `getResolvedDependencies(project)` — new function, replaces `loadedProject.dependencyJars` access everywhere
- `getAllDependencies(project)` — new function, used when `jars` param is provided
- `checkAndReopenIfStale()` — already exists, needs to be called on jar access paths (not resolution)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-existing-tool-integration*
*Context gathered: 2026-04-13*
