# Phase 32: Per-Child Jar Filtering - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix `getDependenciesForTool` so that when called without scope on a multi-mod project, each fabric mod's filter is applied to its own dependency set before merging. Currently a single (arbitrary) mod's filter is applied to the merged set.

</domain>

<decisions>
## Implementation Decisions

### Core behavior change
- The unscoped path in `getDependenciesForTool` (lines 397-408 of tool-helpers.ts) currently:
  1. Calls `getResolvedDependencies(project)` which merges ALL mods' deps into one Map
  2. Picks the first fabric mod found and uses its `filterConfig`
  3. Applies that one filter to the entire merged set
- New behavior:
  1. Iterate each fabric mod child independently
  2. For each: compute `autoIncludeIds`, apply that mod's `filterConfig` to only that mod's `dependencyJars`
  3. Merge the per-mod filtered results into a single Map
  4. Add autoInclude study jars (project-level, not filtered per-mod)

### Never merge dependencies across mods
- Dependencies from different mods MUST NOT overwrite each other even if they share the same base dep name
- This is already guaranteed by namespace prefixing (`modA/minecraft` vs `modB/minecraft`) — Map keys are unique
- No deduplication logic needed — namespaced IDs prevent collisions

### Scoped path unchanged
- When `scope` is provided, the existing behavior is correct: use that child's deps + that child's filter
- No changes to the scoped code path

### `getResolvedDependencies` still useful
- Keep it for `getAllDependencies`-style uses (e.g., navigation tools that need the full merged set)
- `getDependenciesForTool` just stops using it for the unscoped+no-jars path

### Claude's Discretion
- Whether to extract the per-mod filtering into a helper or inline it
- Test structure

</decisions>

<specifics>
## Specific Ideas

- The fix is localized to the `else` branch of `getDependenciesForTool` (the unscoped, no-jars path at lines 397-408)
- The `autoIncludeIds` computation (lines 366-378) already handles both scoped and unscoped — keep it but compute per-mod inside the loop
- Study jars with `autoInclude: true` are project-level and should be added AFTER per-mod filtering (they're always included regardless of filter)

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core fix location
- `src/tools/tool-helpers.ts` — `getDependenciesForTool()` lines 355-408, especially the unscoped else branch at 397-408
- `src/project/jar-registry.ts` — `getFilteredDependencies()` and `matchesFilter()` that apply filters
- `src/project/namespace-resolver.ts` — `getAutoIncludeIds()` returns per-child auto-include set

### Dependency resolution
- `src/project/dependency-resolver.ts` — `getResolvedDependencies()` and `getAllDependencies()`
- `src/project/study-jar.ts` — `studyJarToDependencyEntry()` converts study jar to dep entry

### Test reference
- `tests/tools/tool-helpers.test.ts` — existing getDependenciesForTool tests
- `tests/helpers/factories.ts` — `makeFakeMultiModProject()` for multi-mod test scenarios

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getFilteredDependencies(deps, filter, autoIncludeIds)` — already takes a dep Map and filter, ready for per-mod use
- `getAutoIncludeIds(child)` — already per-child
- `studyJarToDependencyEntry(child)` — converts study jar to dep entry for the merged result
- `makeFakeMultiModProject()` — test factory for multi-mod scenarios

### Established Patterns
- Per-child iteration: `for (const child of project.children.values()) { if (child.kind === 'fabric-mod') ... }`
- Filter application: `getFilteredDependencies(deps, filterConfig, autoIncludeIds)` takes Map + FilterConfig + Set

### Integration Points
- `getDependenciesForTool` is called by every browsing tool: list_packages, list_classes, search_classes, read_source, locate_in_source, and indirectly by navigation tools via resolveSymbolPosition
- The return type stays `Map<string, DependencyEntry>` — callers don't need to change

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 32-per-child-jar-filtering*
*Context gathered: 2026-04-16*
