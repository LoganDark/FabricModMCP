# Architecture Patterns

**Domain:** MCP server project rearchitecture -- composable named containers (v1.4)
**Researched:** 2026-04-15
**Focus:** Restructuring from monolithic LoadedProject into composable Project containers with FabricMod and StudyJar children

## Current Architecture Summary

The current architecture is a monolithic `LoadedProject` that conflates "project" with "single Fabric mod + its study jars." Every `LoadedProject` has exactly one `rootPath`, one `gradleConfig`, one `fabricMod`, one `dependencyJars` map, one `studyJars` map, one `filterConfig`, and one optional `jdtls` session. The `ProjectStore` is a flat `Map<string, LoadedProject>`.

**Key coupling points in the current code:**

| Module | What it touches on LoadedProject | How |
|--------|----------------------------------|-----|
| `tool-helpers.resolveProjectSafely` | `projectStore.resolveProject(name)` | Returns `LoadedProject` directly |
| `tool-helpers.getDependenciesForTool` | `project.dependencyJars`, `project.studyJars`, `project.filterConfig` | Merges deps + study jars, applies filter |
| `tool-helpers.resolveClassSource` | `project.rootPath`, deps via `getAllDependencies` | Creates SourceAdapter per dep |
| `tool-helpers.processNavigationLocations` | `project.jdtls` (via caller), deps via `getAllDependencies` | Reads extracted files, maps URIs to jars |
| `dependency-resolver` | `project.dependencyJars`, `project.studyJars` | Merges into unified dep map |
| `jar-registry` | `FilterConfig` | Applies include/exclude patterns |
| `JarReader` | `projectHandles` keyed by project name | Ref-counted handles per project |
| `loader.loadProject` | Reads gradle.properties, build.gradle.kts, fabric.mod.json, discovers deps | Returns complete LoadedProject |
| `load-project tool` | Calls loader, registers jars, starts JDT LS | Orchestrates everything |
| `workspace.extractSourcesToTemp` | `dependencies` map, `rootPath`, `jarReader` | Extracts all deps to one tmpdir |
| `workspace-sync` | `studyJar`, `jdtls.tempDir`, `jdtls.jarIdToDirName` | Incrementally adds/removes from workspace |
| `uri-mapper` | `jdtls.tempDir`, `jdtls.jarIdToDirName` | Maps file URIs back to jar IDs |
| `source-adapter` | `dep.id === 'src'` special case uses `rootPath` | Filesystem vs jar adapter |

## Recommended Architecture

### New Type Hierarchy

```
Project (named container)
  |-- name: string
  |-- children: Map<string, ProjectChild>
  |-- filterConfig: FilterConfig         (project-level, applies across all children)
  |-- jdtls?: JdtLsSession              (single workspace for entire project)

ProjectChild = FabricModChild | StudyJarChild

FabricModChild
  |-- kind: 'fabric-mod'
  |-- name: string                       (user-chosen or derived from dir basename)
  |-- rootPath: string
  |-- gradleConfig: GradleConfig
  |-- sourcesJar: ResolvedJar
  |-- fabricMod: FabricModJson
  |-- dependencyJars: Map<string, DependencyEntry>

StudyJarChild
  |-- kind: 'study-jar'
  |-- name: string
  |-- studyJar: StudyJar                 (existing StudyJar type, unchanged)
```

### Dependency Resolution Changes

**Current:** `getDependenciesForTool(project, jars?)` returns a flat merged map of `project.dependencyJars` + study jars.

**New:** Dependencies are namespaced by child name. A fabric mod named `my-mod` produces deps like `my-mod/minecraft`, `my-mod/src`, `my-mod/fabric-api:fabric-networking-api-v1`. Study jars at project level use plain names (no namespace prefix).

```
getAllProjectDependencies(project: Project) -> Map<string, DependencyEntry>
  For each FabricModChild:
    prefix each dep ID with "{childName}/"
  For each StudyJarChild:
    keep plain name (same as today's study jar DependencyEntry)
```

