# Project Research Summary

**Project:** MinecraftDevMCP v1.1 — Study Jar Management
**Domain:** Incremental extension to an existing MCP server for Minecraft mod development
**Researched:** 2026-04-13
**Confidence:** HIGH

## Executive Summary

This feature adds the ability to register arbitrary user-provided source jars ("study jars") as browsable, searchable sources within an existing MCP server. The pattern mirrors how IDEs handle manually-attached source jars: the jar is validated, given a unique identifier, stored per-project, and made available to all existing read tools. The critical design constraint is that the existing `dependencyJars` map (keyed by Maven coordinates, rebuilt from scratch on `refresh_dependencies`) must not be contaminated — study jars live in a parallel `studyJars: Map<string, StudyJar>` field on `LoadedProject` and are merged into tool resolution at query time via a facade pattern.

The recommended implementation sequence is bottom-up: types and domain logic first, then wiring existing tools to see study jars via a unified `getCombinedDependencies()` function, then the four management tools (`add_study_jar`, `remove_study_jar`, `list_study_jars`, `set_study_jar_auto_include`), and finally the JDT LS workspace integration for semantic navigation. The first three phases can be validated independently before touching JDT LS, which is the most complex and least predictable integration point. No new npm dependencies are needed — the existing stack handles all study jar requirements.

The dominant risks are jar handle leaks on removal (no granular remove existed in `JarReader`), stale `EntryIndex` cache entries after removal, and JDT LS workspace desync when study jars are added after project load. All three are prevented with targeted additions to existing infrastructure: a `removeJarFromProject()` method with proper ref-counting, an `evictEntryIndex()` method on the cache, and incremental extraction plus `.classpath` rewrite for JDT LS. The MCP SDK's stdio transport provides natural request serialization that eliminates concurrency risk for the current transport.

## Key Findings

### Recommended Stack

