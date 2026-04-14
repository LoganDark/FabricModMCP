# Phase 5: Project Metadata - Research

**Researched:** 2026-04-13
**Domain:** MCP tool implementation, dependency provenance tracking, structured metadata responses
**Confidence:** HIGH

## Summary

Phase 5 creates a single `get_project_metadata` MCP tool that exposes rich, structured metadata about a loaded project. All underlying data is already parsed and stored in `LoadedProject` from Phases 2-4 -- this phase primarily involves assembling existing data into a well-structured response, with one significant extension: adding provenance chain tracking to `DependencyEntry` during dependency discovery.

The implementation is straightforward because the data sources are mature and well-tested: `GradleConfig` has version/era info (META-01, META-05), `FabricModJson` has mod metadata (META-02), and `dependencyJars` Map has jar inventory (META-03). The only new algorithmic work is extending `followTransitiveDeps` in `dependency-discovery.ts` to record the dependency chain path for each entry (META-04).

**Primary recommendation:** Implement in two plans -- first extend `DependencyEntry` with provenance chains in the discovery layer, then build the `get_project_metadata` tool that assembles all data into a single response with optional category flags.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single `get_project_metadata` tool with optional boolean flags to select which categories to include
- Categories: project info (versions/mappings/era), mod info (fabric.mod.json), jar inventory (all source jars)
- Omitting all flags returns everything (or define a sensible default)
- Tool uses standard `resolveProject(name?)` for project resolution
- Mod info: structured typed fields for known properties + separate `extra` object via Zod `.passthrough()`
- Jar inventory includes ALL source entries with: identifier, category, group, artifact, version, file size on disk (bytes via `stat`), availability
- Unavailable jars included in inventory (sources not found)
- File paths hidden by default; optional boolean flag to include paths
- Provenance tracking: extend Phase 3's dependency discovery to track full dependency chains during traversal
- Each dependency records ALL paths that lead to it, not just the first one
- Stored on `DependencyEntry` -- not re-computed at query time
- Identifier remains based on physical jar location, not the path that discovered it
- Full chain exposed: e.g., `fabric-api -> fabric-networking -> guava`
- Mapping era included in project info category response

### Claude's Discretion
- Exact response structure and field naming within the envelope
- Default behavior when no category flags are specified (all vs. summary)
- How provenance chains are serialized in the response (array of arrays, nested objects, etc.)
- Whether mod `depends` map values are version strings or parsed version ranges
- File size formatting (raw bytes only, or also human-readable)

### Deferred Ideas (OUT OF SCOPE)
None

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| META-01 | Structured project metadata: MC version, mappings, loader, Fabric API version | `GradleConfig` already has all fields. Direct read from `LoadedProject.gradleConfig`. |
| META-02 | Mod metadata from fabric.mod.json | `FabricModJson` already parsed with `.passthrough()`. Split into typed fields + `extra` object in response. |
| META-03 | List all source jars with identifiers, types, sizes | `dependencyJars` Map has id/category/version/available. Add `fs.stat()` for file sizes at query time. |
| META-04 | Granular provenance per source jar | Extend `DependencyEntry` with `provenanceChains: string[][]` field. Modify `followTransitiveDeps` to pass chain context. |
| META-05 | Mapping era in metadata responses | `GradleConfig.mappingEra` already exists as `'yarn' | 'unobfuscated'`. Include in project info response. |

</phase_requirements>

## Standard Stack

### Core
No new libraries needed. All dependencies are already in place.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.x (installed: ^4.3.6) | Tool parameter schema | Already used for all tool input schemas |
| node:fs/promises | N/A (built-in) | `stat()` for jar file sizes | Built-in, no dependency needed |

### Supporting
No additional supporting libraries required.

### Alternatives Considered
None -- this phase uses only existing infrastructure.

## Architecture Patterns

### Recommended Project Structure
```
src/
  project/
    types.ts              # Add provenanceChains to DependencyEntry
    dependency-discovery.ts  # Extend to track chains during traversal
  tools/
    get-project-metadata.ts  # New tool implementation
    index.ts              # Register new tool
```