**Scoping:** When `scope` is provided, only return deps from that child. When omitted, return all children's deps merged (with namespacing to avoid collisions).

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `Project` (new type) | Named container holding children, filter config, JDT LS session | ProjectStore, tools |
| `ProjectChild` (new union type) | Discriminated union of FabricModChild and StudyJarChild | Project, dependency resolution |
| `ProjectStore` (modified) | Stores `Map<string, Project>` instead of `Map<string, LoadedProject>` | Tools via resolveProjectSafely |
| `FabricModLoader` (renamed from loader) | Loads a Fabric mod dir into `FabricModChild` (no JDT LS, no study jars) | Called by new add_fabric_mod tool |
| `dependency-resolver` (modified) | Namespace-aware merging across children | Tools, jar-registry |
| `JarReader` (unchanged key semantics) | Ref-counted handles keyed by project name | SourceAdapter, workspace extraction |
| `JDT LS workspace` (modified) | Single workspace per project, containing all children's sources | load/unload lifecycle, add/remove child |
| `UriMapper` (modified) | Maps namespaced jar IDs through directory names | Navigation tools |
| `tool-helpers` (modified) | Resolves project + optional scope to dependency map | All tools |

### Data Flow

**Loading a project (new):**
```
create_project(name) ->
  ProjectStore.set(name, { name, children: new Map(), filterConfig: default, jdtls: undefined })
```

**Adding a fabric mod:**
```
add_fabric_mod(project, path, name?) ->
  1. FabricModLoader.load(path) -> FabricModChild
  2. project.children.set(childName, child)
  3. Register all child's jar paths with JarReader under project name
  4. If project.jdtls exists: extract child's deps to workspace, update .classpath, notify JDT LS
  5. If project.jdtls does not exist: attempt JDT LS init for the whole project
```

**Adding a study jar:**
```
add_study_jar(project, path, name?) ->
  1. createStudyJar(path, name, project) -> StudyJarChild
  2. project.children.set(childName, child)
  3. Register jar path with JarReader
  4. Sync to JDT LS workspace (same as today)
```

**Tool dependency resolution (new flow):**
```
getDependenciesForTool(project, scope?, jars?) ->
  1. If scope: get only that child's deps (namespaced for fabric-mod, plain for study-jar)
  2. If no scope: merge all children's deps (namespaced)
  3. Apply filter config
  4. If jars param: apply glob pattern filtering
  Return: Map<string, DependencyEntry>
```

**Jar ID resolution example:**
```
Project "dev"
  FabricModChild "my-mod"
    dependencyJars: minecraft, src, fabric-api:fabric-networking-api-v1
  FabricModChild "my-lib"
    dependencyJars: minecraft, src
  StudyJarChild "sodium"

Flat dependency map (no scope):
  my-mod/minecraft -> ...
  my-mod/src -> ...
  my-mod/fabric-api:fabric-networking-api-v1 -> ...
  my-lib/minecraft -> ...
  my-lib/src -> ...
  sodium -> ...

With scope="my-mod":
  my-mod/minecraft -> ...
  my-mod/src -> ...
  my-mod/fabric-api:fabric-networking-api-v1 -> ...
```

## Components: Modify vs Replace vs New

### NEW components

| Component | Purpose |
|-----------|---------|
| `project/types.ts` additions | `Project`, `ProjectChild`, `FabricModChild`, `StudyJarChild` type definitions |
| `tools/create-project.ts` | Create a named empty project container |
| `tools/add-fabric-mod.ts` | Load a Fabric mod directory as a child of a project |
| `tools/remove-child.ts` | Remove a child (fabric mod or study jar) from a project |
| `tools/list-children.ts` | List children of a project with their types and metadata |

### MODIFIED components (adapt, not rewrite)

