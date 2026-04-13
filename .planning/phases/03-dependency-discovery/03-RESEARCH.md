# Phase 3: Dependency Discovery and Jar Registry - Research

**Researched:** 2026-04-12
**Domain:** Gradle cache traversal, Maven POM parsing, ZIP/JAR random-access reading, glob-based filtering
**Confidence:** HIGH

## Summary

This phase builds the dependency discovery pipeline: starting from declared dependencies in `build.gradle.kts`, traversing POM files in the Gradle cache to find transitive dependencies, resolving source jar paths, and providing on-demand jar entry reading via `node-stream-zip`. The Gradle cache structure is well-understood and follows rigid conventions that make path construction deterministic.

The key architectural insight is that there are three distinct sources of dependency information: (1) declared dependencies from `build.gradle.kts` (already parsed), (2) Minecraft's own transitive libraries from `mojang_minecraft_info.json` in the Loom cache, and (3) Fabric API module discovery from a Loom-cached POM. Each requires a different resolution strategy but all converge into the same jar registry.

**Primary recommendation:** Use a three-pronged discovery approach: Mojang version manifest for Minecraft's libraries, Loom cache POM for Fabric API modules, and POM traversal in `modules-2` for other declared dependencies. Use `picomatch` for include/exclude glob filtering. Use `node-stream-zip` async API for on-demand jar reading with explicit handle lifecycle management.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Jar identifier scheme: `"minecraft"` (stable ID), `"src"` (mod source), `"group:artifact"` (all others, no version)
- Jar categories: `minecraft`, `mod-source`, `fabric-api`, `library` -- derived from coordinate and dependency configuration
- Filtering uses glob patterns: `*` single-level, `**` multi-level (e.g., `net.fabricmc.fabric-api:*`, `**:gson`)
- Include/exclude via separate MCP tool (not at load time), default include-all with exclude list, per-project persistent state, per-tool-call overrides
- POM-based dependency tree traversal starting from declared dependencies
- Fabric API: parse POM for individual module deps (not cache scanning)
- Discovery happens eagerly at project load time
- Missing source jars: all deps appear in registry with availability status, summary message, suggest downloadSources
- Refresh tool to re-run discovery
- PROJ-10 (manual path override) is DEFERRED -- not this phase

### Claude's Discretion
- Jar reading abstraction internals (node-stream-zip handle management, pooling, lifecycle)
- POM XML parsing approach (regex, lightweight XML parser, etc.)
- Internal data structures for the dependency tree
- How include/exclude state is stored on LoadedProject
- Error handling for malformed POMs or circular dependencies

### Deferred Ideas (OUT OF SCOPE)
- PROJ-10 (manual path override for jar paths)
- Source browsing tools (list packages, list classes, read source) -- Phase 6
- Search across jars -- Phase 7
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROJ-07 | Server auto-discovers dependency source jars from Gradle dependency resolution | Three-pronged discovery: mojang_minecraft_info.json for MC libs, Loom POM for Fabric API modules, POM traversal for other deps |
| PROJ-08 | User can include/exclude specific dependencies | picomatch 4.x for glob matching with `*`/`**` wildcard semantics on `group:artifact` identifiers |
| PROJ-09 | Minecraft sources jar has stable identifier "minecraft" | Jar identifier scheme assigns `"minecraft"` to MC sources jar, distinct from `"group:artifact"` format |
| PROJ-10 | Manual path override | DEFERRED per CONTEXT.md -- not implemented this phase |
| BROW-05 | Source files read from jars on demand, no extraction to disk | node-stream-zip 1.15.x async API: `entryData(name)` for O(1) random access by path |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-stream-zip | 1.15.0 | On-demand jar/ZIP entry reading | Already chosen in CLAUDE.md. Central directory indexing, O(1) lookup by path, never loads entire archive into memory. Async API with `entryData(name)` returns Buffer directly. |
| picomatch | 4.0.4 | Glob pattern matching for include/exclude | Recommended in CLAUDE.md. Fast, zero-dependency, supports `*` and `**` wildcards. Perfect for matching `group:artifact` patterns. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (Node.js built-in fs) | N/A | Read POM files and mojang_minecraft_info.json from Gradle cache | Always -- POMs are small XML files, just readFile them |
| (Node.js built-in path/os) | N/A | Gradle cache path construction | Always -- homedir() + path.join for cache paths |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex POM parsing | fast-xml-parser (5.5.x) | POM structure is simple and predictable. Regex extracts `<dependency>` blocks with `<groupId>`, `<artifactId>`, `<version>`, `<scope>`. No namespace complexity needed. fast-xml-parser would add a dependency for minimal benefit. |
| picomatch | minimatch | picomatch is faster, simpler API, recommended in CLAUDE.md |