### Pattern 1: Category Flag Tool Parameters
**What:** Boolean flags on the tool input to select which metadata categories to include in the response.
**When to use:** When a single tool returns a large composite response and callers may only need a subset.
**Example:**
```typescript
inputSchema: {
	project: z.string().optional().describe('Project name'),
	include_project_info: z.boolean().optional().describe('Include version/mappings info'),
	include_mod_info: z.boolean().optional().describe('Include fabric.mod.json metadata'),
	include_jar_inventory: z.boolean().optional().describe('Include all source jar entries'),
	include_paths: z.boolean().optional().describe('Include file system paths for jars'),
},
```

**Default behavior recommendation:** When no flags are specified, include all categories. This follows SERV-05 ("err on the side of providing more information") and means Claude gets everything on first call without needing to know the flag names.

### Pattern 2: Provenance Chain Tracking During Traversal
**What:** Pass the current dependency chain as context through recursive `followTransitiveDeps`, recording all paths to each dependency.
**When to use:** When you need to know not just what dependencies exist, but how they were reached.
**Example:**
```typescript
// In DependencyEntry (types.ts):
provenanceChains: string[][];  // e.g., [["fabric-api", "fabric-networking-api-v1"], ["fabric-api", "fabric-events-v1"]]

// In followTransitiveDeps:
async function followTransitiveDeps(
	deps: Map<string, DependencyEntry>,
	group: string,
	artifact: string,
	version: string,
	visited: Set<string>,
	depth: number,
	chain: string[],  // NEW: current path from root
): Promise<void> {
```

**Serialization recommendation:** Array of arrays of strings, where each inner array is a path from root to the dependency. Simple, flat, JSON-serializable. Example:
```json
{
	"provenanceChains": [
		["fabric-api", "fabric-networking-api-v1", "com.google.guava:guava"],
		["fabric-api", "fabric-events-v1", "com.google.guava:guava"]
	]
}
```

### Pattern 3: Extra Fields Extraction from Passthrough Zod
**What:** Separate `.passthrough()` parsed data into known typed fields and an `extra` object for the response.
**When to use:** When the parsed object has known fields plus arbitrary additional ones.
**Example:**
```typescript
// FabricModJson already has typed fields. For the response:
const { schemaVersion, id, version, name, description, authors, license, environment, mixins, depends, ...extra } = project.fabricMod;

const modInfo = {
	id, name, version, description, authors, license, environment, mixins, depends,
	extra: Object.keys(extra).length > 0 ? extra : undefined,
};
```

### Pattern 4: Established Tool Registration Pattern
**What:** Every tool follows the same structure: Zod schema, handler function, DomainError catch, envelope response.
**When to use:** All tools.
**Example:**
```typescript
export function registerGetProjectMetadataTool(server: McpServer): void {
	server.registerTool(
		'get_project_metadata',
		{
			title: 'Get Project Metadata',
			description: '...',
			inputSchema: { /* Zod schemas */ },
		},
		async (params) => {
			let project;
			try {
				project = projectStore.resolveProject(params.project);
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					const envelope = makeError(de.code, de.message, de.tried ?? [], de.suggestions);
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
						structuredContent: envelope,
					};
				}
				throw error;
			}
			// ... build response from project data
		},
	);
}
```

### Anti-Patterns to Avoid
- **Re-computing provenance at query time:** The CONTEXT.md explicitly states provenance is stored on `DependencyEntry`, not re-computed. Do not walk POM files during tool execution.
- **Separate tools per category:** User decided on a single tool with flags, not `get_project_versions`, `get_mod_info`, etc.
- **Omitting unavailable jars:** Unavailable jars (sources not found) MUST be included in inventory. They tell Claude "this dependency exists but source isn't readable."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File size in bytes | Manual byte counting | `fs.stat(path).size` | Correct, handles symlinks, OS-portable |
| JSON response serialization | Custom stringifier | `JSON.stringify(envelope, null, 2)` | Already used by all tools |
| Zod passthrough extra extraction | Manual field filtering | Object spread/destructure | TypeScript handles the types correctly |

## Common Pitfalls

