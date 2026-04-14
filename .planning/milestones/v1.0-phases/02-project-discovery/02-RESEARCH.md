# Phase 2: Project Discovery - Research

**Researched:** 2026-04-12
**Domain:** Gradle project parsing, Fabric Loom cache resolution, project state management
**Confidence:** HIGH

## Summary

Phase 2 loads a single Fabric/Loom Gradle project from a CLI flag, parses `build.gradle.kts` (with variable substitution from `gradle.properties`), extracts dependency coordinates, detects mapping era, resolves the Minecraft sources jar path in the Loom cache, and parses `fabric.mod.json`. No new MCP tools are exposed -- the project loads at startup before transport connects.

The two real test projects on this machine have been examined. The `build.gradle.kts` files are simple enough for regex-based parsing: dependency declarations are single-line function calls with string interpolation from `gradle.properties`. The Loom cache follows strict Maven conventions verified from actual POM files on disk.

**Primary recommendation:** Build a `project/` module with submodules for gradle parsing, Loom cache resolution, and fabric.mod.json parsing. Wire project loading into `src/index.ts` between CLI parsing and transport connection. Store projects in a `Map<string, LoadedProject>` from the start for Phase 4 readiness.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `--project` CLI flag auto-loads a project at startup (already exists from Phase 1)
- `--project .` must work (resolve to absolute path)
- Project is named after the directory basename (e.g., `--project /path/to/Debrand` -> name "Debrand")
- No `load-project` MCP tool in this phase -- CLI flag is the only entry point
- If `--project` is not provided, server errors out with a clear message (Phase 4 will allow empty start)
- Data model should be a map of projects keyed by name from the start, even though Phase 2 only supports one
- Parse `build.gradle.kts` as the primary source of truth, not just `gradle.properties`
- `gradle.properties` is used only for variable substitution when `build.gradle.kts` references `${var_name}` or `val x: String by project`
- Extract ALL dependency coordinates from the `dependencies` block: `minecraft(...)`, `mappings(...)`, `modImplementation(...)`, `implementation(...)`, etc.
- Era detection: presence of a `mappings(...)` call -> Yarn era; absence -> unobfuscated era
- Store everything parsed -- downstream phases (3, 5) will need the full dependency list and mod metadata
- Yarn era (has `mappings()` call): artifactId `minecraft-merged`, version `{mc_version}-net.fabricmc.yarn.{yarn_sanitized}.{yarn_mappings}`
- Unobfuscated era (no `mappings()` call): artifactId `minecraft-merged-deobf`, version `{mc_version}`
- Cache follows Maven convention: `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/{artifactId}/{version}/{artifactId}-{version}-sources.jar`
- One path per era -- do not check the wrong artifact directory as fallback
- Return full parsed metadata on successful load
- Response uses the established ToolSuccess envelope from Phase 1
- Parse `fabric.mod.json` during project load
- Located at `src/main/resources/fabric.mod.json` relative to project root
- If sources jar not found: report failure with human-friendly message AND list all literal paths checked
- Error messages include both friendly descriptions and exact paths tried
- Use DomainError system from Phase 1 for structured errors
- Parse `build.gradle.kts` with variable substitution from `gradle.properties`
- Resolve and verify sources jar exists on disk (existence check only, don't open the jar)
- Resolve dependency source jar paths (existence check, store for Phase 3)

### Claude's Discretion
- Internal module structure for project/gradle parsing code
- Exact regex patterns for `build.gradle.kts` parsing
- How to handle edge cases in Kotlin DSL parsing (comments, multi-line strings, etc.)
- Test structure and test project fixtures

### Deferred Ideas (OUT OF SCOPE)
- `load-project` / `unload-project` MCP tools -- Phase 4 (multi-project)
- Named project sessions (PROJ-02) -- Phase 4
- Starting server with no projects loaded -- Phase 4
- Multiple `--project` flags -- Phase 4
- Dependency source jar reading/opening -- Phase 3
- Include/exclude filtering for dependencies -- Phase 3
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROJ-01 | User can load a Fabric/Loom Gradle project by providing its root directory path | CLI flag parsing, path resolution, project loading pipeline, data model |
| PROJ-06 | Server auto-discovers the Minecraft sources jar from gradle.properties (minecraft_version, yarn_mappings) and the Loom cache path structure | Gradle parsing, variable substitution, Loom cache path construction verified against real paths |
| PROJ-11 | Server correctly handles both Yarn-mapped jar era (MC <=1.21.11) and unobfuscated jar era (MC >=26.1) with different Loom cache path structures | Two verified cache path patterns, era detection via mappings() presence |
</phase_requirements>

## Standard Stack

### Core (already installed from Phase 1)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs/promises` | built-in | File existence checks, reading gradle files | No external dep needed for simple file reads |
| Node.js `path` | built-in | Path resolution, joining, basename extraction | Standard path manipulation |
| Zod | 4.x (installed) | Validation of parsed structures | Already in project, use for validating fabric.mod.json shape |

### Supporting
No new dependencies needed. Phase 2 does file I/O (read text files, check file existence) and string parsing -- all achievable with Node.js built-ins.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── project/
│   ├── types.ts              # LoadedProject, GradleConfig, FabricModJson, MappingEra types
│   ├── gradle-parser.ts      # Parse build.gradle.kts + gradle.properties
│   ├── loom-cache.ts         # Resolve Minecraft sources jar path from parsed config
│   ├── fabric-mod.ts         # Parse fabric.mod.json
│   └── loader.ts             # Orchestrator: validate dir, parse, resolve, return LoadedProject
├── state/
│   └── project-store.ts      # Map<string, LoadedProject> singleton, accessed by tool handlers
├── cli/
│   └── args.ts               # (existing) -- needs --project to become required with path resolution
├── index.ts                  # Wire: parseCli -> loadProject -> store -> createServer -> connect
└── ...existing...
```

### Pattern 1: Project Loading Pipeline
**What:** Sequential validation pipeline that fails fast with DomainError at each step
**When to use:** Project loading at startup
**Example:**
```typescript
// src/project/loader.ts
export async function loadProject(projectPath: string): Promise<LoadedProject> {
	const absolutePath = path.resolve(projectPath);
	const name = path.basename(absolutePath);

	// Step 1: Validate directory exists
	await validateProjectDir(absolutePath);

	// Step 2: Parse gradle.properties for variable values
	const properties = await parseGradleProperties(absolutePath);

	// Step 3: Parse build.gradle.kts with variable substitution
	const gradleConfig = await parseBuildGradle(absolutePath, properties);

	// Step 4: Detect mapping era and resolve sources jar
	const sourcesJar = await resolveSourcesJar(gradleConfig);

	// Step 5: Parse fabric.mod.json
	const fabricMod = await parseFabricMod(absolutePath);

	// Step 6: Resolve dependency source jar paths
	const dependencyJars = await resolveDependencyJars(gradleConfig);

	return { name, path: absolutePath, gradleConfig, sourcesJar, fabricMod, dependencyJars };
}
```

### Pattern 2: Gradle Variable Substitution
**What:** Parse `gradle.properties` as key=value pairs, then replace `${var_name}` in build.gradle.kts strings
**When to use:** Reading build.gradle.kts dependency coordinates
**Example:**
```typescript
// gradle.properties is Java properties format:
// minecraft_version=1.21.11
// yarn_mappings=1.21.11+build.4
// Lines starting with # are comments, blank lines ignored
function parseGradleProperties(content: string): Map<string, string> {
	const props = new Map<string, string>();
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		props.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
	}
	return props;
}
```

### Pattern 3: Dependency Extraction from build.gradle.kts
**What:** Regex extraction of dependency declarations from the `dependencies { ... }` block
**When to use:** Parsing all dependency coordinates
**Example:**
```typescript
// Real examples from test projects:
//   minecraft("com.mojang:minecraft:${minecraft_version}")
//   mappings("net.fabricmc:yarn:${yarn_mappings}")
//   modImplementation("net.fabricmc:fabric-loader:${loader_version}")
//   implementation("net.fabricmc:fabric-loader:${loader_version}")
//
// Pattern: configName("group:artifact:version")
// After variable substitution, extract Maven coordinates

