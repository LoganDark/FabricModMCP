# Technology Stack

**Project:** MinecraftDevMCP
**Researched:** 2026-04-12

## Recommended Stack

### Language & Runtime

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| TypeScript | 5.7+ | Primary language | Best MCP SDK maturity (official SDK, v1.29.0). The performance bottleneck is jar I/O and LSP communication, not JSON-RPC parsing -- TypeScript is fast enough for this workload. Rust would add complexity for marginal gain since the heavy lifting is done by JDT LS (a JVM process) anyway. | HIGH |
| Node.js | 22 LTS | Runtime | Required by vscode-languageserver-protocol libs. LTS for stability. | HIGH |

### MCP Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @modelcontextprotocol/sdk | 1.29.x (v1.x line) | MCP server implementation | Official SDK. Full MCP spec compliance. Supports stdio transport (what Claude Code uses). v2 anticipated Q1 2026 but v1.x is production-recommended and will receive patches for 6+ months after v2 ships. Start on v1.x; migrate to v2 when stable. | HIGH |

**Not FastMCP.** FastMCP adds OAuth, HTTP routes, edge deployment -- none of which matter for a local stdio MCP server. The official SDK is lower-level but gives more control and has no unnecessary abstraction. FastMCP's conveniences are for web-facing servers, not development tools.

### Schema Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | 4.x | Tool parameter/return type validation | 14x faster parsing vs v3, 57% smaller core. The MCP TypeScript SDK supports Standard Schema, and Zod v4 implements Standard Schema. Strongly-typed tool interfaces are a core requirement -- Zod provides runtime validation with static type inference. | HIGH |

### Jar/ZIP File Reading

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| node-stream-zip | 1.15.x | Reading .java files from source jars | Reads ZIP central directory on open, then provides random access to individual entries by path (e.g., `zip.entryData('net/minecraft/client/MinecraftClient.java')`). No need to iterate all entries. Memory-efficient: streams entries without loading entire jar into memory. The Minecraft sources jar has ~6,600 files -- central directory indexing means O(1) lookup by class path. | HIGH |

**Why not these alternatives:**

| Library | Why Not |
|---------|---------|
| adm-zip | Loads entire ZIP into memory. A sources jar is ~50-80MB decompressed. Memory budget blown for multi-project support. |
| yauzl | Requires sequential iteration through entries. Cannot access by path directly. Awkward callback-based API. |
| JSZip | Loads entire file into memory, requires iterating all entries. Designed for creation, not efficient reading. |
| unzipit | Optimized for browser/HTTP range requests. node-stream-zip is more natural for local file I/O on Node. |
| unzipper | Good random access via Open.file(), but heavier API surface. node-stream-zip is simpler for read-only jar access. |

### Java Language Server Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Eclipse JDT LS | Latest milestone | Java semantic analysis (find-definition, find-references) | The only mature, standalone Java language server. Runs as a separate JVM process. Communicates via LSP over stdio/socket. Supports headless operation without an IDE. Requires Java 21+ runtime. | HIGH |
| vscode-languageserver-protocol | 3.17.x | LSP client protocol types | Provides TypeScript types for all LSP messages. Used to build a lightweight LSP client that talks to JDT LS. | HIGH |
| ts-lsp-client | 2.x | Standalone LSP client | Minimal-dependency LSP client for Node.js. Unlike vscode-languageclient, does not depend on VS Code internals. Spawns JDT LS as a child process, sends LSP requests, receives responses. | MEDIUM |

**Architecture note:** JDT LS is spawned as a child process per project workspace. The MCP server manages JDT LS lifecycle: start on first semantic query, keep alive for the session, shut down on MCP server exit. JDT LS needs a workspace root and classpath -- we derive these from the Gradle project.