| Component | What Changes | Scope of Change |
|-----------|-------------|-----------------|
| `project/types.ts` | Add new types alongside existing. `LoadedProject` becomes internal/deprecated alias or removed. | Medium -- add types, update exports |
| `state/project-store.ts` | Store `Project` instead of `LoadedProject`. `resolveProject` returns `Project`. | Small -- type change, same logic |
| `project/loader.ts` | Rename to `fabric-mod-loader.ts`. Returns `FabricModChild` instead of `LoadedProject`. Strip JDT LS and study jar concerns. | Medium -- remove orchestration, keep parsing |
| `project/dependency-resolver.ts` | Add namespace-aware functions: `getProjectDependencies(project)`, `getScopedDependencies(project, scope)`. Keep old functions internally for per-child resolution. | Medium -- new functions wrapping existing |
| `project/jar-reader.ts` | No structural change. Project name key still works since we keep one JarReader registration per project. | Minimal -- possibly no changes |
| `project/jar-registry.ts` | No change. Filtering operates on any `Map<string, DependencyEntry>`. | None |
| `project/study-jar.ts` | `validateStudyJarId` checks against all children's names, not just `dependencyJars`. `createStudyJar` takes `Project` instead of `LoadedProject`. | Small |
| `tools/tool-helpers.ts` | `resolveProjectSafely` returns `Project`. `getDependenciesForTool` gains `scope` parameter. `resolveClassSource` takes `Project` + scope. `processNavigationLocations` uses project-level jdtls. | Medium-large -- most helpers gain scope param |
| `tools/load-project.ts` | Becomes `create-project` + `add-fabric-mod` composition, or replaced entirely. May keep as convenience wrapper. | Large -- split or replace |
| `tools/unload-project.ts` | Iterates `project.children` to clean up all jar handles, then shuts down single JDT LS session. | Small |
| `tools/add-study-jar.ts` | Adds to `project.children` instead of `project.studyJars`. Collision check against all children. | Small |
| `tools/remove-study-jar.ts` | Removes from `project.children`. | Small |
| `tools/list-study-jars.ts` | Filters `project.children` by kind. | Small |
| `tools/get-project-metadata.ts` | Iterates children, shows namespaced deps. | Medium |
| `tools/refresh-dependencies.ts` | Operates on fabric mod children only. | Small |
| `tools/configure-filters.ts` | Operates on `project.filterConfig` (project-level, unchanged concept). | None |
| `tools/configure-study-jar.ts` | Finds study jar in `project.children` by kind filter. | Small |
| `jdtls/workspace.ts` | `extractSourcesToTemp` takes all children's deps (namespaced dir names). | Medium -- iterate children |
| `jdtls/workspace-sync.ts` | Incremental add/remove for any child type (not just study jars). Generalize to `syncChildToWorkspace`. | Medium |
| `jdtls/uri-mapper.ts` | `jarIdToDirName` must handle namespaced IDs (`my-mod/minecraft` -> `my-mod__minecraft`). The `/` -> `__` mapping works alongside existing `:` -> `__`. | Small -- update separator logic |
| `browsing/source-adapter.ts` | `createSourceAdapter` for `dep.id` ending in `/src` needs the correct child's `rootPath`. Pass rootPath explicitly rather than assuming one project rootPath. | Small |
| All browsing/navigation tools | Pass `scope` through to `getDependenciesForTool`. Add `scope` to input schemas. | Small per tool, many tools (~15 tools) |

### UNCHANGED components

| Component | Why Unchanged |
|-----------|--------------|
| `browsing/cascading-regex.ts` | Operates on source text, no project awareness |
| `browsing/entry-index.ts` | Operates on entry lists, no project awareness |
| `browsing/entry-index-cache.ts` | Keyed by jar path, no project awareness |
| `browsing/class-parser.ts` | Parses source text |
| `browsing/member-extractor.ts` | Parses source text |
| `browsing/member-enrichment.ts` | Enriches member data |
| `browsing/member-fqn.ts` | FQN generation |
| `browsing/symbol-transform.ts` | Symbol transformation |
| `browsing/search.ts` | Search over entry index |
| `browsing/import-resolver.ts` | Import resolution |
| `browsing/line-slicer.ts` | Line range extraction |
| `browsing/detail-parser.ts` | Detail flag parsing |
| `jdtls/client.ts` | JDT LS process lifecycle (stateless helper functions) |
| `jdtls/context-extractor.ts` | Parses source text |
| `jdtls/symbol-kind.ts` | Enum mapping |
| `errors/domain-error.ts` | Error type |
| `types/envelope.ts` | Response envelope |
| `logging/logger.ts` | Logging |
| `tools/pagination.ts` | Pagination helpers |
| `tools/echo.ts` | Diagnostic tool |

