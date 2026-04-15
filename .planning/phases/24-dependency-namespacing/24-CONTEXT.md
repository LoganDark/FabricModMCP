# Phase 24: Dependency Namespacing - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Each child resolves its own dependencies independently, with mod-name prefixes preventing ID collisions across children. Mod source accessible by mod name. Tools accept optional scope parameter. Bare jar IDs work when unambiguous (one child or default child set).

</domain>

<decisions>
## Implementation Decisions

### Namespaced ID format
- Separator is `/` — e.g., `my-mod/minecraft`, `my-mod/net.fabricmc:fabric-api`
- Study jars stay bare (project-level, no namespace prefix) — e.g., `"my-lib"`
- A fabric mod's own source uses just the mod name as its jar ID — e.g., `"my-mod"` (not `my-mod/my-mod`)
- Namespaced IDs are the primary display format in all tool results

### Backward compatibility
- `"src"` magic string is removed entirely — no backward compat alias, no existing clients to break
- Bare IDs (e.g., `"minecraft"`) resolve only when unambiguous: exactly one child, or a default child is set
- Bare IDs error when ambiguous (multiple children, no default child set)
- Glob patterns in `jars` must be explicit — `"minecraft"` does NOT auto-expand to `"*/minecraft"`, user must write `"*/minecraft"` explicitly

### Default child
- `Project` gets an optional `defaultChild?: string` field
- Default child is set explicitly by the user, never auto-inferred
- When default child is set, bare IDs resolve within that child's namespace
- When only one child exists, bare IDs resolve to that child regardless of defaultChild setting

### Scope parameter
- All tools get an optional `scope` parameter to target a single child
- `scope` sets context: bare IDs in `jars` resolve within the scoped child's namespace
- Namespaced IDs in `jars` always override scope (explicit wins)
- Scope is always optional — omit for project-wide operation

### Dual-purpose tools
- Tools like `get-project-metadata` and `unload-project` become dual-purpose based on scope
- With scope: operate on / return info for that specific child
- Without scope: operate on / return info for the whole project
- May need renaming to reflect dual capability (e.g., names that work for both project and child)

### Filter registry
- Always-include rule applies per-child automatically: each child's own source + its minecraft dep are always included
- Each child has its own filterConfig — filters apply only to that child's own dependencies
- No filter merging across children
- Each child (including study jars) has an auto-include flag controlling whether it appears in default results
- Explicit `jars` parameter bypasses filters entirely (existing behavior preserved)

### Claude's Discretion
- Internal implementation of namespace resolution logic
- Error message wording for ambiguous bare ID resolution
- How to implement the default child setter (tool parameter, separate tool, etc.)
- Order of migration steps

</decisions>

<specifics>
## Specific Ideas

- The `/` separator was chosen because `:` is already used in Maven coordinates (`net.fabricmc:fabric-api`)
- Mod source being just `"my-mod"` (bare) rather than `"my-mod/my-mod"` keeps it clean — the mod IS the namespace
- Study jars staying bare is natural since they're project-level and already have user-chosen unique names

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Dependency resolution (being namespaced)
- `src/project/dependency-resolver.ts` — Current getResolvedDependencies/getAllDependencies API, merges deps + study jars
- `src/project/dependency-discovery.ts` — Where `"src"` magic string is created (line 132), dependency ID generation
- `src/project/study-jar.ts` — studyJarToDependencyEntry() conversion, study jar ID handling

### Type system (from Phase 23)
- `src/project/types.ts` — Project, FabricModChild, StudyJarChild, ProjectChild, DependencyEntry types
- `src/project/compat.ts` — getDependencyJars, getStudyJars compat accessors (being replaced/evolved)

### Tool parameter handling
- `src/tools/tool-helpers.ts` — getDependenciesForTool, filterDependenciesByJarPattern (picomatch glob), resolveClassSource, CATEGORY_PRIORITY
- `src/project/jar-registry.ts` — Always-include logic for "minecraft" and "src" (needs updating)

### Tools needing scope parameter
- `src/tools/get-project-metadata.ts` — Becoming dual-purpose (project or child metadata)
- `src/tools/unload-project.ts` — Becoming dual-purpose (unload project or child)
- All jar-aware tools in `src/tools/` — Need scope parameter added

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `filterDependenciesByJarPattern()` in tool-helpers.ts: picomatch-based glob matching, can be extended for namespaced patterns
- `DependencyEntry` type: `id` field will carry the namespaced ID, `category` field already distinguishes dep types
- `CATEGORY_PRIORITY` ordering: still valid for search priority within a child

### Established Patterns
- Tools use `getDependenciesForTool(project, jars?)` as the single entry point for jar resolution
- `resolveClassSource()` searches jars in priority order — needs namespace awareness
- Compat accessors in `compat.ts` bridge old patterns — some may evolve or be replaced

### Integration Points
- `dependency-discovery.ts` generates the `"src"` entry — must change to use mod name
- `jar-registry.ts` hardcodes `"minecraft"` and `"src"` checks — must use per-child auto-include logic
- Every tool's Zod schema needs `scope` parameter added
- `ProjectStore` or `Project` needs `defaultChild` field

</code_context>

<deferred>
## Deferred Ideas

- `refresh_dependencies` targeting a specific child (DEP-04) — Phase 25
- Multiple fabric mods per project (CONT-04) — Phase 25
- All existing tools working with namespaced IDs end-to-end (TOOL-01/02/03) — Phase 25
- Cross-mod JDT LS navigation (LSP-01/02) — Phase 26

</deferred>

---

*Phase: 24-dependency-namespacing*
*Context gathered: 2026-04-15*