**Installation:**
```bash
pnpm add node-stream-zip picomatch
pnpm add -D @types/picomatch
```

**Version verification:** node-stream-zip 1.15.0 (npm), picomatch 4.0.4 (npm) -- verified 2026-04-12.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── project/
│   ├── types.ts                 # Extended: DependencyEntry, JarCategory, FilterConfig
│   ├── gradle-parser.ts         # Existing: parses build.gradle.kts dependencies
│   ├── loom-cache.ts            # Existing: MC sources jar path. Extended: Gradle cache helpers
│   ├── loader.ts                # Extended: calls dependency discovery during load
│   ├── dependency-discovery.ts  # NEW: orchestrates all three discovery strategies
│   ├── pom-parser.ts            # NEW: POM XML parsing for transitive deps
│   ├── jar-registry.ts          # NEW: manages discovered jars, include/exclude state
│   └── jar-reader.ts            # NEW: node-stream-zip handle management, entry reading
├── state/
│   └── project-store.ts         # Existing: stores LoadedProject (now with jar registry)
└── tools/
    ├── configure-filters.ts     # NEW: MCP tool for include/exclude configuration
    └── refresh-dependencies.ts  # NEW: MCP tool to re-run discovery
```

### Pattern 1: Three-Pronged Dependency Discovery
**What:** Three separate strategies that all feed into a unified jar registry.
**When to use:** Always during project load.

**Strategy A -- Minecraft Libraries (mojang_minecraft_info.json):**
```typescript
// Path: ~/.gradle/caches/fabric-loom/{mcVersion}/mojang_minecraft_info.json
// Contains "libraries" array with { name: "group:artifact:version", downloads: { artifact: { path, sha1 } } }
// Parse name field to extract group, artifact, version
// For each library, look for sources jar in modules-2 cache
```

**Strategy B -- Fabric API Modules (Loom POM):**
```typescript
// Path: ~/.gradle/caches/fabric-loom/fabric-api/fabric-api-{fabricApiVersion}.pom
// Only if fabric-api is in declared dependencies
// Parse POM <dependency> elements to get individual module coordinates
// Each module is tagged with category 'fabric-api'
```

**Strategy C -- Other Declared Dependencies (POM traversal):**
```typescript
// For each non-minecraft, non-mappings, non-fabric-api dependency in GradleConfig.dependencies:
// 1. Find POM in modules-2 cache: ~/.gradle/caches/modules-2/files-2.1/{group}/{artifact}/{version}/*/{artifact}-{version}.pom
// 2. Parse POM for transitive compile-scope dependencies
// 3. Recurse (with cycle detection via Set of "group:artifact:version")
// 4. Each discovered dep tagged with category 'library'
```

### Pattern 2: Source Jar Path Resolution
**What:** Deterministic path construction to find source jars in Gradle cache.
**When to use:** After discovering each dependency coordinate.

```typescript
// Gradle cache layout:
// ~/.gradle/caches/modules-2/files-2.1/{group}/{artifact}/{version}/{sha1}/{artifact}-{version}-sources.jar
//
// SHA1 directory is the SHA1 of the file it contains.
// We don't know the SHA1 ahead of time, so we glob:
// ~/.gradle/caches/modules-2/files-2.1/{group}/{artifact}/{version}/*/{artifact}-{version}-sources.jar
//
// Example: com.google.code.gson/gson/2.13.2/e28a0b248e.../gson-2.13.2-sources.jar

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

