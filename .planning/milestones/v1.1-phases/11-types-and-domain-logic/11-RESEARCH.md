# Phase 11: Types and Domain Logic - Research

**Researched:** 2026-04-13
**Domain:** TypeScript domain model extension, jar handle lifecycle management, cache eviction
**Confidence:** HIGH

## Summary

Phase 11 is a pure domain-layer extension to an existing, well-structured TypeScript codebase. It adds the `StudyJar` type, extends `JarReader` with granular add/remove methods, adds single-entry eviction to `EntryIndex` cache, and introduces the `study:` namespace prefix with collision detection. No new libraries are needed -- all work uses existing patterns and infrastructure.

The codebase already has a clean ref-counting pattern in `JarReader`, a simple `Map`-based entry index cache, and a well-defined `LoadedProject` type. Phase 11 extends each of these with minimal surface area. The key design challenge is ensuring `refresh_dependencies` does not destroy the `studyJars` map -- which the existing code already handles naturally since `refresh_dependencies` replaces `dependencyJars` but does not touch other fields on `LoadedProject`.

**Primary recommendation:** Follow existing patterns exactly -- add `studyJars: Map<string, StudyJar>` to `LoadedProject`, add `addProjectJar()`/`removeProjectJar()` to `JarReader`, export `evictEntryIndex()` from `entry-index-cache.ts`, and add `'study'` to `JarCategory`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Names are user-supplied, auto-derived from jar filename stem when not specified
- Safe character subset only: alphanumeric, hyphens, dots (no colons, spaces, special characters)
- Name collision with existing study jar on same project is a hard error
- Names are case-sensitive
- Same jar file path allowed under multiple names, silently accepted
- Paths normalized via `realpath()` before storage
- JarReader ref-counting handles shared underlying handles naturally
- Store last-modified time and file size at jar open time; check mtime+size on each access
- If either changed, reopen handle automatically
- `refresh_dependencies` triggers staleness checks on all study jars
- Study jars are fully ephemeral (lost on project unload)
- Study jars survive `refresh_dependencies` (separate `studyJars` map)
- No persistence file
- Accept any valid ZIP file (no .java requirement)
- Return stats on successful add: package count, class count, total entries
- Helpful error messages on failure
- No size or entry count limits

### Claude's Discretion
- Exact `StudyJar` interface field names and types
- Safe character validation regex
- Auto-derive name sanitization (how filename maps to valid name)
- Staleness check implementation details (where in read path to check)
- Stats computation approach

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | JarReader supports granular add/remove of individual jar handles per project | Existing `registerProject()` sets the full jar set; new `addProjectJar()`/`removeProjectJar()` methods add/remove individual paths from `projectHandles` while maintaining ref-counting |
| INFRA-02 | EntryIndex cache supports single-entry eviction when a study jar is removed | Cache is a plain `Map<string, EntryIndex>`; add `evictEntryIndex(cacheKey: string)` that calls `entryIndexCache.delete(cacheKey)` |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-stream-zip | 1.15.x | Reading study jar entries | Already used for all jar reading; study jars use identical pattern |
| vitest | 4.x | Testing | Already configured; test dir at `tests/` |

### Supporting (Node.js built-ins)
| API | Purpose | When to Use |
|-----|---------|-------------|
| `fs.realpath()` | Path normalization for study jar paths | On add, before storing path |
| `fs.stat()` | Get mtime + size for staleness detection | On add (store baseline) and on access (check freshness) |
| `path.basename()` / `path.parse()` | Auto-derive name from jar filename | When name not supplied |

No new dependencies needed.

## Architecture Patterns

### Recommended Changes by File

```
src/project/types.ts          # Add StudyJar interface, update JarCategory, update LoadedProject
src/project/jar-reader.ts     # Add addProjectJar(), removeProjectJar(), staleness check
src/browsing/entry-index-cache.ts  # Add evictEntryIndex() export
```

### Pattern 1: StudyJar Type Definition

**What:** New interface on `types.ts` representing a study jar tracked on a project.
**When to use:** Stored in `LoadedProject.studyJars` map, keyed by study jar name.

