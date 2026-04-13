# Architecture Patterns

**Domain:** MCP server for Minecraft Fabric mod development (Java source intelligence)
**Researched:** 2026-04-12

## Recommended Architecture

The server is a **TypeScript MCP server using stdio transport** that manages multiple Fabric/Loom project sessions, reads Java source directly from jar files, and optionally delegates to JDTLS for semantic operations.

### High-Level Component Diagram

```
Claude Code
    |
    | (MCP over stdio, JSON-RPC)
    v
+------------------------------------------+
|           MCP Server (TypeScript)         |
|                                          |
|  +----------+  +---------------------+  |
|  | Tool      |  | Session Manager     |  |
|  | Registry  |  | (multi-project)     |  |
|  +----------+  +---------------------+  |
|       |              |                   |
|       v              v                   |
|  +----------+  +---------------------+  |
|  | Tool      |  | Project Session     |  |
|  | Handlers  |  | - Gradle Parser     |  |
|  +----------+  | - Jar Registry       |  |
|       |        | - JDTLS Bridge       |  |
|       |        +---------------------+  |
|       |              |                   |
+-------|--------------|-------------------+
        |              |
        v              v
  +----------+   +-----------+   +----------+
  | Source    |   | Gradle    |   | JDTLS    |
  | Jars     |   | Files     |   | (child   |
  | (on disk)|   | (on disk) |   |  process)|
  +----------+   +-----------+   +----------+
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **MCP Transport Layer** | stdio JSON-RPC, message framing, request routing | Claude Code (external), Tool Registry (internal) |
| **Tool Registry** | Declares tools with typed schemas, dispatches to handlers | MCP Transport, Tool Handlers |
| **Tool Handlers** | Implements each tool's logic, validates input, formats output | Session Manager, Jar Reader, Cascading Regex Engine |
| **Session Manager** | Manages named project sessions, enforces isolation | Tool Handlers, Project Sessions |
| **Project Session** | Holds per-project state: parsed Gradle config, jar paths, JDTLS bridge | Session Manager, Gradle Parser, Jar Registry, JDTLS Bridge |
| **Gradle Parser** | Reads build.gradle.kts + gradle.properties, extracts versions and dependencies | Project Session, filesystem |
| **Jar Registry** | Discovers and manages handles to source jars (MC sources, dependency sources) | Project Session, Jar Reader |
| **Jar Reader** | Opens zip files, reads central directory, extracts individual entries on demand | Jar Registry, Tool Handlers |
| **Cascading Regex Engine** | Takes array of patterns, narrows position through successive matches | Tool Handlers, Jar Reader output |
| **JDTLS Bridge** | Manages JDTLS child process lifecycle, sends/receives LSP JSON-RPC | Project Session, JDTLS process |

## Data Flow

### Flow 1: Browse Source (read a class file)

```
Claude -> MCP: tools/call "read_class" {project: "debrand", class: "net.minecraft.client.MinecraftClient"}
  -> Tool Handler: resolve project session
  -> Jar Registry: find jar containing this class
  -> Jar Reader: open jar, read entry "net/minecraft/client/MinecraftClient.java"
  -> Tool Handler: return source text with metadata (jar name, MC version, etc.)
  -> MCP -> Claude: {content: [{type: "text", text: "...source..."}]}
```

### Flow 2: Search by Name

```
Claude -> MCP: tools/call "search_name" {project: "debrand", pattern: ".*Biome.*", scope: "minecraft"}
  -> Tool Handler: resolve project session
  -> Jar Registry: get MC sources jar
  -> Jar Reader: read central directory, filter entry names by regex
  -> Tool Handler: return matching class/file list
  -> MCP -> Claude: {content: [{type: "text", text: "...results..."}]}