// Step 1: Extract dependencies block
const depsBlockRegex = /dependencies\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s;

// Step 2: Extract individual dependency calls
// Matches: word("string") where string may be a Maven coordinate
const depCallRegex = /(\w+)\(\s*"([^"]+)"\s*\)/g;
```

### Pattern 4: Data Model Types
**What:** TypeScript interfaces for the project state
**Example:**
```typescript
type MappingEra = 'yarn' | 'unobfuscated';

interface DependencyCoordinate {
	configuration: string;  // "minecraft", "mappings", "modImplementation", etc.
	group: string;          // "com.mojang", "net.fabricmc"
	artifact: string;       // "minecraft", "yarn", "fabric-loader"
	version: string;        // "1.21.11", "1.21.11+build.4"
	raw: string;            // "com.mojang:minecraft:1.21.11"
}

interface GradleConfig {
	minecraftVersion: string;
	mappingEra: MappingEra;
	yarnMappings?: string;          // Only for yarn era
	loaderVersion?: string;
	fabricApiVersion?: string;
	dependencies: DependencyCoordinate[];
}

interface FabricModJson {
	schemaVersion: number;
	id: string;
	version: string;
	name: string;
	description: string;
	authors: string[];
	license: string;
	environment: string;
	mixins: string[];
	depends: Record<string, string>;
}

