# Phase 9: Semantic Navigation - Research

**Researched:** 2026-04-13
**Domain:** JDT Language Server integration, LSP protocol (definition/references), Java source navigation
**Confidence:** MEDIUM

## Summary

This phase adds two new MCP tools (`find_definition` and `find_references`) that combine the existing cascading regex engine (Phase 8) with Eclipse JDT Language Server for semantic Java navigation. The cascading regex resolves a position in source; JDT LS resolves the semantic relationship (definition location, reference locations) at that position.

The primary challenge is JDT LS lifecycle management: spawning a JVM process, initializing it with correct classpath configuration derived from `LoadedProject` data, exposing source jars so JDT LS can navigate across them, and translating between the project's jar-based source model and JDT LS's file-URI-based document model. JDT LS requires source files to be extracted to disk (it cannot read from jars directly via LSP), so a temp directory extraction step is needed.

**Primary recommendation:** Use ts-lsp-client (1.1.1) as the LSP client, spawn one JDT LS process per project, configure it as an "invisible project" with `java.project.referencedLibraries` and `java.project.sourcePaths` pointing to extracted source files in a temp directory. Extract source jars to temp on project load; clean up on unload.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- One-shot tool call flow: `find_definition` and `find_references` accept cascading regex patterns directly (no two-step locate-then-navigate)
- Standardize cascading regex input format across all tools that use it (`locate_in_source`, `find_definition`, `find_references`) -- same parameter shape for the pattern array, class, jar, project params
- Context-aware surrounding code in results (smallest enclosing semantic unit), not fixed N-lines
- Each result includes source provenance (jar ID, category, provenance chains)
- Each result includes file path, position (line/column), and the context-aware source snippet
- Eager JDT LS initialization (on project load, not lazy)
- Hard-error when JDT LS not available -- no regex-based fallback
- Clear failure reason messages

### Claude's Discretion
- JDT LS workspace configuration (how to set up classpath from LoadedProject data)
- LSP client implementation (ts-lsp-client vs custom lightweight client)
- JDT LS process lifecycle details (one per project vs shared, shutdown timing)
- How to expose source jars to JDT LS (extract to temp dir vs configure jar reading)
- Exact error codes and DomainError structure for JDT LS failures
- How to determine the "enclosing semantic unit" for context snippets (AST parsing, regex heuristics, or LSP capabilities)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | Find definition of a symbol at a position identified by cascading regex | ts-lsp-client `definition()` method sends `textDocument/definition` to JDT LS; cascading regex provides position; URI mapping translates between jar model and extracted files |
| NAV-02 | Find all references/usages of a symbol across all sources | ts-lsp-client `references()` method sends `textDocument/references` to JDT LS; JDT LS searches all source paths configured in workspace |
| NAV-03 | Navigation works across jar boundaries (MC source, dep source, mod source) | All source jars extracted to temp directory; JDT LS configured with all source paths; URI-to-jar-ID mapping enables cross-jar navigation |
| NAV-04 | Results include source provenance, file path, position, and surrounding context | LSP Location results mapped back to jar IDs via path prefix matching; context-aware snippet extraction using regex-based enclosing unit detection |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ts-lsp-client | 1.1.1 | LSP client for JDT LS communication | Minimal-dependency standalone LSP client. Does not depend on VS Code internals. Provides `definition()`, `references()`, `typeDefinition()` methods directly. MIT licensed. |
| Eclipse JDT LS | 1.57.0 | Java semantic analysis server | Only mature standalone Java language server. Supports headless operation. go-to-definition and find-references across all configured source paths. Requires Java 21+. |
| vscode-languageserver-protocol | 3.17.5 | LSP type definitions | TypeScript types for all LSP messages (Position, Location, Range, etc.). Used alongside ts-lsp-client for type safety. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process | built-in | Spawn JDT LS JVM process | Process lifecycle management (spawn, kill) |
| node:fs/promises | built-in | Extract source jars to temp dir | JDT LS needs files on disk, not in jars |
| node:os | built-in | Temp directory path | `os.tmpdir()` for extraction target |
| node-stream-zip | 1.15.x (existing) | Extract jar contents | Bulk extraction of source jars to temp filesystem |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ts-lsp-client | Custom JSON-RPC over stdio | More control, but reinventing the wheel. ts-lsp-client handles framing, request/response matching, and provides typed methods. |
| ts-lsp-client | vscode-languageclient | Depends on VS Code internals, not suitable for standalone Node.js server. |
| Temp dir extraction | Configure JDT LS jar reading | JDT LS expects file:// URIs. It can attach source jars to classpath entries, but textDocument/definition requires documents to be openable by URI. Extraction is simpler and more reliable. |

