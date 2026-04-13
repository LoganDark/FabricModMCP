# Phase 7: Search - Research

**Researched:** 2026-04-13
**Domain:** Class search across source jars with glob pattern matching
**Confidence:** HIGH

## Summary

Phase 7 implements a `search_classes` MCP tool that finds Java classes by glob pattern across all source jars in a project. The implementation builds heavily on existing infrastructure: `EntryIndex` already indexes all classes by package from jar entry paths, `parseClassDeclaration` extracts class metadata (type, access) from the first 4KB of source, and the jar filtering/priority system from `read_source` and `list_classes` is directly reusable.

The main technical challenge is efficient pattern matching against fully-qualified class names using picomatch. Picomatch treats `/` as the path separator -- by default, `*` crosses dots, making it useless for FQN segment matching. The solution is to convert FQN dots to slashes before matching and convert pattern dots to slashes, so `*` matches a single package/name segment and `**` crosses package boundaries. This was verified experimentally against picomatch 4.0.4.

**Primary recommendation:** Add an `getAllClasses()` method to `EntryIndex` that returns all class FQNs (top-level + inner), convert dots to slashes for picomatch matching, and aggregate/deduplicate results across jars with priority sorting.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single MCP tool: `search_classes`
- Uses standard `resolveProject(name?)` for project resolution
- Uses standard response envelope with provenance metadata
- Single `pattern` parameter matched against fully-qualified class name
- Glob syntax only (picomatch) -- no regex support; consistent with jars filtering
- `*` matches a single package/name segment, `**` crosses package boundaries
- Case-insensitive by default, `caseSensitive: true` flag to opt in
- Inner classes matched by full `$`-separated FQN (e.g., `*$Options` matches `MinecraftClient$Options`)
- `kind` parameter accepts an array of type values: `class`, `interface`, `enum`, `record`, `@interface`
- Defaults to all types when omitted
- Filters applied after pattern matching
- `jars` parameter reuses same glob pattern syntax as browsing tools (picomatch on jar IDs)
- Defaults to all jars (respecting project-level include/exclude filters)
- Class search uses existing `EntryIndex` for fast filename-based matching -- no source text scanning needed
- `kind` filtering requires reading class declaration (first 4KB) via existing `parseClassDeclaration`
- No source snippets in results -- use `read_source` for detailed inspection
- Offset-based pagination: `offset` (default 0) + `limit` (default 250) parameters
- No max limit -- trust the caller
- Response always includes `offset`, `limit`, and `total` (total match count, even when truncated)
- Flat list, one result per unique class (not per jar)
- Each result: `fqn`, `type`, `access`, `jars` (array of `{ id: string, category: JarCategory }`)
- `access` includes `"package-private"` when no modifier present
- No provenance chains, no inner class list, no source snippets in results
- Primary sort: jar priority (minecraft -> mod-source -> fabric-api -> library)
- Secondary sort: alphabetical by FQN within each priority group

### Claude's Discretion
- How to efficiently aggregate and deduplicate classes across multiple jars
- EntryIndex caching strategy for search (reuse existing module-level cache or new)
- How to handle the interaction between `kind` filtering and EntryIndex (lazy parse vs eager)
- Picomatch options for FQN matching (dot separators, `*`/`**` behavior)

### Deferred Ideas (OUT OF SCOPE)
- Method/field search with semicolon separator syntax -- future phase, needs language server
- Regex pattern support -- glob covers class search needs
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-01 | User can search for classes by name across all sources | EntryIndex provides all class FQNs per jar; aggregate across filtered jars, match with picomatch. Method/field search deferred per CONTEXT.md. |
| SRCH-02 | Search supports regex patterns | CONTEXT.md explicitly defers regex -- glob patterns via picomatch satisfy this requirement for class search. |
| SRCH-03 | Search results include rich context: FQN, type, access, source provenance | `parseClassDeclaration` extracts type/access; jar IDs + categories provide provenance. |
| SRCH-04 | Search results are paginated or limited | Offset-based pagination with `offset`/`limit` params and `total` count in response. |
| SRCH-05 | User can scope search to specific source types | `jars` parameter with picomatch glob matching on jar IDs, same as browsing tools. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| picomatch | 4.0.4 | Glob pattern matching against FQNs | Already a project dependency. Proven in jar filtering. Supports `nocase` option. |
| zod | 4.x | Tool parameter schema validation | Project standard for all MCP tool schemas. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node-stream-zip | 1.15.x | Jar entry listing for EntryIndex | Already used via JarReader for all jar access. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| picomatch on FQNs | minimatch | picomatch is already in the project and faster; no reason to add another glob lib |
| Dot-to-slash conversion | Custom FQN matcher | picomatch is battle-tested; custom code would need to handle all glob edge cases |

