# Project Research Summary

**Project:** MinecraftDevMCP
**Domain:** MCP server for Minecraft Fabric mod development (Java source intelligence)
**Researched:** 2026-04-12
**Confidence:** HIGH

## Executive Summary

MinecraftDevMCP is a local MCP server that gives AI coding assistants (Claude Code) structured, searchable access to Minecraft decompiled source, Fabric API source, dependency source, and mod source -- all read directly from jar files without extraction. No existing tool fills this gap: IDE plugins are locked to their IDE, web viewers have no API, and general code indexers have no Minecraft/Fabric awareness. The product targets Fabric mod developers using AI assistants, with a peak-demand use case right now (2026) as the ecosystem transitions from Yarn-mapped obfuscated jars to unobfuscated Mojang names.

The recommended approach is TypeScript with the official MCP SDK over stdio transport, using node-stream-zip for direct jar reading (benchmarked at 72ms for a full 6,622-file scan, <1ms per entry), regex-based gradle.properties parsing for project discovery, and optional Eclipse JDT LS integration for semantic navigation in later phases. The architecture is session-based: named project sessions hold per-project state (Gradle config, jar handles, optional LSP bridge), and every tool call explicitly names its target project. Multi-project support is foundational, not an afterthought -- the porting use case demands it.

The key risks are: (1) stdout pollution corrupting the MCP stdio protocol -- enforce stderr-only logging from line one; (2) Loom cache path assumptions breaking across Loom versions -- always verify paths on disk and provide fallback search; (3) JDT LS startup latency blocking tool calls -- make it optional and lazy, with core browse/search features working without it; and (4) unbounded response sizes degrading Claude's reasoning -- cap results and use a layered API (list/search returns metadata, separate tool reads full source).

## Key Findings

### Recommended Stack

TypeScript 5.7+ on Node.js 22 LTS with the official `@modelcontextprotocol/sdk` (v1.29.x). The performance bottleneck is jar I/O and LSP communication, not the MCP server itself -- TypeScript is fast enough. Zod v4 for tool parameter validation (Standard Schema compatible with the SDK). node-stream-zip for O(1) jar entry lookup by path. Eclipse JDT LS for semantic analysis in later phases.

**Core technologies:**
- **TypeScript + Node.js 22 LTS**: Primary language/runtime -- best MCP SDK maturity, excellent zip library ecosystem
- **@modelcontextprotocol/sdk 1.29.x**: Official MCP server SDK -- stdio transport, full spec compliance, no unnecessary abstraction
- **Zod 4.x**: Schema validation -- 14x faster than v3, Standard Schema support for MCP SDK integration
- **node-stream-zip 1.15.x**: Jar reading -- central directory indexing, O(1) entry lookup, no full-archive memory loading
- **Eclipse JDT LS (Phase 3)**: Semantic Java analysis -- find-definition, find-references via LSP over stdio
- **tsx/tsup/vitest**: Dev tooling -- fast TypeScript execution, bundling, and testing

**Not recommended:** FastMCP (unnecessary web features for local stdio), adm-zip (loads entire jar into memory), Gradle Tooling API for config parsing (10-30s cold start overkill for reading a .properties file).

### Expected Features

**Must have (table stakes):**
- Multi-project support (porting use case requires 2+ projects side-by-side)
- Auto-discover Minecraft sources jar from Gradle/Loom config
- Auto-discover dependency source jars (Fabric API alone is 60+ modules)
- Read source files directly from jars (no extraction)
- Package browsing (hierarchical navigation of ~6,600 classes)
- Class source reading by fully-qualified name
- Name-based search across all sources (MC, deps, mod)
- Project metadata exposure (MC version, mappings, loader, Fabric API version)
- Strongly-typed tool interfaces with rich JSON schemas

