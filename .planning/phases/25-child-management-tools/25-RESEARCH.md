# Phase 25: Child Management Tools - Research

**Researched:** 2026-04-15
**Domain:** Internal tool evolution -- multi-mod project support, scoped refresh, workspace sync
**Confidence:** HIGH

## Summary

Phase 25 completes the multi-mod project model by making `load_project` add children to existing projects, making `refresh_dependencies` scope-aware, and ensuring all jar-aware tools work end-to-end with namespaced jar IDs. Phase 24 built the infrastructure (namespace resolution, scope parameter, namespaced IDs); Phase 25 wires it together for actual multi-child workflows.

The changes are concentrated in three areas: (1) `load-project.ts` must evolve from "create project + add child" to "add child to existing-or-new project", (2) `refresh-dependencies.ts` must replace `getSoleFabricMod()` with scope-aware child resolution supporting per-child and all-children refresh, and (3) the JDT LS workspace must support incremental mod addition -- extracting a new mod's entire dependency tree and rebuilding the workspace without re-extracting existing mods.

**Primary recommendation:** Implement in three waves: (1) evolve `load_project` to support adding children to existing projects with name collision handling, (2) make `refresh_dependencies` scope-aware with per-child and all-mod refresh modes, (3) build fabric mod workspace sync for incremental JDT LS updates when mods are added/removed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `load_project` defaults to the default project (the auto-created "default" project at startup)
- When the target project exists, adds the fabric mod as a new child
- When the target project doesn't exist, creates it and adds the mod as its first child
- Child name comes from `fabric.mod.json` id
- Explicit name collision (user provided a name): error, tell user the name is taken
- Implicit name collision (name from fabric.mod.json): auto-suffix (e.g., `mymod-2`) and inform user of the actual name in the tool result
- `defaultChild` is never auto-set -- bare IDs already resolve when there's a single child
- Tool result should always include the child name so the user knows what it was named
- `refresh_dependencies` with `scope`: refresh only that child's dependencies and re-register only that child's jars
- `refresh_dependencies` without `scope` and one mod: refresh that mod
- `refresh_dependencies` without `scope` and multiple mods: refresh ALL mods (acts as full project refresh)
- Study jar name collision check runs only against the refreshed child's deps, not all children
- Tool result returns full dependency list (no change-tracking needed)
- Adding a fabric mod: extract ALL of that mod's source jars first, then do a full workspace rebuild (not incremental per-jar)
- Each mod's jars extracted under its own namespace in the workspace directory (no deduplication across mods)
- Fabric mod workspace sync gets its own dedicated function -- not a loop of individual jar syncs like study jars use
- When a fabric mod is unloaded (scoped `unload_project`), its extracted sources are cleaned up from the workspace immediately

### Claude's Discretion
- Auto-suffix numbering scheme details (starting at 2, incrementing)
- Internal workspace directory structure for namespaced extraction
- Order of operations for multi-mod refresh
- Error messages and edge case handling

### Deferred Ideas (OUT OF SCOPE)
- `create_project` tool for empty project containers -- future phase
- `add_fabric_mod` as a distinct tool from `load_project` -- future phase
- Cross-mod JDT LS navigation (LSP-01/02) -- Phase 26
- `set_default_child` tool -- future phase (defaultChild is never auto-set, user must explicitly configure)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONT-04 | A project can hold multiple fabric mods simultaneously | `load_project` must add children to existing projects; `Project.children` Map already supports multiple entries; all downstream code (dependency-resolver, tool-helpers) already iterates all children |
| DEP-04 | `refresh_dependencies` can target a specific fabric mod child | Replace `getSoleFabricMod()` in refresh tool with scope-aware resolution; `discoverDependencies()` already accepts modName for namespaced IDs; jar registration must be per-child |
| TOOL-01 | All existing jar-aware tools work with namespaced jar IDs | Already implemented by Phase 24 -- `resolveJarId`/`resolveJarIds` in namespace-resolver.ts, `getDependenciesForTool` in tool-helpers.ts, `scope` on all 17 tools. Phase 25 validates end-to-end with multiple mods. |
| TOOL-02 | `load_project` adds a fabric mod child to a project (defaults to "default" project) | `load_project` currently creates a new Project per call; must evolve to check if target project exists and add child to it |
| TOOL-03 | Tool results include namespaced jar IDs so the agent knows which child a result came from | Already implemented by Phase 24 -- dependency IDs are namespaced (e.g., `my-mod/minecraft`), tool results use these IDs. Phase 25 validates multi-mod scenarios produce correct namespaced results. |
</phase_requirements>