No new dependencies needed. Everything required is already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  browsing/
    entry-index.ts       # ADD: getAllClasses() method
    class-parser.ts      # EXISTING: parseClassDeclaration() -- used for kind filtering
  tools/
    search-classes.ts    # NEW: search_classes tool implementation
    index.ts             # MODIFY: register new tool
```

### Pattern 1: Dot-to-Slash Conversion for FQN Glob Matching
**What:** Convert FQN dots to slashes before picomatch matching, so `*` matches a single segment and `**` crosses boundaries.
**When to use:** Every pattern match against a fully-qualified class name.
**Why:** Picomatch treats `/` as the path separator. With dots, `*` crosses dot boundaries (e.g., `*Client` matches `net.minecraft.client.MinecraftClient` -- wrong). After conversion, `*` stops at `/` (segment boundary).
**Verified:** Experimentally tested with picomatch 4.0.4.
**Example:**
```typescript
// Convert both pattern and FQN dots to slashes for matching
const matchFqn = fqn.replaceAll('.', '/');
const matchPattern = pattern.replaceAll('.', '/');
const isMatch = picomatch(matchPattern, { nocase: !caseSensitive });
if (isMatch(matchFqn)) { /* hit */ }
```

**Important:** Dollar signs (`$`) in inner class names are NOT special to picomatch and need no escaping. Verified: `picomatch('**/*$Options')` correctly matches `net/minecraft/client/MinecraftClient$Options`.

### Pattern 2: Aggregate-Then-Deduplicate Across Jars
**What:** Iterate all jars, collect all matching class FQNs, deduplicate by FQN while accumulating jar provenance.
**When to use:** Building the search result set.
**Example:**
```typescript
// Map from FQN -> aggregated result
const resultMap = new Map<string, SearchResult>();

for (const [id, dep] of sortedDeps) {
	const index = getOrBuildIndex(entries, cacheKey);
	const allClasses = index.getAllClasses(); // NEW method

	for (const { fqn } of allClasses) {
		const matchFqn = fqn.replaceAll('.', '/');
		if (!isMatch(matchFqn)) continue;

		const existing = resultMap.get(fqn);
		if (existing) {
			existing.jars.push({ id, category: dep.category });
		} else {
			resultMap.set(fqn, { fqn, type: null, access: null, jars: [{ id, category: dep.category }] });
		}
	}
}
```

### Pattern 3: Lazy Kind Filtering (Parse Only Matched Classes)
**What:** Only read class declarations for classes that already matched the pattern AND when `kind` filter is specified.
**When to use:** When `kind` parameter is provided.
**Why:** Reading 4KB per class is I/O-bound. Without `kind` filter, skip all source reads. With it, only parse classes that passed the pattern filter.
**Performance:** Minecraft sources jar has ~6,600 files. A typical glob match might hit 10-100 classes. Parsing 100 x 4KB = 400KB of reads -- fast via node-stream-zip random access.
**Example:**
```typescript
// After pattern matching, before pagination
if (kindFilter) {
	// Filter in-place, reading source only for matched classes
	for (const [fqn, result] of resultMap) {
		// Read from first available jar
		const metadata = await readClassMetadata(adapter, fqn);
		if (!metadata || !kindFilter.includes(metadata.type)) {
			resultMap.delete(fqn);
		} else {
			result.type = metadata.type;
			result.access = metadata.access;
		}
	}
}
```

### Pattern 4: Sorting by Jar Priority Then FQN
**What:** Results sorted by highest-priority jar that contains them, then alphabetically.
**When to use:** Before slicing for pagination.
**Example:**
```typescript
const CATEGORY_PRIORITY: Record<JarCategory, number> = {
	'minecraft': 0,
	'mod-source': 1,
	'fabric-api': 2,
	'library': 3,
};

