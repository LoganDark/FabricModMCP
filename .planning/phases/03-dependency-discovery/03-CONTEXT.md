# Phase 3: Dependency Discovery and Jar Registry - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Server discovers all dependency source jars for a loaded project and can read individual entries from any jar on demand without extracting to disk. Includes jar identifier scheme, include/exclude filtering, and on-demand jar reading via node-stream-zip.

</domain>

<decisions>
## Implementation Decisions

### Jar identifier scheme
- `"minecraft"` — Minecraft sources jar (special, stable identifier per PROJ-09)
- `"src"` — Mod's own source at `src/main/java/` (special)
- `"group:artifact"` — All other dependencies keyed by Maven coordinate without version (e.g., `com.google.code.gson:gson`, `net.fabricmc.fabric-api:fabric-networking-api-v1`)
- Version is metadata on the jar entry, not part of the identifier
- Fabric API declared as one dependency (`net.fabricmc.fabric-api:fabric-api`) is distinguishable from its individual modules (`net.fabricmc.fabric-api:fabric-networking-api-v1`)

### Jar categories and filtering patterns
- Each jar tagged with a category: `minecraft`, `mod-source`, `fabric-api`, `library` — derived from the coordinate and dependency configuration
- Filtering uses glob patterns with two wildcard levels:
  - `*` matches within a single level (e.g., `net.fabricmc.fabric-api:*` matches all Fabric API modules)
  - `**` matches any number of levels (e.g., `**:gson` matches gson regardless of group)

### Include/exclude configuration
- Separate MCP tool to configure include/exclude on a loaded project (not at load time)
- Default: include-all with exclude list
- Can flip to exclude-all with include list if preferred
- Exclude/include by Maven coordinate pattern using the glob syntax above
- Per-project state that persists across tool calls
- Individual tool calls can override the project-level filter (e.g., "search only in `minecraft` and `src`")

### Dependency discovery strategy
- POM-based dependency tree traversal starting from declared dependencies in `build.gradle.kts`
- Follow transitive dependencies through POM files in the Gradle cache (`~/.gradle/caches/modules-2/files-2.1/{group}/{artifact}/{version}/{sha1}/{artifact}-{version}.pom`)
- SHA1 hash directories in Gradle cache are the SHA1 of the file they contain — glob `{version}/*/{artifact}-{version}-sources.jar` to find source jars
- Fabric API: parse its POM to discover individual module dependencies (not cache scanning)
- Discovery happens eagerly at project load time
- Refresh tool to re-run discovery (picks up newly downloaded source jars)

### Missing source jars
- All discovered dependencies appear in the registry regardless of whether source jars are available
- Each entry has an availability status (sources available vs. no sources)
- Discovery results include a summary: "Found sources for X/Y dependencies. Z without sources."
- When sources are missing, suggest running the Gradle `downloadSources` task
- Refresh tool handles the case where sources are downloaded after initial load

### Manual path override
- PROJ-10 (manual path override) is deferred — not included in this phase

### Claude's Discretion
- Jar reading abstraction internals (node-stream-zip handle management, pooling, lifecycle)
- POM XML parsing approach (regex, lightweight XML parser, etc.)
- Internal data structures for the dependency tree
- How include/exclude state is stored on LoadedProject
- Error handling for malformed POMs or circular dependencies

</decisions>

<specifics>
## Specific Ideas

- The glob pattern scheme (`*` single-level, `**` multi-level) should feel natural to developers familiar with file globbing
- The include/exclude system should work at two levels: project-wide persistent state, and per-tool-call overrides — so Claude can narrow scope for specific queries without changing the project config

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `REQUIREMENTS.md` — PROJ-07 (auto-discover dep jars), PROJ-08 (include/exclude), PROJ-09 (minecraft stable ID), PROJ-10 (manual override — deferred), BROW-05 (read from jars on demand)

### Existing code
- `src/project/types.ts` — `DependencyCoordinate`, `GradleConfig`, `ResolvedJar`, `LoadedProject` (with empty `dependencyJars` Map)
- `src/project/gradle-parser.ts` — Already parses all dependency coordinates from `build.gradle.kts`
- `src/project/loom-cache.ts` — Minecraft sources jar path resolution (pattern for cache path construction)
- `src/project/loader.ts` — Project loading orchestrator (Phase 3 extends this with dependency discovery)
- `src/state/project-store.ts` — ProjectStore singleton (jar registry state lives here or on LoadedProject)
- `src/errors/domain-error.ts` — DomainError with tried paths and suggestions

### Stack
- `node-stream-zip` (1.15.x) — Jar reading library chosen in CLAUDE.md. Central directory indexing, O(1) lookup by path, stream-based.

### Real test data
- Yarn-era project: `/Users/LoganDark/Documents/Projects/CreatorCore/Debrand` — has ~11 Fabric API module source jars and various library source jars in Gradle cache
- Gradle cache: `~/.gradle/caches/modules-2/files-2.1/` — SHA1-named subdirectories containing jars and POMs

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GradleConfig.dependencies[]` — All declared dependency coordinates already parsed with group, artifact, version, configuration
- `resolveSourcesJarPath()` in `loom-cache.ts` — Pattern for constructing Gradle cache paths
- `DomainError` — Structured error reporting with tried paths and suggestions
- `makeSuccess()` / `makeError()` — Response envelope builders

### Established Patterns
- Tool registration: Zod schema, handler, response envelope (see `src/tools/echo.ts`)
- Singleton state: `projectStore` pattern for global access
- Era detection: `MappingEra` type distinguishes Yarn vs unobfuscated projects

### Integration Points
- `LoadedProject.dependencyJars` — Empty Map placeholder, needs to be populated with discovered jars
- `loader.ts` — Needs dependency discovery step added to the load pipeline
- New MCP tools needed: include/exclude configuration, refresh, and eventually jar entry reading
- `ResolvedJar` type may need extension for availability status and category

</code_context>

<deferred>
## Deferred Ideas

- PROJ-10 (manual path override for jar paths) — revisit if needed in a later phase
- Source browsing tools (list packages, list classes, read source) — Phase 6
- Search across jars — Phase 7

</deferred>

---

*Phase: 03-dependency-discovery*
*Context gathered: 2026-04-12*
