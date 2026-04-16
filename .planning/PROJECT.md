# FabricModMCP

## What This Is

An MCP (Model Context Protocol) server that gives Claude Code deep access to Minecraft mod development internals — decompiled source, dependency source jars, project metadata, and Java symbol navigation. It turns Claude into a reverse engineering partner for Fabric mod development, able to browse and understand Minecraft internals on demand.

## Core Value

Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling it to reverse engineer how things work and help write Mixins and mod logic with accurate, up-to-date knowledge of the actual codebase.

## Requirements

### Validated

- ✓ MCP server runs over stdio with typed Zod tool schemas and structured response envelope — v1.0
- ✓ Stderr-only logging, zero stdout pollution outside JSON-RPC — v1.0
- ✓ Auto-discover Minecraft sources jar from Gradle/Loom cache, supporting both Yarn-mapped and unobfuscated eras — v1.0
- ✓ Auto-discover dependency source jars (Fabric API, libraries) with include/exclude filtering — v1.0
- ✓ Read .java files directly from source jars on demand, no extraction to disk — v1.0
- ✓ Multi-project sessions with named projects, simultaneous loading, listing, unloading — v1.0
- ✓ Rich structured project metadata (versions, mod info, jar inventory with provenance chains) — v1.0
- ✓ Hierarchical source browsing: list packages, list classes, read full source across jars and mod source — v1.0
- ✓ Class search by glob pattern with scoping, pagination, and rich context — v1.0
- ✓ Cascading regex engine: array of patterns that narrow progressively to a precise character position — v1.0
- ✓ Semantic navigation via JDT LS: find-definition, find-references across all sources — v1.0
- ✓ Advanced LSP browsing: list members, hover info, type hierarchy, find implementations, workspace symbol search — v1.0
- ✓ Add/remove/list/configure named study jars on loaded projects — v1.1
- ✓ Study jars selectable via existing `jars` parameter on all jar-aware tools — v1.1
- ✓ Auto-include study jars appear in default jar set when `jars` omitted — v1.1
- ✓ Incremental JDT LS workspace sync for study jars (extraction, classpath, notification) — v1.1
- ✓ search_symbols returns methods and constructors (not just types) via JDT LS includeSourceMethodDeclarations — v1.2
- ✓ Structured member representations with ClassReference types for parameters and return types — v1.2
- ✓ FQN scheme for methods and fields with enriched structured output in list_members and search_symbols — v1.2
- ✓ read_member tool reads individual method/field source by FQN with Javadoc, annotations, and body — v1.2
- ✓ locate_in_source optional context lines parameter extends matches to whole lines with surrounding context — v1.2
- ✓ read_source line-range reading with startLine/lineCount and per-response metadata — v1.3
- ✓ read_member context expansion with linesBefore/linesAfter and member position metadata — v1.3
- ✓ Navigation pagination (limit/offset) on find_references, find_implementations, find_definition — v1.3
- ✓ Compact-by-default output with category-based DETAIL_PARAMS and opt-in detail flags — v1.3
- ✓ Project type hierarchy with FabricModChild and StudyJarChild discriminated union — Validated in Phase 23
- ✓ ~~Compat accessor layer bridging old field access to new child-based structure~~ — Added Phase 23, removed Phase 25.1
- ✓ Default project created at startup — Validated in Phase 23
- ✓ Dependencies namespaced by fabric mod name (e.g., `testmod/minecraft`) — Validated in Phase 24
- ✓ Tools work across whole project or scoped to a single child via `scope` parameter — Validated in Phase 24
- ✓ Multiple fabric mods per project with auto-suffix collision handling — Validated in Phase 25
- ✓ `load_project` adds children to existing projects (defaults to default project) — Validated in Phase 25, replaced by `create_project` + `add_fabric_mod` in Phase 25.1
- ✓ Scoped `refresh_dependencies` targets specific children, unscoped refreshes all — Validated in Phase 25, replaced by `refresh_project` + `refresh_project_members` in Phase 25.1
- ✓ Clean tool separation: project lifecycle, member lifecycle, info/refresh, and browsing tools — Validated in Phase 25.1
- ✓ `activeProject`/`activeChild` naming (renamed from `defaultProject`/`defaultChild`) — Validated in Phase 25.1
- ✓ All compat shims removed, tools use native Project/FabricModChild/StudyJarChild types — Validated in Phase 25.1
- ✓ One JDT LS workspace per project covers all children's sources — Validated in Phase 26
- ✓ Cross-mod navigation works (find-definition from one mod's source into another mod's dependencies) — Validated in Phase 26
- ✓ Namespace-aware extraction directories for JDT LS workspace (e.g., `mymod--minecraft`) — Validated in Phase 26
- ✓ Default project gets JDT LS session at startup when available — v1.4