interface ResolvedJar {
	path: string;
	exists: boolean;
}

interface LoadedProject {
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, ResolvedJar>;  // keyed by "group:artifact:version"
}
```

### Anti-Patterns to Avoid
- **Full Kotlin DSL parser:** Don't build an AST parser. These build.gradle.kts files use simple single-line patterns. Regex is appropriate.
- **Iterating Loom cache directories:** Don't scan the cache looking for jars. Construct the exact path from parsed coordinates.
- **Lazy loading:** Don't defer validation. Fail fast at startup if the project is misconfigured.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Java properties parsing | Full spec parser with escape sequences, multiline values | Simple line-by-line split on `=` | Gradle properties files in Fabric projects use only simple `key=value` pairs. No Unicode escapes, no multiline values, no backslash continuations in practice. |
| JSON parsing for fabric.mod.json | Custom parser | `JSON.parse()` + Zod validation | Standard JSON, validate shape with Zod |
| Path construction | String concatenation | `path.join()` / `path.resolve()` | Cross-platform correctness (though macOS-only currently) |

## Common Pitfalls

### Pitfall 1: Yarn Version Sanitization
**What goes wrong:** Constructing the wrong Loom cache path because the yarn version string is not correctly transformed.
**Why it happens:** The Loom cache version string has a specific structure that interleaves the raw MC version, a sanitized MC version (dots to underscores), and the raw yarn mappings string.
**How to avoid:** Use the verified formula:
- Yarn mappings value: `1.21.11+build.4` (from gradle.properties)
- Mappings dependency: `net.fabricmc:yarn:1.21.11+build.4` (from build.gradle.kts)
- The Loom cache version is: `{mc_version}-net.fabricmc.yarn.{mc_version.replace(/\./g, '_')}.{yarn_mappings}`
- Example: `1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4`
- This was verified against two real yarn-era paths on disk.
**Warning signs:** Sources jar not found at constructed path.

### Pitfall 2: Dependency Block Parsing Edge Cases
**What goes wrong:** Missing dependencies because of comments, multi-line calls, or nested blocks inside `dependencies {}`.
**Why it happens:** The `dependencies` block can contain comments, conditional logic, or nested blocks.
**How to avoid:** The real test projects use simple single-line patterns. Strip comments first (both `//` and `/* */`), then extract the `dependencies { ... }` block, then match individual calls. Don't try to handle deeply nested Kotlin logic -- it doesn't appear in standard Fabric mod buildscripts.
**Warning signs:** Dependency count is unexpectedly low.

### Pitfall 3: `val x: String by project` vs `${x}`
**What goes wrong:** Missing that build.gradle.kts declares project-delegated properties at the top of the file, which are then used directly as variables (not just in string interpolation).
**Why it happens:** Kotlin DSL can reference gradle.properties values two ways:
1. `val minecraft_version: String by project` then `${minecraft_version}` in strings
2. Direct property reference `project.property("key")`
**How to avoid:** The `val x: String by project` pattern just brings gradle.properties values into scope. Since we do string interpolation from gradle.properties anyway, both patterns resolve the same way. The key insight: scan for `${var_name}` in strings and replace from gradle.properties values.
**Warning signs:** Unreplaced `${...}` tokens in extracted dependency coordinates.