**Installation:**
```bash
pnpm add ts-lsp-client vscode-languageserver-protocol
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── jdtls/
│   ├── client.ts          # JdtLsClient: spawn, initialize, shutdown JDT LS
│   ├── workspace.ts       # Workspace setup: extract jars, generate .classpath/.project
│   ├── uri-mapper.ts      # Map file:// URIs <-> jar IDs + entry paths
│   └── context-extractor.ts  # Extract enclosing semantic unit from source
├── tools/
│   ├── find-definition.ts # find_definition MCP tool
│   └── find-references.ts # find_references MCP tool
└── project/
    └── types.ts           # Extended with JDT LS state (JdtLsSession)
```

### Pattern 1: JDT LS Session per Project
**What:** Each `LoadedProject` gets an associated `JdtLsSession` that owns the JDT LS child process, temp directory, and URI mappings.
**When to use:** Always -- one JDT LS per project ensures classpath isolation.
**Example:**
```typescript
interface JdtLsSession {
	client: LspClient;
	process: ChildProcess;
	tempDir: string;           // Extracted source files
	uriMapper: UriMapper;      // file:// URI <-> jar ID + entry path
	available: boolean;
	failureReason?: string;
}
```

### Pattern 2: URI Mapping
**What:** JDT LS works with `file://` URIs pointing to extracted source files. The URI mapper translates between these URIs and the project's jar-based model (jar ID + entry path).
**When to use:** Every LSP request/response.
**Example:**
```typescript
// Extraction layout:
// /tmp/mcp-jdtls-{uuid}/
//   minecraft/net/minecraft/client/MinecraftClient.java
//   fabric-api:fabric-networking-api-v1/net/fabricmc/...
//   src/com/example/mymod/MyMod.java

// URI -> jar mapping:
// file:///tmp/.../minecraft/net/minecraft/client/MinecraftClient.java
//   -> { jar: "minecraft", entryPath: "net/minecraft/client/MinecraftClient.java" }
```

### Pattern 3: Enclosing Semantic Unit Extraction
**What:** Given a position in source, extract the smallest enclosing semantic unit (method body, field declaration, class declaration) for context-aware results.
**When to use:** Formatting navigation results (NAV-04).
**Approach:** Use regex-based heuristics to find enclosing braces. The project already uses regex extensively (class declaration parsing reads first 4KB). A similar approach works here:
1. From the target line, scan backward for method/class/field declaration patterns
2. If inside a method body, find matching braces to include the full method
3. If at a field/method signature level, include just the declaration
4. Fallback: 5 lines before and after the target position

### Pattern 4: One-Shot Navigation Flow
**What:** `find_definition` and `find_references` handle the full pipeline internally:
1. Resolve project via `projectStore.resolveProject()`
2. Run cascading regex on the target class to get position
3. Map class FQN + position to a file:// URI + LSP Position
4. Send LSP definition/references request
5. Map result URIs back to jar IDs
6. Read source and extract context-aware snippets
7. Return with provenance

**When to use:** Both `find_definition` and `find_references` tools.