function gradleCacheBase(): string {
	return join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1');
}

async function findSourcesJar(group: string, artifact: string, version: string): Promise<string | null> {
	const versionDir = join(gradleCacheBase(), group, artifact, version);
	const expectedName = `${artifact}-${version}-sources.jar`;
	try {
		const sha1Dirs = await readdir(versionDir);
		for (const sha1 of sha1Dirs) {
			const candidate = join(versionDir, sha1, expectedName);
			// Check if file exists (use access or stat)
			try {
				await access(candidate);
				return candidate;
			} catch {
				continue;
			}
		}
	} catch {
		// Version directory doesn't exist
	}
	return null;
}
```

### Pattern 3: Jar Handle Lifecycle with node-stream-zip
**What:** Lazy-open, reference-counted or single-handle approach for jar reading.
**When to use:** When any tool needs to read a file from a jar.

```typescript
import StreamZip from 'node-stream-zip';

// Recommended: lazy-open, close on project unload
// Don't pool or cache -- node-stream-zip reads the central directory on open (fast),
// then individual entries are O(1) lookups.
// Keep handles open for the lifetime of the loaded project.

async function openJar(path: string): Promise<StreamZip.StreamZipAsync> {
	const zip = new StreamZip.async({ file: path, storeEntries: true });
	return zip;
}

// Reading a specific file from a jar:
async function readEntry(zip: StreamZip.StreamZipAsync, entryPath: string): Promise<Buffer> {
	return zip.entryData(entryPath);
}

// Listing all entries (for package/class listing in Phase 6):
async function listEntries(zip: StreamZip.StreamZipAsync): Promise<string[]> {
	const entries = await zip.entries();
	return Object.keys(entries);
}

// Close when project is unloaded:
async function closeJar(zip: StreamZip.StreamZipAsync): Promise<void> {
	await zip.close();
}
```

### Pattern 4: Include/Exclude Filter with picomatch
**What:** Glob-based filtering on jar identifiers using picomatch.
**When to use:** When listing/searching jars, and when configuring project filters.

```typescript
import picomatch from 'picomatch';

// Jar identifiers: "minecraft", "src", "com.google.code.gson:gson"
// Patterns: "net.fabricmc.fabric-api:*", "**:gson", "com.mojang:*"

// The ':' separator between group:artifact means:
// - "*" matches within one side: "net.fabricmc.fabric-api:*" matches any artifact in that group
// - "**" matches across both: "**:gson" matches gson in any group
// - picomatch handles this naturally if we set the separator

interface FilterConfig {
	mode: 'include-all' | 'exclude-all';
	patterns: string[];
}

