# Phase 25: Child Management Tools - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents can build multi-mod projects by adding fabric mods to existing projects, with all tools producing namespaced results. `load_project` adds children to projects (defaulting to the default project). `refresh_dependencies` can target specific children. Multiple fabric mods per project works end-to-end.

</domain>

<decisions>
## Implementation Decisions

### load_project behavior
- Defaults to the default project (whatever project is set as default, which is the auto-created "default" project at startup)
- When the target project exists, adds the fabric mod as a new child
- When the target project doesn't exist, creates it and adds the mod as its first child
- Child name comes from `fabric.mod.json` id
- Explicit name collision (user provided a name): error, tell user the name is taken
- Implicit name collision (name from fabric.mod.json): auto-suffix (e.g., `mymod-2`) and inform user of the actual name in the tool result
- `defaultChild` is never auto-set — bare IDs already resolve when there's a single child
- Tool result should always include the child name so the user knows what it was named

### refresh_dependencies scoping
- With `scope`: refresh only that child's dependencies and re-register only that child's jars
- Without `scope` and one mod: refresh that mod
- Without `scope` and multiple mods: refresh ALL mods (acts as full project refresh)
- Study jar name collision check runs only against the refreshed child's deps, not all children
- Tool result returns full dependency list (no change-tracking needed)

### JDT LS workspace when adding mods
- Adding a fabric mod: extract ALL of that mod's source jars first, then do a full workspace rebuild (not incremental per-jar)
- Each mod's jars extracted under its own namespace in the workspace directory (no deduplication across mods)
- Fabric mod workspace sync gets its own dedicated function — not a loop of individual jar syncs like study jars use
- When a fabric mod is unloaded (scoped `unload_project`), its extracted sources are cleaned up from the workspace immediately

### Future tools (out of scope for this phase)
- Separate `create_project` tool for creating empty project containers — future phase
- Separate `add_fabric_mod` tool distinct from `load_project` — future phase
- These are noted but NOT built in Phase 25

### Claude's Discretion
- Auto-suffix numbering scheme details (starting at 2, incrementing)
- Internal workspace directory structure for namespaced extraction
- Order of operations for multi-mod refresh
- Error messages and edge case handling

</decisions>

<specifics>
## Specific Ideas

- Multi-project support still exists — explicit `project` parameter creates/targets named projects, omitting it uses the default
- The workspace namespace separation ensures two mods with overlapping deps (e.g., both have fabric-api) don't interfere in the JDT LS workspace
- Fabric mod workspace sync is fundamentally different from study jar sync — entire dependency trees, not individual jars

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project loading
- `src/tools/load-project.ts` — Current load_project tool, creates new projects, needs to evolve to add children to existing projects
- `src/project/loader.ts` — `loadFabricMod()` function that parses gradle config, discovers deps, returns FabricModChild
- `src/state/project-store.ts` — ProjectStore with set/has/resolveProject methods

### Dependency refresh
- `src/tools/refresh-dependencies.ts` — Current refresh tool, calls getSoleFabricMod() which fails with multiple mods
- `src/project/dependency-discovery.ts` — `discoverDependencies()` with modName parameter (namespaced from Phase 24)
- `src/project/compat.ts` — `getSoleFabricMod()` used by refresh, needs replacement with scope-aware logic

### Namespace resolution (from Phase 24)
- `src/project/namespace-resolver.ts` — resolveJarId, resolveJarIds, inferSoleChildName, getAutoIncludeIds
- `src/tools/tool-helpers.ts` — getDependenciesForTool with scope-aware resolution
- `src/tools/descriptions.ts` — PARAMS.scope shared schema

### JDT LS workspace
- `src/jdtls/workspace.ts` or equivalent — Workspace extraction and classpath management
- `src/jdtls/study-jar-sync.ts` or equivalent — Incremental study jar sync (pattern reference, NOT to be reused for fabric mods)
- `src/project/types.ts` — JdtLsSession on Project, FabricModChild type

### Type system
- `src/project/types.ts` — Project (with defaultChild, children Map), FabricModChild, StudyJarChild, DependencyEntry

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadFabricMod()` in loader.ts: Returns a FabricModChild ready to add to any project's children map
- `discoverDependencies()`: Already accepts modName parameter, generates namespaced IDs
- `resolveJarId/resolveJarIds`: Namespace resolution already handles scope, defaultChild, sole-child inference
- `getDependenciesForTool()`: Already scope-aware with autoIncludeIds

### Established Patterns
- Study jar incremental sync: Extract individual jars, update classpath, notify JDT LS — reference pattern but fabric mods need their own bulk approach
- `projectStore.resolveProject()`: Resolves by name, or default, or sole project — already supports the "default to default project" behavior
- Scope parameter: Already on all 17 jar-aware tools from Phase 24

### Integration Points
- `load-project.ts`: Must check if project exists (add child) vs doesn't exist (create project + add child)
- `refresh-dependencies.ts`: Must replace `getSoleFabricMod()` with scope-aware child resolution or iterate all children
- `jarReader.registerProject()`: Currently registers all jars for a project — may need per-child registration
- JDT LS workspace extraction: Currently done once at project creation — needs to support incremental mod addition

</code_context>

<deferred>
## Deferred Ideas

- `create_project` tool for empty project containers — future phase
- `add_fabric_mod` as a distinct tool from `load_project` — future phase
- Cross-mod JDT LS navigation (LSP-01/02) — Phase 26
- `set_default_child` tool — future phase (defaultChild is never auto-set, user must explicitly configure)

</deferred>

---

*Phase: 25-child-management-tools*
*Context gathered: 2026-04-15*
