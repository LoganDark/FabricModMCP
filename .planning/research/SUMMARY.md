# Project Research Summary

**Project:** FabricModMCP — v1.4 Rearchitecture
**Domain:** MCP server internal rearchitecture — monolithic project model to composable named containers
**Researched:** 2026-04-15
**Confidence:** HIGH

## Executive Summary

The v1.4 milestone is a pure internal rearchitecture: no new libraries required, no new external integrations, no new MCP protocol features. The existing TypeScript/Node.js/Zod/MCP SDK stack is confirmed appropriate and all current package versions remain current. The core change is decomposing `LoadedProject` (one project = one Fabric mod) into `Project` (named container) + `FabricModChild` + `StudyJarChild` children, with dependency IDs namespaced by child name (`my-mod/minecraft` instead of bare `minecraft`). This enables multiple Fabric mods per project without name collisions, while preserving complete backward compatibility for the single-mod case via short-form resolution.

The recommended approach is a strict bottom-up build order across 5 phases: type foundation first, dependency namespacing second, child management tools third, JDT LS workspace unification fourth, and cleanup last. Every phase must be independently shippable with all 592 tests passing. The key design insight is that `getDependenciesForTool` becomes the single choke point for all namespace resolution — tools never directly access children. The adapter/compatibility pattern for `LoadedProject` is critical: remove it only in the final cleanup phase after all consumers are migrated.

The main risk is attempting too much simultaneously. The codebase has 25 tools, 20+ domain modules, and 592 tests all coupled to `LoadedProject`. A big-bang type replacement that touches all of these at once would produce an undebuggable disaster. The mitigation is the compatibility layer: keep `LoadedProject` as an alias or adapter during migration, and migrate tools one-by-one. The second significant risk is the JDT LS workspace for multi-mod projects — when two mods target different Minecraft versions, their classes overlap in the workspace and JDT LS produces incorrect semantic results. This requires a dedicated research spike before Phase 4 implementation, not an assumption that adding more classpath entries handles it.

## Key Findings

### Recommended Stack

No new dependencies are needed for this milestone. The existing stack handles everything: TypeScript 6.0.2 (exceeds 5.7+ requirement), `@modelcontextprotocol/sdk@^1.29.0`, `zod@^4.3.6`, `node-stream-zip@^1.15.0`, `ts-lsp-client@^1.1.1`, `picomatch@^4.0.4`, and `glob@^13.0.6` are all confirmed current and appropriate.