function matchesFilter(jarId: string, filter: FilterConfig): boolean {
	if (jarId === 'minecraft' || jarId === 'src') return true; // Always included
	if (filter.patterns.length === 0) {
		return filter.mode === 'include-all';
	}
	const isMatch = picomatch(filter.patterns);
	const matched = isMatch(jarId);
	return filter.mode === 'include-all' ? !matched : matched;
}
```

### Anti-Patterns to Avoid
- **Scanning the entire Gradle cache:** Don't `find` all source jars -- there may be hundreds from unrelated projects. Only discover jars for the specific versions declared/transitively resolved.
- **Extracting jars to disk:** Violates BROW-05. Always read entries on-demand via `entryData()`.
- **Opening all jar handles eagerly:** With 100+ dependencies, opening all zip handles at load time wastes resources. Open lazily on first access.
- **Ignoring POM scope:** Only follow `compile` scope dependencies. `test`, `provided`, `runtime` scopes are not relevant for source browsing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob pattern matching | Custom wildcard matcher | picomatch 4.x | Edge cases with nested patterns, escaping, negation. picomatch is battle-tested. |
| ZIP file reading | Custom ZIP parser or extract-to-temp | node-stream-zip | Central directory parsing, decompression, path normalization -- all solved. |
| Full XML DOM parser | Custom XML parser | Regex for POM extraction | POMs have simple, predictable structure. Full XML parsing is overkill. But the regex must handle XML namespaces (Maven POMs use `xmlns`). |

**Key insight:** The POM parsing can use regex because Maven POM `<dependency>` blocks follow a rigid structure. We only need `groupId`, `artifactId`, `version`, and `scope` from `<dependency>` elements. No need for XPath, XSLT, or DOM manipulation.

## Common Pitfalls

### Pitfall 1: Fabric API POM Location
**What goes wrong:** Looking for the top-level `fabric-api` POM in `~/.gradle/caches/modules-2/files-2.1/` -- it doesn't exist there.
**Why it happens:** Fabric Loom handles Fabric API specially. The aggregator POM is stored in `~/.gradle/caches/fabric-loom/fabric-api/fabric-api-{version}.pom`, not the standard modules-2 cache.
**How to avoid:** Check Loom cache first for fabric-api: `~/.gradle/caches/fabric-loom/fabric-api/fabric-api-{version}.pom`. Individual Fabric API module POMs DO exist in modules-2.
**Warning signs:** Empty dependency list when a project declares fabric-api.

### Pitfall 2: Version Mismatch in Loom Cache
**What goes wrong:** The Loom fabric-api POM cached may be from a different project version than the current project.
**Why it happens:** Loom caches POMs by version. If a project uses fabric-api 0.141.3 but only 0.138.4 is cached (from another project), the POM won't be found.
**How to avoid:** Construct the expected path using `GradleConfig.fabricApiVersion`, then handle the case where the POM doesn't exist (suggest running `./gradlew dependencies` or a Gradle sync). Also check the modules-2 cache as a fallback.
**Warning signs:** "POM not found" errors for fabric-api when the project declares it.

### Pitfall 3: Minecraft Libraries Not in POM Chain
**What goes wrong:** POM traversal from `build.gradle.kts` dependencies misses Minecraft's own transitive libraries (gson, netty, authlib, etc.).
**Why it happens:** Minecraft's dependencies come from `mojang_minecraft_info.json` (the version manifest), not from Maven POM chains. The Minecraft POM in Loom cache has no `<dependency>` elements.
**How to avoid:** Use `~/.gradle/caches/fabric-loom/{mcVersion}/mojang_minecraft_info.json` to discover Minecraft's libraries. Parse the `libraries[].name` field (format: `group:artifact:version`).
**Warning signs:** Missing common libraries like gson, netty, log4j from the discovered set.

### Pitfall 4: POM Circular Dependencies
**What goes wrong:** Infinite recursion when following transitive POM dependencies.
**Why it happens:** While rare in practice, circular dependencies can exist in POM chains.
**How to avoid:** Track visited coordinates in a `Set<string>` (key: `group:artifact:version`). Skip any coordinate already visited.
**Warning signs:** Stack overflow or timeout during discovery.

### Pitfall 5: POM Parent References
**What goes wrong:** A POM has a `<parent>` element that defines dependency versions via `<dependencyManagement>`, but the parser ignores it.
**Why it happens:** POMs can inherit version numbers from parent POMs. The gson POM references `gson-parent` which defines versions.
**How to avoid:** For our use case, we only care about dependencies that have explicit `<version>` in their `<dependency>` blocks. Dependencies using `${project.version}` or inheriting from parent POMs without explicit versions can be skipped -- they're usually internal modules of the same project. If a dependency lacks a version, skip it with a warning rather than failing.
**Warning signs:** Dependencies with missing version fields.

### Pitfall 6: Sources Jar Not Downloaded
**What goes wrong:** A dependency is discovered but has no sources jar in the cache.
**Why it happens:** Gradle only downloads sources jars when explicitly requested (IDE integration or `downloadSources` task). Many transitive dependencies won't have sources.
**How to avoid:** Per CONTEXT.md decisions: all discovered deps appear in registry with availability status. Provide a summary of how many have sources vs. not. Suggest `./gradlew downloadSources` for missing ones.
**Warning signs:** Low source jar hit rate (expected: maybe 30-50% of transitive deps have sources).

### Pitfall 7: Plus Signs in Version Strings
**What goes wrong:** Version strings like `1.0.0+14b92d896f` cause path construction issues.
**Why it happens:** Fabric uses build metadata in versions (SemVer `+` suffix). File system paths handle this fine, but URL encoding or string matching could break.
**How to avoid:** Use version strings exactly as they appear in POMs/gradle properties. Don't URL-encode or sanitize them.
**Warning signs:** "File not found" for fabric-api modules with `+` in version.

## Code Examples

### POM Dependency Extraction (Regex approach)
```typescript
// Source: Verified against real POMs in ~/.gradle/caches/modules-2/files-2.1/

