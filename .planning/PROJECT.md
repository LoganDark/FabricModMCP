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

### Active

#### Study Jar Management
- [ ] Add named source jars to loaded projects for study purposes
- [ ] Remove study jars from projects
- [ ] List study jars with auto-include status
- [ ] Toggle auto-include flag per study jar

#### Tool Integration
- [ ] Study jars selectable via existing `jars` parameter
- [ ] Auto-include study jars appear in default jar set

## Current Milestone: v1.1 Study Jars

**Goal:** Enable adding arbitrary source jars to projects for study, with opt-in inclusion in default tool resolution.

**Target features:**
- Add/remove/list named study jars on loaded projects
- Auto-include flag controlling default jar set membership
- Full integration with existing jar-aware tools

### Out of Scope

- Mixin-specific tooling (injection point analysis, target validation) — v2, get the foundation right first
- Code generation / writing files — this is a read/analysis server, Claude handles code generation itself
- Minecraft runtime interaction (connecting to a running game) — not relevant to the development workflow
- Supporting non-Fabric toolchains (Forge, NeoForge, Quilt) — Fabric + Loom only for now
- Version comparison across MC versions — deferred to v2 (useful for unmapped sources)

## Context

- **Shipped:** v1.0 MVP on 2026-04-14 — 5,336 LOC TypeScript, 21 MCP tools, 327 tests
- **Phase 11 complete:** StudyJar type system, jar handle management (add/remove with ref-counting), cache eviction, domain service module (7 functions), refresh_dependencies wiring — 361 tests
- **Tech stack:** TypeScript 5.7+, Node.js 22 LTS, official MCP SDK 1.29.x, Zod 4, node-stream-zip, JDT LS via ts-lsp-client
- **Architecture:** Layered domain → tool pattern. Domain modules handle logic; tool layer wires Zod schemas and MCP registration. Shared abstractions: ProjectStore, JarReader, EntryIndex, SourceAdapter, cascadeRegex, resolveSymbolPosition
- **Ecosystem:** Fabric mod development uses Gradle with Fabric Loom. Loom's genSources decompiles Minecraft into a sources jar (~6,600 .java files) in `~/.gradle/caches/fabric-loom/minecraftMaven/`
- **JDT LS integration:** Eclipse JDT Language Server provides semantic analysis. Workspace extraction on project load, eager initialization with graceful degradation when Java 21 or JDT LS unavailable
- **Known tech debt:** 5 non-critical items (non-null assertion in resolveSymbolPosition, inconsistent guard pattern in type-hierarchy, redundant casts, unused includeSchema pattern). See v1.0 audit for details.

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
| Domain → tool layered architecture | Domain modules testable independently; tools are thin wiring | ✓ Good — 327 tests, clean separation |

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
*Last updated: 2026-04-14 after Phase 11 completion*