No new dependencies are required. The existing stack handles all study jar needs: `node-stream-zip` 1.15.0 for reading jar entries (each handle is a separate fd with its own central directory index, ~1-3MB of metadata per handle), `zod` 4.x for new tool input schemas, and `picomatch` for jar ID glob matching. The current `JarReader` already manages 10-30 concurrent handles per project; adding 1-5 study jars is negligible relative to existing fd usage (worst case 70 fds against macOS's 256 soft limit). State persistence was evaluated and rejected — study jars are session-scoped, and re-adding via a single tool call per jar is the correct model aligned with how dependency jars work (rediscovered on each `load_project`).

**Core technologies (no change from v1.0):**
- `node-stream-zip` 1.15.0: random-access jar reading — central directory indexed on open, O(1) entry lookup by path, never loads full archive into memory
- `zod` 4.x: new tool input validation — same pattern as existing 21 tools
- `picomatch` 4.x: jar ID filtering — `study:*` glob patterns work against namespaced IDs automatically
- JDT LS (existing): incremental workspace update via `.classpath` rewrite — no restart needed for add/remove

### Expected Features

**Must have (table stakes):**
- Add a study jar by absolute file path with a user-provided name — validates path exists, is a valid ZIP, and has .java entries
- Remove a study jar by name with proper handle ref-count decrement and cache eviction
- List study jars with name, path, and auto-include status
- Browse study jar contents via all existing tools (`list_packages`, `list_classes`, `read_source`, `search_classes`, `locate_in_source`) — zero extra code if the entry exists in the combined jar view
- Explicit selection via `jar`/`jars` parameters including `study:mylib` and `study:*` glob — works automatically via namespaced IDs
- Auto-include flag (default OFF) — controls whether a jar appears in unscoped "all jars" searches; study jars are opt-in extras, not things that should pollute every search
- Toggle auto-include without re-adding
- Survive `refresh_dependencies` — the refresh rebuilds `dependencyJars` from Gradle; study jars in a separate `studyJars` map are unaffected
- Name conflict detection with actionable errors at add time against both dependency jar IDs and existing study jar names

**Should have (differentiators):**
- Auto-name from jar filename stem when no name is provided
- Study jar section in `get_project_metadata` output with auto-include status visible
- LSP semantic navigation (`find_definition`, `find_references`) within study jar sources via JDT LS workspace sync
- Incremental JDT LS classpath update on add/remove (no full restart — 30-120s restart would be unacceptable UX)

**Defer to v2+:**
- Bulk add via glob pattern — user can call `add_study_jar` multiple times instead
- Auto-name from `META-INF/MANIFEST.MF` — filename stem is sufficient for MVP
- Persistence across server restarts — session-scoped is correct for v1.1
- `refresh_study_jar` convenience tool for when a jar's file changes on disk

### Architecture Approach

Study jars extend `LoadedProject` directly via a new `studyJars: Map<string, StudyJar>` field, initialized empty on project load. This keeps study jar lifecycle bound to project lifecycle and avoids a parallel store that would require every tool to query two sources. The critical integration point is `getCombinedDependencies()`, a new wrapper that merges filtered Gradle dependencies with auto-included study jars into a single `Map<string, DependencyEntry>`, replacing direct calls to `getFilteredDependencies()` in tool helpers. Study jars are represented as ephemeral `DependencyEntry` facades with `category: 'study'` and `id: 'study:{name}'`, created at query time rather than stored. Non-auto-included study jars are excluded from the merged default view but reachable via explicit `jars: ["study:mylib"]` parameter matching.

Study jars are stored separately from `dependencyJars` (not merged into it) to avoid contaminating the Gradle dependency model and to survive `refresh_dependencies`. The `'study'` category is assigned the lowest `CATEGORY_PRIORITY` (value 4, after `'library': 3`) so study jars never shadow real dependencies in default resolution. The `study:` ID prefix namespaces study jars away from Maven coordinate IDs.

**Major components:**

1. `src/project/types.ts` — Add `StudyJar` interface, `'study'` to `JarCategory`, `studyJars` field on `LoadedProject`, `autoInclude?: boolean` on `DependencyEntry`
2. `src/project/study-jar.ts` (new) — Domain logic: validate, add, remove, toggle, list, build `DependencyEntry` facade, `getCombinedDependencies()`
3. `src/project/jar-reader.ts` — Add `addProjectJar()` and `removeProjectJar()` with ref-counting extracted to a shared `releaseJarIfUnreferenced()` helper
4. `src/browsing/entry-index-cache.ts` — Add `evictEntryIndex(cacheKey: string)` for cache invalidation on jar removal
5. `src/jdtls/workspace.ts` — Add `extractStudyJarToWorkspace()`, `removeStudyJarFromWorkspace()`, `rewriteClasspath()` for incremental workspace mutation
6. `src/jdtls/uri-mapper.ts` — Rebuild `UriMapper` on study jar add/remove by recreating from updated `JdtLsSession.jarIdToDirName`
7. New tools: `add-study-jar.ts`, `remove-study-jar.ts`, `list-study-jars.ts`, `set-study-jar-auto-include.ts`

### Critical Pitfalls

1. **Jar handle leak on remove** — `JarReader.closeProject()` is the only ref-counting path; individual removes have no equivalent. Add `removeJarFromProject()` that runs the ref-counting check and calls `this.close(jarPath)` when no other project references the path. Extract the shared `releaseJarIfUnreferenced()` helper from the existing loop in `closeProject`.

2. **Stale EntryIndex cache after jar removal** — `entryIndexCache` has no eviction API; only a nuclear `clearEntryIndexCache()`. Add `evictEntryIndex(sourcesJarPath)` and call it on remove. Without this, re-adding a rebuilt jar silently returns stale class lists — wrong results with no error.

3. **JDT LS workspace desync** — `extractSourcesToTemp()` runs once at load time. Study jars added afterward need incremental extraction to a new subdirectory and `.classpath` rewrite. Removal must delete the extracted directory and rewrite `.classpath`. If passive JDT LS detection of the `.classpath` change fails, send `workspace/didChangeWatchedFiles` for the `.classpath` URI as an explicit trigger.

4. **Study jar ID collision with dependency jar IDs** — Maven coordinate IDs (e.g., `com.mojang:authlib`) and simple names (e.g., `minecraft`) could collide with user-provided study jar names. Use a `study:` namespace prefix for all study jar IDs and store them in a separate `studyJars` map rather than in `dependencyJars`. Validate user-provided names at add time against both maps.

5. **Study jars invisible to existing tools** — `filterDependenciesByJarPattern()` and `getFilteredDependencies()` only iterate `dependencyJars`. If every call site is not updated to use `getCombinedDependencies()`, study jars silently appear to do nothing. This is the most likely integration miss; update all direct callers of `getFilteredDependencies()` in the same step.

## Implications for Roadmap

### Phase 1: Types and Domain Logic

**Rationale:** All subsequent phases depend on stable data model contracts and correct infrastructure extensions. Start here so everything is unit-testable in isolation before any MCP tool surface is created. Pitfalls 1, 2, and 4 are prevented by building the right abstractions before any tool touches them.

**Delivers:** `StudyJar` interface, `'study'` `JarCategory`, `studyJars: Map<string, StudyJar>` on `LoadedProject`, `CATEGORY_PRIORITY` updated, `loader.ts` initialization, `addProjectJar()`/`removeProjectJar()` on `JarReader` with proper ref-counting, `evictEntryIndex()` on cache, new `src/project/study-jar.ts` domain module with `getCombinedDependencies()`.

**Addresses:** Data model for all features. Auto-include flag logic. Facade creation (`studyJarToDependencyEntry()`). `refresh_dependencies` survival (separate map, unaffected by refresh). Name collision detection.

**Avoids:** Pitfall 4 (ID collision) by designing `study:` namespace prefix into the type from the start. Pitfall 1 (handle leak) by building `removeJarFromProject()` before the remove tool exists. Pitfall 2 (stale cache) by building `evictEntryIndex()` before the remove tool exists.

### Phase 2: Existing Tool Integration

**Rationale:** Before writing new tools, prove that existing tools automatically see study jars when the data model is correct. Replace `getFilteredDependencies()` calls with `getCombinedDependencies()` across tool helpers and direct callers. This validates the facade pattern with no new tool surface and is the most critical integration point to get right.

**Delivers:** `list_packages`, `list_classes`, `search_classes`, `search`, `locate_in_source`, and `get_project_metadata` all correctly include auto-included study jars and exclude non-auto-included ones. `resolveClassSource` respects `'study'` category priority (lowest — never shadows real dependencies). `get_project_metadata` shows study jars as a distinct section.

**Addresses:** Pitfall 13 (study jars invisible to existing tools) — the most likely integration miss. Pitfall 7 (class shadowing) — `'study'` priority 4 ensures study jars never shadow real dependencies in default resolution.

**Avoids:** Building new tools before proving the data flow integration works end-to-end. Shipping tools that appear to work but silently fail for some callers.

### Phase 3: Study Jar Management Tools

**Rationale:** With the data model and tool integration validated, implement the four management tools as thin wiring over Phase 1 domain logic. Each tool follows the established pattern: `resolveProjectSafely` -> domain call -> structured response. Input validation and error messages reuse existing `DomainError` patterns.

**Delivers:** `add_study_jar`, `remove_study_jar`, `list_study_jars`, `set_study_jar_auto_include` MCP tools. Path validation (exists, absolute, valid ZIP, contains .java files). Auto-name from filename stem when no name provided. Collision detection with actionable error messages. Server instructions and tool descriptions updated.

**Addresses:** All table stakes features. Pitfall 6 (path validation gaps) — validate existence, absoluteness, and ZIP validity before registering. Pitfall 10 (name collision) — validate uniqueness against both maps at add time.

**Avoids:** Pitfall 9 (persistence expectations) — document session-scoped behavior explicitly in tool descriptions so users are not surprised.

### Phase 4: JDT LS Workspace Sync

**Rationale:** The hardest integration point deserves its own phase. Study jars are fully usable for browsing, search, and source reading after Phase 3 — Phase 4 adds semantic navigation (`find_definition`, `find_references`, type hierarchy). Incremental extraction + classpath rewrite is strongly preferred over full JDT LS restart (which takes 30-120 seconds — unacceptable per-operation cost).

**Delivers:** `extractStudyJarToWorkspace()`, `removeStudyJarFromWorkspace()`, `rewriteClasspath()` in `workspace.ts`. `UriMapper` reconstruction on add/remove. JDT LS notification on classpath change. Semantic navigation working for study jar classes. Large jar file-count warning (suggest threshold ~10,000 files).

**Addresses:** Pitfall 3 (JDT LS workspace desync). Pitfall 8 (UriMapper stale after add). LSP semantic navigation differentiator.

**Avoids:** Pitfall 3 mitigation (incremental over restart) — do not restart JDT LS on each add/remove; rewrite `.classpath` and notify instead. Anti-Pattern 3 from ARCHITECTURE.md: never kill and restart JDT LS per operation.

### Phase Ordering Rationale

- Phase 1 before Phase 2: `getCombinedDependencies()` requires `studyJars` field on `LoadedProject` and the facade factory to exist.
- Phase 2 before Phase 3: Validates the core data flow before exposing it via MCP tools. Prevents shipping tools that appear to work but silently fail for some callers.
- Phase 3 before Phase 4: JDT LS sync is high-complexity with uncertain behavior (classpath hot-reload needs empirical testing). Study jars must work for browsing/search first — that is the primary value. LSP navigation is additive.
- Phase 4 is independently deferrable: if JDT LS incremental classpath update proves unreliable, Phase 4 can ship with a "require project reload for LSP navigation" fallback without blocking Phases 1-3.

### Research Flags

Phases needing deeper research during planning:
- **Phase 4:** JDT LS classpath hot-reload behavior is marked MEDIUM confidence. Whether `workspace/didChangeWatchedFiles` (or `workspace/didChangeWorkspaceFolders`) triggers JDT LS re-indexing after `.classpath` rewrite needs empirical validation during implementation — not just spec reading. Design a fallback plan (full project reload) and surface clear failure detection (try `find_definition` on a known study jar class after add).

Phases with standard patterns (skip research-phase):
- **Phase 1:** Fully informed by codebase analysis. TypeScript data model changes follow established patterns in `src/project/types.ts`. Ref-counting logic extension is mechanical.
- **Phase 2:** Well-understood call-site substitution. All callers of `getFilteredDependencies()` are identifiable via static analysis.
- **Phase 3:** New tools follow the exact pattern of existing 21 tools. Input validation reuses established `DomainError` patterns. No novel patterns required.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new dependencies. All assessed against installed package versions and direct codebase analysis. |
| Features | HIGH | Derived entirely from codebase analysis of actual data flows. IDE patterns (IntelliJ, VS Code) confirm user expectations for study jar behavior. |
| Architecture | HIGH | All components analyzed directly from source. Integration points are concrete, not speculative. The DependencyEntry facade pattern is well-motivated by the existing tool pipeline. |
| Pitfalls | HIGH | Every pitfall verified against actual code paths — no theoretical risks. JDT LS classpath hot-reload is the sole MEDIUM-confidence item. |

**Overall confidence:** HIGH

### Gaps to Address

- **JDT LS classpath hot-reload reliability:** Whether `workspace/didChangeWatchedFiles` triggers re-indexing after `.classpath` rewrite is unverified without running JDT LS. Design the Phase 4 implementation to detect failure (try `find_definition` on a known study jar class) and surface a clear error message recommending project reload as fallback.
- **`workspace/didChangeWorkspaceFolders` vs. `workspace/didChangeWatchedFiles`:** PITFALLS.md and ARCHITECTURE.md mention different notifications for triggering JDT LS re-indexing. Phase 4 planning should test both empirically and pick the one JDT LS actually responds to.
- **Study jar file count warning threshold:** PITFALLS.md suggests ~10,000 files as a soft limit for JDT LS memory. This is an estimate — validate against actual JDT LS behavior with large jars during Phase 4 integration testing.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/project/jar-reader.ts` — ref-counting in `closeProject`, handle lifecycle, `getHandle` validation
- Codebase analysis: `src/project/types.ts` — `LoadedProject`, `DependencyEntry`, `JarCategory`, `FilterConfig`
- Codebase analysis: `src/project/jar-registry.ts` — `getFilteredDependencies`, `matchesFilter`, special-case IDs
- Codebase analysis: `src/browsing/entry-index-cache.ts` — global Map cache, `getOrBuildIndex`, no eviction API
- Codebase analysis: `src/browsing/source-adapter.ts` — `createJarAdapter` works for any jar path
- Codebase analysis: `src/tools/tool-helpers.ts` — `CATEGORY_PRIORITY`, `filterDependenciesByJarPattern`, `resolveClassSource`
- Codebase analysis: `src/jdtls/workspace.ts` — one-shot `extractSourcesToTemp`, `.classpath` generation
- Codebase analysis: `src/jdtls/uri-mapper.ts` — immutable `jarIdToDirNameMap` and reverse map in closure
- Codebase analysis: `src/state/project-store.ts` — `generateProjectName` collision avoidance pattern
- [node-stream-zip GitHub](https://github.com/antelle/node-stream-zip) — central directory index behavior, `storeEntries` memory semantics (metadata only, not file content)

### Secondary (MEDIUM confidence)
- [LSP Specification 3.17 — workspace/didChangeWatchedFiles](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_didChangeWatchedFiles) — JDT LS workspace mutation notifications
- [IntelliJ IDEA Libraries Documentation](https://www.jetbrains.com/help/idea/library.html) — IDE pattern for manual source jar attachment
- [VS Code Java Project Management](https://code.visualstudio.com/docs/java/java-project) — `java.project.referencedLibraries` source attachment pattern

---
*Research completed: 2026-04-13*
*Ready for roadmap: yes*
