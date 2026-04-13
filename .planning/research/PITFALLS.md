# Pitfalls Research

**Domain:** Java source intelligence MCP server for Minecraft Fabric mod development
**Researched:** 2026-04-12
**Confidence:** HIGH (most pitfalls verified against real Loom cache structure and MCP protocol spec)

## Critical Pitfalls

### Pitfall 1: Loading entire jar into memory on every request

**What goes wrong:**
Libraries like adm-zip load the entire ZIP central directory (and sometimes all file data) into a memory buffer on open. The Minecraft sources jar is ~8MB compressed / ~28MB uncompressed with ~7,000 entries. If you naively open the jar on every tool call, you re-parse the central directory each time. With multiple projects open (the porting use case), you could be doing this for 2+ jars simultaneously. Even worse, some libraries decompress all entries eagerly.

**Why it happens:**
Developers reach for the simplest zip library (adm-zip in Node.js, or Java's ZipFile which also loads the full central directory). The "no caching" requirement in PROJECT.md gets misinterpreted as "don't keep anything in memory" rather than "don't extract files to disk."

**How to avoid:**
- Use a streaming/random-access zip library (node-stream-zip, yauzl, or unzipper's Open API) that reads entries on demand without loading the full archive into memory.
- Cache the parsed central directory index in memory -- this is NOT "extracting files." The central directory for ~7,000 entries is only ~500KB. Re-reading it on every request is wasteful.
- Cache individual decompressed file contents with an LRU eviction policy. The "no caching" constraint means no disk extraction, not no in-memory caching.
- Open the jar file handle once at project load time and keep it open, not per-request.

**Warning signs:**
- Tool call latency >50ms for reading a single class file
- Memory spikes correlated with tool calls rather than steady baseline
- GC pressure visible in Node.js --trace-gc output

**Phase to address:**
Phase 1 (jar reading foundation). Get this right from day one because everything depends on jar I/O performance.

---

### Pitfall 2: Stdout pollution in stdio transport

**What goes wrong:**
The MCP stdio transport uses stdout exclusively for JSON-RPC messages. Any stray output to stdout -- from console.log debugging, a dependency's debug output, an uncaught warning, or even Node.js's built-in deprecation warnings -- corrupts the protocol stream. The client silently drops the connection or throws cryptic parse errors. This is the single most common cause of "MCP server doesn't work" reports.

**Why it happens:**
Developers use console.log for debugging during development. Third-party libraries may write to stdout. Node.js itself emits deprecation warnings to stderr by default, but some configurations or libraries redirect to stdout.

**How to avoid:**
- From the very first line of code, redirect all logging to stderr. Never use console.log -- use console.error or a logging library configured for stderr.
- Set up a logging abstraction on day one that writes to stderr.
- In tests, assert that no tool call produces stdout output beyond the JSON-RPC response.
- Consider process.stdout.write = () => { throw new Error("stdout reserved for MCP protocol") } during development to catch violations early.

**Warning signs:**
- MCP client reports "connection lost" or "parse error" intermittently
- Server works in tests but fails when connected to Claude Code
- Adding a new dependency suddenly breaks the server

**Phase to address:**
Phase 1 (MCP server skeleton). This must be the architectural foundation -- not something bolted on later.

---

### Pitfall 3: Gradle config parsing via regex instead of Tooling API

**What goes wrong:**
build.gradle.kts is a Turing-complete Kotlin script. Parsing it with regex works for the simple case (`val minecraft_version: String by project` in gradle.properties, string interpolation in build.gradle.kts) but breaks for: version catalogs, dependency declarations using variables from buildSrc, conditional dependencies, plugin-applied dependencies, multi-project builds with allprojects/subprojects blocks, and dependencies declared through custom extension functions.

**Why it happens:**
The Gradle Tooling API requires actually running Gradle, which takes 5-15 seconds for configuration. Regex parsing is instant. Developers start with regex for the simple case and discover edge cases too late.

**How to avoid:**
- Start with a two-tier approach: fast regex parsing of gradle.properties (which IS a simple key=value format) for the common Fabric Loom pattern, combined with a fallback to Gradle Tooling API for anything the regex can't handle.
- For Fabric Loom specifically, the critical values (minecraft_version, yarn_mappings, loader_version, fabric_api_version, loom_version) are almost always in gradle.properties. The build.gradle.kts just references them. Parse gradle.properties first.
- From gradle.properties values, you can deterministically compute the Loom cache path: `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged/{mc_version}-net.fabricmc.yarn.{yarn_version_underscored}.{yarn_version}/`
- Allow manual path overrides as an escape hatch for non-standard setups.

**Warning signs:**
- Works on the example project but fails on other people's mod projects
- Users report "Minecraft version not found" despite having a valid project
- Test suite only covers one build.gradle.kts format

**Phase to address:**
Phase 2 (project discovery/metadata). Start with gradle.properties regex + manual override, defer Tooling API integration to a later enhancement phase.

---

### Pitfall 4: Loom cache path assumptions break across versions

**What goes wrong:**
The Loom cache path structure is an internal implementation detail that changes between Loom versions. The current structure uses `minecraft-merged/{version}-net.fabricmc.yarn.{mappings}` but there are also `minecraft-merged-v2` directories, `-deobf` variants, `-intermediary` variants, and `-legacy-intermediary` variants. Hardcoding the path pattern for the current version means the server breaks silently when:
- Loom updates its cache structure (the `-v2` suffix already shows this happens)
- The user has an older Loom version with a different path pattern
- Client-only or server-only splits change the directory from `minecraft-merged` to `minecraft-client` or `minecraft-server`

**Why it happens:**
You test against one project with one Loom version and the path works. You don't realize the path pattern is version-dependent until someone with a different setup reports a bug.

**How to avoid:**
- Parse the actual Loom version from settings.gradle.kts (it's usually `val loom_version: String by settings` in pluginManagement).
- Build the expected path from parsed metadata but verify the path actually exists on disk before using it.
- When the expected path doesn't exist, search the cache directory for matching artifacts using glob patterns (e.g., find any sources jar containing the right Minecraft version).
- Provide clear error messages: "Expected sources jar at {path} but it doesn't exist. Run `./gradlew genSources` or provide a manual path override."
- The `-v2` directories don't contain sources jars -- only the non-v2 directories do. Don't search in v2 directories.

**Warning signs:**
- Server works on your machine but not on users' machines
- "File not found" errors after Loom updates
- Tests only cover one Loom version's cache layout

**Phase to address:**
Phase 2 (project discovery). Build path resolution as a distinct, testable module with version-aware logic.

---

### Pitfall 5: Java LSP (JDT.LS) startup latency blocks tool calls

**What goes wrong:**
Eclipse JDT Language Server takes 10-60+ seconds to initialize, import a project, and build its index. If you start JDT.LS lazily on first find-definition request, the user waits 30+ seconds for the first semantic query. If you start it eagerly at server startup, the MCP server takes 30+ seconds to become available. JDT.LS also requires Java 21+ runtime, which may not be the same JDK the mod project uses.

**Why it happens:**
JDT.LS was designed for IDE use where startup happens once at editor open. In an MCP server context, every server restart (which happens whenever Claude Code restarts or the user reconnects) pays this cost again. The server also needs to import the Gradle project, which triggers Gradle configuration.

**How to avoid:**
- Make JDT.LS an optional, lazy-loaded enhancement. Core features (browse source, search by name, regex-based find) must work WITHOUT JDT.LS running.
- Start JDT.LS in the background after the MCP server is already serving basic requests. Semantic features (find definition, find references) return a clear "LSP initializing, try again in N seconds" message until ready.
- Persist JDT.LS workspace data between restarts (the `.metadata` and project data) so subsequent startups are faster (incremental rather than full import).
- Use JDT.LS's `java.import.gradle.enabled` setting and point it at the actual project to get classpath resolution for free.
- Bundle a minimum Java 21 runtime or detect it at startup with a clear error message.

**Warning signs:**
- First tool call after server start takes >5 seconds
- Server appears "hung" during initialization
- Users report the server "doesn't work" because they don't wait long enough

**Phase to address:**
Phase 3 or 4 (semantic analysis). This is explicitly a later-phase concern -- do NOT block Phase 1-2 on LSP integration.

---

### Pitfall 6: Returning full class source in every tool response

**What goes wrong:**
Minecraft classes can be very large -- some are 1,000-5,000+ lines of decompiled source. If every search result or reference lookup returns the full source of each matching class, you blow up Claude's context window. A search matching 20 classes could return 50,000+ lines. The MCP protocol has no hard response size limit, but the LLM consuming the response does. Claude silently truncates or struggles with massive tool responses.

**Why it happens:**
It feels helpful to return "everything" so Claude doesn't need follow-up requests. The developer doesn't realize that returning 100KB of source code in a tool response actively degrades Claude's reasoning quality.

**How to avoid:**
- Design a layered API: list/search returns names and metadata only, a separate "read source" tool returns a single class's full source.
- For search results, return class name + matched line(s) with a few lines of context, not the full file.
- For find-definition and find-references, return the specific location (file, line range) and a code snippet, not the full file.
- Consider a `maxLines` parameter on the read-source tool so Claude can request just the first N lines of a very large class.
- Cap search results to a reasonable count (20-50 results) with a total_count so Claude knows there are more.

**Warning signs:**
- Claude's responses become confused after a tool call returns large source
- Tool calls take noticeably long (serializing large responses)
- Claude starts asking the same questions repeatedly (context overflow)

**Phase to address:**
Phase 1 (API design). Define the tool interface contract for response sizes before implementing anything. This is an API design decision, not an optimization.

---

### Pitfall 7: Decompiled source is not real source -- treating it as compilable Java

**What goes wrong:**
Vineflower/Fernflower-generated code has artifacts that confuse both humans and tools:
- Synthetic bridge methods and access methods that don't exist in the original source
- Variables named `var1`, `var2` when the decompiler can't recover names (though Yarn mappings largely fix this for Minecraft)
- Comments like `// $FF: synthetic method` or `// $VF:` annotations
- Generic type erasure artifacts where the decompiler guesses wrong
- Lambda desugaring that doesn't roundtrip cleanly
- Switch-on-enum patterns that generate synthetic inner classes
- Inconsistent decompilation between runs (floating point values, inner classes) -- fixed in recent Vineflower but older cached jars may have this

**Why it happens:**
The MCP server treats source jars as authoritative source. In reality, they're a best-effort reconstruction from bytecode. Tools that assume the code compiles (like an LSP that tries to type-check it) will flag false errors.

**How to avoid:**
- Never assert that decompiled source is compilable. Document this assumption in tool descriptions.
- When integrating JDT.LS, configure it with relaxed error tolerance -- decompiled source will have type resolution issues that are acceptable.
- Filter or annotate synthetic members in search results so Claude doesn't waste time analyzing compiler-generated code.
- When Vineflower adds comment markers (`// $VF:`, `// $FF:`), use these to identify decompiler artifacts.

**Warning signs:**
- LSP reports hundreds of errors on valid decompiled source
- Claude gets confused by synthetic methods and tries to use them in Mixins
- Search results cluttered with synthetic/bridge method hits

**Phase to address:**
Phase 1 (source reading) for awareness, Phase 3+ (LSP integration) for handling.

---

### Pitfall 8: Multi-project comparison without stable identifiers

**What goes wrong:**
The porting use case requires comparing the same class across two Minecraft versions. But "the same class" is ambiguous: a class might be renamed between versions (Yarn mappings change), moved to a different package, split into multiple classes, or merged with another class. If the tool assumes class identity is just the fully-qualified name, it fails when names change between MC versions.

**Why it happens:**
Developers implement the simple case (same class name, different version) and miss that Yarn mappings are not stable across Minecraft versions. `net.minecraft.client.render.GameRenderer` in 1.20 might have methods renamed or restructured in 1.21.

**How to avoid:**
- For Phase 1, support name-based comparison only -- it works for most cases because Yarn mapping teams actively try to maintain consistency.
- Document the limitation: comparison works by fully-qualified class name, not by semantic identity.
- For a later phase, consider using intermediary names as the stable identifier for cross-version comparison (intermediary names are guaranteed stable).
- Provide tools that let Claude search by partial name or pattern when exact name matching fails.

**Warning signs:**
- Claude reports "class not found in other version" for classes that were renamed
- Users report comparison results that don't make sense

**Phase to address:**
Phase 2-3 (multi-project support). Start with name-based, document the limitation, enhance later.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Regex-only Gradle parsing | Instant, no Gradle dependency | Breaks on non-standard build scripts | MVP only, with manual override escape hatch |
| Loading full central directory into memory per jar | Simple implementation | Fine for ~7K entries, but O(n) lookup | Always acceptable for Minecraft sources jars (~7K entries, ~500KB index) |
| Synchronous jar reads | Simpler code flow | Blocks event loop during decompression | Never in a Node.js server -- always use async/streaming |
| Skipping JDT.LS integration | Faster Phase 1 delivery | No semantic find-def/find-ref until added | Acceptable -- design the API to support it later |
| Hardcoded Loom cache path pattern | Works immediately for known version | Breaks on Loom updates | Never -- always verify path exists |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| JDT.LS (Eclipse LSP) | Starting it synchronously and blocking MCP server startup | Start async in background, serve basic tools immediately, add semantic tools when LSP ready |
| JDT.LS workspace | Creating workspace in temp dir (lost on restart, full re-import every time) | Persist workspace in a project-specific location for faster subsequent startups |
| JDT.LS classpath | Manually configuring classpath instead of letting it import the Gradle project | Point JDT.LS at the project root and let its Gradle import handle classpath -- it uses the Gradle Tooling API internally |
| Gradle Tooling API | Running full `gradle dependencies` task | Use the Tooling API's model queries (GradleProject, EclipseProject) which only run configuration, not tasks |
| Fabric Loom genSources | Assuming the sources jar always exists | It only exists after `./gradlew genSources` is run -- detect missing jar and provide actionable error |
| MCP stdio transport | Logging to stdout for debugging | All logging to stderr, enforce with linting or runtime check |
| MCP tool descriptions | Vague descriptions like "search source code" | Precise descriptions with parameter types, return shapes, and examples -- Claude uses these to decide which tool to call |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-opening jar file on every tool call | Latency >100ms per call, file descriptor churn | Open once, hold handle, read entries on demand | Immediately -- even with 1 concurrent user |
| Decompressing same class repeatedly | Latency spikes for popular classes (MinecraftClient, etc.) | LRU cache for decompressed source (in-memory, not disk) | After ~10 tool calls hitting the same files |
| Full-text search via linear scan of all 7K entries | Search takes 2-5 seconds | Build in-memory index of class names, method names at jar load time | On first search -- 7K entries x decompression is slow |
| Returning unbounded search results | 200+ results blow up context, serialization takes seconds | Cap at 50 results, return total_count | First broad search (e.g., "get" matches thousands of methods) |
| Synchronous I/O in Node.js event loop | All tool calls block during one jar read | Use async fs operations, consider worker threads for CPU-bound decompression | With 2+ concurrent tool calls |
| No connection pooling for JDT.LS | Each semantic query opens new LSP request cycle | Keep single persistent LSP connection, multiplex requests | First semantic query |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Path traversal in jar entry names | Malicious jar could contain entries like `../../etc/passwd` -- unlikely for Minecraft jars but possible for dependency jars | Validate all entry paths are relative and within expected package structure |
| Exposing absolute filesystem paths in tool responses | Leaks user's home directory structure, project locations | Use project-relative paths in responses, resolve internally |
| Running Gradle Tooling API with user's full Gradle permissions | Gradle build scripts can execute arbitrary code | Run in sandboxed process if possible, or document the trust boundary |
| Not validating project paths from MCP client | Client could point to arbitrary directories | Validate project paths exist and contain expected Gradle/Loom files |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Tool fails silently when sources jar missing | Claude says "no results" with no explanation | Return explicit error: "Sources jar not found. Run ./gradlew genSources first" |
| Search returns raw decompiled artifacts | Claude wastes context analyzing synthetic methods | Filter synthetic entries, or mark them clearly |
| No progress indication for slow operations | Claude/user thinks server is broken | Use MCP progress notifications for operations >1 second |
| Tool names are generic (search, read) | Claude picks wrong tool for the job | Descriptive names: browse_packages, read_class_source, search_by_name, find_definition |
| Returning Java source without context | Claude doesn't know which Minecraft version or mappings version the source is from | Always include project name, MC version, and mappings version in responses |

## "Looks Done But Isn't" Checklist

- [ ] **Jar reading:** Works for one jar but verify with 2+ jars open simultaneously (multi-project porting use case)
- [ ] **Search:** Returns results but verify results include the matched line/context, not just class names
- [ ] **Gradle parsing:** Works for the example project but verify with at least 3 different real Fabric mod projects
- [ ] **Package browsing:** Lists packages but verify nested packages work (net.minecraft.client.render vs net.minecraft.client.render.entity)
- [ ] **Multi-project:** Registers two projects but verify tools disambiguate which project a result comes from
- [ ] **Error messages:** Returns errors but verify they're actionable (not "internal error" but "sources jar not found at {path}")
- [ ] **Tool descriptions:** Defined but verify Claude actually picks the right tool for common tasks (test with real prompts)
- [ ] **Large files:** Works for small classes but verify with the largest Minecraft classes (some are 3000+ lines)
- [ ] **Special characters:** Works for ASCII but verify with Minecraft's unicode string literals in source

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stdout pollution | LOW | Add stderr-only logging constraint, audit all console.log calls |
| Full jar loaded into memory | MEDIUM | Swap zip library, requires changing the I/O layer but not the API |
| Hardcoded Loom cache paths | LOW | Add path existence check + fallback search + manual override |
| No response size limits | LOW | Add truncation/pagination to existing tools without breaking API |
| Synchronous jar reads | HIGH | Requires rewriting I/O layer to async; better to start async |
| Missing JDT.LS workspace persistence | LOW | Add workspace directory config, existing workspace data remains valid |
| Regex-only Gradle parsing breaks | LOW | Manual path override already works as escape hatch |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Jar memory loading | Phase 1 (jar reading) | Benchmark: single class read <10ms, memory stable under repeated reads |
| Stdout pollution | Phase 1 (server skeleton) | Test: connect to MCP client, verify no protocol errors |
| Response size explosion | Phase 1 (API design) | Test: search for common term, verify response <10KB |
| Loom cache path assumptions | Phase 2 (project discovery) | Test: with 2+ different Loom versions, paths resolve correctly |
| Gradle parsing edge cases | Phase 2 (project discovery) | Test: with 3+ different real Fabric projects |
| Decompiled source artifacts | Phase 1-2 (source reading) | Test: synthetic members are filtered/marked in search results |
| LSP startup latency | Phase 3+ (semantic analysis) | Test: basic tools respond within 100ms even while LSP initializing |
| Multi-version comparison | Phase 2-3 (multi-project) | Test: compare same class across two MC versions |
| Full-text search performance | Phase 2 (search) | Benchmark: name search <100ms, full-text search <500ms |

## Sources

- [MCP Protocol Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Pagination Spec](https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/pagination)
- [MCP Transport: stdio vs SSE vs StreamableHTTP](https://mcpcat.io/guides/comparing-stdio-sse-streamablehttp/)
- [MCP Request Timeout Guide](https://mcpcat.io/guides/fixing-mcp-error-32001-request-timeout/)
- [Nearform: MCP Tips, Tricks, and Pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/)
- [MCP Response Size Discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2211)
- [Designing MCP Servers for Large Result Sets (Axiom)](https://axiom.co/blog/designing-mcp-servers-for-wide-events)
- [Eclipse JDT.LS GitHub](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
- [JDT.LS 25-minute Startup Issue](https://github.com/redhat-developer/vscode-java/issues/4034)
- [JDT.LS Startup/JVM Configuration](https://deepwiki.com/redhat-developer/vscode-java/3.3-server-startup-and-jvm-configuration)
- [Vineflower Decompiler](https://github.com/Vineflower/vineflower)
- [Decompiler Behavioral Quirks (academic paper)](https://arxiv.org/pdf/1908.06895)
- [Fabric Loom Documentation](https://docs.fabricmc.net/develop/loom/)
- [Fabric Loom genSources Cache Issue](https://github.com/FabricMC/fabric-loom/issues/1187)
- [Fabric Mappings Wiki](https://wiki.fabricmc.net/tutorial:mappings)
- [node-stream-zip (fast zip reading)](https://github.com/antelle/node-stream-zip)
- [Gradle Tooling API Forum Discussion](https://discuss.gradle.org/t/extracting-dependency-coordinates-from-build-gradle-kts/27088)
- Real Loom cache structure verified against local `~/.gradle/caches/fabric-loom/` (2026-04-12)

---
*Pitfalls research for: Java source intelligence MCP server for Minecraft Fabric mod development*
*Researched: 2026-04-12*
