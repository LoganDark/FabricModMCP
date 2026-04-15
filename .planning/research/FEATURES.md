# Feature Landscape: v1.4 Project Rearchitecture

**Domain:** Composable project containers with namespaced dependencies for MCP dev tooling
**Researched:** 2026-04-15

## Table Stakes

Features the rearchitecture must deliver. Missing = the rearchitecture is incomplete or breaks existing workflows.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Projects as pure named containers | Core milestone goal; decouples "project" from "single Fabric mod root" | Medium | New `Project` type replacing `LoadedProject` | Container holds children (fabric mods + study jars), no `rootPath` on project itself |
| Fabric mod as named child | Projects contain fabric mods loaded from root dirs; each mod brings its own deps | Medium | Project container, loader refactor | `loadFabricMod(rootPath)` returns a `FabricModChild` with its own gradleConfig, dependencyJars, fabricMod, sourcesJar, rootPath |
| Study jars at project level | Study jars belong to the project, not to any fabric mod | Low | Project container | Already nearly this structure; ownership shifts from `LoadedProject` to the container. No functional change for users. |
| Dependency namespacing by fabric mod | `my-mod/minecraft`, `my-mod/net.fabricmc.fabric-api:*` avoids collisions between mods sharing a project | High | Fabric mod children, all tool resolution paths | Hardest single feature -- every dependency lookup must be namespace-aware. Touches `getDependenciesForTool`, `resolveClassSource`, `processNavigationLocations`, `filterDependenciesByJarPattern`, and `getFilteredDependencies`. |
| Fabric mod's own source as `{mod-name}` | The mod's `src/main/java` accessible via its mod name as jar ID | Low | Fabric mod child, source-adapter refactor | Currently hardcoded as `"src"` in `createSourceAdapter` and `jar-registry.ts`. Becomes the mod child's name. |
| Multiple fabric mods per project | A project can hold >1 fabric mod simultaneously | Medium | Project container, JDT LS workspace management | Requires JDT LS to handle multiple source roots in one workspace. JDT LS supports multi-root natively. |
| Tool scoping: project-wide or single child | All 25 tools work across all children or target one child by name | Medium | Revised `jars` parameter semantics, `getDependenciesForTool` refactor | `jars` patterns match against namespaced IDs; `my-mod/*` scopes to that mod's deps |
| Default project "default" created at startup | A project named "default" exists immediately so users can add study jars without first loading a fabric mod | Low | Project container, `server.ts` init | Empty container, no fabric mods, no study jars initially |
| Backward-compatible single-mod experience | Loading one fabric mod into default project should feel identical to v1.3 | Medium | All of the above | If only one fabric mod is loaded, bare jar IDs (no namespace prefix) must resolve correctly |
| `load_project` adds a mod child to a project | `load_project` gains optional `project` param to target which container receives the mod | Low | Project container, `load_project` tool refactor | Defaults to "default" project. Returns the namespaced child info. |

## Differentiators