```typescript
// src/project/types.ts additions

export interface StudyJar {
	name: string;              // user-supplied or auto-derived
	jarPath: string;           // realpath()-normalized absolute path
	mtime: number;             // Date.getTime() at open
	size: number;              // bytes at open
	autoInclude: boolean;      // default false, Phase 12 uses this
	stats: StudyJarStats;      // computed on add
}

export interface StudyJarStats {
	totalEntries: number;      // all entries in ZIP
	packageCount: number;      // distinct Java packages
	classCount: number;        // top-level .java files (not inner classes)
}

// Update JarCategory:
export type JarCategory = 'minecraft' | 'mod-source' | 'fabric-api' | 'library' | 'study';

// Update LoadedProject:
export interface LoadedProject {
	// ... existing fields ...
	studyJars: Map<string, StudyJar>;
}
```

**Why this shape:**
- `name` duplicates the map key for self-contained serialization in tool responses
- `jarPath` is the realpath-normalized path, also used as the `entryIndexCache` key and `JarReader` handle key
- `mtime`/`size` enable staleness detection without storing a file handle
- `autoInclude` is false by default per STUDY-04; Phase 12 reads it
- `stats` is computed once on add, cheaply recomputed on stale reopen

### Pattern 2: Study Jar ID Namespace

**What:** Study jar IDs use `study:<name>` format to avoid collision with existing dependency IDs.
**When to use:** Anywhere a jar ID is used (tool parameters, filtering, sorting).

```typescript
// Collision detection: check that `study:<name>` does not match any existing dependency ID
function validateStudyJarId(name: string, project: LoadedProject): void {
	const id = `study:${name}`;
	if (project.dependencyJars.has(id)) {
		throw new DomainError(
			'STUDY_JAR_ID_COLLISION',
			`Study jar ID '${id}' collides with an existing dependency ID`,
			[id],
			['Choose a different name for the study jar'],
		);
	}
}
```

**Note:** Existing dependency IDs are `minecraft`, `src`, or `group:artifact` format. The `study:` prefix is collision-safe by design since no Maven group is named `study`. But the explicit check guards against edge cases.

### Pattern 3: Granular Add/Remove on JarReader (INFRA-01)

**What:** New methods that modify a project's jar path set incrementally instead of replacing it.
**When to use:** When adding or removing a single study jar.

```typescript
// src/project/jar-reader.ts additions

addProjectJar(projectName: string, jarPath: string): void {
	const paths = this.projectHandles.get(projectName);
	if (!paths) {
		throw new DomainError(
			'PROJECT_NOT_REGISTERED',
			`Project '${projectName}' is not registered with the jar reader`,
			[projectName],
			['Load the project first'],
		);
	}
	paths.add(jarPath);
}

async removeProjectJar(projectName: string, jarPath: string): Promise<void> {
	const paths = this.projectHandles.get(projectName);
	if (!paths) return;
	paths.delete(jarPath);

	// Check if any other project still references this jar
	let shared = false;
	for (const [otherName, otherPaths] of this.projectHandles) {
		if (otherName !== projectName && otherPaths.has(jarPath)) {
			shared = true;
			break;
		}
	}
	if (!shared) {
		await this.close(jarPath);
	}
}
```

**Key insight:** This follows the exact same ref-counting pattern as `closeProject()`. The `removeProjectJar` method is essentially `closeProject` scoped to a single path.

### Pattern 4: Staleness Detection

**What:** Before reading from a study jar, check if the file has been modified since last open.
**When to use:** On every read access to a study jar handle.

```typescript
// Conceptual approach -- staleness check wraps getHandle()

async checkStaleness(studyJar: StudyJar): Promise<boolean> {
	const stat = await fs.stat(studyJar.jarPath);
	return stat.mtimeMs !== studyJar.mtime || stat.size !== studyJar.size;
}

async reopenIfStale(studyJar: StudyJar): Promise<void> {
	if (await this.checkStaleness(studyJar)) {
		await this.close(studyJar.jarPath);
		// Update stored mtime/size
		const stat = await fs.stat(studyJar.jarPath);
		studyJar.mtime = stat.mtimeMs;
		studyJar.size = stat.size;
		// Also evict entry index cache since entries may have changed
		evictEntryIndex(studyJar.jarPath);
	}
}
```

