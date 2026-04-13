# Phase 6: Source Browsing - Research

**Researched:** 2026-04-13
**Domain:** Hierarchical source browsing over ZIP/jar entries and filesystem directories
**Confidence:** HIGH

## Summary

Phase 6 implements three MCP tools (`list_packages`, `list_classes`, `read_source`) that provide hierarchical navigation of Java source code across jar files and mod source directories. The core challenge is transforming flat jar entry paths (e.g., `net/minecraft/client/MinecraftClient.java`) into a hierarchical package/class tree, merging entries across multiple jars, extracting class metadata from source text, and handling the `"src"` jar identifier as a filesystem-backed virtual jar.

All infrastructure is already in place: `JarReader` provides `listEntries()` and `readEntry()`, `ProjectStore` provides `resolveProject()`, picomatch provides glob matching on jar IDs, and the response envelope pattern is well-established across 5 prior phases. The new code is primarily domain logic -- path parsing, package aggregation, class declaration regex parsing, and a filesystem adapter for mod source.

**Primary recommendation:** Build a shared `SourceBrowser` module that abstracts the difference between jar-backed and filesystem-backed sources, then implement each tool as a thin handler over that abstraction.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Three separate MCP tools: `list_packages`, `list_classes`, `read_source`
- All tools use standard `resolveProject(name?)` for project resolution
- All tools use standard response envelope with provenance
- `list_packages` parameters: `project?: string`, `jars?: string[]`, `package?: string`, `depth?: number`
- `list_classes` parameters: `project?: string`, `jars?: string[]`, `package: string` (required), `depth?: number`
- `read_source` parameters: `project?: string`, `jar?: string`, `class: string` (FQN, required)
- `jars` defaults to all jars; accepts glob patterns (picomatch syntax)
- Packages merged across jars; provenance tracked at package and class level
- Inner classes nested in parent object with `$` naming, not as separate top-level entries
- `package-info.java` and `module-info.java` filtered from listings
- Class metadata (access, modifiers, type) extracted by reading first few lines of `.java` file
- Class types at minimum: `class`, `interface`, `enum`, `record`, `@interface`
- `"src"` jar identifier reads from `{rootPath}/src/main/java/` on filesystem
- `read_source` when class found in multiple jars returns ALL matches with provenance
- Search priority: minecraft -> src -> dependencies

### Claude's Discretion
- Exact set of class type values beyond minimum
- How to parse class declarations efficiently (regex on first N lines)
- Internal implementation of filesystem-based browsing for mod source
- How to handle malformed/unparseable class files
- How to efficiently aggregate package listings and class counts across multiple jars

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BROW-01 | List all top-level packages in any source jar or mod source | `JarReader.listEntries()` provides flat paths; parse into package tree. Filesystem `readdir` for mod source. |
| BROW-02 | List sub-packages at any depth within a package | `depth` parameter controls recursion; filter entry paths by prefix |
| BROW-03 | List all classes in a package including inner classes, enums, records, interfaces | Parse `.java` filenames from entries; read first N lines for class declaration metadata |
| BROW-04 | Read full decompiled source of any class by FQN | Convert FQN to jar entry path, use `JarReader.readEntry()` or `fs.readFile` for src |
| BROW-06 | Mod source browsable using same interface as jar source | Filesystem adapter for `"src"` jar ID using `readdir`/`readFile` on `{rootPath}/src/main/java/` |
| BROW-07 | Inner classes correctly handled (listed, readable, navigable) | `$` convention in filenames; nest in parent class entry; readable by FQN with `$` |
| BROW-08 | Every result includes source provenance | Track jar ID, category, version per result using existing `DependencyEntry` metadata |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-stream-zip | 1.15.x | Reading entries from source jars | Already in use. `listEntries()` for path enumeration, `readEntry()` for content. |
| picomatch | 4.0.x | Glob matching on jar identifiers | Already in use for include/exclude filtering. Same syntax for `jars` parameter. |
| zod | 4.3.x | Tool parameter validation | Already in use for all tool schemas. |
| node:fs/promises | N/A (built-in) | Filesystem operations for mod source | `readdir` with `recursive` option (Node 22), `readFile` for source content. |