## Architecture Patterns

### Current Architecture (load_project)

```
load_project(path, name?)
  -> loadFabricMod(path)            # Returns FabricModChild
  -> projectName = name ?? generate  # Name is for the PROJECT
  -> project = { name, children: Map([[mod.name, mod]]) }
  -> projectStore.set(projectName, project)
  -> jarReader.registerProject(projectName, jarPaths)
  -> extractSourcesToTemp(deps)      # Full extraction for JDT LS
  -> startJdtLs(...)                 # One JDT LS per project
```

### Target Architecture (load_project)

```
load_project(path, project?)
  -> loadFabricMod(path)            # Returns FabricModChild
  -> targetProject = project ?? "default"
  -> IF projectStore.has(targetProject):
       existingProject = projectStore.get(targetProject)
       childName = resolveChildName(mod.name, existingProject)
       mod.name = childName          # May be auto-suffixed
       existingProject.children.set(childName, mod)
       jarReader.addProjectJars(...)  # Add new jars incrementally
       syncFabricModToWorkspace(...)  # Extract + rebuild .classpath
     ELSE:
       project = { name: targetProject, children: Map([[mod.name, mod]]) }
       projectStore.set(targetProject, project)
       jarReader.registerProject(...)
       extractSourcesToTemp(...)      # Full extraction
       startJdtLs(...)
  -> return { child: childName, project: targetProject, ... }
```

### Target Architecture (refresh_dependencies)

```
refresh_dependencies(project?, scope?)
  -> resolve project
  -> IF scope:
       mod = project.children.get(scope)  # Must be fabric-mod
       refreshSingleMod(mod)
     ELSE:
       mods = getAllFabricMods(project)
       IF mods.length === 1: refreshSingleMod(mods[0])
       ELSE: refreshAllMods(mods)
  -> jarReader re-registration (per-child or full)
  -> study jar conflict check (scoped to refreshed child)
  -> return full dependency list
```

### Key Design: load_project Parameter Change

The current `name` parameter names the **project**. In Phase 25, `load_project` becomes primarily about adding children to projects. The parameter must be renamed to `project` to match the convention used by all other tools. The child name comes from `fabric.mod.json` id, not from a user parameter.

**Parameter evolution:**
- Old: `path` (required), `name` (optional, names the project)
- New: `path` (required), `project` (optional, targets existing project, defaults to "default")

### Key Design: Child Name Resolution

```typescript
function resolveChildName(
  modId: string,           // from fabric.mod.json
  project: Project,
): string {
  if (!project.children.has(modId)) return modId;
  // Auto-suffix: modId-2, modId-3, ...
  for (let i = 2; ; i++) {
    const candidate = `${modId}-${i}`;
    if (!project.children.has(candidate)) return candidate;
  }
}
```

Note: This is ONLY for implicit collisions (same fabric.mod.json id). Explicit name collision is NOT possible in the new design because the user no longer provides a child name -- it always comes from fabric.mod.json.

Wait -- re-reading CONTEXT.md: "Explicit name collision (user provided a name): error". But in the new design there's no user-provided child name. This decision may be vestigial from an earlier design. The only name the user provides is the `project` name, and project name collision is already handled by `projectStore.set()`. The planner should note this: the "explicit name collision" case cannot occur because child names are always derived from fabric.mod.json id.

### Key Design: Jar Registration for Multi-Child

`jarReader.registerProject()` currently **replaces** the jar set. When adding a second mod, we must **add** jars incrementally:

```typescript
// For adding a child to existing project:
for (const entry of mod.dependencyJars.values()) {
  if (entry.sourcesJarPath) {
    jarReader.addProjectJar(projectName, entry.sourcesJarPath);
  }
}
if (mod.sourcesJar.exists) {
  jarReader.addProjectJar(projectName, mod.sourcesJar.path);
}
```

### Key Design: Scoped Unload Workspace Cleanup

The unload tool already handles scoped child removal (`unload_project` with `scope`). But it currently does NOT clean up extracted workspace sources for the removed child. Phase 25 must add workspace cleanup to scoped unload:

```typescript
// In scoped unload, after removing child:
if (child.kind === 'fabric-mod' && project.jdtls?.available) {
  await unsyncFabricModFromWorkspace(child.name, child.dependencyJars, project.jdtls);
}
```

### Key Design: Fabric Mod Workspace Sync

Study jar sync (`workspace-sync.ts`) operates on individual jars -- one extraction per study jar. Fabric mod sync must operate on an entire dependency tree at once:

```typescript
async function syncFabricModToWorkspace(
  mod: FabricModChild,
  jdtls: JdtLsSession,
  jarReader: JarReader,
): Promise<{ synced: boolean; warning?: string }> {
  // Extract ALL of this mod's available dependencies at once
  for (const [depId, dep] of mod.dependencyJars) {
    if (!dep.available) continue;
    const dirName = jarIdToDirName(depId);  // Namespaced: "my-mod/minecraft" -> "my-mod__minecraft"
    // Extract .java files from jar to tempDir/dirName/...
    extractJarEntries(dep, jdtls.tempDir, dirName, jarReader);
    jdtls.jarIdToDirName.set(depId, dirName);
  }
  // Rebuild .classpath with ALL directories
  rebuildClasspath(jdtls);
  // Notify JDT LS
  notifyWorkspaceChange(jdtls);
}
```

The key difference from study jar sync: the jar IDs are already namespaced (e.g., `my-mod/minecraft`), so `jarIdToDirName()` must handle the `/` separator. Currently `jarIdToDirName` only replaces `:` with `__`. It must also handle `/` -- either replace with `__` or a different separator.

**Filesystem safety:** `jarIdToDirName("my-mod/minecraft")` would produce `"my-mod/minecraft"` which creates nested directories. Must replace `/` too, e.g., `"my-mod__minecraft"` (using `__` for both `:` and `/`). But this could collide: `a/b:c` and `a:b/c` both become `a__b__c`. This is unlikely in practice (mod names don't contain `:`, dependency IDs don't contain `/` except the namespace prefix), but worth noting.

**Recommendation:** Replace `/` with `--` and `:` with `__` to keep them distinguishable: `my-mod--minecraft`, `my-mod--net.fabricmc__fabric-api`.

### Anti-Patterns to Avoid

- **Re-extracting all mods when one is added:** Each mod's workspace sync is independent. Only extract the new mod's jars.
- **Deduplicating workspace directories across mods:** Per CONTEXT.md decision, each mod has its own namespace. Two mods with overlapping deps (e.g., both have fabric-api) get separate extractions.
- **Using `getSoleFabricMod()` anywhere in Phase 25 code:** This function errors on multiple mods. All new code must iterate/select explicitly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Child name collision resolution | Custom dedup logic per call site | Single `resolveChildName()` function | Collision resolution has edge cases (suffix numbering); one function, one set of tests |
| Workspace classpath rebuild | Inline classpath generation in each sync function | `generateClasspathFile()` from workspace.ts (already exists) | Already handles src entry format; just pass the updated dir list |
| Jar ID to dir name mapping | Separate mapping per module | Extended `jarIdToDirName()` from uri-mapper.ts | Single source of truth for filesystem-safe directory names |

## Common Pitfalls

### Pitfall 1: registerProject Overwrites Existing Jars
**What goes wrong:** Calling `jarReader.registerProject()` when adding a second mod replaces the first mod's jar registrations.
**Why it happens:** `registerProject` does `this.projectHandles.set(projectName, new Set(jarPaths))` -- it creates a new Set, not merging.
**How to avoid:** When adding a child to an existing project, use `jarReader.addProjectJar()` in a loop instead of `registerProject()`.
**Warning signs:** First mod's jars become unreadable after loading second mod.

### Pitfall 2: jarIdToDirName Doesn't Handle Namespace Separator
**What goes wrong:** `jarIdToDirName("my-mod/minecraft")` creates nested directory `my-mod/minecraft` instead of flat `my-mod--minecraft`.
**Why it happens:** Current implementation only replaces `:` with `__`. The `/` namespace separator from Phase 24 is new.
**How to avoid:** Extend `jarIdToDirName()` to also replace `/` (with a different separator to avoid ambiguity, e.g., `--`).
**Warning signs:** Directory structure has unexpected nesting; `fromFileUri` in UriMapper fails to map back.