Features that go beyond the minimum rearchitecture and add real value. Not expected, but worth building.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| Cross-mod navigation via JDT LS | `find_definition` from mod A's source into mod B's dependencies or shared Minecraft sources | Medium | Multiple mods in one JDT LS workspace | JDT LS already handles multi-root workspaces; the value is automatic cross-referencing without manual setup |
| Unambiguous short-form jar IDs | When only one fabric mod is loaded, `minecraft` works without prefix; with multiple mods, bare `minecraft` errors with suggestions showing full namespaced IDs | Medium | Name resolution logic in `getDependenciesForTool` | Reduces friction for the common single-mod case while staying correct for multi-mod |
| Shared dependency deduplication | Two fabric mods targeting the same MC version share one Minecraft jar handle via ref-counting | Low | JarReader ref-counting (already exists) | Saves memory and JDT LS workspace size. `JarReader.registerProject` already does ref-counted handle sharing. |
| Project-scoped study jar visibility across mods | Study jars visible to all fabric mods in the project for cross-cutting reference | Low | Study jars at project level | Already the intent; study jars serve as shared reference material across all mods |
| Fabric mod hot-reload (per-mod dep refresh) | `refresh_dependencies` targets a specific fabric mod child, not the whole project | Low | Namespaced fabric mod children | More surgical than full project reload. Pass `mod` param to scope the refresh. |
| JDT LS in-memory file support | Avoid extracting sources to tmpdir; feed JDT LS via virtual URIs or `didOpen` | High | JDT LS protocol research | Research item. May reduce disk I/O and startup time. Not guaranteed to land in v1.4. |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Persistence / serialization of project state | Adds complexity and stale-state bugs; projects load in seconds. Serialization format becomes a compatibility burden across versions. | Defer to a future milestone; keep projects ephemeral per session. |
| Auto-discovery of fabric mods in multi-mod repos | Gradle multi-project builds vary wildly (subprojects, included builds, composite builds). Auto-scan is fragile and will break on non-standard layouts. | User explicitly loads each fabric mod by root path via `load_project`. |
| Merge all mods' dependencies into a flat namespace | Defeats the purpose of namespacing. Name collisions between mods (both have `minecraft`, both have `net.fabricmc.*`) would silently shadow entries. | Always namespace by mod name. Provide short-form convenience only when exactly one mod is loaded. |
| Project nesting (projects containing projects) | Unnecessary complexity. One level of containment is sufficient for the use case. | Keep flat: project -> children (fabric mods + study jars). |
| Automatic JDT LS restart on child add/remove | Incremental sync (didChangeWatchedFiles, classpath updates) is cheaper and faster than restart. Already proven in v1.1 study jar sync. | Continue incremental workspace sync pattern. |
| Renaming projects or children after creation | Complicates identity tracking across tool result provenance, JDT LS workspace mappings, and jar handle registration. | User unloads and re-loads with the desired name. |
| Cross-project references (mod in project A referencing jar in project B) | Projects are isolated workspaces. Cross-project references require a dependency graph between projects, which is a different problem. | Load both mods into the same project if cross-referencing is needed. |
| Implicit `"src"` alias for backward compat in multi-mod case | Ambiguous when multiple mods loaded. Which mod's source is `"src"`? | Only support `"src"` as an alias when exactly one fabric mod exists. Otherwise require the mod name. |

## Feature Dependencies

```
Project container (pure named, no rootPath)
  +-> Fabric mod child type (rootPath, gradleConfig, deps, etc.)
  |     +-> Dependency namespacing (mod-name/jar-id scheme)
  |     |     +-> getDependenciesForTool rewrite (namespace-aware collection)
  |     |     |     +-> Tool scoping refactor (all 25 tools)
  |     |     |     +-> Short-form resolution (backward compat for single-mod)
  |     |     +-> Source adapter refactor (mod-name replaces "src")
  |     +-> load_project refactor (adds mod child to project)
  |     +-> Multiple mods per project
  |           +-> JDT LS multi-root workspace
  |                 +-> Cross-mod navigation (differentiator)
  +-> Study jars at project level (minor ownership shift)
  +-> Default "default" project at startup

JDT LS in-memory file support (independent research track)
```

No circular dependencies. The critical path is:
container type -> fabric mod child -> namespacing -> tool resolution -> tool scoping refactor.

## Detailed Feature Specifications

### 1. Project Container Model

**Current `LoadedProject`:**
```typescript
interface LoadedProject {
  name: string;
  rootPath: string;              // goes away at project level
  gradleConfig: GradleConfig;    // moves to fabric mod child
  sourcesJar: ResolvedJar;       // moves to fabric mod child
  fabricMod: FabricModJson;      // moves to fabric mod child
  dependencyJars: Map<string, DependencyEntry>;  // moves to fabric mod child
  filterConfig: FilterConfig;    // stays at project level
  studyJars: Map<string, StudyJar>;  // stays at project level
  jdtls?: JdtLsSession;         // stays at project level (shared workspace)
}
```

**New model:**
```typescript
interface Project {
  name: string;
  fabricMods: Map<string, FabricModChild>;  // keyed by mod name
  studyJars: Map<string, StudyJar>;
  filterConfig: FilterConfig;
  jdtls?: JdtLsSession;  // single workspace covering all mods
}

interface FabricModChild {
  name: string;           // derived from fabric.mod.json id or directory basename
  rootPath: string;
  gradleConfig: GradleConfig;
  sourcesJar: ResolvedJar;
  fabricMod: FabricModJson;
  dependencyJars: Map<string, DependencyEntry>;  // local IDs: "minecraft", "net.fabricmc.*"
}
```

### 2. Dependency Namespacing Scheme

**Pattern:** `{mod-name}/{jar-id}` for fabric mod dependencies, plain name for study jars and the mod's own source.