```

### Flow 3: Find Definition (cascading regex + JDTLS)

```
Claude -> MCP: tools/call "find_definition" {
    project: "debrand",
    file: "net.minecraft.client.MinecraftClient",
    patterns: ["class MinecraftClient", "private void tick\\(", "this\\.world\\."]
  }
  -> Cascading Regex Engine:
    1. Read source from jar
    2. Match pattern[0] -> get region
    3. Within region, match pattern[1] -> narrower region
    4. Within region, match pattern[2] -> precise offset
    5. Convert offset to line:column
  -> JDTLS Bridge: textDocument/definition at file:line:column
  -> Tool Handler: return definition location + source snippet
  -> MCP -> Claude
```

### Flow 4: Find References (cascading regex + JDTLS)

```
Same as Flow 3 but uses textDocument/references instead of textDocument/definition.
Returns list of locations across all source files.
```

### Flow 5: Project Metadata

```
Claude -> MCP: tools/call "project_info" {project: "debrand"}
  -> Session Manager: get project session
  -> Gradle Parser: (cached) return parsed config
  -> Tool Handler: return structured metadata
    {minecraft_version, yarn_mappings, loader_version, fabric_api_version,
     mod_group, mod_version, dependencies: [...], sources_jar_path, ...}
  -> MCP -> Claude
```

## Key Architecture Decisions

### 1. TypeScript + Official MCP SDK, stdio Transport

**Decision:** Use the official `@modelcontextprotocol/sdk` TypeScript SDK with stdio transport.

**Rationale:**
- Claude Code launches MCP servers as child processes over stdio. This is the standard local integration pattern.
- TypeScript SDK is the Tier 1 official SDK (66M+ npm downloads). Best documentation, fastest updates.
- Streamable HTTP adds complexity with zero benefit -- this is a local-only, single-client tool.
- TypeScript gives access to excellent zip libraries (node-stream-zip, yauzl) and easy process management for JDTLS.

**Confidence:** HIGH (official docs, standard pattern)

### 2. No Source Index, No Persistent Cache -- Brute-Force Jar Reading

**Decision:** Read directly from jars on every request. No extracted files, no search index, no persistent cache.

**Rationale (empirically validated):**
- The Minecraft sources jar is 7.8 MB compressed, 26.6 MB uncompressed across 6,622 files.
- **Reading the entire jar (all 6,622 files) takes 72ms** on the host machine. Opening + reading central directory takes 10ms. Reading a single file takes <1ms.
- At these speeds, brute-force full-text search across the entire Minecraft source is feasible on every query. There is no performance justification for maintaining a search index.
- The user explicitly wants minimal caching. This aligns perfectly.
- The only state to hold in memory: the zip central directory (the list of file paths and their offsets). This is loaded once when a jar is opened and is tiny (a few hundred KB for 7,000 entries).

**Cache strategy:** Keep zip file handles open (the ZipFile object with its parsed central directory) for the duration of a project session. Re-open only if the file changes (mtime check). This is not "caching extracted files" -- it is just keeping the jar handle open to avoid re-parsing the central directory on every request.

**Confidence:** HIGH (empirically benchmarked on actual Minecraft sources jar)

### 3. Regex-Based Gradle Parsing (Not Gradle Daemon)

**Decision:** Parse build.gradle.kts and gradle.properties with targeted regex/text extraction. Do not invoke Gradle.

**Rationale:**
- Fabric Loom projects follow a highly predictable structure. The key values are:
  - `gradle.properties`: `minecraft_version`, `yarn_mappings`, `loader_version`, `fabric_api_version` (plain key=value)
  - `build.gradle.kts`: `minecraft()`, `mappings()`, `modImplementation()` dependency declarations (predictable Kotlin DSL patterns)
- Invoking Gradle would require a JVM, take seconds to start, and add a massive dependency.
- Regex parsing of these specific patterns is fast, reliable, and covers the actual use case.
- For dependency source jar discovery, we can trace the dependency coordinates to `~/.gradle/caches/modules-2/files-2.1/` where Gradle stores downloaded artifacts, or use `./gradlew dependencies --configuration runtimeClasspath` as a fallback for complex cases.

**Confidence:** MEDIUM -- regex parsing covers standard Fabric Loom projects well, but may break for non-standard configurations. A fallback mechanism (manual path override, or optionally invoking Gradle) should exist.

### 4. JDTLS as Optional Child Process

**Decision:** JDTLS is launched as a child process per project session, communicated with over stdio using LSP JSON-RPC. It is optional -- tools that require it gracefully degrade if unavailable.

**Rationale:**
- JDTLS provides semantic Java understanding (find definition, find references, type resolution) that regex alone cannot deliver.
- JDTLS runs headless, communicates over stdio, and supports Gradle projects natively.
- It needs a workspace directory (distinct from the project directory) and takes several seconds to initialize -- this cost is paid once per project session.
- Making it optional means the server is still useful for browsing/searching without Java installed.
- Existing projects (LSP4J-MCP, cclsp) validate this pattern of wrapping a language server behind MCP tools.

**JDTLS workspace setup:** JDTLS needs to "see" the Minecraft sources jar, dependency jars, and the mod's source files. The Gradle project's existing configuration (via Fabric Loom) already declares these on the classpath, so JDTLS importing the Gradle project should pick them up automatically.

**Confidence:** MEDIUM -- JDTLS integration is the highest-risk component. It may struggle with decompiled source that has minor issues, or with Fabric Loom's custom Gradle plugin. This needs a dedicated research/spike phase.

### 5. Multi-Project via Named Sessions

**Decision:** Projects are identified by a user-chosen name (e.g., "old", "new") and registered explicitly. All tools take a `project` parameter.

**Rationale:**
- The porting use case requires comparing two MC versions side-by-side. Named sessions make this explicit.
- Each session holds its own Gradle config, jar handles, and JDTLS instance.
- No implicit "current project" state -- every tool call specifies which project it refers to.
- Sessions are cheap: a few open file handles + some parsed metadata. JDTLS sessions are heavier but only created when semantic tools are first used.

**Session lifecycle:**
```
register_project {name: "old", path: "/path/to/old-version-mod"}
  -> Parses Gradle config
  -> Opens source jars
  -> (lazily) Starts JDTLS when semantic tools first called

