# Domain Pitfalls

**Domain:** Monolithic-to-composable project rearchitecture (v1.4)
**Researched:** 2026-04-15
**Confidence:** HIGH (based on direct codebase analysis of all 25 tools, 20+ domain modules, and 592 tests)

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Big Bang Type Replacement

**What goes wrong:** Replacing `LoadedProject` with a new type in one pass across all 25 tools and 20+ domain modules simultaneously. A single phase tries to change the type, update all consumers, and fix all 592 tests at once.

**Why it happens:** The new model (project = container of children) is fundamentally different from the old model (project = one fabric mod). It seems like you need to change everything at once because the old type shape does not accommodate multiple fabric mods.

**Consequences:** Enormous diff that is impossible to review or debug. If something breaks, the blast radius is the entire codebase. Tests are all red simultaneously, making it impossible to tell what is actually wrong vs. what is cascade failure from the type change.

**Prevention:** Use an adapter/facade pattern. Keep `LoadedProject` as an internal compatibility layer during migration:
1. First phase: Create new types (`ProjectContainer`, `FabricChild`, etc.) alongside existing types
2. Second phase: Add a function that synthesizes a `LoadedProject`-shaped view from the new container for a given scope (whole project or single child)
3. Third phase: Migrate tools one-by-one to the new API, with the adapter keeping old tools working
4. Final phase: Remove the adapter once all consumers are migrated

**Detection:** If a phase plan involves changing more than 5 files simultaneously to accommodate a type change, the phase is too large.

### Pitfall 2: Losing the "src" (Mod Source) Abstraction During Decomposition

**What goes wrong:** The current system treats mod source code as a special dependency entry with `id: 'src'` and `category: 'mod-source'`. The `createSourceAdapter` function (source-adapter.ts:63) uses `dep.id === 'src'` to choose the filesystem adapter vs jar adapter. When splitting into multiple fabric mods, each mod needs its own `src` entry pointing to its own `rootPath`, but the hardcoded `'src'` ID creates a collision.

**Why it happens:** The `'src'` ID was a valid singleton when there was exactly one fabric mod per project. With multiple fabric mods, you need namespaced source IDs (e.g., `my-mod/src`, `other-mod/src`).

**Consequences:** Two fabric mods in the same project would both try to use `id: 'src'` in the merged dependency map. One shadows the other. Tools silently read the wrong mod's source code. Extremely difficult to debug because results look plausible but are wrong.

**Prevention:**
- Namespace the `src` entry early: `{modName}/src` instead of bare `src`
- Update `createSourceAdapter` to detect `mod-source` category (not just `id === 'src'`) and look up the root path from the child, not the project
- Add a test that loads two fabric mods with overlapping package names and verifies each reads from its own source tree

**Detection:** Any code path that uses `dep.id === 'src'` or relies on a single `rootPath` for filesystem source resolution.

### Pitfall 3: Dependency Namespace Collision Across Mods

**What goes wrong:** Two fabric mods in the same project depend on different versions of the same library (e.g., mod-a uses `com.google:gson:2.10` and mod-b uses `com.google:gson:2.11`). The current `dependencyJars: Map<string, DependencyEntry>` uses artifact coordinates as keys. Merging both mods' dependencies into a single map silently drops one version.

**Why it happens:** The current single-mod design never faces this. The flat Map with string keys has no namespacing. The dependency-resolver functions (`getResolvedDependencies`, `getAllDependencies`) both operate on `project.dependencyJars` as a flat Map.

**Consequences:** Wrong dependency version served to tools. Cascading failures in JDT LS because it indexes the wrong version. Subtle type resolution bugs that appear as "JDT LS can't find this class" when it actually can -- just from the wrong version.

**Prevention:**
- Namespace dependency IDs by mod: `{modName}/minecraft`, `{modName}/fabric-api:...`
- Or keep each child's dependencies isolated and merge only at tool invocation time with explicit scoping
- `getDependenciesForTool` already accepts `jars` patterns -- extend it to accept `{child}/{jar}` scoping syntax
- Study jars should NOT be namespaced (they live at project level per the requirements)