- ✓ Unified pagination with both limit and hasMore on all paginated tools — v1.5
- ✓ Per-child jar filtering: each mod's own filter applied independently — v1.5
- ✓ Build file re-parsing on refresh with version/ID change warnings — v1.5
- ✓ Accurate tool descriptions with JDT LS requirements per-tool — v1.5
- ✓ Response envelope structure documented in SERVER_INSTRUCTIONS — v1.5
- ✓ Bug fixes: cache eviction, race-safe handles, JDT LS cleanup, cycle detection, inner class read_source, workspace sync rollback — v1.5
- ✓ API consistency: parameter renames, z.enum validation, dead fields removed — v1.5
- ✓ Data exposure: JDT LS status, build deps, jar locations in hierarchy, inner class FQNs — v1.5

### Active

(None — planning next milestone)

### Out of Scope

- Mixin-specific tooling (injection point analysis, target validation) — get the symbol foundation right first
- Code generation / writing files — this is a read/analysis server, Claude handles code generation itself
- Minecraft runtime interaction (connecting to a running game) — not relevant to the development workflow
- Supporting non-Fabric toolchains (Forge, NeoForge, Quilt) — Fabric + Loom only for now
- Version comparison across MC versions — useful for unmapped sources, deferred
- FQN-based tool input for find_references/find_definition (NAV-01, NAV-02) — scheme defined, acceptance deferred
- JDT LS in-memory file support — rejected, JDT LS requires real files on disk (Issue #1815)
- Study jars live at project level, not under fabric mods — already implemented in v1.4, moved from Active

## Current State

**Latest shipped:** v1.5 Quality & Consistency (2026-04-16)
**Next milestone:** TBD — run `/gsd:new-milestone` to plan

## Context

- **Shipped:** v1.0 MVP on 2026-04-14 — 5,336 LOC TypeScript, 21 MCP tools, 327 tests
- **Shipped:** v1.1 Study Jars on 2026-04-14 — 6,030 LOC TypeScript, 25 MCP tools, 423 tests (+96 tests, +4 tools)
- **Shipped:** v1.2 Symbol Resolution on 2026-04-14 — 6,863 LOC TypeScript, 22 MCP tools, 526 tests (+103 tests, +1 tool)
- **Shipped:** v1.3 Context Management on 2026-04-15 — 7,281 LOC TypeScript, 25 MCP tools, 592 tests (+66 tests)
- **Shipped:** v1.4 Project Rearchitecture on 2026-04-15 — 8,250 LOC TypeScript, 28 MCP tools, 665 tests (+73 tests, +3 tools)
- **Shipped:** v1.5 Quality & Consistency on 2026-04-16 — 8,542 LOC TypeScript, 28 MCP tools, 696 tests (+31 tests)
- **Tech stack:** TypeScript 5.7+, Node.js 22 LTS, official MCP SDK 1.29.x, Zod 4, node-stream-zip, JDT LS via ts-lsp-client
- **Architecture:** Layered domain → tool pattern. Domain modules handle logic; tool layer wires Zod schemas and MCP registration. Shared abstractions: ProjectStore, JarReader, EntryIndex, SourceAdapter, cascadeRegex, resolveSymbolPosition, dependency-resolver, member-enrichment, member-extractor, symbol-transform
- **Ecosystem:** Fabric mod development uses Gradle with Fabric Loom. Loom's genSources decompiles Minecraft into a sources jar (~6,600 .java files) in `~/.gradle/caches/fabric-loom/minecraftMaven/`
- **JDT LS integration:** Eclipse JDT Language Server provides semantic analysis. Workspace extraction on project load, eager initialization with graceful degradation when Java 21 or JDT LS unavailable. Study jars incrementally synced to workspace.
- **Known tech debt:** 20 pre-existing TypeScript `tsc --noEmit` errors (ToolError/ToolSuccess index signature vs MCP SDK structuredContent). Runtime and tests unaffected.

## Constraints

- **Performance**: Must be fast — reading from jars on every request means jar I/O must be optimized (memory-mapped files, indexed lookups, etc.)
- **No caching of extracted files**: Read directly from jars. Minimize persistent caches.
- **Strongly typed**: All tool interfaces must have precise types. More information is better than less.
- **Extensible architecture**: The infrastructure must support adding more capabilities in the future (Mixin analysis, code generation hints, etc.)
- **Language/framework**: Implementer's choice, but must be performant. The MCP server itself is not a Java project — it's a standalone server.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + Node.js 22 LTS | Best MCP SDK maturity; bottleneck is jar I/O and JDT LS, not JSON-RPC | ✓ Good — performant, full SDK compliance |
| node-stream-zip for jar reading | Central directory indexing, O(1) lookup by path, no full-memory load | ✓ Good — 72ms full scan of 6,622 files |
| Cascading regex for position identification | Avoids fragile line numbers; patterns narrow progressively | ✓ Good — clean API, works across all sources |
| JDT LS for semantic navigation | Full semantic analysis requires type-aware tooling beyond regex | ✓ Good — find-definition/references/hierarchy all work |
| Direct jar reading, no extraction cache | User preference; keeps disk usage low, avoids stale cache | ✓ Good — node-stream-zip handles this well |
| Multi-project from the start | Porting use case requires comparing two MC versions side-by-side | ✓ Good — shared jar handles with ref counting |
| Dual mapping-era support | MC <=1.21.11 uses Yarn mappings, MC >=26.1 uses unobfuscated names | ✓ Good — both paths work, era auto-detected |
| Domain → tool layered architecture | Domain modules testable independently; tools are thin wiring | ✓ Good — 526 tests, clean separation |
| Two-mode dependency resolver | getResolvedDependencies for defaults, getAllDependencies for explicit selection | ✓ Good — clean study jar integration across all tools |
| Incremental workspace sync | Extract/remove study jars individually, not full rebuild | ✓ Good — fast add/remove, no full project reload |
| Remove readiness probe entirely | Async notification sufficient; probe caused result explosion with method declarations | ✓ Good — simpler, no blocking |
| Study jar plain name IDs (no prefix) | Simpler API; collision detected at add time, auto-unload on refresh | ✓ Good |
| Namespace dep IDs at creation (`modName/depId`) | Resolves ambiguity with multi-mod projects; bare IDs resolve via scope/defaultChild/sole-child inference | ✓ Good — clean API with backward compat for single-mod case |
| Category-based source adapter dispatch | `dep.category === 'mod-source'` instead of `dep.id === 'src'` magic string | ✓ Good — works with any mod name |
| Parameterized filter auto-include | `autoIncludeIds` set replaces hardcoded `'minecraft'`/`'src'` in jar-registry | ✓ Good — per-child filtering |
| load_project adds to existing projects | Defaults to default project; creates new project if name doesn't exist | ✓ Good — natural multi-mod workflow |
| Auto-suffix implicit child name collisions | `mymod-2` when fabric.mod.json id collides; explicit names error instead | ✓ Good — safe for implicit, strict for explicit |
| Per-child jar handle lifecycle | `addProjectJar`/`removeProjectJar` instead of full `registerProject`/`closeProject` | ✓ Good — scoped refresh doesn't disrupt other children |
| `#` separator for member FQNs | Javadoc convention (`Class#method()`), familiar to Java developers | ✓ Good — matches existing tooling ecosystem |
| Multi-jar resolvePackage inline | createResolvePackage handles single EntryIndex; tools need all jars | ✓ Good — correct for multi-jar case |
| Shared symbol-transform module | Extracted from list-members to avoid duplication with read_member | ✓ Good — DRY, both tools share transform logic |
| startLine/lineCount for line-range params | Avoids collision with offset/limit pagination params | ✓ Good — clear separation of concerns |
| Category-based DETAIL_PARAMS | navigation/member/class/locate/source categories, not per-tool schemas | ✓ Good — scales cleanly, consistent API |
| Compact-by-default with opt-in richness | Agents get small responses unless they ask for more | ✓ Good — 66.5% size reduction measured |
| Strip functions via destructuring rest | Clean field removal without explicit delete | ✓ Good — type-safe, readable |
| Clean tool separation (lifecycle/info/browsing) | 5 lifecycle + 6 info/refresh + 17 browsing tools; clear responsibilities | ✓ Good — easy to find the right tool |
| `activeProject`/`activeChild` naming | "active" is clearer than "default" for user-set selection | ✓ Good — no ambiguity with the "default" project name |
| One JDT LS workspace per project | All children's sources in one workspace enables cross-mod navigation | ✓ Good — find-definition works across mod boundaries |
| Default project gets JDT LS at startup | Semantic nav works immediately without explicit create_project | ✓ Good — better first-use experience |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-16 after v1.5 milestone*
