# Feature Landscape

**Domain:** Study jar management for MCP-based Minecraft dev tool
**Researched:** 2026-04-13

## Table Stakes

Features users expect from "add arbitrary source jars for study." Missing = feature feels incomplete.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| Add a study jar by file path | Core operation -- user has a sources jar on disk and wants to browse it. Must validate it exists and is a valid ZIP/JAR. | Low | `JarReader.readEntry`/`listEntries` for validation; needs a new `DependencyEntry` with a new category |
| Assign a human-friendly name | Jar paths are unwieldy. Users need short IDs like `"sodium"` to reference in `jar`/`jars` parameters. Auto-generation from filename is a fallback, but explicit naming must be supported. | Low | `DependencyEntry.id` is already the short identifier used everywhere |
| Remove a study jar by name | Undo of add. Must clean up jar handle ref counts. | Low | `JarReader` project handle tracking; remove from `dependencyJars` map |
| List study jars | Show what's currently added with name, path, auto-include status. Distinguish study jars from auto-discovered dependencies. | Low | `get_project_metadata` already renders jar inventory; needs category filtering or a dedicated tool |
| Browse study jar contents via existing tools | After adding, `list_packages`, `list_classes`, `read_source`, `search_classes`, `locate_in_source` must see the study jar. This is the whole point. | Low | Study jars become entries in `dependencyJars` -- existing tools iterate that map. If the entry exists and is available, tools work automatically. |
| Study jars selectable via `jar`/`jars` parameters | User must be able to scope operations to a specific study jar by its name. | Low | Already works -- `jar` param does `dependencyJars.get(jar)`, `jars` param uses picomatch against IDs. Study jar ID just needs to be in the map. |
| Auto-include flag (opt-in to default jar set) | Controls whether a study jar appears when tools search "all jars" without explicit `jars` parameter. Default should be OFF -- study jars are opt-in extras, not things you want polluting every search. User enables auto-include for jars they're actively studying. | Medium | `getFilteredDependencies` + `matchesFilter` need to respect auto-include. Study jars with auto-include=false should be excluded from default resolution but still accessible via explicit `jar`/`jars` parameters. |
| Toggle auto-include on existing study jars | Change auto-include without re-adding. Separate operation from add/remove. | Low | Mutate the entry in `dependencyJars` map |
| Persist across refresh_dependencies | `refresh_dependencies` re-scans Gradle cache and replaces `dependencyJars`. Study jars are not from Gradle -- they must survive refresh. | Low | `refresh_dependencies` currently replaces the entire `dependencyJars` map. Need to preserve study jar entries during refresh. |
| Name conflict detection with actionable errors | When adding a study jar whose name collides with an existing dependency or study jar, provide a clear error with the conflicting entry and suggest an alternative. | Low | `DomainError` pattern already established. Check `dependencyJars.has(name)` before insert. |

## Differentiators

Features that set this apart from bare-minimum "add a jar" functionality. Not expected, but high value.

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| Auto-name from jar metadata | Parse `META-INF/MANIFEST.MF` or embedded Maven POM to derive a meaningful name (e.g., `"sodium-0.6.0"`) when user doesn't provide one. Better than just stripping `.jar` from filename. | Low | `JarReader.readEntry` to read manifest. Fallback to filename stem. |
| Bulk add via glob pattern | `add_study_jar` accepts a glob like `/path/to/libs/*-sources.jar` and adds multiple jars at once with auto-generated names. Useful when user has a directory of source jars. | Medium | `glob` library already in stack. Need to handle partial failures (some valid, some not). |
| Study jar metadata in get_project_metadata | Show study jars as a separate section or with a `"study"` category in jar inventory, so `get_project_metadata` clearly distinguishes auto-discovered vs. manually-added jars. | Low | Add `'study'` to `JarCategory` union type. `buildJarInventory` already iterates all deps. |
| LSP navigation with study jars | `find_definition`, `find_references`, etc. work within study jar sources. Requires sources extracted to JDT LS workspace. | High | `jdtls/workspace.ts` extraction on project load. Adding after load requires incremental extraction + JDT LS notification. |
| Incremental JDT LS workspace update | When a study jar is added/removed, update the JDT LS workspace without requiring full project reload. Extract sources to workspace dir and send `workspace/didChangeWatchedFiles` notification. | High | `JdtLsSession` lifecycle management. Must avoid breaking active LSP state. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-discovery of study jars from a configured directory | Adds implicit state and "magic" behavior. Study jars are arbitrary user-chosen artifacts, not things with a well-defined location. | User explicitly adds each jar. Claude can be instructed to add specific jars automatically. |
| Persistence across server restarts | Study jars are session-scoped, tied to loaded projects. Persisting creates stale references (jars moved/deleted), config file management complexity, and conflicts with the "load project = fresh start" model. | User re-adds study jars after loading a project. Claude remembers what to add from conversation context. |
| Classpath/compilation integration | Study jars are for reading source code, not for compilation. Adding them to the Java classpath would create version conflicts and confuse JDT LS type resolution. | Source browsing only. JDT LS workspace extraction is for navigation, not compilation. |
| Automatic transitive dependency resolution | Unlike Gradle dependencies, study jars should not trigger transitive dependency discovery. A study jar is a standalone source artifact the user wants to read. | Each study jar is self-contained. User adds exactly what they want. |
| Sub-categorization of study jars | No need for `"study-library"`, `"study-framework"`, etc. One category distinguishes manual from auto-discovered. | Single `'study'` category on `JarCategory`. |
| Editing/writing to study jars | This is a read-only analysis server. | Read-only access via existing `SourceAdapter` pattern. |