interface PomDependency {
	groupId: string;
	artifactId: string;
	version: string;
	scope: string;
}

function parsePomDependencies(pomXml: string): PomDependency[] {
	const deps: PomDependency[] = [];

	// Strip XML comments
	const cleaned = pomXml.replace(/<!--[\s\S]*?-->/g, '');

	// Match <dependency> blocks -- handles optional whitespace and namespace prefixes
	// Exclude <dependencyManagement> section
	const mgmtMatch = cleaned.match(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/);
	let depsSection = cleaned;
	if (mgmtMatch) {
		depsSection = cleaned.replace(mgmtMatch[0], '');
	}

	const depRegex = /<dependency>\s*([\s\S]*?)\s*<\/dependency>/g;
	let match: RegExpExecArray | null;

	while ((match = depRegex.exec(depsSection)) !== null) {
		const block = match[1];
		const groupId = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
		const artifactId = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
		const version = block.match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
		const scope = block.match(/<scope>([^<]+)<\/scope>/)?.[1]?.trim() ?? 'compile';

		if (groupId && artifactId && version) {
			deps.push({ groupId, artifactId, version, scope });
		}
	}

	return deps;
}
```

### Mojang Library Parsing
```typescript
// Source: Verified against ~/.gradle/caches/fabric-loom/1.21.11/mojang_minecraft_info.json

interface MojangLibrary {
	name: string; // "com.google.code.gson:gson:2.13.2"
	downloads?: {
		artifact?: { path: string; sha1: string; size: number; url: string };
	};
}

interface MojangVersionInfo {
	libraries: MojangLibrary[];
}

function parseMojangLibraries(json: MojangVersionInfo): Array<{ group: string; artifact: string; version: string }> {
	return json.libraries
		.map(lib => {
			const parts = lib.name.split(':');
			if (parts.length >= 3) {
				return { group: parts[0], artifact: parts[1], version: parts[2] };
			}
			return null;
		})
		.filter((x): x is NonNullable<typeof x> => x !== null);
}

// Path construction:
// ~/.gradle/caches/fabric-loom/{mcVersion}/mojang_minecraft_info.json
function mojangInfoPath(mcVersion: string): string {
	return join(homedir(), '.gradle', 'caches', 'fabric-loom', mcVersion, 'mojang_minecraft_info.json');
}
```

### Dependency Entry Type
```typescript
// Extended types for Phase 3

type JarCategory = 'minecraft' | 'mod-source' | 'fabric-api' | 'library';

interface DependencyEntry {
	id: string;           // "minecraft", "src", or "group:artifact"
	group: string;
	artifact: string;
	version: string;
	category: JarCategory;
	sourcesJarPath: string | null;  // null = sources not available
	available: boolean;             // true if sourcesJarPath exists on disk
}

interface FilterConfig {
	mode: 'include-all' | 'exclude-all';
	patterns: string[];  // glob patterns matching jar IDs
}

