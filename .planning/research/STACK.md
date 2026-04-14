# Technology Stack

**Project:** MinecraftDevMCP v1.1 Study Jars
**Researched:** 2026-04-13

## Recommended Stack Changes

### No new libraries needed.

The existing stack handles study jar management without additions. Here is what is already in place and why it suffices:

### Jar I/O: node-stream-zip 1.15.0 (existing -- no change)

| Concern | Assessment | Confidence |
|---------|-----------|------------|
| Multiple concurrent handles | Safe. Each `StreamZip.async` instance opens its own file descriptor and maintains its own central directory index. The existing `JarReader` already manages 10-30+ concurrent handles (minecraft + ~20 dependencies per project). Adding 1-5 study jars is negligible. | HIGH |
| Memory per handle | With `storeEntries: true`, node-stream-zip stores the central directory metadata (file names, offsets, sizes) in memory -- NOT the file contents. For a typical sources jar (~6,600 entries), this is ~1-3MB of metadata. Study jars are the same. | HIGH |
| File descriptor limits | macOS default ulimit is 256 soft / unlimited hard. Each open zip = 1 fd. Current worst case: 2 projects x 30 jars = 60 fds. Adding 10 study jars = 70 fds. Well within limits. | HIGH |
| Jar validation | `JarReader.getHandle()` already validates on open: it calls `await handle.entries()` which throws if the file is not a valid ZIP. This is sufficient validation for study jars -- no separate validation library needed. | HIGH |
| Dynamic add/remove | `JarReader` supports adding jar paths to a project's set at any time (just set manipulation + lazy handle creation). Handle cleanup on remove uses existing ref-counting logic -- if no other project references the jar path, the handle is closed. | HIGH |

### State Persistence: None (in-memory only)

| Approach | Recommendation | Why |
|----------|---------------|-----|
| JSON file on disk | NO | Violates "no caching of extracted files" constraint spirit. Study jars are session-scoped -- user adds them after loading a project, they go away on unload. This matches how dependency jars work (discovered fresh on each `load_project`). |
| SQLite / LevelDB | NO | Massive overkill for a list of (name, path, autoInclude) tuples. Adds a native dependency. |
| In-memory on LoadedProject | YES | Study jars are a property of a loaded project session. Store them directly in the existing `dependencyJars` map as `DependencyEntry` objects with `category: 'study'`. When the project is unloaded, they are cleaned up with everything else. |

**Rationale:** The MCP server is a session tool -- Claude starts it, loads projects, works, and exits. There is no long-running daemon that needs to survive restarts. Re-adding study jars on a new session is a single tool call per jar. Persistence adds complexity for zero practical benefit.

### Schema Validation: Zod 4 (existing -- no change)

New tool input schemas (`add_study_jar`, `remove_study_jar`, `list_study_jars`) use Zod exactly like the existing 21 tools. No new validation library needed.

### JDT LS Integration: Incremental workspace update (existing infrastructure)

| Concern | Approach | Confidence |
|---------|----------|------------|
| Adding study jar to JDT LS workspace | Extract .java files to temp dir (existing `extractSourcesToTemp` pattern), update `.classpath`, notify JDT LS via `workspace/didChangeWatchedFiles`. | MEDIUM |
| Hot-adding without restart | JDT LS supports `workspace/didChangeWatchedFiles` notifications. Extract study jar sources to the existing temp dir, add a new `<classpathentry>` to `.classpath`, send notification. JDT LS should re-index. This avoids full JDT LS restart. | MEDIUM |
| Removing study jar from JDT LS | Delete extracted directory, update `.classpath`, notify. Same mechanism. | MEDIUM |

**Flag:** JDT LS hot-reload of classpath changes needs phase-specific testing. If `didChangeWatchedFiles` does not trigger re-indexing, fallback is full JDT LS restart (which takes ~5-10 seconds). This is acceptable for a study jar add/remove operation.

## Integration Points with Existing Code

### 1. Types (src/project/types.ts)

Extend `JarCategory` to include `'study'`:

```typescript
export type JarCategory = 'minecraft' | 'mod-source' | 'fabric-api' | 'library' | 'study';
```

Study jars are stored as `DependencyEntry` objects in the existing `dependencyJars` map. The `category: 'study'` discriminant identifies them. The auto-include flag needs a separate tracking mechanism (since `DependencyEntry` does not have one) -- a `Set<string>` of auto-included study jar IDs on `LoadedProject`, or a parallel `studyJarMeta` map.