results.sort((a, b) => {
	const pa = Math.min(...a.jars.map(j => CATEGORY_PRIORITY[j.category] ?? 99));
	const pb = Math.min(...b.jars.map(j => CATEGORY_PRIORITY[j.category] ?? 99));
	if (pa !== pb) return pa - pb;
	return a.fqn.localeCompare(b.fqn);
});
```

### Anti-Patterns to Avoid
- **Scanning source text for class names:** EntryIndex already has all class names from jar entry paths. Never read source text just to find class names.
- **Eager metadata parsing for all classes:** Only parse class declarations when `kind` filter is active and only for pattern-matched classes.
- **Separate EntryIndex caches per tool:** Reuse the same caching pattern (module-level Map keyed by jar path). Consider sharing the cache across tools or at minimum using the same `getOrBuildIndex` pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob pattern matching | Custom FQN matcher | picomatch with dot-to-slash conversion | Edge cases in glob semantics (escaping, brace expansion, negation) are complex |
| Class metadata extraction | Custom source parser | Existing `parseClassDeclaration` | Already handles all Java class/interface/enum/record/@interface types |
| Jar filtering | Custom jar filter | Existing `getFilteredDependencies` + picomatch on jar IDs | Already proven in list_packages, list_classes, read_source |
| Entry indexing | Custom file scanner | Existing `EntryIndex` with new `getAllClasses()` | Already indexes ~6,600 entries in the Minecraft sources jar |

**Key insight:** This phase is primarily about composing existing infrastructure (EntryIndex, parseClassDeclaration, jar filtering, picomatch) into a new tool. Almost no new infrastructure is needed.

## Common Pitfalls

### Pitfall 1: Picomatch `*` Crossing Dot Boundaries
**What goes wrong:** `*Client` matches `net.minecraft.client.MinecraftClient` because picomatch's `*` matches any character except `/`. Dots are NOT treated as separators by default.
**Why it happens:** picomatch is designed for file paths with `/` separators. FQNs use `.` separators.
**How to avoid:** Convert both pattern and FQN dots to `/` before matching. This makes `*` stop at package boundaries.
**Warning signs:** Search for `*Client` returns every class ending in "Client" regardless of package depth.

### Pitfall 2: Kind Filtering Before Pattern Matching (Performance)
**What goes wrong:** Reading class declarations for ALL classes in ALL jars, then filtering by kind, then matching pattern. O(n) source reads where n = total classes across all jars.
**Why it happens:** Applying filters in wrong order.
**How to avoid:** Always: (1) pattern match on FQN first, (2) then kind-filter only matched classes.
**Warning signs:** Search taking seconds instead of milliseconds.

### Pitfall 3: Pagination Applied Before Kind Filtering
**What goes wrong:** If pagination is applied before kind filtering, the page might have fewer results than expected (some filtered out), and `total` count would be wrong.
**Why it happens:** Trying to optimize by limiting early.
**How to avoid:** Pipeline must be: pattern match -> deduplicate -> kind filter -> sort -> count total -> slice page.
**Warning signs:** `total` count doesn't reflect actual available results for the given kind filter.

### Pitfall 4: Inner Class FQN Construction
**What goes wrong:** Inner class FQN uses dots instead of dollar signs (`net.minecraft.client.MinecraftClient.Options` instead of `net.minecraft.client.MinecraftClient$Options`).
**Why it happens:** Confusing package separators with inner class separators.
**How to avoid:** EntryIndex already stores class names with `$` separators (e.g., `MinecraftClient$Options`). FQN is `packageName + "." + className` -- the `$` is already in `className`.
**Warning signs:** Inner class patterns like `*$Options` fail to match.

### Pitfall 5: Dot-to-Slash Conversion Breaking Dollar Signs
**What goes wrong:** Converting dots to slashes might interact unexpectedly with `$` in inner class names during picomatch evaluation.
**Why it happens:** Concern about special characters.
**How to avoid:** Verified: `$` is NOT special to picomatch. `picomatch('**/*$Options')` correctly matches `net/minecraft/client/MinecraftClient$Options`. No escaping needed.

### Pitfall 6: EntryIndex Missing Method for Global Class Enumeration
**What goes wrong:** EntryIndex only has `getClasses(packageName)` which requires knowing the package. No method to enumerate all classes across all packages.
**Why it happens:** EntryIndex was designed for browsing (one package at a time), not searching.
**How to avoid:** Add `getAllClasses()` method that iterates the internal `packages` Map and `innerClasses` Map to yield all class FQNs.

## Code Examples

### EntryIndex.getAllClasses() -- New Method
```typescript
// Source: Designed based on existing EntryIndex internals
interface FlatClassInfo {
	fqn: string;          // "net.minecraft.client.MinecraftClient" or "net.minecraft.client.MinecraftClient$Options"
	className: string;    // "MinecraftClient" or "MinecraftClient$Options"
	packageName: string;  // "net.minecraft.client"
	isInnerClass: boolean;
}