### Pitfall 1: Mutating DependencyEntry During Discovery
**What goes wrong:** The `addDependencyEntry` function currently skips if `deps.has(id)` returns true. With provenance chains, a dependency reached via a second path needs its chains array updated even though the entry already exists.
**Why it happens:** The early-return guard was correct when entries were write-once. With provenance chains, the same entry may be discovered via multiple paths.
**How to avoid:** After the `deps.has(id)` check, if the entry exists, append the new chain to `provenanceChains` instead of returning. Only skip the sources jar lookup (it's already resolved).
**Warning signs:** Dependencies showing only one provenance chain when they should have multiple.

### Pitfall 2: Circular Dependencies in POM Traversal
**What goes wrong:** Provenance chain grows infinitely if a circular dependency exists.
**Why it happens:** The `visited` set prevents re-traversal but does not prevent chain recording for already-visited nodes.
**How to avoid:** The existing `visited` guard already prevents infinite recursion. When a visited node is encountered, still record the chain on the existing entry but do not recurse further. The depth limit of 5 is an additional safety net.
**Warning signs:** Chains longer than depth limit.

### Pitfall 3: stat() on Non-Existent Jar Paths
**What goes wrong:** `fs.stat()` throws on null paths or missing files.
**Why it happens:** `DependencyEntry.sourcesJarPath` can be null (unavailable jars). Even non-null paths may have been deleted since discovery.
**How to avoid:** Only call `stat()` when `sourcesJarPath` is non-null and `available` is true. Wrap in try/catch, return `null` size on failure.
**Warning signs:** Unhandled promise rejections during jar inventory building.

### Pitfall 4: Mod Source Entry Missing Provenance
**What goes wrong:** The `src` entry (mod source) is manually seeded in `discoverDependencies` with no POM traversal. It won't have provenance chains unless explicitly handled.
**Why it happens:** `src` and `minecraft` are special-cased seed entries, not discovered via POM.
**How to avoid:** Seed entries get empty provenance chains (they are roots, not transitive deps). Document this in the response -- `minecraft` and `src` have `provenanceChains: []` meaning "direct/root dependency."
**Warning signs:** `provenanceChains` being undefined for seed entries.

### Pitfall 5: FabricModJson Type vs Runtime Shape
**What goes wrong:** The TypeScript `FabricModJson` interface lists specific typed fields, but the actual parsed object (due to `.passthrough()`) may have additional fields that TypeScript doesn't know about.
**Why it happens:** Zod `.passthrough()` preserves unknown keys, but the interface doesn't declare them.
**How to avoid:** When destructuring for the `extra` object, use the actual parsed result (which has the extra keys at runtime) rather than the typed interface. Cast to `Record<string, unknown>` if needed for the spread.
**Warning signs:** `extra` always being empty even when fabric.mod.json has additional fields.

## Code Examples

### Building Project Info Response
```typescript
// Source: LoadedProject.gradleConfig (already parsed in Phase 2)
function buildProjectInfo(project: LoadedProject) {
	const gc = project.gradleConfig;
	return {
		minecraftVersion: gc.minecraftVersion,
		mappingEra: gc.mappingEra,
		yarnMappings: gc.yarnMappings ?? null,
		loaderVersion: gc.loaderVersion ?? null,
		fabricApiVersion: gc.fabricApiVersion ?? null,
	};
}
```

### Building Mod Info Response
```typescript
// Source: LoadedProject.fabricMod (parsed with .passthrough() in Phase 2)
function buildModInfo(project: LoadedProject) {
	const { schemaVersion, id, version, name, description, authors, license, environment, mixins, depends, ...extra } = project.fabricMod as Record<string, unknown>;
	return {
		id, name, version, description, authors, license, environment, mixins, depends,
		extra: Object.keys(extra).length > 0 ? extra : undefined,
	};
}
```

### Building Jar Inventory with File Sizes
```typescript
import { stat } from 'node:fs/promises';

async function buildJarInventory(project: LoadedProject, includePaths: boolean) {
	const entries = [];
	for (const [id, dep] of project.dependencyJars) {
		let sizeBytes: number | null = null;
		if (dep.sourcesJarPath && dep.available) {
			try {
				const s = await stat(dep.sourcesJarPath);
				sizeBytes = s.size;
			} catch {
				sizeBytes = null;
			}
		}

		const entry: Record<string, unknown> = {
			id: dep.id,
			category: dep.category,
			group: dep.group,
			artifact: dep.artifact,
			version: dep.version,
			available: dep.available,
			sizeBytes,
			provenanceChains: dep.provenanceChains,
		};

		if (includePaths && dep.sourcesJarPath) {
			entry.sourcesJarPath = dep.sourcesJarPath;
		}

		entries.push(entry);
	}
	return entries;
}
```

### Extending followTransitiveDeps with Chain Tracking
```typescript
// Modified signature -- adds chain parameter
async function followTransitiveDeps(
	deps: Map<string, DependencyEntry>,
	group: string,
	artifact: string,
	version: string,
	visited: Set<string>,
	depth: number,
	chain: string[],
): Promise<void> {
	if (depth > 5) return;

	const coordKey = `${group}:${artifact}:${version}`;
	if (visited.has(coordKey)) return;
	visited.add(coordKey);

	const pomPath = await findPomInModules2(group, artifact, version);
	if (!pomPath) return;

	try {
		const pomContent = await readFile(pomPath, 'utf-8');
		const pomDeps = parsePomDependencies(pomContent);

		for (const dep of pomDeps) {
			if (dep.scope !== 'compile') continue;
			if (!dep.version) continue;

			const depId = `${dep.groupId}:${dep.artifactId}`;
			const newChain = [...chain, depId];
			await addDependencyEntry(deps, dep.groupId, dep.artifactId, dep.version, 'library', newChain);
			await followTransitiveDeps(deps, dep.groupId, dep.artifactId, dep.version, visited, depth + 1, newChain);
		}
	} catch {
		// Malformed POM or read error -- skip
	}
}
```

### Modified addDependencyEntry with Chain Recording
```typescript
async function addDependencyEntry(
	deps: Map<string, DependencyEntry>,
	group: string,
	artifact: string,
	version: string,
	category: DependencyEntry['category'],
	chain: string[] = [],
): Promise<void> {
	const id = `${group}:${artifact}`;
	const existing = deps.get(id);

	if (existing) {
		// Entry exists -- record additional provenance chain if non-empty
		if (chain.length > 0) {
			existing.provenanceChains.push(chain);
		}
		return;
	}

	const sourcesJarPath = await findSourcesJar(group, artifact, version);
	deps.set(id, {
		id,
		group,
		artifact,
		version,
		category,
		sourcesJarPath,
		available: sourcesJarPath !== null,
		provenanceChains: chain.length > 0 ? [chain] : [],
	});
}
```

## State of the Art

No relevant changes since Phase 4. All libraries remain current.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | N/A | N/A | N/A |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| META-01 | Project info (versions, mappings) returned in response | unit | `pnpm vitest run tests/tools/get-project-metadata.test.ts -t "project info"` | No -- Wave 0 |
| META-02 | Mod info from fabric.mod.json with typed + extra fields | unit | `pnpm vitest run tests/tools/get-project-metadata.test.ts -t "mod info"` | No -- Wave 0 |
| META-03 | Jar inventory with ids, types, sizes, availability | unit | `pnpm vitest run tests/tools/get-project-metadata.test.ts -t "jar inventory"` | No -- Wave 0 |
| META-04 | Provenance chains stored on DependencyEntry | unit | `pnpm vitest run tests/project/dependency-discovery.test.ts -t "provenance"` | No -- Wave 0 |
| META-05 | Mapping era included in project info | unit | `pnpm vitest run tests/tools/get-project-metadata.test.ts -t "mapping era"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/get-project-metadata.test.ts` -- covers META-01, META-02, META-03, META-05
- [ ] `tests/project/dependency-discovery.test.ts` -- extend existing file with provenance chain tests for META-04

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/project/types.ts`, `src/project/dependency-discovery.ts`, `src/project/fabric-mod.ts`, `src/project/gradle-parser.ts`
- Codebase analysis: `src/tools/load-project.ts`, `src/tools/list-projects.ts`, `src/tools/read-jar-entry.ts` (established tool patterns)
- Codebase analysis: `src/state/project-store.ts` (resolveProject pattern)
- Codebase analysis: `src/types/envelope.ts` (makeSuccess/makeError pattern)
- Codebase analysis: `tests/tools/load-project.test.ts` (established test patterns)

### Secondary (MEDIUM confidence)
None needed -- this phase is entirely internal to the existing codebase.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all infrastructure exists
- Architecture: HIGH -- follows established tool patterns from Phases 1-4
- Pitfalls: HIGH -- identified from direct code analysis of dependency-discovery.ts and types.ts

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- internal codebase, no external API changes expected)