### Supporting
No new libraries needed. All functionality is achievable with existing dependencies and Node.js built-ins.

## Architecture Patterns

### Recommended Project Structure
```
src/
  browsing/                # NEW - source browsing domain logic
    entry-index.ts         # Builds package/class index from jar entries
    class-parser.ts        # Regex-based class declaration parsing
    source-adapter.ts      # Abstraction: jar-backed vs filesystem-backed
  tools/
    list-packages.ts       # NEW - list_packages tool handler
    list-classes.ts        # NEW - list_classes tool handler
    read-source.ts         # NEW - read_source tool handler
    index.ts               # Updated to register new tools
```

### Pattern 1: Entry Index Building
**What:** Transform flat jar entry paths into a searchable package/class index. Cache the index per jar (it does not change for a given jar).
**When to use:** On first `list_packages` or `list_classes` call for a jar.
**Example:**
```typescript
// Input: JarReader.listEntries() returns:
// ["net/minecraft/client/MinecraftClient.java",
//  "net/minecraft/client/MinecraftClient$Options.java",
//  "net/minecraft/server/MinecraftServer.java",
//  "net/minecraft/package-info.java"]

// Output: Package index
// "net" -> { classCount: 0, jars: ["minecraft"] }
// "net.minecraft" -> { classCount: 0, jars: ["minecraft"] }
// "net.minecraft.client" -> { classCount: 1, jars: ["minecraft"] }
// "net.minecraft.server" -> { classCount: 1, jars: ["minecraft"] }

// Rules:
// - Only .java files matter
// - Exclude package-info.java, module-info.java
// - Files with $ are inner classes -> do NOT count as top-level classes
// - Convert / to . for package names
// - Class count = top-level .java files only (no $ in filename)
```

### Pattern 2: Class Declaration Regex Parsing
**What:** Extract access, modifiers, and type from the first ~50 lines of a `.java` file.
**When to use:** When building class entries for `list_classes`.
**Example:**
```typescript
// Read first ~50 lines (covers package, imports, annotations, class decl)
// Regex to find class declaration line:
const CLASS_DECL_RE = /^(?:(?<access>public|protected|private)\s+)?(?<modifiers>(?:(?:abstract|final|static|sealed|non-sealed|strictfp)\s+)*)(?<type>class|interface|enum|record|@interface)\s+(?<name>\w+)/m;

// Example inputs and outputs:
// "public final class MinecraftClient" -> access:"public", modifiers:["final"], type:"class"
// "public interface Tickable" -> access:"public", modifiers:[], type:"interface"
// "public enum GameMode" -> access:"public", modifiers:[], type:"enum"
// "public record ChunkPos" -> access:"public", modifiers:[], type:"record"
// "@interface Environment" -> access:"package-private", modifiers:[], type:"@interface"

// For inner classes: same regex applied to inner class file content
// Static inner: "public static class Options" -> modifiers:["static"]
```

### Pattern 3: Source Adapter (Jar vs Filesystem)
**What:** Unified interface for enumerating and reading source from either a jar or the filesystem.
**When to use:** The `"src"` jar identifier is filesystem-backed; all others are jar-backed.
**Example:**
```typescript
interface SourceAdapter {
	listJavaEntries(): Promise<string[]>;  // Returns paths like "com/example/MyMod.java"
	readEntry(path: string): Promise<Buffer>;
}

// Jar-backed: delegates to JarReader.listEntries() / readEntry()
// Filesystem-backed: uses readdir recursive on {rootPath}/src/main/java/
//   - strips the base path prefix to produce jar-like relative paths
//   - only includes .java files
```

### Pattern 4: Multi-Jar Aggregation
**What:** Merge package and class listings across multiple jars.
**When to use:** When `jars` parameter is omitted or matches multiple jars.
**Example:**
```typescript
// For packages: merge by package name, union the jars arrays
// "net.minecraft.client" from minecraft jar + "net.minecraft.client" from src
// -> { name: "net.minecraft.client", classCount: <sum>, jars: ["minecraft", "src"] }

// For classes: merge by class FQN, union the jars arrays
// Same class in multiple jars -> single entry with jars: ["minecraft", "mod-overlay"]

// Sort order: maintain priority - minecraft first, src second, deps alphabetical
```