getAllClasses(): FlatClassInfo[] {
	const result: FlatClassInfo[] = [];

	// Top-level classes from packages map
	for (const [packageName, classNames] of this.packages) {
		for (const className of classNames) {
			const fqn = packageName ? `${packageName}.${className}` : className;
			result.push({ fqn, className, packageName, isInnerClass: false });

			// Inner classes for this outer class
			const innerClassNames = this.innerClasses.get(fqn) ?? [];
			for (const innerClassName of innerClassNames) {
				const innerFqn = packageName ? `${packageName}.${innerClassName}` : innerClassName;
				result.push({ fqn: innerFqn, className: innerClassName, packageName, isInnerClass: true });
			}
		}
	}

	return result;
}
```

### FQN Glob Matching with Picomatch
```typescript
// Source: Verified experimentally with picomatch 4.0.4
import picomatch from 'picomatch';

function createFqnMatcher(pattern: string, caseSensitive: boolean): (fqn: string) => boolean {
	const matchPattern = pattern.replaceAll('.', '/');
	const isMatch = picomatch(matchPattern, { nocase: !caseSensitive });

	return (fqn: string) => {
		const matchFqn = fqn.replaceAll('.', '/');
		return isMatch(matchFqn);
	};
}

// Usage:
// createFqnMatcher('net.minecraft.client.*', false)      -- classes directly in net.minecraft.client
// createFqnMatcher('net.minecraft.**.*Client', false)     -- *Client in any sub-package
// createFqnMatcher('*$Options', false)                    -- inner class named Options in any class
// createFqnMatcher('**/*$Options', false)                 -- same, but explicit about crossing packages
```

### Lazy Kind Filtering
```typescript
// Source: Based on existing list-classes.ts readClassMetadata pattern
async function applyKindFilter(
	resultMap: Map<string, SearchResult>,
	kindFilter: string[],
	jars: Map<string, DependencyEntry>,
	jarReader: JarReader,
	rootPath: string,
): Promise<void> {
	for (const [fqn, result] of resultMap) {
		// Try to read metadata from first available jar
		let metadata: { type: string; access: string } | null = null;

		for (const jarRef of result.jars) {
			const dep = jars.get(jarRef.id);
			if (!dep || !dep.available) continue;

			const adapter = createSourceAdapter(jarReader, dep, rootPath);
			const lastDot = fqn.lastIndexOf('.');
			const packageName = lastDot === -1 ? '' : fqn.substring(0, lastDot);
			const className = lastDot === -1 ? fqn : fqn.substring(lastDot + 1);
			const entryPath = packageName
				? `${packageName.replaceAll('.', '/')}/${className}.java`
				: `${className}.java`;

			try {
				const buffer = await adapter.readEntry(entryPath);
				const head = buffer.subarray(0, 4096).toString('utf-8');
				const parsed = parseClassDeclaration(head);
				if (parsed) {
					metadata = { type: parsed.type, access: parsed.access };
				}
				break; // Got metadata from one jar, no need to try others
			} catch {
				continue;
			}
		}

		if (!metadata || !kindFilter.includes(metadata.type)) {
			resultMap.delete(fqn);
		} else {
			result.type = metadata.type;
			result.access = metadata.access;
		}
	}
}
```

### Response Shape
```typescript
// Source: CONTEXT.md locked decision
interface SearchClassResult {
	fqn: string;                              // "net.minecraft.util.Identifier"
	type: string;                             // "class" | "interface" | "enum" | "record" | "@interface"
	access: string;                           // "public" | "protected" | "private" | "package-private"
	jars: Array<{ id: string; category: JarCategory }>;
}

