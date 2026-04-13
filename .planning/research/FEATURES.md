# Feature Landscape

**Domain:** MCP server for Minecraft Fabric mod development tooling
**Researched:** 2026-04-12

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Multi-project support** | The porting use case (comparing two MC versions side-by-side) is a primary workflow. Every session may involve 2+ projects. | Medium | Must be designed in from day one -- retrofitting multi-project is painful. Each project has its own Gradle config, sources jars, and dependency set. |
| **Auto-discover Minecraft sources jar** | Without this, the user has to manually find and paste a 150-char path from `~/.gradle/caches/fabric-loom/`. Unusable friction. | Medium | Parse `build.gradle.kts` and `gradle.properties` for MC version, Yarn/Mojang mappings version, then resolve the deterministic Loom cache path. Must handle both Yarn-era (<=1.21.11) and unobfuscated-era (>=26.1) jar locations. |
| **Auto-discover dependency source jars** | Fabric API alone is 60+ modules. Without auto-discovery, the user must enumerate every jar. | Medium | Gradle dependency resolution via Loom metadata. Include/exclude filtering is important -- some dependencies are noise. |
| **Read source files from jars** | This is the entire point of the server. If Claude cannot read decompiled Minecraft source, there is no product. | Low | Standard zip/jar reading. No extraction to disk per project requirements. |
| **Package browsing** | Navigating ~6,600 classes requires hierarchical exploration. Users expect `net.minecraft.client` -> list classes, pick one, read it. | Low | List packages at a given depth, list classes in a package. Standard tree navigation. |
| **Class source reading** | Read the full decompiled source of any class by fully-qualified name. | Low | Direct jar entry lookup. Fast path for the most common operation. |
| **Name-based search** | "Find all classes containing 'Creeper'" or "Find methods named 'tick'" across all sources. | Medium | Must search across MC source, mod source, AND dependency sources. Regex support expected. Performance matters with 6,600+ files. |
| **Project metadata exposure** | Claude needs to know: MC version, mappings version, loader version, Fabric API version, mod ID, dependencies. Without this, every conversation starts with "what version are you on?" | Low | Parse `gradle.properties`, `fabric.mod.json`, and `build.gradle.kts`. Return structured data. |
| **Strongly-typed tool interfaces** | MCP protocol supports rich schemas. AI assistants perform dramatically better with precise parameter types, enums, and structured return types vs. free-form strings. | Low | Design-time concern. Every tool gets a proper JSON schema with descriptions. Return types include all useful context (file path, line numbers, package info, etc.). |

## Differentiators