// Extended LoadedProject
interface LoadedProject {
	// ... existing fields ...
	dependencyJars: Map<string, DependencyEntry>;  // key = jar ID
	filterConfig: FilterConfig;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Gradle Tooling API for dep resolution | Parse POMs directly from cache | Always (for this project) | 10-30s cold start avoided, no JVM dependency |
| Extract jars to temp directory | Read entries on-demand via node-stream-zip | Project design constraint | No disk I/O for extracted files, lower memory |

**Deprecated/outdated:**
- None relevant -- the Gradle cache format has been stable for years.

## Open Questions

1. **Minecraft library source jar availability**
   - What we know: `mojang_minecraft_info.json` lists ~107-131 libraries. Source jars exist for many in `modules-2`.
   - What's unclear: Some Mojang libraries (authlib, etc.) may not publish sources to Maven Central. They're downloaded from `libraries.minecraft.net` which may not have `-sources.jar` variants.
   - Recommendation: Best-effort discovery. Try the modules-2 cache path for each. If not found, mark as unavailable. Loom's `downloadSources` may or may not help for Mojang-specific libraries.

2. **Depth of POM traversal**
   - What we know: Direct dependencies have POMs. Some have transitive deps (e.g., fabric-rendering-v1 depends on fabric-api-base).
   - What's unclear: How deep should traversal go? Minecraft's own libraries (gson, netty) have transitive deps of their own (error_prone_annotations, etc.).
   - Recommendation: Follow transitive deps from declared deps only (not from Minecraft's libraries -- those are already discovered via mojang_minecraft_info.json). Limit depth to prevent discovering the entire Maven Central graph. Suggest depth limit of 3-5 levels.

3. **Fabric API POM availability for all versions**
   - What we know: Loom caches the POM at `~/.gradle/caches/fabric-loom/fabric-api/fabric-api-{version}.pom`. Only one version is cached at a time on this system.
   - What's unclear: Is the POM always present after a project has been synced? What if the user hasn't done a Gradle sync with the current fabric-api version?
   - Recommendation: Handle gracefully. If the Loom POM isn't found, check modules-2 cache as fallback. If neither exists, report fabric-api as a single dependency with a note that modules couldn't be resolved.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test -- --reporter=verbose` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-07 | Auto-discover dependency source jars | unit + integration | `pnpm test -- tests/project/dependency-discovery.test.ts -x` | Wave 0 |
| PROJ-08 | Include/exclude filtering with glob patterns | unit | `pnpm test -- tests/project/jar-registry.test.ts -x` | Wave 0 |
| PROJ-09 | Minecraft jar has stable "minecraft" identifier | unit | `pnpm test -- tests/project/jar-registry.test.ts -x` | Wave 0 |
| BROW-05 | Read from jars on demand without extraction | unit | `pnpm test -- tests/project/jar-reader.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- --reporter=verbose`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project/dependency-discovery.test.ts` -- covers PROJ-07
- [ ] `tests/project/pom-parser.test.ts` -- POM parsing unit tests
- [ ] `tests/project/jar-registry.test.ts` -- covers PROJ-08, PROJ-09
- [ ] `tests/project/jar-reader.test.ts` -- covers BROW-05

## Sources

### Primary (HIGH confidence)
- Real Gradle cache at `~/.gradle/caches/modules-2/files-2.1/` -- inspected structure, verified SHA1 naming, confirmed POM/sources jar patterns
- Real Loom cache at `~/.gradle/caches/fabric-loom/` -- verified `mojang_minecraft_info.json` structure (107-131 libraries), fabric-api POM location
- Real POM files -- inspected Fabric API module POMs (simple `<dependency>` blocks), gson POM (has `<parent>`, transitive deps with scopes), fabric-loader POM (empty, packaging=pom)
- node-stream-zip README -- verified async API: `entryData(name)` for buffer, `entries()` for listing, `close()` for cleanup
- Existing codebase -- `types.ts`, `gradle-parser.ts`, `loom-cache.ts`, `loader.ts`, `project-store.ts`

### Secondary (MEDIUM confidence)
- picomatch 4.0.4 on npm -- standard glob matching library, recommended in CLAUDE.md
- node-stream-zip 1.15.0 on npm -- verified current version

### Tertiary (LOW confidence)
- POM parent resolution depth -- unclear how many POMs use `<parent>` for version inheritance in practice for Minecraft mod deps. Recommendation to skip versionless deps is pragmatic but may miss some transitive deps.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- node-stream-zip and picomatch both chosen in CLAUDE.md, versions verified
- Architecture: HIGH -- verified against real Gradle cache structure on disk, real POM files, real mojang_minecraft_info.json
- Pitfalls: HIGH -- all discovered through direct inspection of real cache data and POM files

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (Gradle cache format is stable, unlikely to change)