interface SearchResponse {
	results: SearchClassResult[];
	offset: number;
	limit: number;
	total: number;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex search of source text | EntryIndex-based FQN glob matching | This phase | O(entries) name matching vs O(chars) text scanning |
| Per-package class listing only | Global class enumeration via getAllClasses() | This phase | Enables cross-package search without knowing package names |

## Open Questions

1. **EntryIndex Cache Sharing Across Tools**
   - What we know: list-packages.ts and list-classes.ts each have their own module-level `entryIndexCache` Map. Both use the same pattern.
   - What's unclear: Should search-classes.ts share one of these caches, create its own, or should caching be centralized?
   - Recommendation: Create its own module-level cache using the same `getOrBuildIndex` pattern. The cost of building an EntryIndex is low (~72ms for 6,622 files) and entries are already cached by jar path -- so a cache hit will return the same object. Centralizing can be done later as a refactor if needed.

2. **Type/Access Metadata Without Kind Filter**
   - What we know: CONTEXT.md says results always include `type` and `access`. But kind filtering (which reads class declarations) is optional.
   - What's unclear: When `kind` is not specified, must we still read class declarations to populate `type` and `access`?
   - Recommendation: Yes -- always read class declarations for matched classes to populate `type` and `access`. This is consistent with the result shape. For performance, this is acceptable: typical searches return 10-250 classes, and reading 4KB per class from an indexed jar is fast.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/browsing/entry-index.test.ts tests/tools/search-classes.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | Search classes by name across jars | unit | `npx vitest run tests/tools/search-classes.test.ts -t "matches classes by pattern"` | -- Wave 0 |
| SRCH-02 | Glob pattern support (*, **) | unit | `npx vitest run tests/tools/search-classes.test.ts -t "glob patterns"` | -- Wave 0 |
| SRCH-03 | Results include FQN, type, access, jars | unit | `npx vitest run tests/tools/search-classes.test.ts -t "result shape"` | -- Wave 0 |
| SRCH-04 | Pagination with offset/limit/total | unit | `npx vitest run tests/tools/search-classes.test.ts -t "pagination"` | -- Wave 0 |
| SRCH-05 | Scope to specific jars | unit | `npx vitest run tests/tools/search-classes.test.ts -t "jar scoping"` | -- Wave 0 |
| -- | EntryIndex.getAllClasses() | unit | `npx vitest run tests/browsing/entry-index.test.ts -t "getAllClasses"` | -- Wave 0 |
| -- | FQN glob matching (dot-to-slash) | unit | `npx vitest run tests/browsing/entry-index.test.ts -t "FQN matching"` | -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/browsing/entry-index.test.ts tests/tools/search-classes.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/search-classes.test.ts` -- covers SRCH-01 through SRCH-05
- [ ] `tests/browsing/entry-index.test.ts` -- add tests for new `getAllClasses()` method (file exists, tests for new method needed)

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/browsing/entry-index.ts`, `src/browsing/class-parser.ts`, `src/tools/read-source.ts`, `src/tools/list-classes.ts` -- established patterns for jar iteration, EntryIndex caching, metadata parsing, priority sorting
- picomatch 4.0.4 -- experimentally verified behavior: `*` stops at `/`, `**` crosses, `$` not special, `nocase` option works
- CONTEXT.md -- locked decisions on tool design, result shape, sorting, pagination

### Secondary (MEDIUM confidence)
- picomatch documentation -- `nocase` option for case-insensitive matching

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or experimental tests

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in the project, no new deps
- Architecture: HIGH -- builds directly on existing, proven patterns
- Pitfalls: HIGH -- dot-to-slash conversion verified experimentally; ordering concerns derived from existing code analysis

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- existing infrastructure, no external API changes expected)