## Feature Dependencies

```
Add study jar -----> Browse via existing tools (automatic once in dependencyJars)
     |
     +-------------> Remove study jar
     |
     +-------------> List study jars
     |
     +-------------> Toggle auto-include
     |
     +-------------> LSP navigation with study jars (requires workspace extraction)

Auto-include flag --> Filter integration (getFilteredDependencies must know about study jars)

Persist across refresh --> refresh_dependencies must preserve study entries

Name conflict detection --> Add study jar (pre-insert validation)
```

Key insight: because existing tools operate on `dependencyJars` map entries via `DependencyEntry`, the integration cost for browsing/search is near-zero. The entry just needs to exist in the map with `available: true` and a valid `sourcesJarPath`. The main complexity points are:

1. **Auto-include filtering** -- `getFilteredDependencies` and `matchesFilter` currently only check filter patterns. Study jars with auto-include=false need a new exclusion path: excluded from the "all jars" default set but still accessible when explicitly named in `jar`/`jars` parameters.

2. **JDT LS workspace integration** -- adding sources to the JDT LS workspace after initial project load is the hardest part. Without this, study jars get browsing/search/regex but not semantic navigation.

3. **Jar handle lifecycle** -- `JarReader.registerProject` tracks which jar paths belong to which project. Study jars added after load need to be registered. `closeProject` must clean them up.

## Filter Interaction Design

The critical design question: how does auto-include interact with `getFilteredDependencies` and the `jars` parameter?

**Recommended approach:**

1. `getFilteredDependencies()` excludes study jars where `autoInclude === false`. Tools searching "all jars" (no `jars` param) skip non-auto-included study jars.
2. When `jars` parameter is explicitly provided, it matches against ALL entries including non-auto-included study jars. Users can explicitly target a study jar by name even if it's not auto-included.
3. When `jar` (singular) parameter is provided, it does a direct `dependencyJars.get(jar)` lookup -- already works for any entry in the map regardless of auto-include.
4. `matchesFilter()` already always includes `'minecraft'` and `'src'`. Study jars with `autoInclude === true` should behave like regular dependencies (subject to include/exclude filter patterns). Study jars with `autoInclude === false` should be excluded from default resolution regardless of filter patterns.

This gives the user full control: auto-include=false means "only show me this when I ask for it by name."

## Data Model Implications

The `DependencyEntry` type needs extension:

- **New `JarCategory` value**: `'study'` added to the `'minecraft' | 'mod-source' | 'fabric-api' | 'library'` union.
- **Auto-include flag**: New field on `DependencyEntry` (e.g., `autoInclude?: boolean`, defaulting to `undefined`/`true` for non-study entries). Adding to `DependencyEntry` is cleaner than a separate tracking structure -- it's already the per-jar metadata record.
- **Origin tracking**: The `'study'` category serves to distinguish "came from Gradle discovery" vs "manually added" so `refresh_dependencies` knows which entries to preserve.

Study jars should live in the existing `dependencyJars` map rather than a separate `studyJars` map. A separate map would require every tool to check two maps -- using the existing map with a distinguishing category is the lower-friction approach that gives automatic integration for free.

## MVP Recommendation

Prioritize:
1. **Add/remove/list study jars** -- core CRUD operations. Add `'study'` to `JarCategory`. Store study entries in `dependencyJars`.
2. **Auto-include flag with filter integration** -- must ship with add/remove since it defines default visibility.
3. **Persist across refresh_dependencies** -- without this, refreshing silently removes study jars. Unacceptable.
4. **Name conflict detection** -- trivial to implement, prevents confusing errors.

Defer:
- **Incremental JDT LS workspace update**: High complexity. Study jars would initially support browsing/search/regex but not semantic LSP navigation. This is still highly useful. LSP can be added in a follow-up or require project reload.
- **Bulk glob add**: Nice but not essential. User can call add_study_jar multiple times.
- **Auto-name from jar metadata**: Filename stem is good enough for MVP. Manifest parsing is polish.

## Sources

- Codebase analysis: `jar-registry.ts`, `jar-reader.ts`, `source-adapter.ts`, `tool-helpers.ts`, `dependency-discovery.ts`, `loader.ts`, `project/types.ts`
- [IntelliJ IDEA Libraries Documentation](https://www.jetbrains.com/help/idea/library.html) -- IDE pattern for attaching source jars
- [VS Code Java Project Management](https://code.visualstudio.com/docs/java/java-project) -- `java.project.referencedLibraries` source attachment pattern
- [IntelliJ attach sources discussion](https://intellij-support.jetbrains.com/hc/en-us/community/posts/206191239-Attach-sources-to-jars-the-easy-way) -- community patterns for source attachment workflows
