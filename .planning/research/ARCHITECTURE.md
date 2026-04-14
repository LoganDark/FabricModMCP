# Architecture Patterns

**Domain:** Study jar management integration into existing MCP server
**Researched:** 2026-04-13

## Existing Architecture Summary

The codebase follows a **domain -> tool layered architecture**:

- **State layer:** `ProjectStore` holds `LoadedProject` instances keyed by name
- **Domain layer:** `JarReader` (shared jar handles with ref counting), `EntryIndex` (class/package indexes from jar contents), `SourceAdapter` (unified read interface across jar and filesystem sources), `jar-registry` (filter-based dependency selection)
- **Tool layer:** Thin wiring -- resolves project via `resolveProjectSafely()`, gets filtered deps via `getFilteredDependencies()`, optionally narrows by `jars` glob pattern via `filterDependenciesByJarPattern()`, then delegates to domain modules
- **JDT LS layer:** Workspace extraction to temp dir, Eclipse project/classpath generation, LSP client lifecycle

Key data flow for jar-aware tools:
```
Tool receives (project?, jars?) params
  -> resolveProjectSafely(project) -> LoadedProject
  -> getFilteredDependencies(project.dependencyJars, project.filterConfig) -> filtered Map
  -> filterDependenciesByJarPattern(filtered, jars) if jars provided -> scoped Map
  -> iterate scoped deps, create SourceAdapter per dep, read/index
```

## Recommended Architecture for Study Jars

### Design Decision: Study jars live on LoadedProject

Study jar state belongs on `LoadedProject`, not in a separate store. Rationale:

1. **Study jars are per-project.** A study jar added to project A should not appear in project B. The existing `dependencyJars` map is already per-project -- study jars are the same concept with a different provenance.
2. **All tool resolution flows through `LoadedProject`.** Adding a separate store would require every tool to query two sources and merge results. Keeping study jars on `LoadedProject` means the existing data flow works with minimal changes.
3. **Lifecycle ties to project lifecycle.** When a project is unloaded, its study jars should be cleaned up. This happens naturally if they live on `LoadedProject`.

### New Type: StudyJar

```typescript
// In src/project/types.ts

export interface StudyJar {
  /** User-provided display name */
  name: string;
  /** Absolute path to the source jar on disk */
  path: string;
  /** Whether this jar appears in the default jar set (when jars param is omitted) */
  autoInclude: boolean;
}
```

### Modified Type: LoadedProject

```typescript
export interface LoadedProject {
  // ... existing fields unchanged ...
  studyJars: Map<string, StudyJar>;  // keyed by name
}
```

The `studyJars` map is initialized as empty in `loader.ts` when a project is loaded. Study jars are added/removed/toggled via new tools at runtime.

### Integration Strategy: Bridge via DependencyEntry Facade

The critical architectural question is: how do study jars participate in the existing tool resolution pipeline? Two approaches:

**Option A (rejected): Merge study jars into `dependencyJars` map.** This would contaminate the dependency model -- `dependencyJars` represents discovered Gradle dependencies with Maven coordinates, provenance chains, and categories. Study jars have none of this. Also breaks `refresh_dependencies` which rebuilds the map from scratch.

**Option B (recommended): Create DependencyEntry facades at query time.** When tools call `getFilteredDependencies()`, a new wrapper function also includes study jars with `autoInclude: true`. When tools use the `jars` param, study jars are matchable by their namespaced ID. This requires one new function that wraps the existing `getFilteredDependencies()`.

### Component Boundaries

| Component | Current Responsibility | Change for Study Jars |
|-----------|----------------------|----------------------|
| `LoadedProject` (type) | Holds project state | Add `studyJars: Map<string, StudyJar>` field |
| `loader.ts` | Creates LoadedProject from Gradle project | Initialize `studyJars` as empty Map |
| `JarReader` | Shared jar handles with ref counting | Add `addProjectJar()` and `removeProjectJar()` methods |
| `jar-registry.ts` | Filter deps by include/exclude config | New `getCombinedDependencies()` function that merges filtered deps + auto-included study jars |
| `EntryIndex` / `entry-index-cache.ts` | Index class/package structure from jar entries | No change -- study jars use existing cache keyed by jar path |
| `SourceAdapter` | Unified read across jar/filesystem | No change -- `createJarAdapter()` already works with any jar path |
| `tool-helpers.ts` | `filterDependenciesByJarPattern`, `resolveClassSource`, etc. | Use `getCombinedDependencies()` instead of raw `getFilteredDependencies()` |
| `workspace.ts` | Extract sources to temp dir for JDT LS | New functions for incremental extraction/removal of study jars |
| `uri-mapper.ts` | Map file URIs to jar IDs | Study jar names follow existing convention -- no code change needed |
| `load-project.ts` (tool) | Registers jar handles, starts JDT LS | No change -- study jars added post-load |
| `unload-project.ts` (tool) | Closes handles, cleans up JDT LS | Study jar handles cleaned up naturally by existing `closeProject()` |
| New: `study-jar.ts` (domain) | Add/remove/list/toggle study jars | New domain module |
| New: `add-study-jar.ts` (tool) | MCP tool for adding study jars | New tool |
| New: `remove-study-jar.ts` (tool) | MCP tool for removing study jars | New tool |
| New: `list-study-jars.ts` (tool) | MCP tool for listing study jars | New tool |
| New: `set-study-jar-auto-include.ts` (tool) | MCP tool for toggling auto-include | New tool |

