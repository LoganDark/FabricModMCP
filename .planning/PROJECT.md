# MinecraftDevMCP

## What This Is

An MCP (Model Context Protocol) server that gives Claude Code deep access to Minecraft mod development internals — decompiled source, dependency source jars, project metadata, and Java symbol navigation. It turns Claude into a reverse engineering partner for Fabric mod development, able to browse and understand Minecraft internals on demand.

## Core Value

Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling it to reverse engineer how things work and help write Mixins and mod logic with accurate, up-to-date knowledge of the actual codebase.

## Requirements

### Validated

- [x] Strongly typed tool interfaces — every MCP tool has precise parameter types and rich return types (Validated in Phase 1: Server Bootstrap)
- [x] Performant and optimized — stderr-only logging, no stdout pollution, structured response envelope (Validated in Phase 1: Server Bootstrap)
- [x] Auto-discover Minecraft sources jar from Gradle/Loom cache by parsing project config (build.gradle.kts, gradle.properties) (Validated in Phase 2: Project Discovery)
- [x] Expose rich, strongly-typed project metadata: Minecraft version, Yarn mappings version, loader version, Fabric API version, mod metadata (Validated in Phase 2: Project Discovery)
- [x] Auto-discover all dependency source jars (Fabric API, libraries, etc.) with include/exclude filtering; Minecraft sources have stable "minecraft" identifier (Validated in Phase 3: Dependency Discovery)
- [x] Read .java files directly from source jars on demand — no extraction, no caching of extracted files (Validated in Phase 3: Dependency Discovery)
- [x] Multi-project support — handle multiple Fabric/Loom Gradle projects simultaneously, explicitly supporting the mod-porting use case (comparing two MC versions side-by-side) (Validated in Phase 4: Multi-Project Sessions)
- [x] Expose structured project metadata via MCP tool — Minecraft version, mappings, mod info, jar inventory with provenance chains (Validated in Phase 5: Project Metadata)

### Active
- [ ] Manual path override for sources jar (fallback when auto-discovery fails)
- [x] Browse decompiled source — list packages, list classes in a package, read full source of a class (Validated in Phase 6: Source Browsing)
- [x] Search by name — find classes by glob pattern across all sources with scoping and pagination (Validated in Phase 7: Search)
- [x] Find definition — given a cascading regex pattern array (each regex narrows within the previous match), locate the definition site in source (Validated in Phase 8: Cascading Regex Engine)
- [ ] Find references/usages — given a cascading regex pattern array to identify a symbol position, find all places that reference it across all sources
- [x] ~~Version comparison~~ — Deferred to v2 (only useful for unmapped sources, not needed for v1)
- [ ] Strongly typed tool interfaces — every MCP tool has precise parameter types and rich return types, erring on the side of providing more information rather than less
- [ ] Performant and optimized — fast jar reading, efficient search, minimal memory footprint

### Out of Scope

- Mixin-specific tooling (injection point analysis, target validation) — v2, get the foundation right first
- Code generation / writing files — this is a read/analysis server, Claude handles code generation itself
- Minecraft runtime interaction (connecting to a running game) — not relevant to the development workflow
- Supporting non-Fabric toolchains (Forge, NeoForge, Quilt) — Fabric + Loom only for now

## Context

- **Ecosystem**: Fabric mod development uses Gradle with the Fabric Loom plugin. Loom's `genSources` task decompiles Minecraft into a sources jar stored in `~/.gradle/caches/fabric-loom/minecraftMaven/`. The jar contains ~6,600 .java files with Yarn-mapped names.
- **Sources jar structure**: Standard jar with Java source files at their package paths (e.g., `net/minecraft/client/MinecraftClient.java`). No special metadata — just decompiled Java source.
- **Example project**: `/Users/LoganDark/Documents/Projects/CreatorCore/Debrand` — a Fabric mod using Loom with `genSources` already run. Sources jar located at `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged/1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/minecraft-merged-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4-sources.jar`.
- **Mod source structure**: Mixin classes use `@Mixin(Target.class)` annotations and reference MC internals by Yarn-mapped names. Mod sources live in `src/main/java/`.
- **Find-by-reference design**: Uses cascading regex — an array of patterns where each pattern searches within the text matched by the previous one. This locates a precise position in a file without fragile line numbers, enabling the Java LSP to then find definitions/usages from that position.
- **Java LSP dependency**: Full find-definition and find-references require a Java language server or similar tooling that understands Java semantics (imports, type resolution, method dispatch). The MCP server needs to integrate with or embed such infrastructure.
- **Porting use case**: A key workflow is having two projects open (old MC version and new MC version) and comparing how the same class/method changed between versions to guide migration of Mixin targets and mod logic.

## Constraints

- **Performance**: Must be fast — reading from jars on every request means jar I/O must be optimized (memory-mapped files, indexed lookups, etc.)
- **No caching of extracted files**: Read directly from jars. Minimize persistent caches.
- **Strongly typed**: All tool interfaces must have precise types. More information is better than less.
- **Extensible architecture**: The infrastructure must support adding more capabilities in the future (Mixin analysis, code generation hints, etc.)
- **Language/framework**: Implementer's choice, but must be performant. The MCP server itself is not a Java project — it's a standalone server.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cascading regex for position identification | Avoids fragile line numbers; each pattern narrows within previous match to locate precise position in source | Validated — Phase 8 |
| Direct jar reading, no extraction cache | User preference for minimal caching; keeps disk usage low and avoids stale cache issues | — Pending |
| Java LSP integration for find-by-reference | Full semantic navigation requires type-aware tooling beyond regex; LSP provides this | — Pending |
| Multi-project from the start | Porting use case requires comparing two MC versions side-by-side | — Pending |

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
*Last updated: 2026-04-13 after Phase 8 completion*
