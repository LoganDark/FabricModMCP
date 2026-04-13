# Phase 4: Multi-Project Sessions - Research

**Researched:** 2026-04-13
**Domain:** Session management, CLI argument parsing, resource lifecycle
**Confidence:** HIGH

## Summary

Phase 4 adds multi-project session support to the MCP server. The existing codebase is already well-positioned for this: `ProjectStore` is a `Map<string, LoadedProject>`, `loadProject()` is a pure function with no singleton dependency, and all three existing tools already accept a `project` parameter. The work is primarily wiring: adding a default-project concept to `ProjectStore`, making the `project` parameter optional with resolution logic, adding four new MCP tools (`load-project`, `unload-project`, `list-projects`, `set-default-project`), supporting multiple `--project` CLI flags, and tracking per-project jar handles for cleanup.

No new dependencies are needed. The `node:util` `parseArgs` API already supports `multiple: true` for accepting multiple `--project` flags. The `JarReader` already has `close(jarPath)` and `closeAll()` methods. The main engineering challenge is the project resolution logic that must be shared across all tools and the per-project handle tracking for clean unload.

**Primary recommendation:** Extract a shared `resolveProject(projectName?: string)` helper that implements the resolution chain (explicit name -> default -> single-project implicit -> error). Wire it into all existing and new tools.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- User can provide a name at load time; if omitted, auto-generate from the directory basename
- If a user-provided name collides with an existing project, return an error
- If an auto-generated name collides, auto-append a suffix: `name-1`, `name-2`, etc.
- Support multiple `--project` flags on the CLI to load several projects at startup
- Server can also start with zero projects and load them via tool calls
- If exactly one project is loaded, all tools implicitly target it without requiring a project name
- If multiple projects are loaded and no default is set, omitting the project name from a tool call is an error
- A `set-default-project` tool allows the user to designate one loaded project as the default
- Unloading the default project clears the default (does not error)
- Unloading a project closes all JarReader file handles associated with that project's jars

### Claude's Discretion
- Internal implementation of per-project handle tracking in JarReader
- How multiple `--project` flags are parsed (yargs, manual argv, etc.)
- List-projects response format and what metadata to include beyond name, MC version, and status
- Error message wording

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROJ-02 | User can assign a human-readable name to a loaded project session and refer to it by name in all tool calls | Name assignment at load time, auto-generation from basename, collision handling. `resolveProject()` helper for name-based lookup in all tools. |
| PROJ-03 | Multiple projects can be loaded simultaneously with independent state | `ProjectStore` already Map-based. `loadProject()` is stateless. New `load-project` tool calls `loadProject()` and stores result. Each `LoadedProject` has independent `gradleConfig`, `dependencyJars`, `filterConfig`. |
| PROJ-04 | User can list all loaded projects with names, MC versions, and status | New `list-projects` tool iterating `projectStore.list()`. Response includes name, MC version, mapping era, dependency count, whether it's the default. |
| PROJ-05 | User can unload a project to free resources | New `unload-project` tool calling `projectStore.delete()` + closing per-project jar handles via `JarReader`. Clears default if unloaded project was default. |
</phase_requirements>

## Standard Stack

### Core
No new dependencies. All required functionality exists in the current stack.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:util parseArgs | Node 22 built-in | CLI argument parsing with `multiple: true` | Already used in `src/cli/args.ts`. Native `multiple: true` option collects repeated `--project` flags into an array. No external dependency needed. |
| node-stream-zip | 1.15.x | Jar handle management | Already used. `close(jarPath)` already exists for per-handle cleanup. |

### Supporting
No new supporting libraries needed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `parseArgs` `multiple: true` | yargs | yargs adds a dependency for something `parseArgs` does natively. Unnecessary. |

## Architecture Patterns

### Recommended Changes to Project Structure
```
src/
  cli/
    args.ts              # UPDATE: support multiple --project flags, optional name syntax
  state/
    project-store.ts     # UPDATE: add defaultProject tracking, resolveProject() method
  project/
    jar-reader.ts        # UPDATE: add per-project handle tracking for cleanup
    loader.ts            # No changes needed (already pure)
    types.ts             # No changes needed
  tools/
    index.ts             # UPDATE: register new tools
    load-project.ts      # NEW: load-project tool
    unload-project.ts    # NEW: unload-project tool
    list-projects.ts     # NEW: list-projects tool
    set-default-project.ts  # NEW: set-default-project tool
    read-jar-entry.ts    # UPDATE: make project optional, use resolveProject()
    configure-filters.ts # UPDATE: make project optional, use resolveProject()
    refresh-dependencies.ts  # UPDATE: make project optional, use resolveProject()
  index.ts               # UPDATE: support zero or multiple --project flags at startup
```

