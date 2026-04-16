# Phase 28: Jar & Cache Bug Fixes - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix four independent bugs in the jar reading, cache management, and error reporting subsystems. All fixes are well-defined with clear correct behavior — no ambiguous design choices.

</domain>

<decisions>
## Implementation Decisions

### FIX-01: Cache eviction on remove_project
- `remove_project` must call `evictEntryIndex()` for every jar path belonging to the project before `jarReader.closeProject()` deletes the `projectHandles` entry
- Get jar paths from `jarReader.getProjectJars(projectName)` before calling `closeProject()`
- Iterate and evict each path, plus any `fs:*` cache keys for mod source adapters
- For mod source cache keys: format is `fs:{rootPath}:{depId}` — iterate `project.children` to find fabric mod root paths and mod-source dep IDs

### FIX-03: JarReader.getHandle() race condition
- The race window is between `new StreamZip.async()` and `this.handles.set()` — the `await handle.entries()` yields control
- Fix by storing a Promise in the map immediately (before any await), so concurrent callers await the same Promise
- Pattern: `this.handles.set(jarPath, handlePromise)` then resolve the promise after `entries()` succeeds
- On failure: delete the sentinel from the map so future attempts retry
- Alternative simpler approach: store the handle in the map before `await entries()` validation, and close+delete on failure

### FIX-07: Error message references non-existent listEntries
- Two locations need fixing:
  1. `src/tools/read-jar-entry.ts` line 87: change "use listEntries or browse packages" to "use list_packages and list_classes"
  2. `src/project/jar-reader.ts` line 77: change "use listEntries to see available paths" to "use list_packages and list_classes to browse available paths"

### FIX-08: add_study_jar missing provenance
- `src/tools/add-study-jar.ts` line 39: `makeSuccess({...})` needs second argument
- Add `{ provenance: { tool: 'add_study_jar', project: loadedProject.name } }` to match other tools

### Claude's Discretion
- Exact implementation of the handle race fix (Promise-based vs pre-store approach)
- Whether to add a helper method on JarReader for "get all jar paths for project" or use existing getProjectJars
- Test structure and naming

</decisions>

<specifics>
## Specific Ideas

No specific requirements — all fixes have clear correct behavior defined by the audit.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Cache eviction (FIX-01)
- `src/tools/remove-project.ts` — Current remove_project implementation (missing eviction)
- `src/browsing/entry-index-cache.ts` — `evictEntryIndex()` function and cache structure
- `src/project/jar-reader.ts` — `closeProject()` and `getProjectJars()` methods
- `src/tools/remove-project-member.ts` — Reference implementation that DOES call evictEntryIndex correctly

### Race condition (FIX-03)
- `src/project/jar-reader.ts` — `getHandle()` method at line 103, the race window

### Error messages (FIX-07)
- `src/tools/read-jar-entry.ts` line 87 — "listEntries" reference in tool error
- `src/project/jar-reader.ts` line 77 — "listEntries" reference in jar reader error

### Provenance (FIX-08)
- `src/tools/add-study-jar.ts` line 39 — Missing metadata argument
- `src/tools/add-fabric-mod.ts` — Reference implementation with provenance metadata

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `evictEntryIndex(cacheKey)` in `entry-index-cache.ts`: ready to use, takes a cache key string
- `jarReader.getProjectJars(projectName)`: returns `Set<string>` of jar paths for a project
- `remove-project-member.ts`: already does correct cache eviction — pattern to follow

### Established Patterns
- Cache keys are `dep.sourcesJarPath` for jar deps, `fs:{rootPath}:{id}` for mod source
- `evictEntryIndex` is called per-jar-path, not per-project (no bulk eviction)
- Error messages use `returnError(code, message, tried, suggestions)` consistently

### Integration Points
- `remove_project` calls `jarReader.closeProject()` which deletes the `projectHandles` entry — must get jar paths BEFORE this call
- `getHandle()` is called from `readEntry()` and `listEntries()` — both are called frequently from browsing tools

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 28-jar-and-cache-bug-fixes*
*Context gathered: 2026-04-15*