### Anti-Patterns to Avoid
- **Shared JDT LS across projects:** Different projects have different classpaths, Minecraft versions, and dependency sets. A shared JDT LS would require classpath switching which is error-prone and slow.
- **Lazy extraction of individual files:** JDT LS needs the full source tree to resolve references. Extracting on demand would miss cross-file references. Extract all sources upfront.
- **Using JDT LS document symbols for context:** The `textDocument/documentSymbol` request returns the full symbol tree, but parsing it to find the enclosing unit is more complex than simple regex scanning. Use regex heuristics.
- **Keeping temp files across sessions:** Extract fresh on each project load. Avoids stale source issues and simplifies cleanup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LSP JSON-RPC framing | Custom Content-Length parser + message framing | ts-lsp-client's JSONRPCEndpoint | Protocol framing has edge cases (partial reads, encoding). ts-lsp-client handles this. |
| LSP request/response correlation | Custom request ID tracking | ts-lsp-client's LspClient | Handles concurrent requests, response matching, error propagation. |
| Java 21 detection | Manual `java -version` parsing | `child_process.execSync('java --version')` with regex | Simple enough, but must handle: no java on PATH, wrong version, JAVA_HOME override. |
| JDT LS download/install | Custom downloader | Document as prerequisite; user installs | Downloading 185MB binary at runtime is fragile. JDT LS is a user-managed dependency like Java 21. |

**Key insight:** The LSP protocol is well-specified but has many edge cases in the transport layer. ts-lsp-client handles all of these. The project-specific complexity is in the URI mapping and workspace configuration, not in the protocol layer.

## Common Pitfalls

### Pitfall 1: JDT LS Initialization Takes Time
**What goes wrong:** JDT LS takes 10-30 seconds to fully index a workspace on first launch. LSP requests sent before indexing completes may return empty results.
**Why it happens:** JDT LS builds an internal model of all source files, resolves types, builds cross-reference indices.
**How to avoid:** After `initialize`/`initialized`, wait for the `language/status` notification with `"ServiceReady"` or monitor `window/logMessage` for completion. Do NOT send definition/references requests until ready.
**Warning signs:** Empty results from definition/references, or `ResponseError` with "not ready" messages.

### Pitfall 2: LSP Position is 0-Based, Cascading Regex is 1-Based
**What goes wrong:** The cascading regex engine returns 1-based line/column. LSP uses 0-based line and 0-based character (UTF-16 code units).
**Why it happens:** Different conventions. LSP spec explicitly states 0-based.
**How to avoid:** Convert: `lspLine = cascadeResult.line - 1`, `lspCharacter = cascadeResult.column - 1`. For ASCII Java source, column maps directly to character offset. Be aware of potential UTF-16 issues with non-ASCII identifiers (rare in Minecraft source).
**Warning signs:** Off-by-one errors in navigation results; definitions found one line above/below the expected location.

### Pitfall 3: JDT LS Expects .project and .classpath Files
**What goes wrong:** JDT LS may not recognize the workspace as a Java project without Eclipse project metadata files.
**Why it happens:** JDT LS is Eclipse-based and looks for `.project` and `.classpath` files to configure the project model.
**How to avoid:** Generate minimal `.project` and `.classpath` files in the temp extraction directory. The `.classpath` file declares source folders and the JRE container.
**Warning signs:** JDT LS reports "no project found" or fails to resolve any types.

### Pitfall 4: Source Jar Extraction Size
**What goes wrong:** Extracting all source jars can take significant disk space and time. Minecraft sources jar alone is ~50-80MB decompressed. With all dependencies, could be 200-400MB.
**Why it happens:** Source jars contain all .java files for each dependency.
**How to avoid:** Extract only .java files (skip META-INF, resources). Use streaming extraction. Document the disk space requirement. Clean up temp dirs on project unload.
**Warning signs:** Slow project load times, disk space warnings.