### Anti-Patterns to Avoid
- **Rebuilding entry index on every call:** The jar contents do not change. Cache the parsed index per jar path. Invalidate only on project reload.
- **Reading entire file for class metadata:** Only read the first ~50 lines (or first 4KB). Class declarations appear before the method body. Do not read 10,000-line files for a class listing.
- **Treating inner class files as top-level:** Files containing `$` are inner classes. They must appear nested in their parent, never as top-level entries.
- **Ignoring filter config:** All jar enumeration must go through `getFilteredDependencies()` to respect project-level include/exclude filters.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching on jar IDs | Custom string matching | picomatch (already in project) | Edge cases with `*` vs `**`, brace expansion, etc. |
| Project resolution | Custom project lookup | `projectStore.resolveProject(name?)` | Handles explicit/default/single/none cases with proper DomainErrors |
| Jar file reading | Custom ZIP parsing | `JarReader` singleton via `shared-jar-reader.ts` | Lazy handles, reference counting, error wrapping all handled |
| Response formatting | Custom JSON responses | `makeSuccess`/`makeError` envelope builders | Consistent structure, dual content/structuredContent output |
| Dependency filtering | Custom filter logic | `getFilteredDependencies()` from `jar-registry.ts` | Already handles include-all/exclude-all modes with picomatch |

## Common Pitfalls

### Pitfall 1: Inner Class File Naming Conventions
**What goes wrong:** Inner classes in source jars use `$` in filenames (e.g., `MinecraftClient$Options.java`). If treated as top-level classes, listings are polluted with duplicates.
**Why it happens:** Flat entry lists do not distinguish inner vs outer classes.
**How to avoid:** Split filename on `$`. If `$` is present, it is an inner class. Group inner classes by their outer class (prefix before first `$`). For deeply nested inner classes (`Foo$Bar$Baz`), nest under the outermost class.
**Warning signs:** Class count is much higher than expected; same class appears both nested and top-level.

### Pitfall 2: Anonymous and Synthetic Classes
**What goes wrong:** Source jars may contain `Foo$1.java`, `Foo$2.java` (anonymous classes). These are synthetic and do not contain meaningful standalone source.
**Why it happens:** Decompilers sometimes generate separate files for anonymous inner classes.
**How to avoid:** Filter out files where the inner class name is purely numeric (e.g., `$1`, `$2`). These are anonymous classes and should not appear in listings. If they exist in source jars, skip them. If a user requests them by FQN via `read_source`, still serve the content.
**Warning signs:** Entries like `SomeClass$1`, `SomeClass$2` appearing in class listings.

### Pitfall 3: Package-Private (Default) Access
**What goes wrong:** Java classes without an explicit access modifier are package-private. The regex may not match anything for the access group.
**Why it happens:** `public class Foo` has explicit access; `class Foo` does not.
**How to avoid:** Default to `"package-private"` when the regex access group is empty/missing.
**Warning signs:** `access` field is null or empty string.

### Pitfall 4: Mod Source Directory May Not Exist
**What goes wrong:** `{rootPath}/src/main/java/` may not exist or may be empty.
**Why it happens:** Some projects use different source layouts, or the project is freshly initialized.
**How to avoid:** Check existence before listing. Per CONTEXT.md decision: include `"src"` with empty listing, not omitted entirely.
**Warning signs:** ENOENT errors when reading mod source directory.

### Pitfall 5: Performance on Large Jars
**What goes wrong:** Minecraft sources jar has ~6,600 entries. Iterating all entries for every call is wasteful.
**Why it happens:** No caching of parsed package/class structure.
**How to avoid:** Build the entry index once per jar handle opening. Cache it alongside the jar handle. The index is a Map of package names to class lists -- lightweight in memory.
**Warning signs:** Tool calls taking >100ms on warm jars.