### Pitfall 3: Stale JDT LS After Adding Mod
**What goes wrong:** JDT LS doesn't know about new mod's sources until workspace is notified.
**Why it happens:** Extracting files to tempDir is necessary but not sufficient -- .classpath must be rebuilt and JDT LS notified via `workspace/didChangeWatchedFiles`.
**How to avoid:** Follow the study jar sync pattern: extract -> update jarIdToDirName -> rebuild .classpath -> notify.
**Warning signs:** `find-definition` and `search-symbols` don't find classes from newly-added mod.

### Pitfall 4: Scoped Refresh Re-Registers All Jars
**What goes wrong:** `refresh_dependencies` currently calls `jarReader.closeProject()` then `jarReader.registerProject()`, which wipes and replaces ALL jar registrations for the project.
**Why it happens:** The current implementation assumes one mod = one project's worth of jars.
**How to avoid:** For scoped refresh, only close and re-register the targeted child's jars. Keep other children's jars intact.
**Warning signs:** After scoped refresh, other children's jars become unreadable.

### Pitfall 5: Workspace Namespace for Mod Source Jar
**What goes wrong:** A mod's own source (category `mod-source`) uses just the mod name as jar ID (e.g., `my-mod`). When extracted to workspace, this creates a directory named just `my-mod`, which could collide with a study jar named `my-mod`.
**Why it happens:** Study jars are bare names at project level; mod source is also a bare name.
**How to avoid:** Study jars and fabric mod deps live in separate namespace tiers. The mod-source entry has `category: 'mod-source'` and uses `createModSourceAdapter` (reads from rootPath, not a jar), so it's extracted differently. Ensure workspace extraction handles mod-source entries by reading from the mod's `rootPath/src/main/java/` rather than from a jar.
**Warning signs:** Mod source appears as missing in workspace; duplicate directory names.

### Pitfall 6: Entry Index Cache Not Cleared on Scoped Refresh
**What goes wrong:** After refreshing one child's dependencies, stale entry index caches serve old data.
**Why it happens:** `evictEntryIndex()` must be called for each dependency that changed, scoped to the refreshed child.
**How to avoid:** When doing scoped refresh, evict entry index caches only for that child's dependency jar paths.
**Warning signs:** `list_packages` or `list_classes` shows stale class listings after dependency refresh.

## Code Examples

### Adding a Child to an Existing Project (load_project evolution)

```typescript
// Determine target project
const targetProjectName = project ?? projectStore.getDefault() ?? 'default';

const fabricMod = await loadFabricMod(path);

if (projectStore.has(targetProjectName)) {
	const existingProject = projectStore.get(targetProjectName)!;

	// Resolve child name (auto-suffix on collision)
	let childName = fabricMod.name;
	if (existingProject.children.has(childName)) {
		childName = generateUniqueChildName(childName, existingProject);
		fabricMod.name = childName;
		// Also rename dependency IDs to match new child name
		fabricMod.dependencyJars = renameNamespace(fabricMod.dependencyJars, fabricMod.fabricMod.id, childName);
	}

	existingProject.children.set(childName, fabricMod);

	// Register jars incrementally
	for (const entry of fabricMod.dependencyJars.values()) {
		if (entry.sourcesJarPath) {
			jarReader.addProjectJar(targetProjectName, entry.sourcesJarPath);
		}
	}
	if (fabricMod.sourcesJar.exists) {
		jarReader.addProjectJar(targetProjectName, fabricMod.sourcesJar.path);
	}

	// Sync to JDT LS workspace
	if (existingProject.jdtls?.available) {
		await syncFabricModToWorkspace(fabricMod, existingProject.jdtls, jarReader);
	}
} else {
	// Create new project (existing behavior, mostly unchanged)
	const newProject: Project = {
		name: targetProjectName,
		children: new Map([[fabricMod.name, fabricMod]]),
	};
	projectStore.set(targetProjectName, newProject);
	jarReader.registerProject(targetProjectName, collectJarPaths(fabricMod));
	// ... JDT LS initialization ...
}
```

### Namespace Renaming on Auto-Suffix

When a child gets auto-suffixed (e.g., `mymod` -> `mymod-2`), all its dependency IDs must be updated because they were generated with the original name:

```typescript
function renameChildNamespace(
	deps: Map<string, DependencyEntry>,
	originalName: string,
	newName: string,
): Map<string, DependencyEntry> {
	const renamed = new Map<string, DependencyEntry>();
	for (const [id, dep] of deps) {
		if (id === originalName) {
			// Mod source entry: rename to new name
			renamed.set(newName, { ...dep, id: newName });
		} else if (id.startsWith(originalName + '/')) {
			// Namespaced dep: replace prefix
			const newId = newName + id.slice(originalName.length);
			renamed.set(newId, { ...dep, id: newId });
		} else {
			renamed.set(id, dep);
		}
	}
	return renamed;
}
```

### Scoped Refresh (refresh_dependencies)

```typescript
// Replace getSoleFabricMod() with scope-aware resolution
function resolveFabricModsForRefresh(
	project: Project,
	scope?: string,
): FabricModChild[] {
	if (scope) {
		const child = project.children.get(scope);
		if (!child || child.kind !== 'fabric-mod') {
			throw new DomainError(
				'CHILD_NOT_FOUND',
				`Fabric mod child '${scope}' not found in project '${project.name}'`,
				[scope],
				['Check available children with get_project_metadata'],
			);
		}
		return [child];
	}

	const mods: FabricModChild[] = [];
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') mods.push(child);
	}

	if (mods.length === 0) {
		throw new DomainError(
			'NO_FABRIC_MOD',
			`No fabric mod loaded in project '${project.name}'`,
			[project.name],
			['Load a fabric mod using load_project'],
		);
	}

	return mods;
}
```

### Fabric Mod Workspace Sync

```typescript
async function syncFabricModToWorkspace(
	mod: FabricModChild,
	jdtls: JdtLsSession,
	jarReader: JarReader,
): Promise<{ synced: boolean; warning?: string }> {
	if (!jdtls.available || !jdtls.endpoint) {
		return { synced: false, warning: 'JDT LS unavailable' };
	}

	try {
		for (const [depId, dep] of mod.dependencyJars) {
			if (!dep.available) continue;
			const dirName = jarIdToDirName(depId);
			const depDir = join(jdtls.tempDir, dirName);
			const adapter = createSourceAdapter(jarReader, dep, mod.rootPath);
			const entries = await adapter.listJavaEntries();

			for (const entryPath of entries) {
				const targetPath = join(depDir, entryPath);
				await mkdir(dirname(targetPath), { recursive: true });
				const content = await adapter.readEntry(entryPath);
				await writeFile(targetPath, content);
			}
			jdtls.jarIdToDirName.set(depId, dirName);
		}

		// Rebuild .classpath with ALL directories
		const allDirs = Array.from(jdtls.jarIdToDirName.values());
		const classpathXml = generateClasspathFile(allDirs);
		const resolvedTempDir = realpathSync(jdtls.tempDir);
		await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);

		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
		});

		return { synced: true };
	} catch (err) {
		return {
			synced: false,
			warning: 'Fabric mod workspace sync failed: ' + (err instanceof Error ? err.message : String(err)),
		};
	}
}
```

## Critical Implementation Details

### load_project Input Schema Change

The `name` parameter must become `project` to match the semantics (targeting a project, not naming it). The child name is always derived from `fabric.mod.json` id. This is a breaking change if any agent scripts depend on the `name` parameter.

Current schema:
```typescript
inputSchema: {
  path: z.string(),
  name: z.string().optional(),
}
```

New schema:
```typescript
inputSchema: {
  path: z.string(),
  project: PARAMS.project,  // Re-use shared schema
}
```

### Dependency Namespace Renaming

`loadFabricMod()` generates dependency IDs using the mod's `fabric.mod.json` id (from Phase 24). If the child gets auto-suffixed (e.g., `mymod-2`), all dependency IDs must be rewritten to match:

- `mymod/minecraft` -> `mymod-2/minecraft`
- `mymod` (mod source) -> `mymod-2`

This means the `FabricModChild.name` and all `DependencyEntry.id` values must be updated atomically.

### Scoped Refresh: Jar Handle Lifecycle

For scoped refresh (one child), the jar lifecycle must be:
1. Close ONLY the targeted child's jar handles (not `jarReader.closeProject()` which closes all)
2. Re-discover dependencies for that child
3. Re-register ONLY that child's new jar handles

