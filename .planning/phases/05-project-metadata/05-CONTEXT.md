# Phase 5: Project Metadata - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can query rich, structured metadata about any loaded project — versions, mod info, jar inventory, and dependency provenance. All underlying data is already parsed in Phases 2-4; this phase creates the MCP tools to expose it and extends dependency discovery to track provenance chains.

</domain>

<decisions>
## Implementation Decisions

### Tool design
- Single `get_project_metadata` tool with optional boolean flags to select which categories to include
- Categories: project info (versions/mappings/era), mod info (fabric.mod.json), jar inventory (all source jars)
- Omitting all flags returns everything (or define a sensible default)
- Tool uses standard `resolveProject(name?)` for project resolution

### Mod info response shape
- Structured typed fields for known fabric.mod.json properties (id, name, version, description, authors, license, environment, mixins, depends)
- Separate `extra` object containing any additional keys found via Zod `.passthrough()` parsing
- Two distinct sections in the response: typed fields + extra blob

### Jar inventory
- Include ALL source entries: Minecraft sources jar, mod source, and all dependency jars — same namespace since they can all be specified as sources for file reading
- Each entry includes: identifier, category, group, artifact, version, file size on disk (bytes via `stat`), availability (sources jar found or not)
- Unavailable jars (sources not found) are included — tells Claude "this dependency exists but source isn't readable"
- File paths hidden by default; optional boolean flag on the tool to include paths (for debugging "why can't I read this" situations)

### Provenance tracking
- Extend Phase 3's dependency discovery code to track full dependency chains during traversal
- Each dependency records ALL paths that lead to it, not just the first one found (a transitive dep can be reached via multiple routes)
- Stored on `DependencyEntry` (or extension of it) — not re-computed at query time
- Identifier remains based on physical jar location, not the path that discovered it
- Full chain exposed: e.g., `fabric-api → fabric-networking → guava`, not just immediate parent
- Provenance is per-project (implicit from tool being scoped to a project, no cross-project provenance)

### Mapping era
- Include mapping era (`yarn` vs `unobfuscated`) in the project info category response (META-05)

### Claude's Discretion
- Exact response structure and field naming within the envelope
- Default behavior when no category flags are specified (all vs. summary)
- How provenance chains are serialized in the response (array of arrays, nested objects, etc.)
- Whether mod `depends` map values are version strings or parsed version ranges
- File size formatting (raw bytes only, or also human-readable)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for response structure and field naming.

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — META-01 (version metadata), META-02 (mod metadata), META-03 (jar inventory with sizes), META-04 (granular provenance), META-05 (mapping era)

### Existing code — metadata sources
- `src/project/types.ts` — `LoadedProject`, `GradleConfig`, `FabricModJson`, `DependencyEntry`, `JarCategory` type definitions
- `src/project/gradle-parser.ts` — Parses gradle.properties for MC version, yarn mappings, loader version, Fabric API version
- `src/project/fabric-mod.ts` — Parses fabric.mod.json with Zod `.passthrough()`
- `src/project/dependency-discovery.ts` — Three-strategy dependency discovery (needs provenance chain extension)
- `src/project/pom-parser.ts` — POM parsing for transitive deps (depth limit 5, compile-scope)

### Existing code — tool infrastructure
- `src/tools/index.ts` — Tool registration hub (`registerAllTools`)
- `src/types/envelope.ts` — `makeSuccess`/`makeError` response envelope
- `src/state/project-store.ts` — `ProjectStore` with `resolveProject(name?)` resolution logic
- `src/project/jar-reader.ts` — JarReader with per-project handle tracking

### Prior phase decisions
- `04-CONTEXT.md` — Project resolution pattern (explicit → default → single-project → error)
- `03-CONTEXT.md` — Jar identifier scheme, dependency categories, include/exclude filtering

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GradleConfig`: Already contains minecraftVersion, mappingEra, yarnMappings, loaderVersion, fabricApiVersion
- `FabricModJson`: Already parsed with passthrough — structured fields + extras available
- `DependencyEntry`: Has id, group, artifact, version, category, sourcesJarPath, available — needs provenance chain field added
- `resolveProject(name?)`: Standard project resolution with fallback logic
- `makeSuccess(data, metadata)`: Response envelope with provenance

### Established Patterns
- Tool registration: Zod schema + handler function + `register*Tool(server)` export
- Response envelope: `makeSuccess`/`makeError` with `provenance: {tool, project?}`
- DomainError catch pattern for `resolveProject` errors in tool handlers
- Singleton state access via `projectStore` and shared jar reader

### Integration Points
- `src/project/dependency-discovery.ts` — Extend to track provenance chains during POM traversal
- `src/project/types.ts` — Add provenance chain field to `DependencyEntry`
- `src/tools/index.ts` — Register new `get_project_metadata` tool
- New file: `src/tools/get-project-metadata.ts` — Tool implementation

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-project-metadata*
*Context gathered: 2026-04-13*