register_project {name: "new", path: "/path/to/new-version-mod"}
  -> Same

unregister_project {name: "old"}
  -> Closes jar handles
  -> Kills JDTLS process
  -> Frees memory
```

**Confidence:** HIGH (straightforward state management pattern)

### 6. Cascading Regex as Position Resolution

**Decision:** The cascading regex engine is a pure function: `(source_text: string, patterns: string[]) -> {offset, line, column, matched_text}`.

**Rationale:**
- Each pattern in the array searches within the region matched by the previous pattern.
- This creates a "zoom in" effect: `class MinecraftClient` -> `private void tick(` -> `this.world.` narrows to a precise offset.
- The engine converts the final offset to line:column for LSP consumption.
- This is more robust than line numbers (which change across MC versions) and more precise than a single regex (which might match multiple locations).

**Implementation detail:** The engine should return the full match chain for debugging: what each pattern matched, the narrowed region at each step, and the final position. This aligns with the "more information is better" principle.

**Confidence:** HIGH (well-defined algorithm, no external dependencies)

## Component Build Order (Dependencies)

The following build order respects component dependencies:

```
Phase 1: Foundation
  |- MCP Transport Layer (stdio, tool registration)
  |- Jar Reader (zip file reading, central directory parsing)
  |- Gradle Parser (regex-based config extraction)
  
Phase 2: Core Intelligence
  |- Session Manager (multi-project, depends on Phase 1)
  |- Jar Registry (jar discovery from Gradle config, depends on Gradle Parser + Jar Reader)
  |- Browse/Search tools (depends on Session Manager + Jar Registry + Jar Reader)

Phase 3: Precision Navigation
  |- Cascading Regex Engine (pure function, could be built earlier but tested here)
  |- JDTLS Bridge (child process management, LSP JSON-RPC, depends on Session Manager)
  |- Find Definition / Find References tools (depends on Cascading Regex + JDTLS Bridge)

Phase 4: Polish
  |- Dependency source jar discovery (extends Jar Registry)
  |- Include/exclude filtering for dependency sources
  |- Mod source reading (reading from project src/main/java/)
  |- Cross-source search (search across MC + deps + mod source)
```

**Build order rationale:**
- Phase 1 components have no internal dependencies. They can be built and tested in isolation.
- Phase 2 composes Phase 1 components into the session model. Browsing/searching is the most immediately useful capability.
- Phase 3 adds the semantic intelligence layer. JDTLS is the highest-risk component and benefits from having the rest of the system working first (easier to test/debug).
- Phase 4 extends reach. Dependency source jars and mod source reading use the same Jar Reader and patterns, just with more discovery logic.

## Patterns to Follow

### Pattern 1: Stateless Tool Handlers with Injected Session

**What:** Each tool handler is a pure function that receives a resolved project session. The tool registry resolves the session from the `project` parameter before dispatching.

**When:** Every tool implementation.

**Example:**
```typescript
// Tool registration
server.tool("read_class", ReadClassSchema, async (params) => {
  const session = sessionManager.get(params.project); // throws if not found
  return readClassHandler(session, params);
});

// Handler is a pure function given a session
async function readClassHandler(
  session: ProjectSession,
  params: { class_name: string }
): Promise<ToolResult> {
  const jarEntry = session.jarRegistry.resolveClass(params.class_name);
  const source = await session.jarReader.readEntry(jarEntry);
  return {
    content: [{ type: "text", text: source }],
    // Rich metadata in structured form
    _meta: { jar: jarEntry.jarPath, version: session.config.minecraftVersion }
  };
}
```

### Pattern 2: Lazy JDTLS Initialization

**What:** Do not start JDTLS when a project is registered. Start it on first use of a semantic tool (find_definition, find_references).

**When:** JDTLS Bridge initialization.

**Why:** JDTLS takes multiple seconds to start and uses significant memory. Many interactions only need browsing/searching.

### Pattern 3: Jar Handle Pool

**What:** Keep a pool of open ZipFile handles keyed by file path. Check mtime before returning a handle (re-open if jar was regenerated by `genSources`).

**When:** Jar Reader operations.

**Why:** Opening a zip file (parsing central directory) takes ~10ms. Keeping the handle open makes subsequent reads <1ms. Mtime check ensures freshness without the complexity of file watchers.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Extracting Jar Contents to Disk

**What:** Unpacking source jars to a temp directory and reading from there.
**Why bad:** Creates 6,600+ temp files, stale cache risk, disk space waste, and it is actually *slower* than reading from the jar (disk I/O for many small files vs. one sequential read).
**Instead:** Read directly from jar. The benchmarks prove this is fast enough.

### Anti-Pattern 2: Building a Search Index

**What:** Creating an inverted index or SQLite database of class names, method signatures, etc.
**Why bad:** Adds complexity, stale cache risk, and startup cost. With 72ms full-jar-read time, brute-force search is fast enough for interactive use.
**Instead:** Brute-force read + regex on every query. Cache nothing beyond the open zip handle.

### Anti-Pattern 3: Implicit Current Project

**What:** Having a "current project" that tools operate on by default.
**Why bad:** Ambiguous in multi-project scenarios. Claude might switch context without realizing it. Makes the porting use case error-prone.
**Instead:** Every tool call explicitly names its project. No default.

### Anti-Pattern 4: Monolithic JDTLS Coupling

**What:** Making every tool depend on JDTLS being available.
**Why bad:** JDTLS adds startup latency, requires Java installed, and is the highest-risk component. If it breaks, everything breaks.
**Instead:** JDTLS is optional. Browse, search, and metadata tools work without it. Only find-definition and find-references require it.

## Scalability Considerations

| Concern | 1 Project (typical) | 2 Projects (porting) | 5+ Projects (unlikely) |
|---------|---------------------|---------------------|----------------------|
| Memory | ~50MB (jar handles + JDTLS) | ~100MB | Consider lazy JDTLS teardown after idle timeout |
| Jar read latency | <1ms single file, 72ms full scan | Same per project | Same per project |
| JDTLS startup | 3-10s first semantic query | 3-10s per project | May want shared JDTLS workspace |
| File handles | ~5 jar handles | ~10 jar handles | OS limits not a concern under 100 |

## Technology-Specific Notes

### node-stream-zip vs yauzl vs unzipit

**Recommendation: node-stream-zip** for the Jar Reader component.

- **node-stream-zip:** Reads central directory on open, supports random access to individual entries by name, never loads entire archive into memory, synchronous entry reading available. This is exactly what we need.
- **yauzl:** Requires sequential iteration through entries even to find one. Poor fit for random access by class name.
- **unzipit:** Designed for browser/web use cases with HTTP range requests. Overkill for local file reading.
- **adm-zip:** Loads entire zip into memory. Wasteful for 7.8MB jars when we usually only need one entry.

### LSP JSON-RPC Communication with JDTLS

JDTLS communicates over stdio using the LSP wire protocol (Content-Length header + JSON-RPC body). The JDTLS Bridge should implement:

1. **Process spawning:** Launch JDTLS with appropriate JVM flags, workspace path, and configuration path.
2. **Message framing:** Parse `Content-Length: N\r\n\r\n{json}` format for both sending and receiving.
3. **Request/response tracking:** LSP uses numeric IDs to match responses to requests. Maintain a pending request map with Promise resolvers.
4. **Initialization handshake:** Send `initialize` with workspace root and capabilities, wait for `initialized` notification, then JDTLS begins importing the project.

Libraries like `vscode-jsonrpc` handle the wire protocol, but a lightweight custom implementation (few hundred lines) avoids pulling in VS Code dependencies.

### Gradle Properties Parsing

`gradle.properties` is a standard Java properties file (key=value, # comments). This is trivially parseable with a few lines of code -- no library needed.

`build.gradle.kts` requires targeted regex for:
- `minecraft("group:artifact:version")` or `minecraft("group:artifact:${variable}")`
- `mappings("group:artifact:version")`
- `modImplementation("group:artifact:version")`
- Plugin declarations: `id("fabric-loom")`
- Loom configuration blocks

Variable references like `${minecraft_version}` resolve against the parsed gradle.properties.

## Sources

- [MCP Architecture Overview](https://modelcontextprotocol.io/docs/learn/architecture) -- official MCP protocol docs
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- official SDK, server implementation docs
- [MCP Transport docs](https://modelcontextprotocol.info/docs/concepts/transports/) -- stdio vs HTTP transport
- [Eclipse JDTLS](https://github.com/eclipse-jdtls/eclipse.jdt.ls) -- Java language server, headless usage
- [JDTLS CLI usage](https://github.com/eclipse-jdtls/eclipse.jdt.ls/wiki/Running-the-JAVA-LS-server-from-the-command-line) -- launching JDTLS from command line
- [LSP4J-MCP](https://github.com/stephanj/LSP4J-MCP) -- existing project wrapping JDTLS behind MCP (Java-based)
- [cclsp](https://github.com/ktnyt/cclsp) -- Claude Code LSP integration via MCP, validates the pattern
- [node-stream-zip](https://github.com/antelle/node-stream-zip) -- fast zip reading for Node.js
- [Fabric Loom docs](https://docs.fabricmc.net/develop/loom/) -- Loom cache structure, genSources
- [Fabric Loom Wiki](https://wiki.fabricmc.net/documentation:fabric_loom) -- cache paths, project structure
- Empirical benchmarks on actual Minecraft 1.21.11 sources jar (7.8 MB, 6,622 .java files)
