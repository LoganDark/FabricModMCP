# Domain Pitfalls

**Domain:** Study jar management for an existing MCP server with multi-project support, shared jar handles, EntryIndex caching, and JDT LS integration
**Researched:** 2026-04-13
**Confidence:** HIGH (all pitfalls verified against actual codebase implementation)

## Critical Pitfalls

Mistakes that cause jar handle leaks, stale state, JDT LS desync, or data corruption.

### Pitfall 1: Jar Handle Leak on Remove

**What goes wrong:** When removing a study jar, the jar path is deleted from `projectHandles` but the underlying `StreamZip.StreamZipAsync` handle in `JarReader.handles` is never closed because the ref-counting loop in `closeProject()` only runs on full project unload, not on individual jar removal.

**Why it happens:** `JarReader` currently has two operations: `registerProject(name, jarPaths)` (bulk) and `closeProject(name)` (bulk). There is no `removeJarFromProject(project, jarPath)` operation. Adding study jars means you need granular add/remove, but the ref-counting logic lives inside `closeProject` which tears down the entire project's jar set.

**Consequences:** File descriptor leak. Over many add/remove cycles, the process accumulates open file handles. On macOS the default ulimit is 256, meaning ~250 add/remove cycles without corresponding closes could exhaust file descriptors and crash the server.

**Prevention:** Add a `removeJarFromProject(projectName: string, jarPath: string)` method to `JarReader` that:
1. Removes the path from `projectHandles.get(projectName)`
2. Checks all other projects' `projectHandles` sets for the same path
3. If no other project references it, calls `this.close(jarPath)`

The ref-counting logic already exists in `closeProject` -- extract it into a shared `releaseJarIfUnreferenced(jarPath, excludeProject?)` helper.

**Detection:** Monitor `handles.size` over time. If it only grows, handles are leaking. Add a `getOpenHandleCount()` diagnostic method.

### Pitfall 2: EntryIndex Cache Stale After Jar Removal

**What goes wrong:** `entryIndexCache` (a global `Map<string, EntryIndex>`) is keyed by `sourcesJarPath`. When a study jar is removed, its EntryIndex stays in the cache. If a different jar with the same path is later added (e.g., user rebuilds the jar and re-adds it), the stale cached index is returned instead of rebuilding from the new jar contents.

**Why it happens:** `entryIndexCache` has `getOrBuildIndex()` and `clearEntryIndexCache()` (nuclear clear) but no `evictEntry(cacheKey)`. Nothing evicts individual entries.

**Consequences:** Browsing/search returns classes that no longer exist in the jar, or misses new classes that were added. Silent data corruption -- no error, just wrong results.