**Detection:** Test with two mods that have overlapping dependency IDs but different jar paths. Assert that scoped queries return the correct jar for each mod.

### Pitfall 4: JDT LS Single-Workspace Assumption

**What goes wrong:** Currently one JDT LS process gets one workspace (one `.project` + `.classpath` in one temp dir). All jars from all children get extracted into the same flat namespace. When two fabric mods have the same class (e.g., both have `net.minecraft.client.MinecraftClient` from different MC versions), JDT LS sees duplicate definitions and semantic navigation breaks unpredictably.

**Why it happens:** JDT LS was initialized in load-project.ts for one fabric mod. The workspace extraction (workspace.ts) creates one temp dir with one .classpath. There is no concept of multiple Eclipse "projects" within the workspace.

**Consequences:** find-definition returns results from the wrong mod's Minecraft version. find-references returns mixed results across incompatible codebases. Type hierarchy shows phantom implementations from incompatible versions. These are silent data corruption bugs -- the results look valid but are wrong.

**Prevention:**
- Option A: One JDT LS process per fabric child (simple, memory-heavy ~200-400MB per JVM, but correct isolation)
- Option B: Multiple Eclipse projects within one JDT LS workspace (one .project per child, with separate classpaths -- needs investigation of whether JDT LS supports this in headless mode)
- Option C: Shared JDT LS when all mods target the same MC version, separate when they differ
- The current `extractSourcesToTemp` creates a single `mcp-sources` project name. Multiple `.project` files would need separate subdirectories.
- Phase that tackles this MUST be a research phase first -- do not assume .classpath extension works for cross-mod isolation.

**Detection:** If any phase plan assumes "just add more source dirs to the existing .classpath" without addressing cross-mod class duplication, flag it.

## Moderate Pitfalls

### Pitfall 5: rootPath Removal Breaks 18+ Call Sites

**What goes wrong:** The new model says "projects are pure named containers (no root dir)." But `rootPath` appears in 18+ call sites across tool files. It is used for three distinct purposes:
1. `createSourceAdapter(jarReader, dep, loadedProject.rootPath)` -- filesystem source reading (13 sites)
2. Cache keys: `fs:${loadedProject.rootPath}:${id}` (4 sites)
3. `extractSourcesToTemp(deps, project.rootPath, jarReader)` -- workspace creation (1 site)
4. Response metadata: `list-projects.ts:22` returns rootPath to agent