Features that set product apart. Not expected from a basic source browser, but high value for the Minecraft modding AI assistant use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Cascading regex position identification** | Locates a precise symbol position in source without fragile line numbers. Each regex narrows within the previous match. Enables "find the `health` field inside the `LivingEntity` class inside the `damage` method" without knowing any line numbers. | Medium | Novel approach per PROJECT.md. The regex chain is: file-level match -> class-level match -> member-level match -> precise position. Elegant for AI use since Claude naturally describes locations hierarchically. |
| **Find definition (go-to-definition)** | Given a cascading regex identifying a symbol usage, resolve where that symbol is defined. Critical for reverse engineering -- "where is this method actually implemented?" | High | Requires Java semantic understanding (imports, type resolution, inheritance). PROJECT.md acknowledges Java LSP dependency. This is the hardest feature but also one of the most valuable. |
| **Find references/usages** | Given a cascading regex identifying a symbol definition, find all usages across all sources. "What calls `Entity.tick()`?" is a constant question in mod development. | High | Same Java LSP dependency as find-definition. Cross-jar search across MC source + dependencies. |
| **Version comparison** | Compare the same class/method between two MC versions side-by-side. The killer feature for the porting use case -- "how did `MinecraftClient.render()` change between 1.21.11 and 26.1?" | Medium | Leverages multi-project support. Return structured diff or both versions for Claude to compare. Especially valuable during the Yarn -> unobfuscated migration happening right now (2025-2026). |
| **Minecraft-version-aware source resolution** | Automatically handle the Yarn-mapped jars (<=1.21.11) vs. unobfuscated jars (>=26.1) vs. Mojang-mapped jars. Different mapping eras have different jar naming, different cache locations. | Medium | The Fabric ecosystem is in active transition. Supporting both eras seamlessly makes this tool work for porting, which is the primary pain point right now. |
| **Intelligent result context** | When returning search results or source code, include surrounding context: package path, class hierarchy info, imports, method signatures. Give Claude enough to understand without reading the entire file. | Low | Design-time decision. Return more data than strictly requested. Include class FQN, enclosing class, method signature context around matches. |
| **Source type discrimination** | Clearly label whether source comes from: Minecraft core, Fabric API, third-party library, or mod source. Claude needs this context to give appropriate advice. | Low | Track source provenance per jar. Tag every result with its origin. |
| **Mod source integration** | Browse and search the user's own mod source (`src/main/java/`) alongside Minecraft and dependency sources. | Low | Read from filesystem instead of jar. Same search/browse interface. Enables "find all places my mod references this MC method." |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Code generation / file writing** | Claude Code already handles file creation and editing. Duplicating this creates confusion about who writes files. The MCP server is a read/analysis tool. | Return rich analysis data; let Claude synthesize and write code itself. |
| **Mixin injection point analysis (v1)** | PROJECT.md explicitly defers this. The foundation (source browsing, search, navigation) must be solid first. Mixin analysis is complex (bytecode-level injection point validation) and depends on the foundation. | Build the foundation. Mixin tooling is v2. |
| **Runtime game interaction** | Connecting to a running Minecraft instance is a completely different domain (debug protocols, JDWP). Not relevant to the source analysis workflow. | Stay focused on static source analysis. |
| **Non-Fabric toolchain support** | Supporting Forge/NeoForge/Quilt multiplies complexity for mappings, build systems, and jar locations. Fabric + Loom is the target. | Design interfaces that could theoretically support other toolchains later, but implement only Fabric. |
| **Full Java LSP embedding** | Embedding a full Eclipse JDT or similar LSP is enormous complexity. The server should integrate with external LSP infrastructure, not reinvent it. | Use external Java LSP (Eclipse JDT LS, or leverage IntelliJ's MCP server for semantic features). Design the cascading regex system to work independently for basic cases. |
| **Persistent source extraction cache** | PROJECT.md requirement: read directly from jars, no extraction. Caching extracted files creates staleness issues and disk bloat. | Read from jars on demand. Cache jar metadata (package lists, class lists) in memory for performance, but not extracted source files on disk. |
| **GUI or web interface** | This is an MCP server consumed by AI coding assistants. No human UI needed. | Invest in rich tool schemas and documentation instead. The "UI" is Claude's natural language interface. |
| **Bytecode analysis** | Decompiled source is sufficient for the mod development use case. Raw bytecode analysis adds complexity without proportional value for the target user (AI assistant helping a modder). | Work with decompiled .java source only. If bytecode is needed later, it's a v2+ concern. |

## Feature Dependencies

```
Multi-project support ─┬─> Version comparison (requires 2 projects loaded)
                       └─> All features (must work per-project)

Auto-discover MC sources jar ──> Read source from jars ──> Package browsing
                                                       ──> Class source reading
                                                       ──> Name-based search

Auto-discover dependency jars ──> Read source from jars (same)

Project metadata exposure (independent, no deps)

Cascading regex ──> Find definition (regex locates position, LSP resolves)
               ──> Find references (regex locates position, LSP finds usages)

Name-based search (independent once jar reading works)

Mod source integration ──> Name-based search (search mod source too)
                       ──> Find references (find usages in mod source)
```

**Critical path:** Multi-project support -> Auto-discover jars -> Read from jars -> Package browsing + Class reading + Search. Everything else builds on this foundation.

**LSP-dependent features (find-definition, find-references) are the highest complexity and can be deferred** to a later phase without blocking the core value proposition. The cascading regex system, package browsing, class reading, and search provide substantial value on their own.

## MVP Recommendation

**Phase 1 -- Foundation (table stakes, no LSP):**
1. Multi-project support architecture
2. Auto-discover Minecraft sources jar from Gradle/Loom config
3. Auto-discover dependency source jars
4. Read source files from jars (no extraction)
5. Package browsing (list packages, list classes)
6. Class source reading by FQN
7. Project metadata exposure
8. Strongly-typed tool interfaces

**Phase 2 -- Search and Context:**
1. Name-based search across all sources (MC, deps, mod)
2. Mod source integration
3. Source type discrimination (MC vs. Fabric API vs. library vs. mod)
4. Intelligent result context
5. Cascading regex position identification

**Phase 3 -- Navigation and Comparison:**
1. Version comparison (diff same class across projects)
2. Find definition via cascading regex + LSP integration
3. Find references/usages via cascading regex + LSP integration

**Defer:** Mixin-specific tooling, non-Fabric toolchains, bytecode analysis

**Rationale:** Phase 1 delivers immediate value -- Claude can browse and read Minecraft source on demand, which is the core use case. Phase 2 makes search efficient and introduces the novel cascading regex. Phase 3 adds semantic navigation which requires the hardest integration work (Java LSP). Each phase is independently useful.

## Important Context: Ecosystem Transition

The Fabric ecosystem is undergoing its biggest change ever:
- **Minecraft <=1.21.11**: Obfuscated, uses Yarn/Intermediary mappings, sources in Loom cache
- **Minecraft >=26.1**: Unobfuscated, uses Mojang's own names, simpler toolchain (Loom 2.0)
- **Right now (2026)**: Modders are actively porting from Yarn to unobfuscated. This is the peak demand moment for version comparison tooling.

The MCP server must support both eras. This is not optional -- it IS the porting use case.

## Competitive Landscape

| Existing Tool | What It Does | Gap This MCP Server Fills |
|---------------|-------------|--------------------------|
| **IntelliJ MinecraftDev plugin** | Mixin inspections, accessor generation, target reference copying, project creation | Only works inside IntelliJ. AI coding assistants (Claude Code, Cursor) cannot access these features. |
| **IntelliJ MCP server (2025.2+)** | 28 general IDE tools (file search, symbol info, refactoring) | General-purpose. No Minecraft-specific awareness. Cannot browse source jars, doesn't understand Loom/Fabric structure. |
| **Fabric Loom genSources** | Decompiles MC to source jar | Produces the jar but provides no browsing/search API. Only generates; doesn't help consume. |
| **mcsrc.dev** | Web-based MC source viewer | Browser-only. No API. No dependency source. No search across projects. |
| **Code Indexer MCP servers** | General code indexing with tree-sitter | Designed for regular codebases, not jar-packaged decompiled source. No Minecraft/Fabric awareness. |
| **Sourcegraph MCP** | Code search via Sourcegraph API | Requires Sourcegraph instance. Not designed for local jar source browsing. |

**The gap:** No existing tool gives an AI coding assistant structured, searchable, navigable access to Minecraft decompiled source + dependency source + mod source with Fabric-aware project metadata. This MCP server fills that gap entirely.

## Sources

- [IntelliJ MCP Server Documentation](https://www.jetbrains.com/help/idea/mcp-server.html) -- HIGH confidence
- [MinecraftDev IntelliJ Plugin](https://github.com/minecraft-dev/MinecraftDev) -- HIGH confidence
- [MinecraftDev DeepWiki](https://deepwiki.com/minecraft-dev/MinecraftDev) -- HIGH confidence
- [Fabric Loom Documentation](https://docs.fabricmc.net/develop/loom/) -- HIGH confidence
- [Fabric Loom Source Generation](https://deepwiki.com/FabricMC/fabric-loom/6.1-source-generation-tasks) -- HIGH confidence
- [Removing Obfuscation from Fabric](https://fabricmc.net/2025/10/31/obfuscation.html) -- HIGH confidence
- [Fabric for Minecraft 1.21.11](https://fabricmc.net/2025/12/05/12111.html) -- HIGH confidence
- [Fabric Mappings Wiki](https://wiki.fabricmc.net/tutorial:mappings) -- HIGH confidence
- [Code-Index-MCP](https://mcpservers.org/servers/ViperJuice/Code-Index-MCP) -- MEDIUM confidence
- [Sourcegraph MCP Server](https://sourcegraph.com/docs/api/mcp) -- MEDIUM confidence
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) -- HIGH confidence