### Pitfall 5: JDT LS Process Crash/Hang
**What goes wrong:** JDT LS JVM process may crash (OOM, segfault) or hang (deadlock, infinite loop during indexing).
**Why it happens:** Large classpaths, complex source trees, JVM issues.
**How to avoid:** Set `-Xmx1G` heap limit. Monitor process with `exit` event. Set timeout on LSP requests (30 seconds for definition, 60 seconds for references). Mark session as unavailable on process death.
**Warning signs:** Process consuming excessive memory, no response to LSP requests.

### Pitfall 6: textDocument/didOpen Required Before Navigation
**What goes wrong:** JDT LS may not return results for a file that has not been opened via `textDocument/didOpen`.
**Why it happens:** LSP servers may only track documents that the client has explicitly opened.
**How to avoid:** Send `textDocument/didOpen` for the target file before sending definition/references requests. Close with `textDocument/didClose` after to manage memory.
**Warning signs:** Empty results for files that definitely contain the target symbol.

## Code Examples

### Creating JDT LS Client with ts-lsp-client
```typescript
// Source: ts-lsp-client npm / GitHub
import { LspClient, JSONRPCEndpoint } from 'ts-lsp-client';
import { spawn } from 'node:child_process';

function createJdtLsClient(jdtlsPath: string, workspaceDir: string, dataDir: string): {
	client: LspClient;
	process: ChildProcess;
} {
	const proc = spawn('java', [
		'-Declipse.application=org.eclipse.jdt.ls.core.id1',
		'-Dosgi.bundles.defaultStartLevel=4',
		'-Declipse.product=org.eclipse.jdt.ls.core.product',
		'-Xmx1G',
		'--add-modules=ALL-SYSTEM',
		'--add-opens', 'java.base/java.util=ALL-UNNAMED',
		'--add-opens', 'java.base/java.lang=ALL-UNNAMED',
		'-jar', `${jdtlsPath}/plugins/org.eclipse.equinox.launcher_*.jar`,
		'-configuration', `${jdtlsPath}/config_mac`, // platform-specific
		'-data', dataDir,
	], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	const endpoint = new JSONRPCEndpoint(proc.stdin!, proc.stdout!);
	const client = new LspClient(endpoint);
	return { client, process: proc };
}
```

### LSP Initialize Request
```typescript
// Source: LSP spec + JDT LS wiki
const initResult = await client.initialize({
	processId: process.pid,
	rootUri: `file://${workspaceDir}`,
	capabilities: {
		textDocument: {
			definition: { dynamicRegistration: false },
			references: { dynamicRegistration: false },
		},
	},
	initializationOptions: {
		settings: {
			java: {
				autobuild: { enabled: true },
				import: {
					maven: { enabled: false },
					gradle: { enabled: false },
				},
				project: {
					sourcePaths: ['minecraft', 'src', ...depDirs],
					referencedLibraries: [],
				},
			},
		},
	},
	workspaceFolders: [{ uri: `file://${workspaceDir}`, name: 'sources' }],
});
client.initialized();
```

### Sending Definition Request
```typescript
// Source: ts-lsp-client API
const result = await client.definition({
	textDocument: { uri: `file://${filePath}` },
	position: { line: cascadeLine - 1, character: cascadeColumn - 1 },
});

// result is Location | Location[] | LocationLink[] | ResponseError | null
if (result && !('code' in result)) {
	const locations = Array.isArray(result) ? result : [result];
	for (const loc of locations) {
		const { jar, entryPath } = uriMapper.toJarEntry(loc.uri);
		// Map back to project model...
	}
}
```

### Sending References Request
```typescript
// Source: ts-lsp-client API
const result = await client.references({
	textDocument: { uri: `file://${filePath}` },
	position: { line: cascadeLine - 1, character: cascadeColumn - 1 },
	context: { includeDeclaration: true },
});