**Should have (differentiators):**
- Cascading regex position identification (novel hierarchical "zoom in" approach for AI-friendly symbol location)
- Find definition via cascading regex + LSP
- Find references/usages via cascading regex + LSP
- Version comparison (diff same class across MC versions -- killer feature for porting)
- Source type discrimination (MC core vs. Fabric API vs. library vs. mod source)
- Intelligent result context (include surrounding metadata, not just raw source)
- Mod source integration (search user's own code alongside MC/deps)

**Defer (v2+):**
- Mixin injection point analysis (complex bytecode concern, depends on solid foundation)
- Non-Fabric toolchain support (Forge/NeoForge/Quilt -- multiplies complexity)
- Runtime game interaction (different domain entirely)
- Bytecode analysis (decompiled source is sufficient)

### Architecture Approach

The server is a TypeScript MCP server using stdio transport with named project sessions. Each session holds its own Gradle config, jar handles, and optional JDT LS bridge. Tool handlers are stateless functions that receive a resolved session. Jar handles stay open for the session lifetime with mtime checks for freshness. No search index or persistent cache -- brute-force jar reading is fast enough (empirically validated). JDT LS is lazy-loaded on first semantic query and optional for all non-semantic tools.

**Major components:**
1. **MCP Transport Layer** -- stdio JSON-RPC, tool registration, request routing
2. **Session Manager** -- named project sessions, isolation, lifecycle management
3. **Gradle Parser** -- regex-based gradle.properties extraction, Loom cache path resolution
4. **Jar Registry + Reader** -- jar discovery, central directory caching, on-demand entry decompression
5. **Cascading Regex Engine** -- hierarchical pattern matching for precise symbol location
6. **Tool Handlers** -- stateless functions implementing browse, search, read, find-definition, find-references
7. **JDT LS Bridge** -- optional child process management, LSP JSON-RPC communication

### Critical Pitfalls

1. **Stdout pollution** -- Any stray console.log corrupts the MCP stdio protocol. Enforce stderr-only logging from line one. Consider `process.stdout.write = () => { throw ... }` during development.
2. **Unbounded response sizes** -- Large Minecraft classes (1,000-5,000+ lines) and broad searches blow up Claude's context. Use a layered API: search returns metadata, separate tool reads full source. Cap search results at 20-50.
3. **Loom cache path fragility** -- Path structure changes across Loom versions (-v2 directories, merged vs. client/server splits). Always verify paths exist on disk; fall back to glob search; provide manual override.
4. **JDT LS startup latency** -- 10-60+ seconds to initialize. Must be optional and lazy. Core browse/search tools must work without it. Return "LSP initializing" messages, not hangs.
5. **Decompiled source is not compilable Java** -- Synthetic methods, decompiler artifacts, type erasure issues. Configure JDT LS with relaxed error tolerance. Filter synthetic members in search results.

## Implications for Roadmap

Based on combined research, the following phase structure reflects dependency ordering, risk mitigation, and incremental value delivery.

### Phase 1: Server Skeleton and Jar Reading Foundation
**Rationale:** Everything depends on the MCP transport working correctly and jar reading being performant. These are the lowest-risk, highest-dependency components. Getting stdio protocol handling and jar I/O right from day one prevents costly rework.
**Delivers:** A working MCP server that can register projects, parse gradle.properties, locate source jars, and read individual class files on demand.
**Addresses:** MCP transport, Gradle parsing, jar reading, project metadata exposure, strongly-typed tool interfaces.
**Avoids:** Stdout pollution (enforce stderr-only from line one), jar memory loading (use node-stream-zip with handle pooling), response size explosion (define API contract for response sizes upfront).

### Phase 2: Browse, Search, and Multi-Project
**Rationale:** With jar reading working, the next highest-value features are browsing and searching. These compose Phase 1 components into the session model and deliver the core value proposition -- Claude can explore Minecraft source on demand. Multi-project support must be built here, not retrofitted.
**Delivers:** Package browsing, class source reading, name-based search, multi-project named sessions, mod source integration, source type discrimination.
**Addresses:** Package browsing, class reading, name-based search, multi-project support, auto-discover dependency jars, mod source integration, source type discrimination, intelligent result context.
**Avoids:** Loom cache path assumptions (verify paths on disk, implement fallback), Gradle parsing edge cases (test with multiple real projects, provide manual override).

### Phase 3: Cascading Regex and Version Comparison
**Rationale:** The cascading regex engine is a pure function with no external dependencies -- lower risk than JDT LS integration. Combined with multi-project support from Phase 2, this unlocks version comparison, which is the killer feature for the current Yarn-to-unobfuscated ecosystem transition.
**Delivers:** Cascading regex position identification, version comparison across MC versions, cross-project search.
**Addresses:** Cascading regex, version comparison, multi-version comparison limitations (document name-based limitation).
**Avoids:** Multi-project comparison without stable identifiers (use FQN-based comparison, document limitation, consider intermediary names later).

### Phase 4: Semantic Navigation (JDT LS Integration)
**Rationale:** JDT LS integration is the highest-risk, highest-complexity component. Deferring it to Phase 4 means the entire server is useful and tested before adding this complexity. The cascading regex engine from Phase 3 provides the position resolution that JDT LS needs for go-to-definition.
**Delivers:** Find definition, find references/usages via cascading regex + JDT LS.
**Addresses:** Find definition, find references, semantic Java navigation.
**Avoids:** JDT LS startup latency (lazy initialization, background startup, workspace persistence), decompiled source issues (relaxed error tolerance), monolithic LSP coupling (JDT LS is optional, tools degrade gracefully).

### Phase Ordering Rationale

- **Dependency chain:** Transport -> Jar reading -> Session model -> Browse/Search -> Cascading regex -> JDT LS. Each phase builds on the previous.
- **Risk ordering:** Low-risk foundational components first (jar reading, Gradle parsing), highest-risk component last (JDT LS). If JDT LS integration proves too difficult, Phases 1-3 still deliver substantial value.
- **Value delivery:** Each phase is independently useful. Phase 1+2 alone makes the product worth using. Phase 3 adds the killer porting feature. Phase 4 adds semantic intelligence.
- **Ecosystem timing:** The Yarn-to-unobfuscated transition is happening now. Phases 1-3 should ship as fast as possible to capture the porting use case.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Dependency source jar discovery across diverse Loom versions. The Gradle cache structure (`modules-2/files-2.1/`) for non-Minecraft dependencies needs validation against real projects.
- **Phase 4:** JDT LS integration is the highest-risk component. Needs a dedicated spike to validate: headless startup, Gradle project import with Fabric Loom plugin, decompiled source tolerance, workspace persistence for fast restarts.

Phases with standard patterns (skip research-phase):
- **Phase 1:** MCP SDK stdio server setup, zip file reading, properties file parsing -- all well-documented with official examples.
- **Phase 3:** Cascading regex is a pure algorithmic component. Version comparison is straightforward given multi-project support.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official SDK, empirically benchmarked jar reading, well-established libraries. All choices verified against official docs and npm. |
| Features | HIGH | Feature landscape validated against real ecosystem tools (IntelliJ MinecraftDev, Fabric Loom, mcsrc.dev). Clear gap analysis. Competitive landscape well-mapped. |
| Architecture | HIGH | Core patterns (stdio MCP, jar reading, session management) are standard. Benchmarks validate the "no index needed" decision. Component boundaries are clean. |
| Pitfalls | HIGH | Pitfalls verified against real Loom cache structure, MCP protocol spec, and JDT LS documentation. Concrete prevention strategies with phase mappings. |

**Overall confidence:** HIGH

### Gaps to Address

- **ts-lsp-client maturity:** Recommended for JDT LS communication at MEDIUM confidence. May need to fall back to a custom lightweight LSP client implementation. Validate during Phase 4 planning.
- **Loom 2.0 cache structure:** The unobfuscated era (MC >= 26.1) uses a different Loom version with potentially different cache paths. Test against a real Loom 2.0 project during Phase 2.
- **Dependency source jar completeness:** Not all Maven dependencies publish source jars. Need a strategy for missing sources (graceful "no source available" response, not an error).
- **JDT LS + decompiled source interaction:** Unknown how well JDT LS handles decompiled source with artifacts. Needs hands-on spike before Phase 4 implementation.
- **Intermediary names for cross-version comparison:** Name-based comparison works for most cases but fails when Yarn renames things. Intermediary-based comparison is a potential enhancement but not yet researched.

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- server implementation, tool registration, stdio transport
- [MCP Protocol Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25) -- protocol constraints, pagination, response format
- [Eclipse JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls) -- headless Java language server, Gradle support
- [Fabric Loom Documentation](https://docs.fabricmc.net/develop/loom/) -- cache structure, genSources, project layout
- [Fabric Mappings Wiki](https://wiki.fabricmc.net/tutorial:mappings) -- Yarn/intermediary/Mojang mapping systems
- [Removing Obfuscation from Fabric](https://fabricmc.net/2025/10/31/obfuscation.html) -- ecosystem transition context
- [node-stream-zip](https://github.com/antelle/node-stream-zip) -- jar reading library
- Empirical benchmarks on Minecraft 1.21.11 sources jar (7.8 MB, 6,622 files, 72ms full scan)

### Secondary (MEDIUM confidence)
- [LSP4J-MCP](https://github.com/stephanj/LSP4J-MCP) -- validates JDT LS + MCP integration pattern
- [cclsp](https://github.com/ktnyt/cclsp) -- validates Claude Code + LSP via MCP pattern
- [ts-lsp-client](https://www.npmjs.com/package/ts-lsp-client) -- standalone LSP client for Node.js
- [IntelliJ MCP Server](https://www.jetbrains.com/help/idea/mcp-server.html) -- competitive landscape
- [MinecraftDev IntelliJ Plugin](https://github.com/minecraft-dev/MinecraftDev) -- competitive landscape

### Tertiary (LOW confidence)
- [Zod v4 performance claims](https://www.infoq.com/news/2025/08/zod-v4-available/) -- 14x faster parsing, needs independent verification
- [JDT LS 25-minute startup issue](https://github.com/redhat-developer/vscode-java/issues/4034) -- worst-case latency scenario, may not apply to headless usage

---
*Research completed: 2026-04-12*
*Ready for roadmap: yes*