## Patterns to Follow

### Pattern 1: Discriminated Union for Children
**What:** Use `kind` field discriminant on ProjectChild types.
**When:** Any code that handles children generically.
**Example:**
```typescript
type ProjectChild = FabricModChild | StudyJarChild;

interface FabricModChild {
	kind: 'fabric-mod';
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, DependencyEntry>;
}

interface StudyJarChild {
	kind: 'study-jar';
	name: string;
	studyJar: StudyJar;
}

function getChildDeps(child: ProjectChild): Map<string, DependencyEntry> {
	switch (child.kind) {
		case 'fabric-mod': return child.dependencyJars;
		case 'study-jar': return new Map([[child.name, studyJarToDependencyEntry(child.studyJar)]]);
	}
}
```

### Pattern 2: Namespace Prefixing for Dependency IDs
**What:** Prefix dependency IDs with `{childName}/` for fabric mods. Study jars keep plain names.
**When:** Building the flat dependency map for a project.
**Why:** Avoids collisions when two fabric mods both have `minecraft` or `src` dependencies. Study jars do not need namespacing because their names are globally unique within a project (collision checked at add time).
**Example:**
```typescript
function getProjectDependencies(project: Project): Map<string, DependencyEntry> {
	const merged = new Map<string, DependencyEntry>();
	for (const [childName, child] of project.children) {
		if (child.kind === 'fabric-mod') {
			for (const [depId, dep] of child.dependencyJars) {
				merged.set(`${childName}/${depId}`, { ...dep, id: `${childName}/${depId}` });
			}
		} else {
			const entry = studyJarToDependencyEntry(child.studyJar);
			merged.set(entry.id, entry);
		}
	}
	return merged;
}
```

### Pattern 3: Scope Parameter Threading
**What:** Add optional `scope` parameter to tool input schemas that threads down to dependency resolution.
**When:** Any tool that currently accepts `project` and `jars` parameters.
**Why:** Allows targeting a specific child without manually constructing jar glob patterns.
**Example:**
```typescript
// Tool schema addition (alongside existing project and jars params):
scope: z.string().optional().describe('Limit to a specific child (fabric mod or study jar name)')

// In tool handler:
const deps = getDependenciesForTool(project, scope, jars);
```

### Pattern 4: Single JDT LS Workspace Per Project
**What:** One JDT LS process per project, workspace contains all children's sources.
**When:** Project creation/first child with sources triggers JDT LS init. Adding/removing children incrementally syncs.
**Why:** JDT LS cross-references work best when all sources are in one workspace. Multiple JDT LS processes would waste memory and miss cross-child references.

### Pattern 5: Default Project on Startup
**What:** Create an empty default project automatically when the MCP server starts.
**When:** Server initialization, before any tool calls.
**Why:** Eliminates the "no projects loaded" error for the common single-project case. User can immediately `add_fabric_mod` without first calling `create_project`.
**Example:**
```typescript
// In server.ts or index.ts initialization:
const defaultProject: Project = {
	name: 'default',
	children: new Map(),
	filterConfig: { mode: 'include-all', patterns: [] },
};
projectStore.set('default', defaultProject);
projectStore.setDefault('default');
```