**Alternative considered:** The [LSP4J-MCP](https://github.com/stephanj/LSP4J-MCP) project wraps JDT LS in a Java MCP server. However, this is a separate Java project with its own MCP transport. It's better to own the integration: spawn JDT LS directly from our TypeScript process for tighter lifecycle control, unified error handling, and no extra Java build dependency.

**Fallback for Phase 1:** JDT LS integration is complex (workspace initialization, classpath configuration, project import). Phase 1 should ship regex-based search without JDT LS. JDT LS integration is Phase 2+.

### Gradle Project Parsing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Custom parser (properties + regex) | N/A | Extract Minecraft version, mappings, loader version, Fabric API version | Fabric Loom projects follow a rigid convention: `gradle.properties` contains `minecraft_version`, `yarn_mappings`, `loader_version`, `fabric_api_version` as simple key=value pairs. `build.gradle.kts` references these via `val x: String by project`. No need for Gradle Tooling API -- just parse the properties file. | HIGH |

**Why not Gradle Tooling API:** The Tooling API requires a JVM, executing the actual build scripts, and downloading Gradle wrapper/dependencies. This is a 10-30 second cold start per project. For extracting 4-5 well-known property values from a `.properties` file, it's massive overkill. The properties file is a simple Java Properties format (key=value, one per line).

**What we parse and how:**

```
# gradle.properties -- Java Properties format, trivially parseable
minecraft_version=1.21.11
yarn_mappings=1.21.11+build.4
loader_version=0.18.6
fabric_api_version=0.141.3+1.21.11
```

From these values, we derive:
- **Sources jar path:** `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged/{mc_version}-net.fabricmc.yarn.{yarn_mappings_sanitized}.{yarn_mappings}/{artifact}-sources.jar`
- **Dependency source jars:** Located via Gradle cache at `~/.gradle/caches/modules-2/files-2.1/` using Maven coordinates

**For dependency source jars beyond Minecraft:** Shell out to `gradle dependencies --configuration compileClasspath` to get the full dependency tree, then locate source jars in the Gradle cache. This is a one-time invocation per project, cached in memory.

### Build & Development

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| tsx | 4.x | TypeScript execution | Run .ts files directly without compilation step during development. Fast startup via esbuild. | HIGH |
| tsup | 8.x | Production bundling | Bundles TypeScript to single JS file for distribution. Based on esbuild. Fast. | HIGH |
| vitest | 3.x | Testing | Fast, TypeScript-native test runner. Compatible with Node.js APIs. | HIGH |
| @types/node | 22.x | Node.js type definitions | Match Node.js 22 LTS runtime. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| glob | 11.x | File system globbing | Finding .java files in mod source directories, locating gradle.properties in project trees | HIGH |
| picomatch | 4.x | Fast glob matching | Pattern matching for class/package filtering (include/exclude rules for dependency sources) | HIGH |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Language | TypeScript | Rust | MCP SDK less mature (rmcp 0.16.x, still migrating to 1.x). JDT LS integration from Rust is more complex (no LSP client ecosystem). The performance ceiling is JDT LS and jar I/O, not the MCP server itself. |
| Language | TypeScript | Go | No official MCP SDK. Community SDKs are immature. Go's type system is less expressive for strongly-typed tool interfaces. |
| Language | TypeScript | Java/Kotlin | Would simplify JDT LS integration (use LSP4J directly), but MCP SDK ecosystem is weaker. Also adds JVM startup overhead for the MCP server itself. |
| MCP SDK | Official SDK | FastMCP | FastMCP adds web server features (OAuth, CORS, HTTP routes) irrelevant for local stdio server. Unnecessary abstraction layer. |
| ZIP Library | node-stream-zip | adm-zip | Memory hog -- loads entire jar into memory. Blocks multi-project support. |
| Gradle Parsing | Properties file parser | Gradle Tooling API | 10-30s cold start, requires JVM, massive overkill for reading a .properties file. |
| Java LSP | JDT LS (Phase 2) | None (regex only) | Phase 1 uses cascading regex for search. JDT LS adds semantic find-definition/find-references in Phase 2. This is an additive approach, not a replacement. |

## Runtime Dependencies

```
Java 21+ (for Eclipse JDT LS -- Phase 2 only)
```

JDT LS requires Java 21 at minimum. Since this is a Minecraft mod development tool, users will already have a JDK installed (Fabric Loom requires it). We detect the JDK path from `JAVA_HOME` or the project's `gradle.properties` / Gradle wrapper config.

## Installation

```bash
# Core
npm install @modelcontextprotocol/sdk zod node-stream-zip glob picomatch

# Dev dependencies  
npm install -D typescript tsx tsup vitest @types/node
```

## Project Structure

```
src/
  index.ts              # Entry point, MCP server setup
  server.ts             # MCP server with tool registrations
  tools/                # One file per MCP tool
    browse-source.ts
    search-classes.ts
    find-definition.ts  # Phase 2 (JDT LS)
    find-references.ts  # Phase 2 (JDT LS)
    project-info.ts
    list-packages.ts
  project/
    discovery.ts        # Gradle project detection and parsing
    properties.ts       # gradle.properties parser
    cache-paths.ts      # Loom cache path resolution
  jar/
    reader.ts           # node-stream-zip wrapper, jar indexing
    index.ts            # Central directory caching, entry lookup
  lsp/                  # Phase 2
    client.ts           # JDT LS lifecycle management
    protocol.ts         # LSP request/response helpers
  search/
    regex.ts            # Cascading regex implementation
    name-search.ts      # Class/method/field name search
```

## Key Technical Details

### Jar Reading Strategy

1. On project load, open each source jar with `node-stream-zip` (reads central directory, ~200KB for 6,600 entries)
2. Build an in-memory index: package -> class list, full path -> entry reference
3. On read request, decompress single entry on demand via `zip.entryData(path)`
4. Keep zip handles open for the session (file descriptors are cheap, re-opening is not)
5. For multi-project: separate jar handle sets per project, shared index structure

### Gradle Properties Parsing Strategy

1. Read `gradle.properties` as text, parse as Java Properties format (handle `=`, `:`, whitespace separators, `#` and `!` comments, line continuations with `\`)
2. Extract known keys: `minecraft_version`, `yarn_mappings`, `loader_version`, `fabric_api_version`, `loom_version`
3. Construct Loom cache paths deterministically:
   - Yarn mappings sanitize dots in MC version to underscores for the directory name
   - Path pattern: `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged/{version}-net.fabricmc.yarn.{sanitized}.{yarn_mappings}/`
   - Verify jar exists at computed path; fall back to directory listing if pattern doesn't match

### Multi-Project Support

Each project is an independent context with its own:
- Gradle properties
- Source jar handles (Minecraft + dependencies)
- Mod source directory
- JDT LS workspace (Phase 2)

Projects are registered by path. Tools accept a `projectId` parameter to scope operations.

## Sources

- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk)
- [@modelcontextprotocol/sdk - npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP SDKs - Official Documentation](https://modelcontextprotocol.io/docs/sdk)
- [Eclipse JDT LS - GitHub](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
- [LSP4J-MCP - GitHub](https://github.com/stephanj/LSP4J-MCP) (reference implementation for JDT LS + MCP integration)
- [node-stream-zip - GitHub](https://github.com/antelle/node-stream-zip)
- [Zod v4 - InfoQ](https://www.infoq.com/news/2025/08/zod-v4-available/)
- [Fabric Loom Documentation](https://docs.fabricmc.net/develop/loom/)
- [Gradle Tooling API](https://docs.gradle.org/current/userguide/tooling_api.html)
- [ts-lsp-client - npm](https://www.npmjs.com/package/ts-lsp-client)
- [Rust MCP SDK - GitHub](https://github.com/modelcontextprotocol/rust-sdk)
