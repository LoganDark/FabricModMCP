# Phase 6: Source Browsing - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can navigate decompiled source hierarchically — list packages, list classes, read full source — across jar sources and mod source using a unified interface. Every result includes source provenance.

</domain>

<decisions>
## Implementation Decisions

### Tool design
- Three separate MCP tools: `list_packages`, `list_classes`, `read_source`
- All tools use standard `resolveProject(name?)` for project resolution
- All tools use standard response envelope with provenance

### list_packages tool
- Parameters: `project?: string`, `jars?: string[]`, `package?: string`, `depth?: number`
- `jars` defaults to all jars; accepts glob patterns (same picomatch syntax as include/exclude filtering)
- `package` defaults to top-level packages; specifying a package lists its children
- `depth` defaults to 1 (immediate children only); higher values recurse into sub-packages
- Each package entry includes a class count (top-level classes only, not inner classes)
- Each package entry includes which jars contain it (provenance at package level)
- Packages with the same name from different jars are merged into a single entry

### list_classes tool
- Parameters: `project?: string`, `jars?: string[]`, `package: string` (required), `depth?: number`
- `jars` defaults to all jars; accepts glob patterns
- `depth` defaults to 1 (classes in this package only); higher values recurse into sub-packages
- Each class entry includes: `name`, `access`, `modifiers`, `type`, `jars` (array of jar identifiers)
- `access`: extracted from class declaration (e.g., `public`, package-private)
- `modifiers`: array of modifiers (e.g., `["final"]`, `["abstract"]`, `["static"]`)
- `type`: class kind — Claude's discretion on exact set, but at minimum: `class`, `interface`, `enum`, `record`, `@interface`
- `jars`: array of jar identifiers where this class appears (enables multi-jar detection)
- Inner classes are nested inside the parent class object with `$` naming:
  ```json
  {
    "name": "MinecraftClient",
    "access": "public",
    "modifiers": [],
    "type": "class",
    "jars": ["minecraft"],
    "innerClasses": [
      {
        "name": "MinecraftClient$Options",
        "access": "public",
        "modifiers": ["static"],
        "type": "class"
      }
    ]
  }
  ```
- Inner classes appear ONLY nested in parent, not as separate top-level entries
- `package-info.java` and `module-info.java` are filtered out of listings
- Class metadata (access, modifiers, type) extracted by reading the first few lines of each `.java` file — performance tradeoff accepted

### read_source tool
- Parameters: `project?: string`, `jar?: string`, `class: string` (fully-qualified name, required)
- `jar` is optional — if omitted, searches all jars for the class
- When class found in multiple jars: returns full source text for ALL matches, each with provenance
- Search priority when scanning all jars: minecraft → src → dependencies
- `class` uses fully-qualified dot notation (e.g., `net.minecraft.client.MinecraftClient`)

### Source scoping
- All three tools default to browsing across all jars (respecting project-level include/exclude filters)
- `jars` parameter accepts glob patterns with picomatch syntax (`*` single-level, `**` multi-level)
- When browsing all jars, packages are merged across jars — provenance tracked at package and class level
- Search/browse priority order: minecraft first, then mod source (`src`), then dependencies

### Mod source integration
- `"src"` jar identifier reads from `{rootPath}/src/main/java/` on the filesystem instead of a jar
- Same interface, same response shape — no differences from jar-based browsing
- If mod source directory doesn't exist or is empty: include `"src"` with empty listing (not omitted)

### Claude's Discretion
- Exact set of class type values beyond the minimum (class, interface, enum, record, @interface)
- How to parse class declarations efficiently (regex on first N lines, etc.)
- Internal implementation of filesystem-based browsing for mod source
- How to handle malformed or unparseable class files (skip with warning, best-effort, etc.)
- How to efficiently aggregate package listings and class counts across multiple jars

</decisions>

<specifics>
## Specific Ideas