### Pitfall 4: fabric.mod.json with Template Variables
**What goes wrong:** `fabric.mod.json` contains `${version}` which is a Gradle template variable, not a literal value.
**Why it happens:** The `processResources` task expands this at build time, but the raw file on disk still has `${version}`.
**How to avoid:** Accept `${version}` as-is in the parsed output, or substitute from `build.gradle.kts` `version` property. Since this is the source file (not the built artifact), template variables are expected. Document this in the response metadata.
**Warning signs:** `version` field in fabric.mod.json is literally `"${version}"`.

### Pitfall 5: Path Resolution for `--project .`
**What goes wrong:** Relative path `.` is not resolved to absolute before use.
**Why it happens:** `path.basename('.')` returns `'.'`, not the directory name.
**How to avoid:** Always `path.resolve(projectPath)` first, then `path.basename()` on the resolved absolute path.
**Warning signs:** Project name is `"."` instead of the directory name.

### Pitfall 6: Home Directory in Cache Path
**What goes wrong:** Using literal `~` in path construction.
**Why it happens:** `~` is a shell expansion, not a filesystem path.
**How to avoid:** Use `os.homedir()` or `process.env.HOME` to get the actual home directory path.
**Warning signs:** `ENOENT` on paths starting with `~`.

## Code Examples

### Verified Loom Cache Paths (from real filesystem)

**Yarn era** (MC 1.21.11, yarn 1.21.11+build.4):
```
~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged/
  1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/
    minecraft-merged-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4-sources.jar
```

**Unobfuscated era** (MC 26.2-snapshot-2, no mappings):
```
~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/
  26.2-snapshot-2/
    minecraft-merged-deobf-26.2-snapshot-2-sources.jar
```

### Real build.gradle.kts Patterns Found

**Yarn-era project** (`/Users/LoganDark/Documents/Projects/CreatorCore/Debrand/build.gradle.kts`):
```kotlin
val minecraft_version: String by project
val yarn_mappings: String by project
val loader_version: String by project
val fabric_api_version: String by project

dependencies {
    minecraft("com.mojang:minecraft:${minecraft_version}")
    mappings("net.fabricmc:yarn:${yarn_mappings}")
    modImplementation("net.fabricmc:fabric-loader:${loader_version}")
}
```

**Unobfuscated-era project** (`/Users/LoganDark/IdeaProjects/debrand/build.gradle.kts`):
```kotlin
val minecraft_version: String by project
val loader_version: String by project
val fabric_api_version: String by project

dependencies {
    minecraft("com.mojang:minecraft:${minecraft_version}")
    implementation("net.fabricmc:fabric-loader:${loader_version}")
}
```

Key difference: No `mappings(...)` call and no `yarn_mappings` property in unobfuscated era.

### Real gradle.properties Values

**Yarn era:**
```properties
minecraft_version=1.21.11
yarn_mappings=1.21.11+build.4
loader_version=0.18.6
loom_version=1.16-SNAPSHOT
fabric_api_version=0.141.3+1.21.11
```

**Unobfuscated era:**
```properties
minecraft_version=26.2-snapshot-2
loader_version=0.18.6
loom_version=1.16-SNAPSHOT
fabric_api_version=0.145.5+26.2
```

### Real fabric.mod.json Structure

```json
{
    "schemaVersion": 1,
    "id": "debrand",
    "version": "${version}",
    "name": "Debrand",
    "description": "Removes Fabric branding from client and server",
    "authors": ["LoganDark"],
    "contact": {},
    "license": "ARR",
    "environment": "*",
    "mixins": ["Debrand.mixins.json"],
    "depends": {
        "minecraft": "1.21.11"
    }
}
```

Note: `"version": "${version}"` is a Gradle template -- raw file has the placeholder.

### Yarn Version to Cache Path Construction

```typescript
function buildYarnCacheVersion(mcVersion: string, yarnMappings: string): string {
    const sanitizedMcVersion = mcVersion.replace(/\./g, '_');
    return `${mcVersion}-net.fabricmc.yarn.${sanitizedMcVersion}.${yarnMappings}`;
}

// buildYarnCacheVersion("1.21.11", "1.21.11+build.4")
// => "1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4"
```

### Dependency Source Jar Path Pattern

Dependency source jars live in the standard Gradle module cache:
```
~/.gradle/caches/modules-2/files-2.1/{group}/{artifact}/{version}/{hash}/{artifact}-{version}-sources.jar
```