### Pattern 1: Project Resolution Chain
**What:** Centralized logic for resolving which project a tool call targets
**When to use:** Every tool that operates on a project (all existing + new tools)
**Example:**
```typescript
// In project-store.ts
resolveProject(name?: string): LoadedProject {
	if (name) {
		const project = this.projects.get(name);
		if (!project) throw /* PROJECT_NOT_FOUND error */;
		return project;
	}

	if (this.defaultProject) {
		const project = this.projects.get(this.defaultProject);
		if (project) return project;
		// Default was stale, clear it
		this.defaultProject = undefined;
	}

	if (this.projects.size === 1) {
		return this.projects.values().next().value!;
	}

	if (this.projects.size === 0) {
		throw /* NO_PROJECTS_LOADED error */;
	}

	throw /* AMBIGUOUS_PROJECT error with list of loaded projects */;
}
```

### Pattern 2: Auto-Name Generation with Collision Avoidance
**What:** Generate project name from directory basename, append suffix on collision
**When to use:** When user loads a project without specifying a name
**Example:**
```typescript
function generateProjectName(basePath: string, existingNames: Set<string>): string {
	const base = basename(basePath);
	if (!existingNames.has(base)) return base;

	let counter = 1;
	while (existingNames.has(`${base}-${counter}`)) {
		counter++;
	}
	return `${base}-${counter}`;
}
```

### Pattern 3: Per-Project Handle Tracking in JarReader
**What:** Track which jar handles belong to which project so unload can close only that project's handles
**When to use:** When loading/unloading projects
**Example:**
```typescript
// In JarReader, add a reverse map: jarPath -> Set<projectName>
// Or more simply: track project -> Set<jarPath> alongside the existing handles map

private projectHandles = new Map<string, Set<string>>();

registerHandle(projectName: string, jarPath: string): void {
	let paths = this.projectHandles.get(projectName);
	if (!paths) {
		paths = new Set();
		this.projectHandles.set(projectName, paths);
	}
	paths.add(jarPath);
}

async closeProject(projectName: string): Promise<void> {
	const paths = this.projectHandles.get(projectName);
	if (!paths) return;
	for (const jarPath of paths) {
		// Only close if no other project references this jar
		let otherRefs = false;
		for (const [name, otherPaths] of this.projectHandles) {
			if (name !== projectName && otherPaths.has(jarPath)) {
				otherRefs = true;
				break;
			}
		}
		if (!otherRefs) {
			await this.close(jarPath);
		}
	}
	this.projectHandles.delete(projectName);
}
```

### Pattern 4: CLI Multiple Project Loading
**What:** Parse `--project /path --project /other/path` or `--project /path:name` syntax
**When to use:** Server startup
**Example:**
```typescript
// In args.ts, change project option to multiple
project: { type: 'string', short: 'p', multiple: true },

// parseArgs returns values.project as string[] | undefined
// Each entry is a path, name auto-generated from basename
```

### Anti-Patterns to Avoid
- **Duplicating resolution logic:** Every tool currently has its own `projectStore.get(project)` + error handling block. Extract to `resolveProject()` and use everywhere.
- **Closing shared jar handles:** Two projects might reference the same jar (e.g., same Fabric API version). Track reference counts or check before closing.
- **Mutating project name after load:** Project names should be immutable once assigned. If a user wants a different name, unload and reload.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI multi-value parsing | Custom argv iteration | `parseArgs` with `multiple: true` | Built into Node.js, already used in project |
| Name collision detection | Ad-hoc string manipulation | Simple counter loop (see Pattern 2) | Predictable, matches user expectations from file managers |

## Common Pitfalls

### Pitfall 1: Shared Jar Handles Between Projects
**What goes wrong:** Two projects use the same Fabric API version. Unloading one closes the shared jar handle, breaking the other project.
**Why it happens:** Jar handles are keyed by path, not by project. Two projects with the same dependency version share the same jar file on disk.
**How to avoid:** Reference-count jar handles or check all projects before closing. Only close a handle when no remaining project references that jar path.
**Warning signs:** "JAR_OPEN_FAILED" errors after unloading a project while another is still loaded.

### Pitfall 2: Stale Default Project
**What goes wrong:** Default project is set, then unloaded, but `defaultProject` string still points to the old name.
**Why it happens:** Forgetting to clear default on unload.
**How to avoid:** The unload logic MUST check if the unloaded project is the default and clear it. This is a locked decision from CONTEXT.md.
**Warning signs:** `resolveProject()` returns undefined when using default.

### Pitfall 3: Race Conditions on Load/Unload
**What goes wrong:** Two concurrent `load-project` calls with the same auto-generated name could both pass the collision check.
**Why it happens:** MCP tool calls are async; two could run simultaneously.
**How to avoid:** This is low risk since MCP tool calls from Claude Code are typically sequential. However, the name reservation should happen synchronously (check + set in the same synchronous block before awaiting `loadProject()`).
**Warning signs:** Two projects with the same name in the store.