**Design decision:** Staleness checks happen at the study jar domain layer, not inside JarReader itself. JarReader remains a simple handle pool. The study jar management code (Phase 13 tools or a domain service) calls `reopenIfStale()` before reads. This keeps JarReader unaware of the study jar concept.

### Pattern 5: Single-Entry Cache Eviction (INFRA-02)

**What:** Export a function to delete one entry from the entry index cache.
**When to use:** When a study jar is removed or detected as stale.

```typescript
// src/browsing/entry-index-cache.ts addition

export function evictEntryIndex(cacheKey: string): boolean {
	return entryIndexCache.delete(cacheKey);
}
```

**Why not just expose the map?** The existing pattern exports functions (`getOrBuildIndex`, `clearEntryIndexCache`) rather than the map directly. Adding `evictEntryIndex` follows this encapsulation pattern.

### Pattern 6: Name Validation and Auto-Derivation

**What:** Validate study jar names against safe character subset; auto-derive from filename.
**When to use:** On study jar add.

```typescript
// Safe name regex: alphanumeric, hyphens, dots
const STUDY_JAR_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/;

function validateStudyJarName(name: string): void {
	if (!STUDY_JAR_NAME_PATTERN.test(name)) {
		throw new DomainError(
			'INVALID_STUDY_JAR_NAME',
			`Study jar name '${name}' contains invalid characters`,
			[name],
			['Use only alphanumeric characters, hyphens, and dots', 'Name must start with an alphanumeric character'],
		);
	}
}

function deriveStudyJarName(jarPath: string): string {
	const basename = path.basename(jarPath);
	// Remove extension(s): "foo-1.0-sources.jar" -> "foo-1.0-sources"
	const stem = basename.replace(/\.jar$/i, '');
	// Sanitize: replace invalid chars with hyphens, collapse runs
	const sanitized = stem.replace(/[^a-zA-Z0-9.\-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
	return sanitized || 'unnamed';
}
```

### Anti-Patterns to Avoid
- **Storing study jars in `dependencyJars` map:** This would cause `refresh_dependencies` to destroy them. They MUST be in a separate `studyJars` map.
- **Making JarReader aware of StudyJar type:** JarReader should remain a generic handle pool. Study jar logic (staleness, naming, stats) belongs in a higher layer.
- **Eager stat checking on every JarReader.readEntry:** Only study jars need staleness checks. Dependency jars are immutable cache artifacts. Do not add overhead to the hot path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP reading | Custom ZIP parser | node-stream-zip (already used) | Handles ZIP64, compression methods, central directory indexing |
| Path normalization | Manual `..` resolution | `fs.realpath()` | Handles symlinks, relative paths, OS-specific quirks |
| Glob matching on jar IDs | Custom pattern matcher | picomatch (already used) | Phase 12 will need `study:*` patterns to work with picomatch |

**Key insight:** This phase adds no new library dependencies. Everything builds on existing infrastructure.

## Common Pitfalls

### Pitfall 1: refresh_dependencies Destroying Study Jars
**What goes wrong:** `refresh_dependencies` calls `jarReader.closeProject()` then `jarReader.registerProject()` with only dependency jar paths, which overwrites the project's jar set and drops study jar paths.
**Why it happens:** `registerProject()` does `this.projectHandles.set(projectName, new Set(jarPaths))` -- a full replacement.
**How to avoid:** After `registerProject()` in `refresh_dependencies`, re-add study jar paths. OR change `registerProject` to only set dependency paths and have study jars use `addProjectJar`. The cleanest approach: after `jarReader.registerProject()` in refresh-dependencies.ts, iterate `loadedProject.studyJars` and call `jarReader.addProjectJar()` for each.
**Warning signs:** Study jar reads fail with JAR_OPEN_FAILED after a refresh.

