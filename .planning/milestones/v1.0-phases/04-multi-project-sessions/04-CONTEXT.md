# Phase 4: Multi-Project Sessions - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can work with multiple Fabric projects simultaneously with named sessions, enabling the side-by-side porting workflow. Includes loading, naming, listing, unloading, and default project selection.

</domain>

<decisions>
## Implementation Decisions

### Project naming
- User can provide a name at load time; if omitted, auto-generate from the directory basename
- If a user-provided name collides with an existing project, return an error
- If an auto-generated name collides, auto-append a suffix: `name-1`, `name-2`, etc.

### Startup behavior
- Support multiple `--project` flags on the CLI to load several projects at startup
- Server can also start with zero projects and load them via tool calls

### Default project resolution
- If exactly one project is loaded, all tools implicitly target it without requiring a project name
- If multiple projects are loaded and no default is set, omitting the project name from a tool call is an error
- A `set-default-project` tool allows the user to designate one loaded project as the default
- Unloading the default project clears the default (does not error)

### Resource cleanup on unload
- Unloading a project closes all JarReader file handles associated with that project's jars
- If the unloaded project was the default, clear the default

### Claude's Discretion
- Internal implementation of per-project handle tracking in JarReader
- How multiple `--project` flags are parsed (yargs, manual argv, etc.)
- List-projects response format and what metadata to include beyond name, MC version, and status
- Error message wording

</decisions>

<specifics>
## Specific Ideas

- The auto-naming with collision suffix (`name-1`, `name-2`) mirrors how file managers handle duplicate names — intuitive behavior
- The "one project = implicit default" rule keeps the single-project experience frictionless while scaling to multi-project naturally

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `REQUIREMENTS.md` — PROJ-02 (named sessions), PROJ-03 (simultaneous loading), PROJ-04 (list projects), PROJ-05 (unload projects)

### Existing code
- `src/state/project-store.ts` — ProjectStore singleton with `Map<string, LoadedProject>`, already multi-project capable
- `src/project/loader.ts` — `loadProject(path)` pure function, no singleton dependency
- `src/project/jar-reader.ts` — JarReader with `Map<string, StreamZipAsync>` keyed by jar path, needs per-project cleanup tracking
- `src/tools/read-jar-entry.ts` — Already accepts `project` parameter, validates via `projectStore.get(project)`
- `src/tools/configure-filters.ts` — Already accepts `project` parameter
- `src/tools/refresh-dependencies.ts` — Already accepts `project` parameter
- `src/index.ts` — CLI entry point, currently loads single project via `--project` flag

### Prior phase decisions
- `03-CONTEXT.md` — Jar identifier scheme, include/exclude filtering, JarReader handle management

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProjectStore` — Already a Map-based store with get/set/has/delete/list; needs default-project tracking added
- `loadProject()` — Stateless loader, can be called multiple times for different projects
- All existing tools already parameterized by project name

### Established Patterns
- Tool registration: Zod schema + handler + response envelope
- Singleton state: `projectStore` for global access
- DomainError with tried paths and suggestions for structured errors

### Integration Points
- `ProjectStore` — Add default project field and resolution logic
- `JarReader` — Add per-project handle tracking for cleanup on unload
- `src/index.ts` — Parse multiple `--project` flags, auto-generate names from basenames
- New MCP tools: `load-project`, `unload-project`, `list-projects`, `set-default-project`
- Existing tools need project resolution logic (check explicit param → check default → check single-project → error)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-multi-project-sessions*
*Context gathered: 2026-04-13*
