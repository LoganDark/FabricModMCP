# MinecraftDevMCP

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

### Active

(No active requirements — planning next milestone)

### Out of Scope

- Mixin-specific tooling (injection point analysis, target validation) — get the symbol foundation right first
- Code generation / writing files — this is a read/analysis server, Claude handles code generation itself
- Minecraft runtime interaction (connecting to a running game) — not relevant to the development workflow
- Supporting non-Fabric toolchains (Forge, NeoForge, Quilt) — Fabric + Loom only for now
- Version comparison across MC versions — useful for unmapped sources, deferred
- FQN-based tool input for find_references/find_definition (NAV-01, NAV-02) — scheme defined, acceptance deferred

## Context

- **Shipped:** v1.0 MVP on 2026-04-14 — 5,336 LOC TypeScript, 21 MCP tools, 327 tests
- **Shipped:** v1.1 Study Jars on 2026-04-14 — 6,030 LOC TypeScript, 25 MCP tools, 423 tests (+96 tests, +4 tools)
- **Shipped:** v1.2 Symbol Resolution on 2026-04-14 — 6,863 LOC TypeScript, 22 MCP tools, 526 tests (+103 tests, +1 tool)
- **Tech stack:** TypeScript 5.7+, Node.js 22 LTS, official MCP SDK 1.29.x, Zod 4, node-stream-zip, JDT LS via ts-lsp-client
- **Architecture:** Layered domain → tool pattern. Domain modules handle logic; tool layer wires Zod schemas and MCP registration. Shared abstractions: ProjectStore, JarReader, EntryIndex, SourceAdapter, cascadeRegex, resolveSymbolPosition, dependency-resolver, member-enrichment, member-extractor, symbol-transform
- **Ecosystem:** Fabric mod development uses Gradle with Fabric Loom. Loom's genSources decompiles Minecraft into a sources jar (~6,600 .java files) in `~/.gradle/caches/fabric-loom/minecraftMaven/`
- **JDT LS integration:** Eclipse JDT Language Server provides semantic analysis. Workspace extraction on project load, eager initialization with graceful degradation when Java 21 or JDT LS unavailable. Study jars incrementally synced to workspace.
- **Known tech debt:** 20 pre-existing TypeScript `tsc --noEmit` errors (ToolError/ToolSuccess index signature vs MCP SDK structuredContent). Runtime and tests unaffected. createResolvePackage exported but unused in production (single-EntryIndex API vs multi-jar need).

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
| Study jar `study:` namespace prefix | Collision avoidance with real dependency IDs | ✓ Good — clear separation |
| `#` separator for member FQNs | Javadoc convention (`Class#method()`), familiar to Java developers | ✓ Good — matches existing tooling ecosystem |
| Multi-jar resolvePackage inline | createResolvePackage handles single EntryIndex; tools need all jars | ✓ Good — correct for multi-jar case |
| Shared symbol-transform module | Extracted from list-members to avoid duplication with read_member | ✓ Good — DRY, both tools share transform logic |

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
*Last updated: 2026-04-14 after v1.2 milestone*