### Pitfall 2: Entry Index Cache Not Evicted on Stale Reopen
**What goes wrong:** A study jar file is rebuilt externally. Staleness detection reopens the handle, but the entry index cache still holds the old index. New/removed classes invisible.
**Why it happens:** `evictEntryIndex()` not called alongside `close()`.
**How to avoid:** Always pair `close()` + `evictEntryIndex()` in the staleness reopen path.
**Warning signs:** `list_classes` shows stale data after jar rebuild.

### Pitfall 3: realpath() Failing on Non-Existent Paths
**What goes wrong:** `fs.realpath()` throws ENOENT if the file does not exist.
**Why it happens:** User provides path to file that does not exist yet or was deleted.
**How to avoid:** Validate file existence before calling `realpath()`. The validation-on-add flow should: (1) check existence, (2) realpath, (3) open ZIP, (4) compute stats.
**Warning signs:** Cryptic ENOENT error instead of helpful "file not found" message.

### Pitfall 4: Name Collision Check Timing
**What goes wrong:** Two concurrent add requests for the same name both pass validation and one overwrites the other.
**Why it happens:** JavaScript is single-threaded for sync code but async operations interleave.
**How to avoid:** Check name collision synchronously before any async work (the map check is sync). Since Node.js is single-threaded, the sync check + sync map insert is atomic.
**Warning signs:** Silent overwrite of study jar entries.

### Pitfall 5: DependencyEntry Compatibility for Study Jars
**What goes wrong:** Downstream tools expect `DependencyEntry` objects but study jars are `StudyJar` objects.
**Why it happens:** Phase 12 needs to include study jars in the same jar iteration as dependencies.
**How to avoid:** Provide a `toDependencyEntry()` helper that creates a `DependencyEntry` from a `StudyJar` for downstream compatibility. This is Phase 12's concern but Phase 11 should design `StudyJar` to make this trivial.
**Warning signs:** Type errors in Phase 12 when iterating mixed jar sets.

## Code Examples

### Creating a StudyJar from a file path
```typescript
// Domain service function (new file: src/project/study-jar-service.ts or inline in types)
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import StreamZip from 'node-stream-zip';
import { EntryIndex } from '../browsing/entry-index.js';
import { decomposeEntryPath } from '../browsing/entry-index.js';

async function createStudyJar(
	jarPath: string,
	name: string | undefined,
	project: LoadedProject,
): Promise<StudyJar> {
	// 1. Validate file exists and normalize path
	const resolvedPath = await realpath(jarPath); // throws ENOENT if missing
	const fileStat = await stat(resolvedPath);

	// 2. Derive or validate name
	const finalName = name ?? deriveStudyJarName(resolvedPath);
	validateStudyJarName(finalName);

	// 3. Check collisions
	if (project.studyJars.has(finalName)) {
		throw new DomainError('STUDY_JAR_NAME_EXISTS', ...);
	}
	validateStudyJarId(finalName, project); // checks study:<name> vs dependencyJars

	// 4. Open and compute stats
	const zip = new StreamZip.async({ file: resolvedPath, storeEntries: true });
	const entries = Object.keys(await zip.entries());
	await zip.close(); // we don't keep this handle; JarReader manages handles

	const javaEntries = entries.filter(e => e.endsWith('.java'));
	const packages = new Set<string>();
	let classCount = 0;
	for (const entry of javaEntries) {
		const decomposed = decomposeEntryPath(entry);
		if (decomposed && !decomposed.isInnerClass) {
			classCount++;
			packages.add(decomposed.packageName);
		}
	}

	return {
		name: finalName,
		jarPath: resolvedPath,
		mtime: fileStat.mtimeMs,
		size: fileStat.size,
		autoInclude: false,
		stats: {
			totalEntries: entries.length,
			packageCount: packages.size,
			classCount,
		},
	};
}
```