**Prevention:**
- `rootPath` moves from project to fabric child (each mod has its own root)
- Create a helper that resolves the root path given a dependency entry (looks up which child owns that dep, returns that child's rootPath)
- Or store rootPath directly on each `DependencyEntry` with `mod-source` category, eliminating the lookup entirely
- Do NOT make rootPath optional on the project type -- this creates nullable access bugs across 18 sites and TypeScript will not catch them all if you use `!`

### Pitfall 6: Test Factory Coupling to LoadedProject Shape

**What goes wrong:** `makeFakeProject()` in `tests/helpers/factories.ts` constructs a full `LoadedProject` with all 9 fields hardcoded. 21 test files (37 references total) depend on this shape. Trying to update the factory and all tests in one pass is the same big-bang problem as Pitfall 1.

**Prevention:**
- Update `makeFakeProject` first to support the new shape with backward-compatible defaults
- If using the adapter pattern from Pitfall 1, the factory can produce the new container type and the adapter produces the old shape -- tests keep working until individually migrated
- Add a `makeFakeContainer` factory alongside `makeFakeProject` for new tests
- Phase the test migration: update factory -> migrate project/domain tests -> migrate tool tests

### Pitfall 7: Study Jar Collision Detection Assumes Flat Namespace

**What goes wrong:** `validateStudyJarId` (study-jar.ts:36) checks `project.dependencyJars.has(name)` to detect collisions between study jar names and real dependency IDs. `autoUnloadConflictingStudyJars` does the same. With namespaced dependencies (`mod-a/minecraft`), a study jar named `minecraft` no longer collides with `mod-a/minecraft`. But it WILL shadow results in tools that search across all jars, because `getDependenciesForTool` matches by pattern.

**Prevention:**
- Decide the collision policy explicitly: study jars collide with the UNNAMESPACED portion of any child's dep IDs
- Since study jars live at project level (requirement), collision should iterate all children's dependency maps and check the bare dep ID (not the namespaced one)
- Update `autoUnloadConflictingStudyJars` to use the same logic

### Pitfall 8: getDependenciesForTool Merge Order Creates Silent Shadowing

**What goes wrong:** `getDependenciesForTool` currently returns a flat `Map<string, DependencyEntry>`. When merging dependencies from multiple children, insertion order determines which entry wins for duplicate keys. Different merge orders produce different results with no warning.

**Prevention:**
- When merging across children, use namespaced keys (`{child}/{depId}`) so there are no collisions in the merged map
- If a tool requests unscoped jars (no child specified), define explicit precedence rules (first-loaded mod wins, or all mods included with namespaced IDs)
- Never silently shadow entries -- at minimum log a warning, at best use namespaced keys so shadowing is impossible

### Pitfall 9: filterConfig Scope Ambiguity

**What goes wrong:** `filterConfig` currently lives on `LoadedProject` and applies globally via `getFilteredDependencies`. With multiple fabric mods, should filter patterns apply per-mod or project-wide? A pattern like `fabric-api:*` would filter the same group from all mods if project-wide. If per-mod, `configure_filters` needs a child selector.

**Prevention:**
- Keep filterConfig at the project level (it filters what appears in default results, not what exists)
- Jar patterns need to work with namespaced IDs: does `minecraft` match `mod-a/minecraft`? Define this before implementing
- Recommended: bare patterns match across all children (convenience), namespaced patterns match specific children (precision)

### Pitfall 10: Backward Incompatible Tool Schemas

**What goes wrong:** Adding a required `child` parameter to all 25 tools to specify which fabric mod to target. This breaks every existing Claude conversation that uses the tools -- Claude has learned the current parameter shapes and will send the old format.

**Prevention:**
- The `child` parameter MUST be optional, with smart defaults (if project has one fabric mod, use it; if multiple, require specification)
- Mirror the pattern from `resolveProject` in project-store.ts (lines 74-113): optional name, auto-resolve when unambiguous, error when ambiguous
- Create `resolveChild(project, childName?)` that follows the exact same logic
- Test: every tool called with NO `child` parameter on a single-mod project produces identical results to v1.3

## Minor Pitfalls

### Pitfall 11: Entry Index Cache Keys Become Ambiguous

**What goes wrong:** Cache keys like `fs:${loadedProject.rootPath}:${id}` assume one rootPath per project. With multiple mods from different directories, two children with the same dep ID (e.g., both have `src`) would produce different cache keys correctly IF rootPath is different, but the pattern breaks if rootPath moves.

**Prevention:** Include child name in cache key: `fs:${childName}:${rootPath}:${id}`. Or better: use the dep's `sourcesJarPath` as the cache key (already unique) and only use the compound key for `mod-source` entries.

### Pitfall 12: jarReader.registerProject Assumes One Registration Per Project

**What goes wrong:** `jarReader.registerProject(projectName, jarPaths)` registers all jar paths under the project name in one shot. With multiple fabric mods added incrementally (add mod-a, then later add mod-b), each new mod needs to register additional jars without deregistering mod-a's jars.

**Prevention:** Change to additive registration (`jarReader.addJars(projectName, jarPaths)`) or register per-child (`jarReader.registerProject(`${projectName}/${childName}`, jarPaths)`). The shared-jar-reader already uses ref counting, so additive registration should work cleanly.

### Pitfall 13: Default Project vs. Default Child Two-Level Confusion

**What goes wrong:** The system already has "default project" semantics (project-store.ts lines 54-65). Adding "default child" within a project creates a two-level defaulting system. Agents get confused about which level is being set when they call `set_default_project`.

**Prevention:**
- Only one level of defaulting: the project. Within a project, auto-resolve when there is exactly one child (like `resolveProject` does for single-project sessions)
- When ambiguous, return a clear error listing children, not a silent wrong choice
- Do NOT add a `set_default_child` tool

### Pitfall 14: load_project Tool Semantics Shift

**What goes wrong:** `load_project` currently takes a path and creates a project with one fabric mod. In the new model, loading a project and adding a fabric mod are separate concepts. If `load_project` changes to only create an empty container, all existing agent workflows break because they expect `load_project(path)` to give them a usable project.

**Prevention:**
- Keep `load_project` as sugar: creates a project (if needed) AND adds a fabric mod child to it, all in one call
- This preserves backward compatibility -- single-mod workflows work identically to v1.3
- Add a separate `add_fabric_mod` tool for adding additional mods to an existing project
- Optional: `create_project` tool for creating empty containers, but `load_project` should remain the primary entry point

### Pitfall 15: UriMapper Breaks With Multiple Workspaces

**What goes wrong:** `UriMapper` (jdtls/uri-mapper.ts) maps between file URIs in the temp extraction directory and jar IDs. It uses the `jarIdToDirName` map from `JdtLsSession`. With multiple fabric children each having their own extraction, the URI mapper needs to know which child's extraction directory a given file URI belongs to.

**Prevention:** Either one UriMapper per child (if separate JDT LS processes) or a multi-root UriMapper that includes child context in mappings. Do not try to share a single UriMapper across children with overlapping class names.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| New type definitions | Big Bang Type Replacement (#1) | Define new types alongside old ones, do not remove old types yet |
| Dependency namespacing | Namespace Collision (#3), src Abstraction (#2) | Namespace dep IDs by child name, update src handling to use category not ID |
| Tool migration | Backward Incompatible Schemas (#10), rootPath Removal (#5) | Optional child param with auto-resolve, adapter pattern for rootPath |
| JDT LS multi-child | Single-Workspace Assumption (#4), UriMapper (#15) | Research phase first, do not assume .classpath extension works |
| Test migration | Factory Coupling (#6) | Update factory to new shape with compat defaults, migrate tests incrementally |
| Filter/collision updates | filterConfig Scope (#9), Study Jar Collision (#7) | Define scoping rules before code, test with multi-mod scenarios |
| Default project on startup | Default Confusion (#13), load_project Semantics (#14) | Keep load_project as sugar, single-level defaulting |
| Dependency merging | getDependenciesForTool Shadowing (#8) | Use namespaced keys in merged maps, never silently shadow |

## Sources

All findings derived from direct codebase analysis:
- `src/project/types.ts` -- LoadedProject type definition, 9 fields, 57 field accesses across 20 tool files
- `src/tools/tool-helpers.ts` -- getDependenciesForTool, resolveClassSource, processNavigationLocations (18 rootPath references)
- `src/project/dependency-resolver.ts` -- getResolvedDependencies, getAllDependencies (flat Map merge pattern)
- `src/browsing/source-adapter.ts` -- createSourceAdapter with hardcoded `dep.id === 'src'` check at line 63
- `src/state/project-store.ts` -- resolveProject pattern (model for resolveChild), lines 74-113
- `src/jdtls/workspace.ts` -- single .project/.classpath extraction, `mcp-sources` project name
- `src/jdtls/workspace-sync.ts` -- incremental study jar sync (assumes single workspace tempDir)
- `src/jdtls/types.ts` -- JdtLsSession type with single tempDir/dataDir
- `src/project/study-jar.ts` -- validateStudyJarId collision detection at line 36
- `src/project/loader.ts` -- loadProject returns monolithic LoadedProject, lines 20-128
- `src/tools/load-project.ts` -- project initialization with JDT LS, single-mod assumptions
- `tests/helpers/factories.ts` -- makeFakeProject factory used by 21 test files, 37 references