### Pitfall 4: Forgetting to Update Existing Tools
**What goes wrong:** New tools work with project resolution but existing tools still require explicit `project` parameter.
**Why it happens:** Only adding new code without updating old code.
**How to avoid:** All three existing tools (`read_jar_entry`, `configure_filters`, `refresh_dependencies`) must be updated to make `project` optional and use `resolveProject()`.
**Warning signs:** User has to specify project name in single-project mode.

## Code Examples

### Existing Tool Pattern (current -- project required)
```typescript
// Source: src/tools/read-jar-entry.ts
inputSchema: {
	project: z.string().describe('Project name'),
	// ...
},
```

### Updated Tool Pattern (phase 4 -- project optional)
```typescript
inputSchema: {
	project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
	// ...
},
async ({ project, ...rest }) => {
	const loadedProject = projectStore.resolveProject(project);
	// ... use loadedProject
}
```

### MCP Tool Response Pattern (established)
```typescript
// Source: src/types/envelope.ts
const envelope = makeSuccess({ /* data */ }, { provenance: { tool: 'tool_name', project } });
return {
	content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
	structuredContent: envelope,
};
```

### parseArgs with multiple (Node.js built-in)
```typescript
// Source: Node.js docs - https://nodejs.org/api/util.html#utilparseargsconfig
const { values } = parseArgs({
	args: argv,
	options: {
		project: { type: 'string', short: 'p', multiple: true },
	},
});
// values.project is string[] | undefined
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `--project` required | Multiple `--project` optional | Phase 4 | Server can start empty, load projects via tools |
| `project` param required in tools | `project` param optional with resolution chain | Phase 4 | Single-project UX unchanged, multi-project enabled |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-02 | Name assignment: explicit name, auto-from-basename, collision suffix | unit | `pnpm vitest run tests/state/project-store.test.ts -t "naming"` | No -- Wave 0 |
| PROJ-02 | Name used in all tool calls via resolveProject() | unit | `pnpm vitest run tests/state/project-store.test.ts -t "resolve"` | No -- Wave 0 |
| PROJ-03 | Multiple projects loaded with independent state | unit | `pnpm vitest run tests/state/project-store.test.ts -t "multiple"` | No -- Wave 0 |
| PROJ-04 | List all loaded projects with metadata | unit | `pnpm vitest run tests/tools/list-projects.test.ts` | No -- Wave 0 |
| PROJ-05 | Unload project frees handles, clears default | unit | `pnpm vitest run tests/tools/unload-project.test.ts` | No -- Wave 0 |
| PROJ-05 | Shared jar handles not closed prematurely | unit | `pnpm vitest run tests/project/jar-reader.test.ts -t "per-project"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/state/project-store.test.ts` -- covers PROJ-02, PROJ-03 (naming, resolution, multiple projects)
- [ ] `tests/tools/load-project.test.ts` -- covers PROJ-02, PROJ-03 (load via tool)
- [ ] `tests/tools/unload-project.test.ts` -- covers PROJ-05 (unload + handle cleanup)
- [ ] `tests/tools/list-projects.test.ts` -- covers PROJ-04
- [ ] `tests/tools/set-default-project.test.ts` -- covers PROJ-02 (default resolution)
- [ ] `tests/cli/args.test.ts` -- covers multiple `--project` flag parsing

## Open Questions

1. **CLI name syntax for startup projects**
   - What we know: Multiple `--project` flags supported. Name auto-generated from basename.
   - What's unclear: Should there be a way to specify a custom name at CLI level (e.g., `--project /path:custom-name` or `--project /path --name custom-name`)? Or only via the `load-project` tool?
   - Recommendation: Keep CLI simple -- auto-generate names from basenames at startup. Users who want custom names can use the `load-project` tool after startup. This avoids complicating the CLI syntax.

2. **JarReader singleton vs per-project instances**
   - What we know: Currently a module-level singleton in `read-jar-entry.ts`. Handles are cached by jar path.
   - What's unclear: Should each project get its own JarReader, or should there be one shared JarReader with per-project tracking?
   - Recommendation: Keep the singleton JarReader (avoids opening the same jar file twice for two projects sharing a dependency). Add per-project handle tracking as a mapping layer on top (`projectHandles: Map<projectName, Set<jarPath>>`).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/state/project-store.ts`, `src/project/loader.ts`, `src/project/jar-reader.ts`, `src/cli/args.ts`, `src/index.ts`, all tool files
- [Node.js util.parseArgs docs](https://nodejs.org/api/util.html#utilparseargsconfig) -- `multiple: true` option support

### Secondary (MEDIUM confidence)
- [Exploring JS - parseArgs](https://exploringjs.com/nodejs-shell-scripting/ch_node-util-parseargs.html) -- confirmed `multiple` behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing tools verified
- Architecture: HIGH -- patterns derived from existing codebase, straightforward extensions
- Pitfalls: HIGH -- identified from code inspection (shared handles, stale defaults)

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable domain, no external dependency changes expected)