### Pitfall 6: Multi-Line Class Declarations
**What goes wrong:** Some class declarations span multiple lines due to long `implements`/`extends` lists or annotations.
**Why it happens:** Java allows: `public class Foo\n    extends Bar\n    implements Baz, Qux {`
**How to avoid:** The regex only needs to match the line containing the class keyword. Access, modifiers, and type all appear on the same line as the `class`/`interface`/`enum`/`record`/`@interface` keyword in standard Java formatting. The `extends`/`implements` clauses can be ignored for metadata extraction.
**Warning signs:** Classes reported as unparseable when they have long extends/implements clauses.

## Code Examples

### Jar Entry Path to Package/Class Decomposition
```typescript
// Source: project domain logic
function decomposeEntryPath(entryPath: string): {
	packageName: string;
	fileName: string;
	isInnerClass: boolean;
	outerClassName: string | null;
	isAnonymous: boolean;
} | null {
	// Only process .java files
	if (!entryPath.endsWith('.java')) return null;

	// Skip package-info and module-info
	const fileName = entryPath.split('/').pop()!;
	if (fileName === 'package-info.java' || fileName === 'module-info.java') return null;

	const className = fileName.replace('.java', '');
	const parts = entryPath.replace('.java', '').split('/');
	const packageParts = parts.slice(0, -1);
	const packageName = packageParts.join('.');

	const dollarIndex = className.indexOf('$');
	const isInnerClass = dollarIndex !== -1;
	const outerClassName = isInnerClass ? className.substring(0, dollarIndex) : null;
	const innerPart = isInnerClass ? className.substring(dollarIndex + 1) : null;
	const isAnonymous = isInnerClass && /^\d+$/.test(innerPart!);

	return { packageName, fileName, isInnerClass, outerClassName, isAnonymous };
}
```

### Class Declaration Regex
```typescript
// Source: project domain logic
// Matches the class declaration line in a Java source file
// Applied to the first ~50 lines of source text
const CLASS_DECL_RE = /^(?:(public|protected|private)\s+)?(?:((?:(?:abstract|final|static|sealed|non-sealed|strictfp)\s+)*))?(class|interface|enum|record|@interface)\s+(\w+)/m;

function parseClassDeclaration(sourceText: string): {
	access: string;
	modifiers: string[];
	type: string;
	name: string;
} | null {
	// Only scan first ~4KB for performance
	const head = sourceText.substring(0, 4096);
	const match = head.match(CLASS_DECL_RE);
	if (!match) return null;

	const access = match[1] ?? 'package-private';
	const modifiers = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);
	const type = match[3];
	const name = match[4];

	return { access, modifiers, type, name };
}
```

### Filesystem Source Adapter for Mod Source
```typescript
// Source: project domain logic
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function listModSourceEntries(rootPath: string): Promise<string[]> {
	const srcDir = join(rootPath, 'src', 'main', 'java');

	try {
		// Node 22 supports recursive readdir
		const entries = await readdir(srcDir, { recursive: true });
		return entries
			.filter(e => e.endsWith('.java'))
			.map(e => e.replaceAll('\\', '/')); // Normalize Windows paths
	} catch (err: any) {
		if (err.code === 'ENOENT') return [];
		throw err;
	}
}

async function readModSourceFile(rootPath: string, entryPath: string): Promise<Buffer> {
	const fullPath = join(rootPath, 'src', 'main', 'java', entryPath);
	return readFile(fullPath);
}
```