**Prevention:** Add `evictEntryIndex(cacheKey: string)` to `entry-index-cache.ts`. Call it when removing a study jar. The cache key is `sourcesJarPath` (the jar's absolute path on disk).

**Detection:** Compare `entryIndex.getAllClasses().length` against `jarReader.listEntries(path).filter(e => e.endsWith('.java')).length`. If they differ, the index is stale.

### Pitfall 3: JDT LS Workspace Desync

**What goes wrong:** JDT LS receives source files via extraction to a temp directory at project load time (`extractSourcesToTemp` in `workspace.ts`). When a study jar is added after load, its sources exist in the jar but not in the JDT LS workspace. Find-definition, find-references, and type-hierarchy silently skip study jar classes. Conversely, removing a study jar leaves orphaned extracted files that JDT LS still indexes.

**Why it happens:** `extractSourcesToTemp()` runs once during `load_project`. The `.classpath` file is written once. JDT LS has no re-extraction trigger without restart or workspace folder change notifications.

**Consequences:** Semantic navigation (find-definition, find-references, type-hierarchy, find-implementations) does not cover study jar classes. Users get incomplete results with no indication that study jars are excluded from semantic analysis.

**Prevention:** Two viable approaches, in order of preference:

1. **Incremental extraction + workspace update:** When adding a study jar, extract its `.java` files to the existing temp directory under a new subdirectory. Update `.classpath` to add the new source root. Send `workspace/didChangeWorkspaceFolders` notification to JDT LS. On removal, delete the subdirectory and update `.classpath`. JDT LS supports this capability.

2. **Full workspace rebuild:** Tear down the JDT LS session entirely (shutdown, cleanup temp dir) and re-extract from all current jars including study jars. Simpler but slower (~5-15 seconds for a full re-init).

Approach 1 is strongly preferred -- it avoids the re-indexing cost of a full restart.

**Detection:** After adding a study jar, try `find-definition` on a class known to be in that jar. If it fails, JDT LS is desynced.

### Pitfall 4: Study Jar ID Collides With Dependency Jar ID

**What goes wrong:** User adds a study jar and the system assigns it an ID (e.g., based on filename or Maven coordinates) that matches an existing dependency jar ID in `dependencyJars`. The Map overwrites the existing entry, or the study jar is silently ignored because the key already exists.

**Why it happens:** Dependency jar IDs are Maven coordinates (e.g., `com.mojang:authlib`). If a study jar happens to be a different version of the same library, the natural ID generation would produce the same key. Even simpler: user adds a Minecraft sources jar for a different version -- its natural ID would be `minecraft`, colliding with the project's own Minecraft jar.

**Consequences:** Either the dependency jar is replaced (breaking dependency resolution for tools that rely on it) or the study jar silently fails to register. Both are wrong.

**Prevention:**
- Study jars MUST use a separate storage from `dependencyJars`. Either a `study:` prefix namespace or a separate `studyJars` map on `LoadedProject`.
- A separate map is cleaner -- it avoids contaminating the dependency graph. But requires updating every tool that iterates `dependencyJars` to also iterate study jars when appropriate.
- The `jars` parameter on tools already uses picomatch glob patterns. Study jar IDs with a `study:` prefix would naturally be filterable: `jars: ["study:*"]`.
- Validate user-provided names against existing dependency IDs at add time. Reject collisions with a clear error.

**Detection:** At add time, check both `dependencyJars.has(proposedId)` and existing study jar names.

### Pitfall 5: Concurrent Tool Access During Add/Remove

**What goes wrong:** A tool call (e.g., `search_classes`) is iterating over jars or reading from a jar via `JarReader` while another request adds or removes a study jar. The jar handle could be closed mid-read, the jar collection could be mutated during iteration, or the EntryIndex could be evicted while being used.

**Why it happens:** Node.js is single-threaded but `async` operations yield control. Between two `await`s in a search operation, an add/remove request can interleave and mutate shared state.

**Consequences:** Unhandled exceptions from node-stream-zip if the handle was closed mid-read, inconsistent search results, or stale EntryIndex references.

**Prevention:**
- The MCP SDK over stdio transport processes requests sequentially through a single JSON-RPC stream. This means tool calls cannot truly interleave -- one must complete before the next starts its handler. This gives natural mutual exclusion for the stdio transport.
- However, within a single tool handler, multiple `await` points exist (e.g., `Promise.all` in `searchClasses` reads from multiple jars concurrently). If a study jar operation runs as a separate tool call, stdio serialization prevents interleaving. The risk is only if add/remove is triggered from within another operation (which the current design does not do).
- Never close a jar handle that might be in use. The ref-counting pattern in `JarReader` already handles this for project-level operations. Extend it to study jar operations.
- If future transports (HTTP/SSE) allow concurrent requests, add a read-write lock around jar state mutations.

**Detection:** Wrap `StreamZip.StreamZipAsync` operations in try/catch. If `entryData` throws after a handle was closed, log a concurrency warning.

## Moderate Pitfalls

### Pitfall 6: File Path Validation Gaps

**What goes wrong:** User provides a path to a file that does not exist, is not a valid ZIP/JAR, or contains no `.java` source files. The system either crashes on open or silently adds an empty jar that clutters results.

**Prevention:**
- Validate in this order: (1) file exists (`fs.access`), (2) file is a valid ZIP (attempt `new StreamZip.async()` and call `.entries()`), (3) jar contains at least one `.java` file.
- `JarReader.getHandle()` already validates (1) and (2) by calling `await handle.entries()` and throwing `JAR_OPEN_FAILED` on failure. Reuse this -- attempt to open the jar via `JarReader` before registering it as a study jar.
- For (3), decide on policy: warn but allow (some jars have only `.class` files), or reject. Recommendation: warn but allow, since the user explicitly chose to add it.
- Validate that the path is absolute. Relative paths are fragile.

### Pitfall 7: Auto-Include Flag Ambiguity With Overlapping Classes

**What goes wrong:** A study jar with `autoInclude: true` contains classes that also exist in a dependency jar (e.g., user adds an older version of Minecraft's sources jar for comparison). Tools that search "all jars" now find duplicate classes. The deduplication in `searchClasses` merges them into one result with multiple jar provenances, but `resolveClassSource` returns the first match by priority order. The user cannot predict which version they get.

**Why it happens:** The priority system (`CATEGORY_PRIORITY`) has four categories: `minecraft`, `mod-source`, `fabric-api`, `library`. There is no category for study jars. Study jars have no defined priority relative to existing categories.

**Consequences:** Confusing results. User adds a study jar to compare versions but reads source from the wrong one because priority order picked the dependency jar first. Or worse: auto-included study jars shadow dependency classes.

**Prevention:**
- Assign study jars a new `JarCategory` (e.g., `'study'`) with the lowest priority (after `'library'`, priority value 4). This means study jars never shadow real dependencies in default resolution.
- When the user explicitly specifies a study jar via the `jars` parameter, bypass priority and read from that specific jar. This already works via the `jar` parameter on `resolveClassSource`.
- Document clearly: auto-include means "include in search/browse results" not "override dependency jars." Study jars are additive, not replacement.
- In search results, surface the jar category so users can distinguish when a class appears in both a dependency and a study jar.

### Pitfall 8: UriMapper Not Updated for Study Jars

**What goes wrong:** `UriMapper` is constructed once during JDT LS init with a fixed `jarIdToDirNameMap` (see `createUriMapper` in `uri-mapper.ts`). When a study jar is added and its sources extracted to the temp directory, the new directory name is not in the mapper. JDT LS may resolve definitions to files in the study jar's extraction directory, but `fromFileUri` returns `null` because the directory name is not in `dirNameToJarIdMap`.

**Prevention:** `UriMapper` must be updatable. Either:
- Make `jarIdToDirNameMap` and the reverse `dirNameToJarIdMap` mutable, with `addMapping(jarId, dirName)` / `removeMapping(jarId)` methods.
- Or reconstruct the mapper on each add/remove (cheap -- it is just two Maps from `JdtLsSession.jarIdToDirName`).

The second approach is simpler since `createUriMapper` is a factory function, not a class with accumulated state. Just recreate it.

### Pitfall 9: Study Jar Persistence Expectations

**What goes wrong:** User adds study jars, unloads the project, reloads it, and expects study jars to still be there. They are not -- study jars were in-memory state only.

**Prevention:** Decide up front: study jars are session-scoped (lost on unload/restart) or persistent (saved to a config file).

Recommendation: session-scoped for v1.1. Persistence adds config file management, path validation on reload (jar might have been deleted), and versioning concerns. Document explicitly that study jars are session-scoped. If persistence is desired later, store in a `.mcp-study-jars.json` in the project root.

### Pitfall 10: Jar Name Uniqueness Within a Project

**What goes wrong:** User adds two study jars with the same name (either explicitly or via auto-naming from filename). The second silently overwrites the first, or the system throws a confusing error.

**Prevention:**
- Auto-generate names from the jar filename (without extension), like `ProjectStore.generateProjectName` does for projects.
- Allow user-provided names but validate uniqueness against both existing study jar names AND dependency jar IDs (if using a shared namespace).
- Use the same collision-avoidance pattern: `basename`, then `basename-1`, `basename-2`, etc.

## Minor Pitfalls

### Pitfall 11: Large Study Jars Blow JDT LS Memory

**What goes wrong:** User adds a massive study jar (e.g., the full JDK sources, ~30,000 files). Extracting to temp disk and having JDT LS index it causes significant memory pressure and long indexing times.

**Prevention:** Log the file count when adding a study jar. Consider warning when a jar exceeds a threshold (e.g., 10,000 files). Do not block -- the user may genuinely want it.

### Pitfall 12: Jar File Changes on Disk After Add

**What goes wrong:** User adds a study jar, then rebuilds the jar externally. The `StreamZip.StreamZipAsync` handle was opened on the old file. node-stream-zip reads the central directory on open, so subsequent reads use stale metadata. Results may be corrupted or throw.

**Prevention:** This is a known limitation of the architecture. Document it: if a study jar's file changes on disk, remove and re-add it. Consider a `refresh_study_jar` convenience tool.

### Pitfall 13: filterDependenciesByJarPattern Misses Study Jars

**What goes wrong:** `filterDependenciesByJarPattern` (used by `list-packages`, `list-classes`, and `search`) only iterates the `filtered` Map derived from `dependencyJars`. If study jars live in a separate map, they are silently excluded from all browsing and search operations unless every call site is updated.

**Prevention:** Create a unified jar resolution function that merges `dependencyJars` and `studyJars` into a single iteration target. All tool helpers should use this merged view rather than accessing `dependencyJars` directly. This is the most important integration point -- if missed, study jars appear to "not work" in most tools.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Data model (LoadedProject changes) | Pitfall 4: ID collision with dependency jars | Use `study:` prefix or separate map from the start |
| Data model (JarCategory) | Pitfall 7: No priority for study jars | Add `'study'` category with lowest priority immediately |
| JarReader integration | Pitfall 1: Handle leak on remove | Add `removeJarFromProject()` with ref-counting before implementing remove tool |
| EntryIndex integration | Pitfall 2: Stale cache after removal | Add `evictEntryIndex()` before implementing remove tool |
| JDT LS integration | Pitfall 3: Workspace desync, Pitfall 8: UriMapper stale | Implement incremental extraction + workspace update; recreate UriMapper on change |
| Auto-include flag | Pitfall 7: Class shadowing ambiguity | Define priority for study category; document additive semantics |
| Tool wiring | Pitfall 13: Study jars invisible to existing tools | Create merged jar view function; update all tool helpers |
| Tool wiring | Pitfall 5: Concurrency during add/remove | Verify MCP SDK stdio serialization; add guards if concurrent transport used |
| Input validation | Pitfall 6: Invalid paths/jars | Validate existence, ZIP validity, and absoluteness before registering |
| Naming | Pitfall 10: Name collisions | Reuse ProjectStore naming pattern with collision avoidance |

## Sources

- Codebase analysis: `src/project/jar-reader.ts` -- ref-counting in `closeProject`, handle lifecycle, `getHandle` validation
- Codebase analysis: `src/browsing/entry-index-cache.ts` -- global Map cache, `getOrBuildIndex` keyed by jar path, no eviction API
- Codebase analysis: `src/jdtls/workspace.ts` -- one-shot `extractSourcesToTemp`, `.classpath` generation
- Codebase analysis: `src/jdtls/uri-mapper.ts` -- immutable `jarIdToDirNameMap` and reverse map in closure
- Codebase analysis: `src/jdtls/types.ts` -- `JdtLsSession` fields, `jarIdToDirName` Map
- Codebase analysis: `src/tools/tool-helpers.ts` -- `resolveClassSource` priority-based resolution, `filterDependenciesByJarPattern`, `CATEGORY_PRIORITY`
- Codebase analysis: `src/browsing/search.ts` -- `searchClasses` jar iteration, deduplication, `createSourceAdapter` usage
- Codebase analysis: `src/tools/load-project.ts` -- jar registration flow, JDT LS init sequence
- Codebase analysis: `src/tools/unload-project.ts` -- cleanup flow: JDT LS shutdown, temp dir cleanup, `closeProject`
- Codebase analysis: `src/project/types.ts` -- `LoadedProject` fields, `DependencyEntry`, `JarCategory` enum, `FilterConfig`
- Codebase analysis: `src/state/project-store.ts` -- `generateProjectName` collision avoidance pattern
- node-stream-zip behavior: central directory read on open, handle invalidation on close
- Eclipse JDT LS: `workspace/didChangeWorkspaceFolders` capability for dynamic source root management
