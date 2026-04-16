<!-- GSD:project-start source:PROJECT.md -->
## Project

**MinecraftDevMCP**

An MCP (Model Context Protocol) server that gives Claude Code deep access to Minecraft mod development internals — decompiled source, dependency source jars, project metadata, and Java symbol navigation. It turns Claude into a reverse engineering partner for Fabric mod development, able to browse and understand Minecraft internals on demand.

**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling it to reverse engineer how things work and help write Mixins and mod logic with accurate, up-to-date knowledge of the actual codebase.

### Constraints

- **Performance**: Must be fast — reading from jars on every request means jar I/O must be optimized (memory-mapped files, indexed lookups, etc.)
- **No caching of extracted files**: Read directly from jars. Minimize persistent caches.
- **Strongly typed**: All tool interfaces must have precise types. More information is better than less.
- **Extensible architecture**: The infrastructure must support adding more capabilities in the future (Mixin analysis, code generation hints, etc.)
- **Language/framework**: Implementer's choice, but must be performant. The MCP server itself is not a Java project — it's a standalone server.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Language & Runtime
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| TypeScript | 5.7+ | Primary language | Best MCP SDK maturity (official SDK, v1.29.0). The performance bottleneck is jar I/O and LSP communication, not JSON-RPC parsing -- TypeScript is fast enough for this workload. Rust would add complexity for marginal gain since the heavy lifting is done by JDT LS (a JVM process) anyway. | HIGH |
| Node.js | 22 LTS | Runtime | Required by vscode-languageserver-protocol libs. LTS for stability. | HIGH |
### MCP Framework
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @modelcontextprotocol/sdk | 1.29.x (v1.x line) | MCP server implementation | Official SDK. Full MCP spec compliance. Supports stdio transport (what Claude Code uses). Production-ready v1.x line. | HIGH |
### Schema Validation
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | 4.x | Tool parameter/return type validation | 14x faster parsing vs v3, 57% smaller core. The MCP TypeScript SDK supports Standard Schema, and Zod v4 implements Standard Schema. Strongly-typed tool interfaces are a core requirement -- Zod provides runtime validation with static type inference. | HIGH |
### Jar/ZIP File Reading
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| node-stream-zip | 1.15.x | Reading .java files from source jars | Reads ZIP central directory on open, then provides random access to individual entries by path (e.g., `zip.entryData('net/minecraft/client/MinecraftClient.java')`). No need to iterate all entries. Memory-efficient: streams entries without loading entire jar into memory. The Minecraft sources jar has ~6,600 files -- central directory indexing means O(1) lookup by class path. | HIGH |
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
| ts-lsp-client | 2.x | Standalone LSP client | Minimal-dependency LSP client for Node.js. Unlike vscode-languageclient, does not depend on VS Code internals. Spawns JDT LS as a child process, sends LSP requests, receives responses. | HIGH |
### Gradle Project Parsing
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Custom parser (properties + regex) | N/A | Extract Minecraft version, mappings, loader version, Fabric API version | Fabric Loom projects follow a rigid convention: `gradle.properties` contains `minecraft_version`, `yarn_mappings`, `loader_version`, `fabric_api_version` as simple key=value pairs. `build.gradle.kts` references these via `val x: String by project`. No need for Gradle Tooling API -- just parse the properties file. | HIGH |
# gradle.properties -- Java Properties format, trivially parseable
- **Sources jar path:** `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged/{mc_version}-net.fabricmc.yarn.{yarn_mappings_sanitized}.{yarn_mappings}/{artifact}-sources.jar`
- **Dependency source jars:** Located via Gradle cache at `~/.gradle/caches/modules-2/files-2.1/` using Maven coordinates
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
| Java LSP | JDT LS | None (regex only) | Cascading regex provides text-based search. JDT LS adds semantic navigation (find-definition, find-references, type hierarchy). Both are used — additive, not replacement. |
## Runtime Dependencies