### Integrating study jars with refresh_dependencies
```typescript
// In src/tools/refresh-dependencies.ts, after jarReader.registerProject():

// Re-register study jar paths that survived the refresh
for (const studyJar of loadedProject.studyJars.values()) {
	jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);
}

// Trigger staleness checks on study jars
for (const studyJar of loadedProject.studyJars.values()) {
	await reopenIfStale(studyJar);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `registerProject()` with full set | Add `addProjectJar()`/`removeProjectJar()` for incremental | Phase 11 | Enables study jar lifecycle without replacing full jar set |
| `clearEntryIndexCache()` (all-or-nothing) | Add `evictEntryIndex(key)` for surgical eviction | Phase 11 | Removes one jar's cache without invalidating all |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test -- --reporter=verbose` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01a | `addProjectJar` adds path to project's jar set | unit | `pnpm test -- tests/project/jar-reader.test.ts -t "addProjectJar"` | No -- Wave 0 |
| INFRA-01b | `removeProjectJar` removes path and closes unshared handle | unit | `pnpm test -- tests/project/jar-reader.test.ts -t "removeProjectJar"` | No -- Wave 0 |
| INFRA-01c | `removeProjectJar` keeps shared handle open | unit | `pnpm test -- tests/project/jar-reader.test.ts -t "removeProjectJar.*shared"` | No -- Wave 0 |
| INFRA-02 | `evictEntryIndex` removes single cache entry | unit | `pnpm test -- tests/browsing/entry-index-cache.test.ts -t "evict"` | No -- Wave 0 |
| SC-1 | Study jar can be opened, tracked, and closed with ref-counting | unit | `pnpm test -- tests/project/study-jar.test.ts` | No -- Wave 0 |
| SC-2 | Removing study jar evicts entry index cache | unit | `pnpm test -- tests/project/study-jar.test.ts -t "evict"` | No -- Wave 0 |
| SC-3 | Study jar IDs use `study:` prefix; collision detected | unit | `pnpm test -- tests/project/study-jar.test.ts -t "collision"` | No -- Wave 0 |
| SC-4 | `studyJars` map survives `refresh_dependencies` | integration | `pnpm test -- tests/project/study-jar.test.ts -t "refresh"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- tests/project/jar-reader.test.ts tests/browsing/entry-index-cache.test.ts tests/project/study-jar.test.ts --reporter=verbose`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project/study-jar.test.ts` -- covers SC-1 through SC-4 (StudyJar type, lifecycle, collision detection, refresh survival)
- [ ] `tests/browsing/entry-index-cache.test.ts` -- covers INFRA-02 (single-entry eviction). File does not exist yet.
- [ ] Extend `tests/project/jar-reader.test.ts` -- covers INFRA-01 (add/remove per-project jar methods)

## Open Questions

1. **Where does staleness check logic live?**
   - What we know: JarReader should not be aware of StudyJar. Staleness is a study-jar-only concern.
   - What's unclear: Should it be a standalone function, a method on a StudyJarService class, or inline in the tool handlers (Phase 13)?
   - Recommendation: Create a standalone `checkAndReopenIfStale()` function in a study jar domain module (e.g., `src/project/study-jar.ts`). Phase 13 tools call it before reads.

2. **Should `StudyJar` also generate a `DependencyEntry` for downstream compatibility?**
   - What we know: Phase 12 tools iterate `dependencyJars` map. Study jars need to appear in that iteration.
   - What's unclear: Should Phase 11 provide a `toDepEntry()` helper, or should Phase 12 handle the merge?
   - Recommendation: Phase 11 provides a `studyJarToDependencyEntry(jar: StudyJar): DependencyEntry` utility. This keeps the conversion logic close to the type definition.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/project/types.ts`, `src/project/jar-reader.ts`, `src/browsing/entry-index-cache.ts` -- direct inspection of existing patterns
- Codebase analysis: `src/tools/refresh-dependencies.ts` -- understanding of refresh flow and where study jar re-registration must occur
- Codebase analysis: `tests/project/jar-reader.test.ts`, `tests/browsing/entry-index.test.ts` -- existing test patterns

### Secondary (MEDIUM confidence)
- Node.js `fs.realpath()` and `fs.stat()` APIs -- standard Node.js built-ins, well-documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns already established in codebase
- Architecture: HIGH -- direct extension of existing types and classes with minimal new surface area
- Pitfalls: HIGH -- identified from concrete code paths (refresh_dependencies flow, cache eviction)

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- pure domain layer, no external dependency changes expected)