### Jar ID Filtering with Glob Patterns
```typescript
// Source: existing pattern from jar-registry.ts
import picomatch from 'picomatch';

function filterJarIds(
	allJars: Map<string, DependencyEntry>,
	filterConfig: FilterConfig,
	jarGlobs?: string[],
): Map<string, DependencyEntry> {
	// First apply project-level include/exclude filters
	let filtered = getFilteredDependencies(allJars, filterConfig);

	// Then apply tool-level jar scope if provided
	if (jarGlobs && jarGlobs.length > 0) {
		const isMatch = picomatch(jarGlobs);
		const scoped = new Map<string, DependencyEntry>();
		for (const [id, entry] of filtered) {
			if (isMatch(id)) {
				scoped.set(id, entry);
			}
		}
		filtered = scoped;
	}

	return filtered;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `read_jar_entry` (raw path) | `read_source` (FQN) | Phase 6 | Users use dot notation instead of jar-internal paths |
| No browsing | `list_packages` + `list_classes` | Phase 6 | Hierarchical navigation replaces blind path guessing |

**Note:** `read_jar_entry` is not being removed in Phase 6 -- it remains as a low-level tool. `read_source` is a higher-level abstraction on top.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test -- --reporter=dot` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BROW-01 | List top-level packages from jar and mod source | unit | `pnpm test -- tests/browsing/entry-index.test.ts -t "top-level"` | No - Wave 0 |
| BROW-02 | List sub-packages at any depth | unit | `pnpm test -- tests/browsing/entry-index.test.ts -t "sub-package"` | No - Wave 0 |
| BROW-03 | List classes with metadata (access, modifiers, type, inner classes) | unit | `pnpm test -- tests/browsing/class-parser.test.ts` | No - Wave 0 |
| BROW-04 | Read full source by FQN | integration | `pnpm test -- tests/tools/read-source.test.ts` | No - Wave 0 |
| BROW-06 | Mod source browsable via same interface | unit | `pnpm test -- tests/browsing/source-adapter.test.ts -t "filesystem"` | No - Wave 0 |
| BROW-07 | Inner classes correctly nested, readable | unit | `pnpm test -- tests/browsing/entry-index.test.ts -t "inner"` | No - Wave 0 |
| BROW-08 | Source provenance on every result | integration | `pnpm test -- tests/tools/list-packages.test.ts -t "provenance"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- --reporter=dot`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/browsing/entry-index.test.ts` -- covers BROW-01, BROW-02, BROW-07
- [ ] `tests/browsing/class-parser.test.ts` -- covers BROW-03
- [ ] `tests/browsing/source-adapter.test.ts` -- covers BROW-06
- [ ] `tests/tools/list-packages.test.ts` -- covers BROW-08 (provenance), BROW-01 tool integration
- [ ] `tests/tools/list-classes.test.ts` -- covers BROW-03 tool integration
- [ ] `tests/tools/read-source.test.ts` -- covers BROW-04 tool integration

## Open Questions

1. **Anonymous inner class files in source jars**
   - What we know: Decompiled source jars sometimes contain `Foo$1.java` files for anonymous classes
   - What is unclear: Whether Yarn-mapped Minecraft source jars actually produce these, or if the decompiler inlines them
   - Recommendation: Filter numeric-only inner class names from listings. Still serve content if requested by FQN.

2. **Entry index caching lifetime**
   - What we know: Jar contents are immutable for a loaded project. Caching is safe.
   - What is unclear: Where to store the cache -- on the JarReader, on the project, or in the browsing module
   - Recommendation: Cache in the browsing module (entry-index.ts) keyed by jar path. Clear on project unload. Keep it separate from JarReader which is a low-level I/O layer.

3. **`read_source` and `read_jar_entry` coexistence**
   - What we know: `read_jar_entry` takes raw jar paths; `read_source` takes FQN. Both can read the same file.
   - What is unclear: Should `read_jar_entry` be deprecated or removed?
   - Recommendation: Keep both. `read_jar_entry` is useful for non-Java entries (resources, mappings files). Phase scope does not include removing existing tools.

## Sources

### Primary (HIGH confidence)
- Project codebase (`src/project/jar-reader.ts`, `src/project/jar-registry.ts`, `src/project/types.ts`) -- existing infrastructure patterns
- Phase 06 CONTEXT.md -- locked decisions from user discussion
- Phase 03 CONTEXT.md -- jar identifier scheme, filtering patterns
- Prior tool implementations (`read-jar-entry.ts`, `get-project-metadata.ts`, `configure-filters.ts`) -- established patterns

### Secondary (MEDIUM confidence)
- Java language specification for class declaration syntax -- regex pattern covers standard declarations
- Node.js 22 `readdir` recursive option -- verified available in Node 22 LTS

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all tools already in project
- Architecture: HIGH -- patterns directly extend existing codebase conventions
- Pitfalls: HIGH -- based on concrete analysis of jar entry formats and Java source structure

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable domain, no external dependencies changing)