| Package | Purpose |
|---------|---------|
| @modelcontextprotocol/sdk | MCP server implementation and stdio transport |
| glob | File system globbing for finding .java files and gradle.properties |
| node-stream-zip | O(1) random access reading of .java files from source jars |
| picomatch | Fast glob pattern matching for class/package filtering |
| ts-lsp-client | Standalone LSP client for communicating with JDT LS |
| zod | Runtime schema validation with static type inference for tool parameters |

## Installation

```
pnpm install      # Install dependencies
pnpm start        # Run the MCP server (stdio transport)
pnpm build        # Bundle for production (tsup)
pnpm test         # Run tests (vitest)
```

## Project Structure

```
src/
  index.ts          - Entry point
  server.ts         - MCP server setup and tool registration
  browsing/         - Class parsing, member extraction, search, cascading regex
  cli/              - CLI argument parsing
  errors/           - Domain error types and validation
  jdtls/            - JDT LS client, workspace sync, startup
  logging/          - Logger
  project/          - Gradle parsing, jar reading, dependency discovery
  state/            - ProjectStore singleton
  tools/            - MCP tool handlers and descriptions
  types/            - Shared types and response envelope
tests/              - Test files
```

## Key Technical Details

### Jar Reading Strategy

Uses node-stream-zip for O(1) random access by entry path from source jars. The ZIP central directory is read on open, then individual entries are accessed by path (e.g., `zip.entryData('net/minecraft/client/MinecraftClient.java')`). No full-memory load, no iteration. The Minecraft sources jar has ~6,600 files.

### Gradle Properties Parsing Strategy

Reads `gradle.properties` as simple key=value pairs to extract `minecraft_version`, `yarn_mappings`, `loader_version`, `fabric_api_version`. Supplements with regex extraction from `build.gradle.kts` for dependency declarations. No Gradle Tooling API needed.

### Multi-Project Support

Each project holds:
- Fabric mod children (with Gradle properties, source jar handles, dependency jars)
- Study jar children (with jar path, auto-include status, stats)
- JDT LS workspace (one per project, covers all children for cross-mod navigation)
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- **Tab indentation** in all source files (not spaces)
- **No nested JSON strings** in MCP tool text responses -- do not JSON.stringify structuredContent into text content
- **All tool descriptions** live in `src/tools/descriptions.ts` -- the `TOOL_DESCRIPTIONS` and `SERVER_INSTRUCTIONS` objects
- **Shared parameter schemas** in `PARAMS` and `DETAIL_PARAMS` objects in `descriptions.ts` -- reused across multiple tools
- **Tool response envelope**: `{ ok: true, ...data }` on success, `{ ok: false, code, message, tried?, suggestions? }` on error (see `src/types/envelope.ts`)
- **Domain logic** in `src/browsing/`, `src/project/`, `src/jdtls/` -- tools in `src/tools/` are thin wrappers that validate params and format responses
- **Tests** use vitest, located alongside source or in `tests/` directory
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Layered architecture with thin tool wrappers over domain modules:

- **Layer 1 -- MCP Server** (`src/server.ts`, `src/index.ts`): Registers tools, handles MCP protocol via stdio transport
- **Layer 2 -- Tools** (`src/tools/*.ts`): Thin handlers that validate params (via Zod schemas from `descriptions.ts`), call domain logic, and format responses. Each tool imports its description from `descriptions.ts`.
- **Layer 3 -- Domain** (`src/browsing/`, `src/project/`, `src/jdtls/`): Business logic. Browsing: class parsing, member extraction, search, cascading regex. Project: Gradle parsing, jar reading, dependency discovery, namespace resolution. JDT LS: LSP client, workspace sync, symbol navigation.
- **Layer 4 -- State** (`src/state/project-store.ts`): Singleton ProjectStore holding all project state, jar handles, JDT LS sessions
- **Layer 5 -- Types** (`src/types/`): Shared type definitions, response envelope (`makeSuccess`/`makeError`)
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