Examples for a project with fabric mod "my-mod":
- `my-mod/minecraft` -- Minecraft sources jar from my-mod's Loom cache
- `my-mod/net.fabricmc.fabric-api:fabric-resource-loader-v0` -- Fabric API module
- `my-mod` -- the mod's own source (replaces `"src"`)
- `sodium` -- a study jar (no prefix, lives at project level)

**Resolution rules:**
1. Exact match against namespaced IDs first
2. If no exact match and exactly one fabric mod exists, try `{sole-mod-name}/{bare-id}`
3. If no exact match and `id === "src"`, resolve to sole mod's source (backward compat)
4. Otherwise, error with available namespaced IDs as suggestions

### 3. Tool Scoping Changes

**`getDependenciesForTool(project, jars?)` rewrite:**
1. Collect all namespaced deps: for each fabric mod, prefix its dep IDs with `{mod-name}/`
2. Add fabric mod sources as `{mod-name}` entries (category: `mod-source`)
3. Add study jars as flat-name entries (category: `study`)
4. Apply project-level `filterConfig`
5. If `jars` provided, filter by glob match against collected namespaced IDs
6. Return the resolved Map<string, DependencyEntry> with namespaced IDs as keys

**`resolveClassSource` changes:**
- When `jar` is provided, resolve it through the namespacing system
- When searching all jars, iterate all namespaced deps in priority order

**`processNavigationLocations` changes:**
- JDT LS file URIs must map back to namespaced jar IDs via updated `UriMapper`

### 4. Default Project at Startup

In `server.ts` initialization:
```typescript
const defaultProject: Project = {
  name: 'default',
  fabricMods: new Map(),
  studyJars: new Map(),
  filterConfig: { mode: 'include-all', patterns: [] },
};
projectStore.set('default', defaultProject);
projectStore.setDefault('default');
```

### 5. Backward Compatibility Contract

| v1.3 API | v1.4 Behavior | Mechanism |
|----------|---------------|-----------|
| `load_project({ path })` | Loads fabric mod into "default" project | `project` param defaults to "default" |
| `jar: "minecraft"` | Resolves to `my-mod/minecraft` when one mod loaded | Short-form resolution |
| `jar: "src"` | Resolves to `my-mod` (mod's own source) when one mod loaded | `"src"` alias for sole mod |
| `jars: ["net.fabricmc.*"]` | Matches `my-mod/net.fabricmc.*` when one mod loaded | Short-form glob expansion |
| `jars` omitted | All resolved deps from all mods + auto-include study jars | Same as current but across all mods |
| Study jar `"sodium"` | Same -- `"sodium"` at project level | No prefix needed |
| `get_project_metadata` | Shows per-mod dep inventory under namespaced sections | New response shape, more info |

## MVP Recommendation

Prioritize in this order based on dependency chain:

1. **Project container type + fabric mod child type** -- structural foundation; everything depends on this
2. **Dependency namespacing + `getDependenciesForTool` rewrite** -- makes multi-mod resolution correct
3. **Source adapter + `"src"` -> mod-name migration** -- enables reading mod source by name
4. **Tool scoping refactor across all tools** -- updates parameter handling to use namespaced IDs
5. **Default project at startup + `load_project` refactor** -- API-facing changes after internals are solid
6. **Backward-compatible short-form resolution** -- polish for single-mod ergonomics
7. **JDT LS multi-root workspace management** -- enables cross-mod navigation
8. **JDT LS in-memory file support (research)** -- independent spike, may not complete

Defer:
- **Persistence:** Premature; projects are ephemeral and load fast.
- **Auto-discovery:** Too fragile for Gradle multi-project variance.
- **Renaming:** Unload + reload is sufficient; identity tracking is complex.

## Sources

- Existing codebase analysis: `src/project/types.ts` (current `LoadedProject` shape), `src/state/project-store.ts` (project resolution logic), `src/project/loader.ts` (Fabric mod loading), `src/project/dependency-resolver.ts` (dependency merging), `src/tools/tool-helpers.ts` (tool resolution utilities, `getDependenciesForTool`), `src/browsing/source-adapter.ts` (jar vs filesystem reading), `src/project/study-jar.ts` (study jar lifecycle), `src/project/jar-registry.ts` (filter matching)
- Milestone context from `.planning/PROJECT.md` v1.4 active requirements
- Existing architectural patterns: JarReader ref-counting for shared handles, picomatch glob filtering, incremental JDT LS workspace sync, cascading regex position resolution