- Class entry JSON structure explicitly confirmed:
  ```json
  {
    "name": "MinecraftClient",
    "access": "public",
    "modifiers": ["final"],
    "type": "class",
    "jars": ["minecraft"],
    "innerClasses": [
      {
        "name": "MinecraftClient$Options",
        "access": "public",
        "modifiers": ["static"],
        "type": "class"
      }
    ]
  }
  ```
- Strongly typed JSON responses — no string formatting for class listings

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — BROW-01 (list top-level packages), BROW-02 (sub-packages at any depth), BROW-03 (list classes including inner classes/enums/records/interfaces), BROW-04 (read full source by FQN), BROW-06 (mod source same interface), BROW-07 (inner classes correctly handled), BROW-08 (source provenance on every result)

### Existing code — browsing infrastructure
- `src/project/jar-reader.ts` — `JarReader` class with `listEntries()` (all entry paths) and `readEntry()` (file contents as Buffer)
- `src/tools/shared-jar-reader.ts` — Global JarReader singleton
- `src/tools/read-jar-entry.ts` — Existing tool for reading individual jar entries (pattern reference, but Phase 6 replaces this with `read_source`)
- `src/project/types.ts` — `LoadedProject`, `DependencyEntry`, `JarCategory`, `FilterConfig`
- `src/state/project-store.ts` — `ProjectStore` with `resolveProject(name?)` and project listing
- `src/types/envelope.ts` — `makeSuccess`/`makeError` response envelope builders
- `src/errors/domain-error.ts` — DomainError with tried paths and suggestions

### Prior phase decisions
- `.planning/phases/03-dependency-discovery/03-CONTEXT.md` — Jar identifier scheme (`"minecraft"`, `"src"`, `"group:artifact"`), jar categories, include/exclude filtering with picomatch glob patterns
- `.planning/phases/04-multi-project-sessions/04-CONTEXT.md` — Project resolution pattern (explicit → default → single-project → error)
- `.planning/phases/05-project-metadata/05-CONTEXT.md` — Tool design pattern, provenance chain tracking

### Key decisions from prior phases affecting this phase
- `"src"` entry exists in `dependencyJars` map with `category: 'mod-source'`, `available: true`, `sourcesJarPath: null` (Phase 3)
- JarReader handles are lazy-opened and cached; shared singleton across tools (Phase 3)
- Picomatch used for glob pattern matching on jar identifiers (Phase 3)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `JarReader.listEntries(jarPath)`: Returns string array of all entry paths in a jar — filter these for package/class extraction
- `JarReader.readEntry(jarPath, entryPath)`: Returns Buffer — convert to UTF-8 for source text
- `resolveProject(name?)`: Standard project resolution with fallback logic
- `makeSuccess(data, metadata)` / `makeError(code, message, tried, suggestions)`: Response envelope builders
- `DependencyEntry.id`, `.category`, `.sourcesJarPath`, `.available`: Jar metadata for scoping and provenance
- `LoadedProject.filterConfig`: Existing include/exclude filter state (picomatch-based)
- `LoadedProject.rootPath`: Base path for mod source at `{rootPath}/src/main/java/`

### Established Patterns
- Tool registration: Zod schema + handler + `register*Tool(server)` export, registered in `src/tools/index.ts`
- Response: dual `content` (text JSON) + `structuredContent` for universal MCP client compatibility
- DomainError catch pattern for resolveProject errors
- Singleton state: `projectStore` and `jarReader` accessed as module-level singletons

### Integration Points
- `src/tools/index.ts` — Register three new tools: `list_packages`, `list_classes`, `read_source`
- `LoadedProject.dependencyJars` — Iterate to find matching jars for scoping
- `LoadedProject.filterConfig` — Apply include/exclude before browsing
- Filesystem access needed for `"src"` jar ID: `fs.readdir` / `fs.readFile` on `{rootPath}/src/main/java/`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-source-browsing*
*Context gathered: 2026-04-13*