One research question was explicitly investigated and closed: whether JDT LS can operate without extracting sources to a tmpdir (via `textDocument/didOpen` or `kind="lib"` source attachments). Both approaches fail. JDT LS requires files on disk for indexing (confirmed by issue #1815), and source attachments via `kind="lib"` are view-only and not indexed for find-references. Tmpdir extraction remains the correct and only viable approach.

**Core technologies:**
- TypeScript 6.0.2: primary language — type-safe refactor of discriminated union types across all modules
- Zod 4.x: runtime validation — tool schema changes for optional `scope` parameter across all 25 tools
- node-stream-zip: jar reading — unchanged; operates at jar-file level independent of container structure
- ts-lsp-client + JDT LS: semantic analysis — single workspace per project; extraction dirs become namespace-aware (`my-mod__minecraft` from `my-mod/minecraft`)

### Expected Features

The milestone has a well-defined feature set derived from direct codebase analysis, not external research. Priority order is fixed by the dependency chain.

**Must have (table stakes):**
- Project as pure named container (no rootPath) — core milestone goal, enables multi-mod support
- FabricModChild type with its own rootPath, gradleConfig, deps — decouples mod identity from project identity
- Dependency namespacing by mod name (`{mod-name}/{jar-id}`) — prevents collision when multiple mods share dep IDs
- `getDependenciesForTool` rewrite with `scope` parameter — single entry point for all namespace-aware resolution
- Backward-compatible single-mod experience — bare IDs (`minecraft`, `src`) resolve via short-form when one mod loaded
- Default "default" project at startup — eliminates "no project" error for common single-mod case
- `load_project` remains usable (creates project + adds mod in one call) — preserves existing agent workflows

**Should have (differentiators):**
- `add_fabric_mod` tool for adding additional mods to an existing project
- Optional `scope` parameter on all 25 tools for explicit child targeting
- Cross-mod navigation via single JDT LS workspace
- Shared dependency deduplication via JarReader ref-counting (already exists; extend to multi-child)
- Per-mod dep refresh via `refresh_dependencies` with fabric mod child targeting

**Defer to later:**
- Persistence/serialization of project state — projects load fast; stale state bugs outweigh benefit
- Auto-discovery of Fabric mods in multi-mod repos — Gradle multi-project layouts are too varied to handle reliably
- Project/child renaming after creation — unload + reload is sufficient; identity tracking is complex
- Cross-project references between separate ProjectStore entries — load both mods into the same project instead

### Architecture Approach

The architecture decomposes `LoadedProject` into a two-level hierarchy: `Project` (container) holds a `Map<string, ProjectChild>` where children are a discriminated union of `FabricModChild` (kind: 'fabric-mod') and `StudyJarChild` (kind: 'study-jar'). The `ProjectStore` changes from `Map<string, LoadedProject>` to `Map<string, Project>`. Dependency resolution funnels through a single rewritten `getDependenciesForTool(project, scope?, jars?)` that namespaces fabric mod dependencies with their child name and leaves study jar names flat. The JDT LS workspace remains one process per project with all children's sources extracted into namespace-prefixed directories (`my-mod__minecraft/`, `other-mod__minecraft/`).

**Major components:**
1. `project/types.ts` — new `Project`, `ProjectChild`, `FabricModChild`, `StudyJarChild` types (add alongside existing; remove `LoadedProject` only in Phase 5)
2. `project/dependency-resolver.ts` — namespace-aware merging: `getProjectDependencies(project)` prefixes each fabric mod's deps with `{childName}/`
3. `tools/tool-helpers.ts` — `getDependenciesForTool` gains `scope` param; `resolveClassSource` and `processNavigationLocations` use project-level jdtls with namespaced URI mapping
4. `jdtls/uri-mapper.ts` — `jarIdToDirName` handles `/` separator: `my-mod/minecraft` → `my-mod__minecraft`
5. `browsing/source-adapter.ts` — `createSourceAdapter` detects `category === 'mod-source'` (not bare `id === 'src'`) and resolves rootPath from the owning FabricModChild

### Critical Pitfalls

1. **Big-bang type replacement** — replacing `LoadedProject` everywhere at once produces an undebuggable diff with all 592 tests failing simultaneously; keep `LoadedProject` as compatibility alias during migration, migrate tools one-by-one, remove alias only in Phase 5 cleanup

2. **`src` dep ID collision across mods** — when two fabric mods both produce a dep with `id: 'src'`, the second silently shadows the first; fix by using the mod's own name as the source dep ID (`my-mod` instead of `src`) and updating `createSourceAdapter` to check `category === 'mod-source'` instead of `id === 'src'`

3. **JDT LS workspace class duplication** — two mods targeting different MC versions both contribute `net.minecraft.client.MinecraftClient`; JDT LS semantic results become silently incorrect; this REQUIRES a research spike before Phase 4 implementation, not an assumption that adding more classpath entries works

4. **Backward-incompatible tool schemas** — adding a required `child` or `scope` param breaks every existing agent workflow; `scope` must be optional with auto-resolve when exactly one child exists, mirroring the existing `resolveProject` pattern in `project-store.ts` lines 74-113

5. **rootPath removal at 18+ call sites** — `rootPath` moves from project to fabric mod child; create a helper that resolves rootPath given a dep entry's owning child; do NOT make it optional on the project type (TypeScript cannot catch all `!` assertions across 18 sites)

## Implications for Roadmap

Based on research, the dependency chain is strictly ordered: types → namespacing → child tools → JDT LS → cleanup. Each phase must leave all tests passing.

### Phase 1: Type Foundation and ProjectStore

**Rationale:** Everything else depends on the new types existing. The compatibility layer here is what makes incremental migration possible without a big-bang rewrite.
**Delivers:** `Project`, `FabricModChild`, `StudyJarChild` types in `project/types.ts`; `ProjectStore` stores `Project`; `loader.ts` refactored to return `FabricModChild`; default "default" project created on startup; `load_project` kept as a sugar wrapper (creates project + adds fabric mod in one call)
**Addresses:** Project container model, backward compatibility contract, default project at startup (FEATURES.md items 1-3, 8, 10)
**Avoids:** Big-bang type replacement (Pitfall 1) — `LoadedProject` alias preserved throughout this phase

### Phase 2: Dependency Namespacing and Scope

**Rationale:** Namespacing is the core semantic change that unlocks multi-mod correctness. All tool resolution must funnel through the updated `getDependenciesForTool` before child management tools can be built on top.
**Delivers:** Namespace-aware `getProjectDependencies` in `dependency-resolver.ts`; `getDependenciesForTool` with optional `scope` param; updated `uri-mapper.ts` (`/` → `__`); updated `source-adapter.ts` (mod-source category check with explicit rootPath); `resolveClassSource` for namespaced deps; optional `scope` param added to all 25 tool schemas with auto-resolve logic
**Addresses:** Dependency namespacing, `src` ID collision, tool scoping, filterConfig scope rules, short-form backward compat (FEATURES.md items 4-7, backward compatibility contract)
**Avoids:** Namespace collision (Pitfall 3), src abstraction loss (Pitfall 2), getDependenciesForTool shadowing (Pitfall 8), filterConfig ambiguity (Pitfall 9), backward-incompatible schemas (Pitfall 10)

### Phase 3: Child Management Tools

**Rationale:** User-facing API changes come after the internal model is stable. These tools expose the new container model to agents.
**Delivers:** `add_fabric_mod` tool; `create_project` tool; `remove_child` tool; `list_children` tool; study jar tools updated to use `project.children`; `get_project_metadata` shows namespaced dep inventory per child; `refresh_dependencies` targets specific fabric mod child
**Addresses:** Multiple fabric mods per project, tool surface expansion, study jar ownership shift (FEATURES.md: multiple mods, load_project refactor, study jar items)
**Avoids:** load_project semantics shift (Pitfall 14), study jar collision detection with namespaced deps (Pitfall 7), two-level default confusion (Pitfall 13)

### Phase 4: JDT LS Workspace Unification

**Rationale:** JDT LS is the riskiest integration point. This phase must begin with a research spike on whether JDT LS headless mode supports multiple fabric mods sharing one workspace when their classes overlap. Only proceed to implementation after that question is answered.
**Delivers:** Single JDT LS workspace per project with all children's sources in namespaced extraction dirs; `extractSourcesToTemp` iterates all children; incremental sync generalized for any child type (not just study jars); JDT LS init deferred until first child with sources; `processNavigationLocations` uses project-level jdtls with namespaced URI mapping
**Addresses:** Cross-mod navigation, multiple mods in one workspace, URI mapper for namespaced IDs (FEATURES.md: multiple fabric mods per project, cross-mod navigation differentiator)
**Avoids:** Single-workspace class duplication (Pitfall 4), UriMapper breakage with multiple workspaces (Pitfall 15)

### Phase 5: Cleanup and Migration Completion

**Rationale:** Cleanup is always last. Only remove compatibility shims after all consumers are verified working with new types.
**Delivers:** `LoadedProject` alias removed; `load_project` wrapper finalized or removed (decision based on Phase 3 outcome); `project.studyJars` field removed (study jars now in `project.children`); `makeFakeProject` test factory updated to new shape; all 592+ tests passing against new types; all deprecated aliases gone
**Addresses:** Test factory coupling, full migration of all 21 test files referencing the old factory
**Avoids:** Factory coupling cascade failure (Pitfall 6)

### Phase Ordering Rationale

- Types must precede everything because TypeScript will not compile without them. The compatibility alias lets existing tests continue passing while consumers migrate one-by-one.
- Namespacing must precede child management tools because without it, adding a second mod immediately corrupts the flat dependency map.
- Child management tools must precede JDT LS changes because the data model must be stable before reworking the most complex integration.
- JDT LS is explicitly the last feature phase because it is the highest-risk component and benefits from stable types, stable namespacing, and stable tools before being touched.
- Cleanup is last to allow compatibility shims to carry the codebase through the migration without forcing any simultaneous mass change.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 4 (JDT LS workspace unification):** The multi-Eclipse-project-in-one-workspace scenario for mods targeting different MC versions is unvalidated. Must spike whether JDT LS headless mode supports multiple `.project` files in one workspace, and whether class duplication causes incorrect semantic results or explicit errors. If multiple `.project` entries do not work, the fallback is one JDT LS process per fabric mod child (simpler, memory-heavier). Do NOT proceed to Phase 4 implementation without answering this.

Phases with standard patterns (skip research-phase):

- **Phase 1 (Type foundation):** Pure TypeScript type modeling with compatibility alias — well-understood pattern, direct codebase analysis was sufficient
- **Phase 2 (Namespacing):** String prefixing and Map operations — deterministic, no external API uncertainty
- **Phase 3 (Child management tools):** Tool registration via existing MCP SDK patterns — identical to existing tool authoring in the codebase
- **Phase 5 (Cleanup):** Mechanical removal of deprecated aliases and test migration — no design uncertainty

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All existing packages confirmed current; JDT LS in-memory file question definitively closed via issue #1815 and source attachment behavior research |
| Features | HIGH | Derived from direct codebase analysis of v1.3 source; feature set is tightly scoped with no external dependencies on third-party API changes |
| Architecture | HIGH | All findings from direct reading of all modules in `src/project/`, `src/state/`, `src/tools/`, `src/jdtls/`, `src/browsing/` — no inference needed |
| Pitfalls | HIGH | All 15 pitfalls identified from direct code analysis with specific file and line references; no guesswork |

**Overall confidence:** HIGH

### Gaps to Address

- **JDT LS multi-project workspace behavior:** Whether JDT LS in headless mode supports multiple Eclipse `.project` entries within one workspace when mods share class names is unvalidated. The Phase 4 research spike must answer this before implementation begins. If multiple `.project` files do not work, the fallback is one JDT LS process per fabric mod child.

- **`jarReader.registerProject` additive behavior:** The current API registers all jar paths in one shot. Incremental add (mod-a first, then mod-b) needs additive registration without deregistering mod-a's jars. This is a small change but must be explicitly addressed before Phase 4 when multiple adds happen at different times.

- **filterConfig pattern semantics with namespaced IDs:** Whether bare glob patterns like `minecraft` match namespaced IDs like `my-mod/minecraft` must be decided before Phase 2 implementation. Research recommends bare patterns match across all children, namespaced patterns match specific children — but this must be the authoritative rule before any code is written.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `src/project/types.ts`, `src/state/project-store.ts`, `src/project/loader.ts`, `src/project/dependency-resolver.ts`, `src/tools/tool-helpers.ts`, `src/browsing/source-adapter.ts`, `src/project/study-jar.ts`, `src/project/jar-registry.ts`, `src/jdtls/workspace.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/uri-mapper.ts`, `src/jdtls/client.ts`, `tests/helpers/factories.ts` — FabricModMCP v1.3 (592 tests, 25 tools, 7,281 LOC)
- [JDT LS Issue #1815](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1815) — JDT LS requires files on disk for indexing; rules out in-memory file approach
- [Eclipse classpath entry kinds](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.isv/guide/jdt_api_classpath.htm) — kind=src vs kind=lib semantic differences (src is indexed, lib sourcepath is view-only)

### Secondary (MEDIUM confidence)
- [Eclipse .classpath source attachments](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/reference/ref-properties-source-attachment.htm) — sourcepath is view-only, not indexed for find-references
- [JDT LS Issue #657](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/657) — jdt:// URI scheme adds complexity; requires classFileContentsSupport capability
- [JDT LS Discussion #3191](https://github.com/eclipse-jdtls/eclipse.jdt.ls/discussions/3191) — classpath configuration without build tools
- `.planning/PROJECT.md` v1.4 milestone requirements — feature scope and constraints

---
*Research completed: 2026-04-15*
*Ready for roadmap: yes*