This requires a new operation on JarReader: close specific jars by path, not the entire project. The `removeProjectJar()` method exists but operates on single paths. A helper that closes all jars from a dependency map would be useful.

### Default Project Resolution

The CONTEXT.md says `load_project` defaults to "the auto-created 'default' project at startup". Currently the "default" project is created at startup as an empty container. `load_project` with no `project` parameter should add to this default project.

The resolution order should be:
1. Explicit `project` parameter -> target that project
2. No parameter -> `projectStore.getDefault()` if set
3. No parameter, no default -> use "default" (the auto-created project)

### Workspace Cleanup on Scoped Unload

The current `unload_project` with `scope` removes the child from `project.children` but does NOT clean up workspace. Must add:
1. Remove extracted directories for all of the child's dependencies
2. Remove from `jdtls.jarIdToDirName`
3. Rebuild `.classpath`
4. Notify JDT LS

Also must remove the child's jar paths from `jarReader` project handles.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run tests/tools/load-project.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONT-04 | Multiple fabric mods in one project | integration | `pnpm vitest run tests/tools/load-project.test.ts -t "adds child to existing"` | Needs new tests |
| CONT-04 | Auto-suffix on implicit name collision | unit | `pnpm vitest run tests/tools/load-project.test.ts -t "auto-suffix"` | Needs new tests |
| DEP-04 | Scoped refresh targets single child | integration | `pnpm vitest run tests/tools/refresh-dependencies.test.ts -t "scoped"` | Needs new tests |
| DEP-04 | Unscoped refresh with multiple mods refreshes all | integration | `pnpm vitest run tests/tools/refresh-dependencies.test.ts -t "multiple mods"` | Needs new tests |
| TOOL-01 | Namespaced jar IDs work end-to-end | integration | `pnpm vitest run tests/tools/load-project.test.ts` | Partially exists from Phase 24 |
| TOOL-02 | load_project adds to default project | integration | `pnpm vitest run tests/tools/load-project.test.ts -t "default project"` | Needs new tests |
| TOOL-03 | Tool results include namespaced jar IDs | integration | `pnpm vitest run tests/tools/load-project.test.ts -t "child name"` | Needs new tests |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tests/tools/load-project.test.ts tests/tools/refresh-dependencies.test.ts tests/tools/unload-project.test.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/load-project.test.ts` -- needs new test cases for add-child-to-existing, auto-suffix, default project targeting
- [ ] `tests/tools/refresh-dependencies.test.ts` -- needs scope parameter tests, multi-mod refresh tests
- [ ] `tests/tools/unload-project.test.ts` -- needs workspace cleanup verification for scoped unload
- [ ] `tests/jdtls/workspace-sync.test.ts` -- needs fabric mod sync tests (currently only study jar sync)
- [ ] `tests/helpers/factories.ts` -- may need a `makeFakeProject` variant with multiple mods

## Sources

### Primary (HIGH confidence)
- Source code: `src/tools/load-project.ts` -- current implementation, lines 15-142
- Source code: `src/tools/refresh-dependencies.ts` -- current implementation, lines 13-109
- Source code: `src/project/namespace-resolver.ts` -- Phase 24 namespace resolution
- Source code: `src/jdtls/workspace.ts` -- extraction logic, `extractSourcesToTemp()`
- Source code: `src/jdtls/workspace-sync.ts` -- incremental sync pattern for study jars
- Source code: `src/project/jar-reader.ts` -- `registerProject()` vs `addProjectJar()` semantics
- Source code: `src/jdtls/uri-mapper.ts` -- `jarIdToDirName()` implementation
- Source code: `src/project/compat.ts` -- `getSoleFabricMod()` that must be replaced
- Source code: `src/state/project-store.ts` -- project name collision handling
- CONTEXT.md: Phase 25 user decisions

### Secondary (MEDIUM confidence)
- Phase 24 RESEARCH.md -- namespace architecture decisions that Phase 25 builds on

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all internal code changes
- Architecture: HIGH -- patterns established in Phase 24 and study jar sync; codebase thoroughly inspected
- Pitfalls: HIGH -- identified from direct source code analysis of registration/lifecycle behavior

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- internal refactoring, no external dependencies)