### Pattern 6: SourceAdapter rootPath Resolution
**What:** When creating a SourceAdapter for a namespaced dep like `my-mod/src`, look up the fabric mod child to get its `rootPath`.
**When:** Any code path that creates a filesystem source adapter.
**Why:** The `src` dep ID is special-cased in `createSourceAdapter` to use filesystem reading. With multiple fabric mods, each has a different rootPath.
**Example:**
```typescript
function resolveRootPath(project: Project, namespacedDepId: string): string | undefined {
	const slashIndex = namespacedDepId.indexOf('/');
	if (slashIndex === -1) return undefined; // study jar, no rootPath needed
	const childName = namespacedDepId.slice(0, slashIndex);
	const child = project.children.get(childName);
	if (child?.kind === 'fabric-mod') return child.rootPath;
	return undefined;
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Keeping LoadedProject as Intermediate
**What:** Converting LoadedProject to the new types at tool boundaries instead of replacing it.
**Why bad:** Two representations of the same data. Conversion bugs. Stale data if one is updated but not the other.
**Instead:** Replace LoadedProject with the new types throughout. The loader returns FabricModChild; the store holds Project. A temporary deprecated alias is fine during migration, but must be removed.

### Anti-Pattern 2: Deep Nesting for Scope Resolution
**What:** Making tools navigate `project.children.get(scope).dependencyJars` directly.
**Why bad:** Couples every tool to the container structure. If the structure changes, every tool changes.
**Instead:** Funnel all scope resolution through `getDependenciesForTool(project, scope?, jars?)`. Tools never see children directly.

### Anti-Pattern 3: Multiple JDT LS Sessions Per Project
**What:** One JDT LS per fabric mod child.
**Why bad:** Cross-mod references broken. Memory multiplied. Startup time multiplied. Workspace sync complexity explosion.
**Instead:** Single JDT LS per project. All children's sources in one workspace.

### Anti-Pattern 4: Eager Namespace Stripping
**What:** Stripping the `childName/` prefix from dep IDs before returning to tools/users.
**Why bad:** Loses provenance information. Cannot tell which child a dependency came from.
**Instead:** Keep namespaced IDs everywhere. Tools display them as-is. The namespace IS the identity.

### Anti-Pattern 5: Separate ProjectStore Per Child Type
**What:** Having `fabricModStore` and `studyJarStore` alongside `projectStore`.
**Why bad:** Splits project state across multiple stores. Invariants (like "child names are unique within a project") are unenforceable.
**Instead:** Single ProjectStore holding Project containers. Children live inside Project.

## Build Order (Suggested Phase Sequence)

The rearchitecture has clear dependency layers. Build bottom-up:

### Phase 1: Type Foundation + ProjectStore
- Define new types (`Project`, `ProjectChild`, `FabricModChild`, `StudyJarChild`)
- `ProjectStore` stores `Project` instead of `LoadedProject`
- `loader.ts` refactored to return `FabricModChild` (renamed or new function)
- `create_project` tool creates empty container
- Default project created on startup
- Existing `load_project` preserved as compatibility wrapper (creates project + adds fabric mod in one call)
- All existing tools continue to work via compatibility layer

**Why first:** Everything depends on the type foundation. The compatibility wrapper means existing tests keep passing while migration proceeds.

### Phase 2: Dependency Namespacing + Scope
- `dependency-resolver` gains namespace-aware functions
- `getDependenciesForTool` gains `scope` parameter
- `uri-mapper` handles namespaced dir names (`/` -> `__`)
- `source-adapter` takes explicit rootPath resolution
- `resolveClassSource` updated for namespaced deps
- Add `scope` parameter to all jar-aware tool schemas

**Why second:** Namespacing is the core semantic change. Once deps are namespaced, multiple fabric mods can coexist without collisions.

### Phase 3: Child Management Tools
- `add_fabric_mod` tool (loads a Fabric mod as a child)
- Study jar tools operate on `project.children` instead of `project.studyJars`
- `remove_child` tool (generic removal of any child type)
- `list_children` tool (shows all children with types and metadata)
- `get_project_metadata` shows children structure
- `refresh_dependencies` operates per-fabric-mod child

**Why third:** Depends on types (Phase 1) and namespacing (Phase 2) being in place. This is where the user-facing API changes.

### Phase 4: JDT LS Workspace Unification
- Single workspace per project containing all children's sources
- `extractSourcesToTemp` iterates all children with namespaced dir names
- Incremental sync generalized for any child type (not just study jars)
- JDT LS init deferred until first child with sources is added
- `processNavigationLocations` uses project-level jdtls and namespaced URI mapping

**Why fourth:** JDT LS is the most complex integration. It benefits from stable types and namespacing. The workspace extraction must produce namespaced directory names that match the URI mapper.

### Phase 5: Cleanup + Migration Completion
- Remove `LoadedProject` type alias
- Remove or finalize `load_project` wrapper (decide: keep as convenience or remove)
- Remove `project.studyJars` field (study jars now live in `project.children`)
- Update all test fixtures
- Verify all 592+ tests pass with new types

**Why last:** Cleanup depends on everything else being stable. Tests validate the full migration.

**Phase ordering rationale:**
- Types must exist before anything can use them (Phase 1 first)
- Namespacing must work before tools can correctly address multi-child deps (Phase 2 before Phase 3)
- Child management tools need both types and namespacing (Phase 3 after Phase 2)
- JDT LS workspace changes are the riskiest and most isolated -- defer until the data model is stable (Phase 4)
- Cleanup is always last

**Key risk in ordering:** Phase 2 (namespacing) changes the shape of dependency IDs that all tools consume. If existing tools do exact-match on dep IDs like `minecraft`, those will break when IDs become `my-mod/minecraft`. The compatibility layer in Phase 1 must handle the single-child case (no namespace prefix when project has exactly one fabric mod child) OR Phase 2 must update all tool tests simultaneously.

## Integration Points Summary

| Feature | Files Modified | Files Created | Key Integration Point |
|---------|---------------|---------------|----------------------|
| Type foundation | `project/types.ts`, `state/project-store.ts` | None | New types alongside existing |
| Loader refactor | `project/loader.ts` | Possibly `project/fabric-mod-loader.ts` | Returns `FabricModChild` instead of `LoadedProject` |
| Dependency namespacing | `project/dependency-resolver.ts`, `tools/tool-helpers.ts` | None | `getDependenciesForTool` gains scope param |
| URI mapping | `jdtls/uri-mapper.ts` | None | `/` in jar IDs -> `__` in dir names |
| Source adapter | `browsing/source-adapter.ts` | None | rootPath resolved from child, not project |
| Child management | `tools/add-study-jar.ts`, `tools/remove-study-jar.ts`, `tools/list-study-jars.ts` | `tools/add-fabric-mod.ts`, `tools/create-project.ts`, `tools/remove-child.ts`, `tools/list-children.ts` | Children stored in `project.children` map |
| JDT LS workspace | `jdtls/workspace.ts`, `jdtls/workspace-sync.ts` | None | Single workspace per project, namespaced extraction dirs |
| Scope threading | ~15 tool files | None | Add `scope` param to input schemas |

## Scalability Considerations

| Concern | 1 fabric mod | 3 fabric mods | 10+ fabric mods |
|---------|-------------|---------------|-----------------|
| JDT LS memory | ~1GB (current) | ~2-3GB (more source files) | May need -Xmx tuning |
| Jar handle count | ~20-30 | ~60-90 (shared jars ref-counted) | Verify OS file handle limits |
| Workspace extraction time | ~5-10s | ~15-30s | Consider lazy extraction per child |
| Dependency map size | ~30 entries | ~90 entries (namespaced) | Glob matching stays fast (picomatch) |
| Entry index cache | ~30 entries | ~90 entries (keyed by jar path, shared across children) | Memory bounded by unique jar count |
| URI mapper reverse lookup | ~30 dir-to-jar mappings | ~90 mappings | Map lookup is O(1), no concern |

## Sources

- Direct codebase analysis of MinecraftDevMCP v1.3 (592 tests, 25 tools, 7,281 LOC)
- All source files in `src/project/`, `src/state/`, `src/tools/`, `src/jdtls/`, `src/browsing/` read and cross-referenced
- Architecture patterns derived from existing code conventions (domain/tool separation, discriminated unions in types.ts, dependency resolution pipeline)
- Confidence: HIGH -- all findings from direct source reading, no external references needed
