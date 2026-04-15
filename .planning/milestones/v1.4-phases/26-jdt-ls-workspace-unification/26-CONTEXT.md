# Phase 26: JDT LS Workspace Unification - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Semantic navigation works across all children in a project through a single JDT LS workspace. One workspace per project covering all fabric mods and study jars. Cross-mod navigation (find_definition from one mod into another's deps). Namespace-aware extraction directory naming to avoid collisions.

</domain>

<decisions>
## Implementation Decisions

### Extraction strategy
- Per-child isolated extraction directories — each child's dependencies get namespaced directories (e.g., `mymod--minecraft`, `othermod--minecraft`)
- Even if two children depend on the same artifact at the same version, they get separate extracted directories
- This avoids version collision issues entirely and keeps child isolation clean
- Trade-off accepted: some disk duplication for simplicity and correctness

### JDT LS initialization timing
- Start JDT LS eagerly on project creation (inside `create_project`)
- Navigation tools do NOT need a lazy "not ready yet" path — JDT LS is always available if the project exists
- If Java 21 or JDT LS binary is unavailable, graceful degradation (existing pattern: `jdtls.available = false`)

### Incremental sync on child add/remove
- Always incremental — add new child's sources to existing workspace without full re-extract or restart
- Follow the study jar sync pattern already established in `workspace-sync.ts`: extract to tempDir, regenerate `.classpath`, notify JDT LS via `workspace/didChangeWatchedFiles`
- Removing a child: delete its extracted directories, regenerate `.classpath`, notify JDT LS
- No full workspace rebuild needed — JDT LS handles incremental classpath changes

### Claude's Discretion
- Whether `jarIdToDirName` map needs restructuring to track per-child ownership or if namespace prefixes in directory names are sufficient
- Exact directory naming scheme (e.g., `mymod--minecraft` vs `mymod__minecraft`) — follow existing `jarIdToDirName()` conventions
- Whether to extract on `create_project` (empty workspace) and then incrementally add on `add_fabric_mod`, or batch the first child's extraction into the startup sequence
- Error handling for JDT LS process crashes mid-session

</decisions>

<specifics>
## Specific Ideas

No specific requirements — standard approaches are fine. The key constraint is that cross-mod navigation must work (find_definition from mod A's source into mod B's dependencies).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### JDT LS lifecycle
- `src/jdtls/client.ts` — `detectJava()`, `findJdtLs()`, `startJdtLs()`, `shutdownJdtLs()`, `waitForReady()` — process management
- `src/jdtls/types.ts` — `JdtLsSession` type with `tempDir`, `jarIdToDirName`, `client`, `process` fields

### Workspace extraction
- `src/jdtls/workspace.ts` — `extractSourcesToTemp()`, `generateClasspathFile()`, `generateProjectFile()`, `cleanupTempDir()` — full extraction pipeline
- `src/jdtls/workspace-sync.ts` — `syncStudyJarToWorkspace()`, `unsyncStudyJarFromWorkspace()`, `extractStudyJarToWorkspace()` — incremental sync pattern to follow

### URI mapping
- `src/jdtls/uri-mapper.ts` — `jarIdToDirName()`, `dirNameToJarId()`, `createUriMapper()` — bidirectional jar ID to file URI mapping, needs namespace awareness

### Tools that trigger workspace changes
- `src/tools/create-project.ts` — Where JDT LS startup should be wired
- `src/tools/add-fabric-mod.ts` — Lines 71-74 have explicit Phase 26 TODO for workspace sync
- `src/tools/remove-project.ts` — Already calls `shutdownJdtLs()` and `cleanupTempDir()`
- `src/tools/add-study-jar.ts` — Reference for incremental sync integration pattern

### Navigation tools (consumers of JDT LS)
- `src/tools/find-definition.ts`, `src/tools/find-references.ts`, `src/tools/find-implementations.ts` — Use `createUriMapper()` and `resolveSymbolPosition()`
- `src/tools/list-members.ts`, `src/tools/search-symbols.ts`, `src/tools/hover-info.ts`, `src/tools/type-hierarchy.ts` — Also use JDT LS client

### Project types
- `src/project/types.ts` — `Project` type has `jdtls?: JdtLsSession` field
- `src/state/project-store.ts` — Where project creation happens

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `workspace-sync.ts`: Incremental extract/remove/classpath-regenerate/notify pattern — extend this for fabric mod children
- `extractSourcesToTemp()`: Full extraction logic can be refactored into per-child extraction calls
- `generateClasspathFile()`: Already generates from a list of source dirs — just needs all namespaced dirs
- `createUriMapper()`: Bidirectional mapping — needs namespace-prefix awareness for new directory names
- `detectJava()` / `findJdtLs()`: Ready to use as-is for eager startup

### Established Patterns
- Study jar sync: extract → update jarIdToDirName → regenerate .classpath → notify JDT LS — this is the template for fabric mod sync
- Graceful degradation: `jdtls.available = false` when Java/JDT LS unavailable — tools check this before attempting LSP calls
- URI mapper: `jarIdToDirName()` function converts jar ID to safe directory name (replaces `/` → `--`, `:` → `__`)

### Integration Points
- `create_project` needs JDT LS startup wired in (create tempDir, start process, store session on project)
- `add_fabric_mod` needs workspace sync (extract child's deps, update classpath, notify)
- `remove_project_member` needs workspace unsync (delete child's dirs, update classpath, notify)
- `refresh_project_members` may need re-extraction if dependencies changed
- All navigation tools already read from `project.jdtls` — no changes needed if session structure stays the same

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 26-jdt-ls-workspace-unification*
*Context gathered: 2026-04-15*