### 2. JarReader (src/project/jar-reader.ts)

The existing `registerProject` / `closeProject` ref-counting pattern handles shared jar paths across projects. Study jars integrate by:
- On add: add jar path to the project's registered set via a new `addJarToProject(projectName, jarPath)` method
- On remove: remove from set, close handle if no other project references it via a new `removeJarFromProject(projectName, jarPath)` method

Both are thin wrappers around the existing `projectHandles` Map and `close()` method.

### 3. Jar registry / filtering (src/project/jar-registry.ts)

`matchesFilter` already special-cases `'minecraft'` and `'src'` as always-included. Study jars with auto-include should be similarly special-cased:

```typescript
// Study jars with autoInclude bypass filter
if (autoIncludeSet.has(jarId)) return true;
```

This requires passing the auto-include set into the filter function, or extending `FilterConfig`.

### 4. Source adapter (src/browsing/source-adapter.ts)

No changes needed. `createSourceAdapter` already handles any `DependencyEntry` with a non-null `sourcesJarPath` via `createJarAdapter`. Study jars have `sourcesJarPath` set to the user-provided path.

### 5. Entry index cache (src/browsing/entry-index-cache.ts)

No changes needed. Cache is keyed by jar path. Study jar paths are unique. Index builds automatically on first access.

### 6. Tool helpers (src/tools/tool-helpers.ts)

`CATEGORY_PRIORITY` needs a new entry: `'study': 4` (lowest default priority -- study jars should not shadow minecraft/dependency classes unless user explicitly selects them via `jars` parameter).

`filterDependenciesByJarPattern` works unchanged because study jar IDs are just strings matched by picomatch.

### 7. JDT LS workspace (src/jdtls/workspace.ts)

Needs new functions for incremental extraction:
- `addJarToWorkspace(tempDir, jarReader, dep, rootPath)` -- extracts one jar's .java files and returns the dir name
- `removeJarFromWorkspace(tempDir, dirName)` -- deletes the extracted directory
- `rewriteClasspath(tempDir, allDirNames)` -- regenerates `.classpath` with current source dirs

### 8. get_project_metadata tool

Should include study jars in the jar inventory, with auto-include status visible.

## What NOT to Add

| Library | Why Not |
|---------|---------|
| Any persistence library (better-sqlite3, level, conf) | Session-scoped state. No persistence needed. |
| Jar metadata extraction (java-parser, @pnpm/java-properties) | Study jars are source jars -- just ZIP files of .java files. Validation is "can node-stream-zip open it and does it contain .java entries." |
| File watcher (chokidar, fs.watch) | Study jars do not change on disk during a session. No need to watch for modifications. |
| UUID / nanoid for jar IDs | User provides the name. Existing `jarIdToDirName` handles sanitization for JDT LS directory names. |
| Path validation library | Node.js `fs.access` + node-stream-zip's open validation is sufficient. |
| Maven/POM parser for study jars | Study jars are user-provided paths, not Maven coordinates. No resolution needed. |

## Version Verification

| Package | Installed | Latest | Status | Confidence |
|---------|-----------|--------|--------|------------|
| node-stream-zip | 1.15.0 | 1.15.0 | Current | HIGH |
| @modelcontextprotocol/sdk | ^1.29.0 | 1.29.x | Current | HIGH |
| zod | ^4.3.6 | 4.x | Current | HIGH |
| picomatch | ^4.0.4 | 4.x | Current | HIGH |

No version bumps or new dependencies needed for v1.1.

## Sources

- [node-stream-zip - GitHub](https://github.com/antelle/node-stream-zip) -- architecture: reads central directory on open, random access by path, never loads full archive into memory
- [node-stream-zip - npm](https://www.npmjs.com/package/node-stream-zip) -- v1.15.0, storeEntries stores metadata not file content
- Codebase analysis: `src/project/jar-reader.ts` -- existing ref-counting handle management already supports dynamic jar sets
- Codebase analysis: `src/project/types.ts` -- `DependencyEntry` and `JarCategory` are the extension points
- Codebase analysis: `src/browsing/source-adapter.ts` -- `createJarAdapter` works for any jar path, no study-jar-specific code needed
- Codebase analysis: `src/jdtls/workspace.ts` -- extraction pattern exists, needs incremental add/remove variants
- Codebase analysis: `src/project/jar-registry.ts` -- filter/match logic extensible via `JarCategory` and special-case IDs