Example: `~/.gradle/caches/modules-2/files-2.1/net.fabricmc/fabric-loader/0.18.6/e0f788dc9ea96aeccba0fcbf6f3065b0ded89664/fabric-loader-0.18.6-sources.jar`

The `{hash}` directory is unpredictable -- need to glob for it. This is Phase 3 work but the path pattern should be stored now.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Yarn mappings required | Unobfuscated era (no mappings) | MC 26.1+ | Two cache path patterns, era detection logic needed |
| `modImplementation` for loader | `implementation` for loader | Unobfuscated era buildscripts | Dependency configuration names differ between eras |

## Open Questions

1. **Yarn version sanitization edge cases**
   - What we know: Dots in MC version -> underscores. Verified for `1.21.11` -> `1_21_11` and `1.21.10` -> `1_21_10`.
   - What's unclear: How snapshot versions like `26.2-snapshot-2` would be sanitized if they ever had yarn mappings (they don't in the unobfuscated era, so this is moot).
   - Recommendation: Handle the known pattern. If an edge case appears, the error message will include the tried path, making debugging easy.

2. **Dependency source jar hash directories**
   - What we know: Source jars are at `~/.gradle/caches/modules-2/files-2.1/{group}/{artifact}/{version}/{hash}/{artifact}-{version}-sources.jar` where `{hash}` is a SHA-1.
   - What's unclear: Whether to glob for the hash directory now or defer.
   - Recommendation: Store the dependency coordinates now. Glob resolution of source jar paths can be done in Phase 3 or done now for completeness (user decision says "resolve dependency source jar paths, existence check, store for Phase 3").

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
| PROJ-01 | Load project from directory path, parse config, return metadata | integration | `pnpm vitest run tests/project/loader.test.ts -t "loads yarn-era project"` | No -- Wave 0 |
| PROJ-01 | Reject missing/invalid project directory | unit | `pnpm vitest run tests/project/loader.test.ts -t "rejects"` | No -- Wave 0 |
| PROJ-06 | Parse gradle.properties and build.gradle.kts, resolve sources jar | unit | `pnpm vitest run tests/project/gradle-parser.test.ts` | No -- Wave 0 |
| PROJ-06 | Construct correct Loom cache path for yarn era | unit | `pnpm vitest run tests/project/loom-cache.test.ts -t "yarn"` | No -- Wave 0 |
| PROJ-11 | Detect yarn era (has mappings call) | unit | `pnpm vitest run tests/project/gradle-parser.test.ts -t "yarn era"` | No -- Wave 0 |
| PROJ-11 | Detect unobfuscated era (no mappings call) | unit | `pnpm vitest run tests/project/gradle-parser.test.ts -t "unobfuscated"` | No -- Wave 0 |
| PROJ-11 | Construct correct Loom cache path for unobfuscated era | unit | `pnpm vitest run tests/project/loom-cache.test.ts -t "unobfuscated"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project/gradle-parser.test.ts` -- covers PROJ-06, PROJ-11 (parsing)
- [ ] `tests/project/loom-cache.test.ts` -- covers PROJ-06, PROJ-11 (path resolution)
- [ ] `tests/project/loader.test.ts` -- covers PROJ-01 (integration)
- [ ] `tests/project/fabric-mod.test.ts` -- covers fabric.mod.json parsing
- [ ] `tests/fixtures/` -- test fixture files (mock gradle.properties, build.gradle.kts, fabric.mod.json)

## Sources

### Primary (HIGH confidence)
- Real filesystem inspection of `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/` -- verified both era paths
- Real POM files confirming artifactId and version strings
- Real `build.gradle.kts` and `gradle.properties` from two test projects
- Real `fabric.mod.json` from both test projects
- Existing Phase 1 codebase at `/Users/LoganDark/Documents/Projects/MinecraftDevMCP/src/`

### Secondary (MEDIUM confidence)
- None needed -- all findings verified against real filesystem

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all built-in Node.js APIs
- Architecture: HIGH - Verified against real project structures on disk
- Pitfalls: HIGH - Derived from actual file contents and real cache paths
- Loom cache paths: HIGH - Verified against actual files on disk with POM confirmation

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable -- Loom cache conventions change rarely)
