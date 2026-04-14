# Phase 7: Search - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can find classes by name or glob pattern across all sources in a project, with scoping, pagination, and rich context. Method/field search is deferred to a future phase when the language server is available.

</domain>

<decisions>
## Implementation Decisions

### Tool design
- Single MCP tool: `search_classes`
- Uses standard `resolveProject(name?)` for project resolution
- Uses standard response envelope with provenance metadata

### Pattern matching
- Single `pattern` parameter matched against fully-qualified class name
- Glob syntax only (picomatch) — no regex support; consistent with jars filtering
- `*` matches a single package/name segment, `**` crosses package boundaries
- Case-insensitive by default, `caseSensitive: true` flag to opt in
- Inner classes matched by full `$`-separated FQN (e.g., `*$Options` matches `MinecraftClient$Options`)

### Kind filtering
- `kind` parameter accepts an array of type values: `class`, `interface`, `enum`, `record`, `@interface`
- Defaults to all types when omitted
- Filters applied after pattern matching

### Source scoping
- `jars` parameter reuses same glob pattern syntax as browsing tools (picomatch on jar IDs)
- Defaults to all jars (respecting project-level include/exclude filters)

### Search implementation
- Class search uses existing `EntryIndex` for fast filename-based matching — no source text scanning needed
- `kind` filtering requires reading class declaration (first 4KB) via existing `parseClassDeclaration`
- No source snippets in results — use `read_source` for detailed inspection

### Pagination
- Offset-based: `offset` (default 0) + `limit` (default 250) parameters
- No max limit — trust the caller
- Response always includes `offset`, `limit`, and `total` (total match count, even when truncated)
- Total count scoped to same jar/kind filters as results
- Offset past end returns empty results array with correct `total`

### Result shape
- Flat list, one result per unique class (not per jar)
- Each result: `fqn`, `type`, `access`, `jars`
- `access` includes `"package-private"` when no modifier present
- `jars` is an array of `{ id: string, category: JarCategory }` — pairs jar ID with category
- No provenance chains in results — available via `get_project_metadata`
- No inner class list in results — inner classes are independently searchable
- No source snippets — keeps search fast and responses compact

### Result ordering
- Primary sort: jar priority (minecraft → mod-source → fabric-api → library)
- Secondary sort: alphabetical by FQN within each priority group

### Claude's Discretion
- How to efficiently aggregate and deduplicate classes across multiple jars
- EntryIndex caching strategy for search (reuse existing module-level cache or new)
- How to handle the interaction between `kind` filtering and EntryIndex (lazy parse vs eager)
- Picomatch options for FQN matching (dot separators, `*`/`**` behavior)

</decisions>

<specifics>
## Specific Ideas

- Future method/field search will use semicolon separator: `net.minecraft.client.network.ClientPlayerEntity;lastXClient:` for fields, `net.minecraft.client.network.ClientPlayerEntity;startRiding` for methods — captured for future reference, not in scope for this phase
- Result shape confirmed:
  ```json
  {
    "fqn": "net.minecraft.util.Identifier",
    "type": "class",
    "access": "public",
    "jars": [
      { "id": "minecraft", "category": "minecraft" },
      { "id": "net.fabricmc:fabric-api-base", "category": "fabric-api" }
    ]
  }
  ```

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — SRCH-01 (search by name across all sources), SRCH-02 (regex/pattern support), SRCH-03 (rich context in results), SRCH-04 (pagination/limiting), SRCH-05 (scope to specific source types)

### Existing code — search infrastructure
- `src/browsing/entry-index.ts` — `EntryIndex` class with `getPackages()`, `getClasses()`, `getClassCount()`, `decomposeEntryPath()` — core of filename-based class discovery
- `src/browsing/class-parser.ts` — `parseClassDeclaration()` extracts access/modifiers/type from first 4KB of source
- `src/browsing/source-adapter.ts` — `SourceAdapter` interface, `createSourceAdapter()` factory for jar/filesystem access
- `src/browsing/types.ts` — `ClassMetadata`, `ClassEntry`, `InnerClassEntry`, `PackageEntry` type definitions

### Existing code — tool patterns
- `src/tools/read-source.ts` — Reference for jar priority sorting (`CATEGORY_PRIORITY`), `getFilteredDependencies()` usage, DomainError catch pattern
- `src/tools/shared-jar-reader.ts` — Global JarReader singleton
- `src/project/jar-registry.ts` — `getFilteredDependencies()` for applying include/exclude filters
- `src/state/project-store.ts` — `resolveProject(name?)` for project resolution
- `src/types/envelope.ts` — `makeSuccess`/`makeError` response envelope builders
- `src/tools/index.ts` — Tool registration point

### Prior phase decisions
- `.planning/phases/03-dependency-discovery/03-CONTEXT.md` — Jar identifier scheme, picomatch glob patterns for filtering
- `.planning/phases/06-source-browsing/06-CONTEXT.md` — Browsing tool design, `jars` parameter pattern, mod source as `"src"` identifier

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EntryIndex`: Already indexes all classes by package from jar entry paths — foundation for class search
- `decomposeEntryPath()`: Parses entry paths into package/class/inner-class components
- `parseClassDeclaration()`: Extracts class metadata from source text (first 4KB) — needed for `kind` filtering
- `CATEGORY_PRIORITY` in read-source.ts: Jar priority ordering — reuse for result sorting
- `getFilteredDependencies()`: Applies project-level include/exclude filters to jar set
- `createSourceAdapter()`: Unified jar/filesystem access for reading class source when `kind` filtering

### Established Patterns
- Tool registration: Zod schema + handler + `register*Tool(server)` export
- Response: dual `content` (text JSON) + `structuredContent`
- DomainError catch for resolveProject errors
- Module-level EntryIndex cache (`Map<string, EntryIndex>`) already exists in entry-index.ts tools

### Integration Points
- `src/tools/index.ts` — Register `search_classes` tool
- `EntryIndex` — Needs to expose all classes (not just by package) for global search
- Picomatch — Already a dependency, use for FQN glob matching with `*`/`**`

</code_context>

<deferred>
## Deferred Ideas

- Method/field search with semicolon separator syntax (`FQN;memberName`) — future phase, needs language server
- Regex pattern support — glob covers class search needs; regex may be needed for method/field search later

</deferred>

---

*Phase: 07-search*
*Context gathered: 2026-04-13*