## Data Flow Changes

### Adding a Study Jar

```
add_study_jar(project, name, path, autoInclude?)
  -> Validate jar path exists and is a valid ZIP/JAR
  -> Validate name is unique within project's study jars
  -> Create StudyJar { name, path, autoInclude: autoInclude ?? false }
  -> project.studyJars.set(name, studyJar)
  -> jarReader.addProjectJar(projectName, path)
  -> If JDT LS active: extract study jar to workspace, update .classpath, rebuild UriMapper
```

### Removing a Study Jar

```
remove_study_jar(project, name)
  -> Get StudyJar from project.studyJars
  -> project.studyJars.delete(name)
  -> jarReader.removeProjectJar(projectName, path)
  -> If JDT LS active: remove extracted dir, update .classpath, rebuild UriMapper
```

### Modified Tool Resolution (e.g., list_packages, search_classes)

```
Tool receives (project?, jars?) params
  -> resolveProjectSafely(project) -> LoadedProject
  -> getCombinedDependencies(project) -> combined Map<string, DependencyEntry>
       (internally: getFilteredDependencies + auto-included study jars merged)
  -> filterDependenciesByJarPattern(combined, jars) if jars provided -> scoped
  -> [rest unchanged]
```

The merge step creates ephemeral `DependencyEntry` objects for study jars:

```typescript
function studyJarToDependencyEntry(studyJar: StudyJar): DependencyEntry {
  return {
    id: `study:${studyJar.name}`,
    group: '',
    artifact: studyJar.name,
    version: '',
    category: 'study',
    sourcesJarPath: studyJar.path,
    available: true,
    provenanceChains: [],
  };
}
```

### JarCategory Extension

Add `'study'` to `JarCategory`:

```typescript
export type JarCategory = 'minecraft' | 'mod-source' | 'fabric-api' | 'library' | 'study';
```

Study jars sort last in priority (they are supplementary):

```typescript
export const CATEGORY_PRIORITY: Record<JarCategory, number> = {
  'minecraft': 0,
  'mod-source': 1,
  'fabric-api': 2,
  'library': 3,
  'study': 4,
};
```

### Namespaced Jar IDs

Study jar IDs use a `study:` prefix: `study:my-library`. This avoids collisions with Maven-coordinate dependency IDs like `group:artifact`. Users target them with `jars: ["study:*"]` or `jars: ["study:my-library"]`.

The `study:` prefix naturally maps to filesystem directory `study__my-library` via the existing `jarIdToDirName()` function (`:` -> `__`).

## JarReader Ref Counting Changes

Two new methods extend the existing pattern:

```typescript
addProjectJar(projectName: string, jarPath: string): void {
  const paths = this.projectHandles.get(projectName);
  if (!paths) throw new DomainError(...);
  paths.add(jarPath);
}

async removeProjectJar(projectName: string, jarPath: string): Promise<void> {
  const paths = this.projectHandles.get(projectName);
  if (!paths) return;
  paths.delete(jarPath);

  // Close handle if no other project references this jar
  let shared = false;
  for (const [, otherPaths] of this.projectHandles) {
    if (otherPaths.has(jarPath)) { shared = true; break; }
  }
  if (!shared) {
    await this.close(jarPath);
  }
}
```

The existing `closeProject()` already iterates all paths in a project's handle set, so study jar paths added via `addProjectJar()` get cleaned up on project unload automatically.

## JDT LS Workspace Impact

This is the most complex integration point.

### Current flow (load time only)

1. `extractSourcesToTemp()` extracts ALL available dependency jars to a temp directory
2. Generates `.project` and `.classpath` listing all extracted dirs as source entries
3. Starts JDT LS with this workspace
4. JDT LS indexes everything during startup

### Study jar flow (post-load mutation)

**Approach: Incremental extraction + classpath rewrite**

1. Extract study jar to new subdirectory in existing `tempDir` (e.g., `study__mylib/`)
2. Rewrite `.classpath` to include the new source entry
3. JDT LS detects `.classpath` change and re-configures the project
4. Rebuild `UriMapper` so LSP result URIs map back to the study jar ID

JDT LS watches `.classpath` for changes. After rewriting it, JDT LS should pick up the new source root. This needs validation during implementation -- if passive watching does not work, a `workspace/didChangeWatchedFiles` notification for the `.classpath` file URI should trigger it.

### New workspace.ts functions

```typescript
export async function extractStudyJarToWorkspace(
  studyJar: StudyJar,
  tempDir: string,
  jarReader: JarReader,
): Promise<string>  // returns dirName

export async function removeStudyJarFromWorkspace(
  studyJarName: string,
  tempDir: string,
): Promise<void>

export async function rewriteClasspath(
  tempDir: string,
  allDirNames: string[],
): Promise<void>
```

