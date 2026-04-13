# Phase 2: Project Discovery - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

User can point the server at a Fabric/Loom Gradle project directory and the server correctly parses its configuration and locates the Minecraft sources jar in the Loom cache. Single project only (multi-project is Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Project loading flow
- `--project` CLI flag auto-loads a project at startup (already exists from Phase 1)
- `--project .` must work (resolve to absolute path)
- Project is named after the directory basename (e.g., `--project /path/to/Debrand` → name "Debrand")
- No `load-project` MCP tool in this phase — CLI flag is the only entry point
- If `--project` is not provided, server errors out with a clear message (Phase 4 will allow empty start)
- Data model should be a map of projects keyed by name from the start, even though Phase 2 only supports one

### Gradle project parsing
- Parse `build.gradle.kts` as the primary source of truth, not just `gradle.properties`
- `gradle.properties` is used only for variable substitution when `build.gradle.kts` references `${var_name}` or `val x: String by project`
- Extract ALL dependency coordinates from the `dependencies` block: `minecraft(...)`, `mappings(...)`, `modImplementation(...)`, `implementation(...)`, etc.
- Era detection: presence of a `mappings(...)` call → Yarn era; absence → unobfuscated era
- Store everything parsed — downstream phases (3, 5) will need the full dependency list and mod metadata

### Mapping era and cache path resolution
- Yarn era (has `mappings()` call): artifactId `minecraft-merged`, version `{mc_version}-net.fabricmc.yarn.{yarn_sanitized}.{yarn_mappings}`
- Unobfuscated era (no `mappings()` call): artifactId `minecraft-merged-deobf`, version `{mc_version}`
- Cache follows Maven convention: `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/{artifactId}/{version}/{artifactId}-{version}-sources.jar`
- One path per era — do not check the wrong artifact directory as fallback
- The yarn version sanitization (dots → underscores, etc.) needs research — figure out where the path actually comes from rather than guessing the transformation. Check Loom cache metadata/POM files
- No intermediary-only support — out of scope

### Load response
- Return full parsed metadata on successful load: MC version, mappings (if Yarn era), loader version, Fabric API version, mod metadata from fabric.mod.json, sources jar path, all discovered dependency coordinates
- Response uses the established ToolSuccess envelope from Phase 1

### fabric.mod.json parsing
- Parse `fabric.mod.json` during project load (mod ID, name, version, description, authors, dependencies)
- Located at `src/main/resources/fabric.mod.json` relative to project root

### Error handling
- If sources jar not found: report failure with human-friendly message ("Couldn't find sources — have you run genSources?") AND list all literal paths checked
- Error messages include both friendly descriptions and exact paths tried
- Use DomainError system from Phase 1 for structured errors

### Validation on load
- Parse `build.gradle.kts` with variable substitution from `gradle.properties`
- Parse `fabric.mod.json`
- Resolve and verify sources jar exists on disk (existence check only, don't open the jar)
- Resolve dependency source jar paths (existence check, store for Phase 3)

### Claude's Discretion
- Internal module structure for project/gradle parsing code
- Exact regex patterns for `build.gradle.kts` parsing
- How to handle edge cases in Kotlin DSL parsing (comments, multi-line strings, etc.)
- Test structure and test project fixtures

</decisions>

<specifics>
## Specific Ideas

- Two real test projects available on this machine:
  - Yarn era: `/Users/LoganDark/Documents/Projects/CreatorCore/Debrand` (MC 1.21.11, yarn 1.21.11+build.4)
  - Unobfuscated era: `/Users/LoganDark/IdeaProjects/debrand` (MC 26.2-snapshot-2, no yarn mappings)
- POM files in the Loom cache contain artifactId and version, which directly map to the cache directory structure

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md (PROJ-01, PROJ-06, PROJ-11).

### Existing code
- `src/cli/args.ts` — Already has `--project / -p` flag, returns `project?: string`
- `src/types/envelope.ts` — ToolSuccess/ToolError/Disambiguation response types
- `src/errors/domain-error.ts` — DomainError class for structured error reporting
- `src/tools/echo.ts` — Canonical tool registration pattern (Zod schema, response envelope, include metadata)
- `src/server.ts` — McpServer factory
- `src/index.ts` — Entry point, wires CLI args → server → transport

### Real Gradle projects (test targets)
- `/Users/LoganDark/Documents/Projects/CreatorCore/Debrand/build.gradle.kts` — Yarn-era project (has `mappings()` call)
- `/Users/LoganDark/IdeaProjects/debrand/build.gradle.kts` — Unobfuscated-era project (no `mappings()` call)
- Loom cache POM: `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/{artifactId}/{version}/{artifactId}-{version}.pom`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseCli()` in `src/cli/args.ts`: Already returns `project?: string` — needs to become required with path resolution
- `makeSuccess()` / `makeError()` in `src/types/envelope.ts`: Response builders for load results
- `DomainError` in `src/errors/domain-error.ts`: Structured errors with code + message + tried paths + suggestions
- `registerAllTools()` in `src/tools/index.ts`: Tool registration orchestrator to plug in new tools

### Established Patterns
- Tool registration: Zod schema → handler → response envelope (see `src/tools/echo.ts`)
- Stderr-only logging via `src/logging/logger.ts`
- ESM with `.js` extensions in imports

### Integration Points
- `src/index.ts` needs to call project loading after parsing CLI args, before connecting transport
- Project state (the map) needs to be accessible to tool handlers
- The `--project` flag needs validation and path resolution (support relative paths, `.`)

</code_context>

<deferred>
## Deferred Ideas

- `load-project` / `unload-project` MCP tools — Phase 4 (multi-project)
- Named project sessions (PROJ-02) — Phase 4
- Starting server with no projects loaded — Phase 4
- Multiple `--project` flags — Phase 4
- Dependency source jar reading/opening — Phase 3
- Include/exclude filtering for dependencies — Phase 3

</deferred>

---

*Phase: 02-project-discovery*
*Context gathered: 2026-04-12*