// result is Location[] | ResponseError | null
```

### Minimal .classpath File
```xml
<?xml version="1.0" encoding="UTF-8"?>
<classpath>
	<classpathentry kind="src" path="minecraft"/>
	<classpathentry kind="src" path="src"/>
	<!-- one per dependency source dir -->
	<classpathentry kind="src" path="fabric-api:fabric-networking-api-v1"/>
	<classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
	<classpathentry kind="output" path="bin"/>
</classpath>
```

### Minimal .project File
```xml
<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
	<name>mcp-sources</name>
	<buildSpec>
		<buildCommand>
			<name>org.eclipse.jdt.core.javabuilder</name>
		</buildCommand>
	</buildSpec>
	<natures>
		<nature>org.eclipse.jdt.core.javanature</nature>
	</natures>
</projectDescription>
```

### Enclosing Semantic Unit Extraction (Regex Heuristic)
```typescript
// Heuristic: find the enclosing method or class declaration
function extractEnclosingContext(source: string, targetLine: number): {
	snippet: string;
	startLine: number;
	endLine: number;
	kind: 'method' | 'field' | 'class' | 'fallback';
} {
	const lines = source.split('\n');
	// Scan backward from targetLine for method/class declaration
	const METHOD_RE = /^\s*(public|protected|private|static|final|abstract|synchronized|native|\s)+[\w<>\[\],\s]+\s+\w+\s*\(/;
	const CLASS_RE = /^\s*(public|protected|private|static|final|abstract)?\s*(class|interface|enum|record)\s+/;
	const FIELD_RE = /^\s*(public|protected|private|static|final|\s)+[\w<>\[\],\s]+\s+\w+\s*(=|;)/;

	// ... scan backward, find matching braces, return snippet
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-only symbol search | LSP semantic navigation (definition/references) | Phase 9 | Precise cross-file navigation instead of pattern matching |
| Extract-to-disk cache | Read from jars directly | Project constraint | JDT LS is the exception -- it NEEDS files on disk. Temp dir is acceptable since it's JDT LS's requirement, not a source reading cache. |

**Note on constraint interpretation:** The project constraint says "no caching of extracted files" and "read directly from jars." JDT LS fundamentally cannot read from jars via LSP -- it needs file:// URIs. The temp directory is a JDT LS workspace, not a source cache. The MCP tools themselves still read from jars for all non-JDT-LS operations. This is consistent with the constraint's intent (avoid persistent extraction caches for browsing/reading).

## Open Questions

1. **JDT LS Binary Location**
   - What we know: JDT LS is a ~185MB binary distribution. Latest milestone is 1.57.0.
   - What's unclear: How does the user tell the MCP server where JDT LS is installed? Environment variable? Config file? Auto-detection?
   - Recommendation: Accept a `JDTLS_HOME` environment variable. If not set, try common locations (`~/.local/share/jdtls`, `/usr/local/share/jdtls`). If not found, mark semantic tools as unavailable with clear message.

2. **Java 21 Detection**
   - What we know: JDT LS requires Java 21+. Must verify before spawning.
   - What's unclear: Should we use JAVA_HOME, or search PATH? What if user has multiple Java versions?
   - Recommendation: Check JAVA_HOME first, then PATH. Parse `java --version` output for version >= 21. If not found, mark semantic tools as unavailable.

3. **JDT LS Indexing Completion Signal**
   - What we know: JDT LS takes time to index. Premature requests return empty results.
   - What's unclear: The exact notification/message that signals indexing is complete varies across JDT LS versions.
   - Recommendation: Listen for `language/status` notifications or poll with a simple definition request until it returns non-empty. Set a reasonable timeout (60 seconds).

4. **Classpath Entry Naming for Extracted Sources**
   - What we know: Dependency IDs can contain `:` (e.g., `fabric-api:fabric-networking-api-v1`). Some filesystems may have issues with `:` in directory names (Windows).
   - What's unclear: Whether the MCP server needs to run on Windows.
   - Recommendation: Replace `:` with `__` in extraction directory names. URI mapper handles the bidirectional translation.

5. **Memory Impact of Extracted Sources**
   - What we know: Minecraft sources jar is ~50-80MB decompressed. Full dependency tree could be 200-400MB on disk.
   - What's unclear: How much of this JDT LS keeps in memory (its -Xmx1G budget).
   - Recommendation: Start with 1G heap, document as configurable. Monitor in practice.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | find_definition resolves symbol definition via cascading regex + JDT LS | integration | `pnpm vitest run tests/tools/find-definition.test.ts -x` | Wave 0 |
| NAV-02 | find_references finds all usages across sources | integration | `pnpm vitest run tests/tools/find-references.test.ts -x` | Wave 0 |
| NAV-03 | Cross-jar navigation (MC, dep, mod) | integration | `pnpm vitest run tests/tools/find-definition.test.ts -x` | Wave 0 |
| NAV-04 | Results include provenance, position, context snippet | unit | `pnpm vitest run tests/jdtls/context-extractor.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/jdtls/client.test.ts` -- covers JDT LS spawn/init/shutdown lifecycle
- [ ] `tests/jdtls/workspace.test.ts` -- covers source extraction and .classpath generation
- [ ] `tests/jdtls/uri-mapper.test.ts` -- covers file URI <-> jar ID mapping
- [ ] `tests/jdtls/context-extractor.test.ts` -- covers enclosing semantic unit extraction (NAV-04)
- [ ] `tests/tools/find-definition.test.ts` -- covers NAV-01, NAV-03
- [ ] `tests/tools/find-references.test.ts` -- covers NAV-02, NAV-03

**Note:** Integration tests for NAV-01/02/03 require JDT LS + Java 21 to be available. Tests should skip gracefully if not available, with clear skip messages. Unit tests for context extraction and URI mapping can run without JDT LS.

## Sources

### Primary (HIGH confidence)
- [ts-lsp-client GitHub](https://github.com/ImperiumMaximus/ts-lsp-client) - LspClient API: `definition()`, `references()`, `initialize()`, `shutdown()`, `didOpen()`, `didClose()`
- [Eclipse JDT LS GitHub](https://github.com/eclipse-jdtls/eclipse.jdt.ls) - Launch commands, Java 21 requirement, workspace configuration
- [JDT LS Wiki - Running from CLI](https://github.com/eclipse-jdtls/eclipse.jdt.ls/wiki/Running-the-JAVA-LS-server-from-the-command-line) - InitializationOptions, java.project.sourcePaths, java.project.referencedLibraries
- [JDT LS Milestones](https://download.eclipse.org/jdtls/milestones/) - Latest version 1.57.0 (Feb 2026)

### Secondary (MEDIUM confidence)
- [JDT LS Issue #1986](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1986) - Classpath config without Maven/Gradle confirmed working via .classpath file and java.project settings
- [JDT LS Discussion #3191](https://github.com/eclipse-jdtls/eclipse.jdt.ls/discussions/3191) - .classpath file format with source attachments, .project file requirement
- [Eclipse .classpath docs](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.isv/guide/jdt_api_classpath.htm) - classpathentry kind="src", kind="lib", sourcepath attribute

### Tertiary (LOW confidence)
- JDT LS indexing completion signal -- varied reports across versions; `language/status` with "ServiceReady" is the most cited but not officially documented as stable API
- ts-lsp-client maturity -- version 1.1.1, last published ~April 2026, small project but API surface matches our needs exactly

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - ts-lsp-client is small/niche but its API is verified. JDT LS is well-established.
- Architecture: MEDIUM - URI mapping and workspace extraction pattern is sound but untested at this scale.
- Pitfalls: HIGH - LSP integration pitfalls are well-documented across JDT LS issues and community.

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days -- JDT LS and LSP protocol are stable)