### UriMapper rebuild

Current `UriMapper` is created once at load time. When study jars change, rebuild it:

```typescript
// After adding/removing study jar, update JdtLsSession:
session.jarIdToDirName.set(`study:${name}`, dirName);  // or .delete()
// Then rebuild:
const newMapper = createUriMapper(session.tempDir, session.jarIdToDirName);
```

The `UriMapper` is cheap to construct (two Maps + one `realpathSync`). Rebuilding is cleaner than adding mutation methods.

### Non-blocking extraction

Study jar extraction and JDT LS re-indexing should not block the `add_study_jar` response. The jar is immediately usable for browsing, search, and reading (those go through `JarReader` directly). Only semantic navigation (find-definition, find-references) needs the JDT LS index. Return success immediately; JDT LS indexes in the background.

However, implementing truly async extraction adds complexity (tracking in-progress state, error handling). For v1.1, **synchronous extraction with async JDT LS indexing** is the pragmatic choice: extract files synchronously (fast -- just file I/O), rewrite .classpath, return. JDT LS re-indexes on its own timeline.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate Study Jar Store

**What:** Creating a `StudyJarStore` parallel to `ProjectStore`.
**Why bad:** Every tool would need to query two stores and merge. The `jars` parameter resolution would need two code paths. Testing surface doubles.
**Instead:** Keep study jar state on `LoadedProject`.

### Anti-Pattern 2: Mutating dependencyJars Map

**What:** Inserting study jar entries directly into `LoadedProject.dependencyJars`.
**Why bad:** Breaks `refresh_dependencies` (rebuilds the map from scratch). Confuses `get_project_metadata` provenance. Makes it impossible to distinguish study jars from real dependencies.
**Instead:** Use the DependencyEntry facade pattern at query time.

### Anti-Pattern 3: Restarting JDT LS on Every Add/Remove

**What:** Kill and restart JDT LS when study jars change.
**Why bad:** 30-120 seconds downtime per operation. Unacceptable UX.
**Instead:** Incremental extraction + classpath rewrite.

## Suggested Build Order

Each step is independently testable. Dependencies flow downward.

### Step 1: Types and Domain Logic (no tool changes)

1. Add `StudyJar` interface and `'study'` to `JarCategory` in `src/project/types.ts`
2. Add `studyJars` field to `LoadedProject` interface
3. Update `CATEGORY_PRIORITY` in `tool-helpers.ts`
4. Initialize `studyJars: new Map()` in `loader.ts`
5. Add `addProjectJar()` and `removeProjectJar()` to `JarReader`
6. Create `src/project/study-jar.ts` with domain logic (add/remove/list/validate/facade)
7. Create `getCombinedDependencies()` helper

**Tests:** Unit test StudyJar validation, JarReader add/remove, getCombinedDependencies merging.

### Step 2: Existing Tool Integration (existing tools see study jars)

1. Replace `getFilteredDependencies()` calls with `getCombinedDependencies()` in:
   - `tool-helpers.ts` (`resolveClassSource`)
   - `list-packages.ts`, `list-classes.ts`, `search-classes.ts`, `search.ts` (direct callers)
   - `get-project-metadata.ts` (display study jars in inventory)

**Tests:** Integration tests -- manually set up a LoadedProject with study jars, verify tools see them.

### Step 3: Study Jar Management Tools

1. `add_study_jar` tool
2. `remove_study_jar` tool
3. `list_study_jars` tool
4. `set_study_jar_auto_include` tool

**Tests:** Tool-level tests for each.

### Step 4: JDT LS Workspace Sync

1. Add incremental extraction functions to `workspace.ts`
2. Wire into add/remove study jar tools
3. Rebuild UriMapper on add/remove
4. Notify JDT LS of classpath changes

**Tests:** Integration test -- add study jar, verify find-definition resolves to study jar source.

### Step 5: Descriptions and Server Instructions

1. Update `SERVER_INSTRUCTIONS` to document study jars
2. Add `TOOL_DESCRIPTIONS` for new tools
3. Register tools in `src/tools/index.ts`

## Scalability Considerations

| Concern | 1-2 study jars | 10 study jars | 50 study jars |
|---------|----------------|---------------|---------------|
| Memory (jar handles) | Negligible | ~500MB uncompressed | Consider limiting |
| EntryIndex build time | <100ms per jar | ~1s total | May need lazy indexing |
| JDT LS indexing | 5-10s incremental | 30-60s incremental | May hit JDT LS limits |
| Tool response time | No impact | Minimal (parallel reads) | Use `jars` param to scope |

Practical limit: 10-15 study jars is reasonable. No need for an artificial cap in v1.1, but document the tradeoff.

## Sources

- Existing codebase analysis (all files in `src/project/`, `src/browsing/`, `src/tools/`, `src/jdtls/`, `src/state/`)
- LSP Specification 3.17 (workspace/didChangeWatchedFiles): https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_didChangeWatchedFiles
