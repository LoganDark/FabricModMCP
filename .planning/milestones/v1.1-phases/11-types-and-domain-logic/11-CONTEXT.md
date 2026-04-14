# Phase 11: Types and Domain Logic - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Study jar data model and infrastructure extensions exist, enabling all downstream phases to build on stable contracts. Covers: `StudyJar` type definition, `JarReader` granular add/remove with ref-counting, `EntryIndex` single-entry cache eviction, `study:` namespace prefix with collision detection. The `studyJars` map on `LoadedProject` survives `refresh_dependencies` without data loss.

</domain>

<decisions>
## Implementation Decisions

### Study jar naming
- Names are user-supplied, but auto-derived from jar filename (stem without extension) when not specified
- Safe character subset only: alphanumeric, hyphens, dots — no colons, spaces, or special characters (colons would break `study:name` ID scheme)
- Name collision with an existing study jar on the same project is a hard error — agent can remove the old one first if needed
- Names are case-sensitive (`MyLib` and `mylib` are different study jars)

### Duplicate path handling
- Same jar file path allowed under multiple names, silently accepted
- Paths normalized via `realpath()` before storage (resolves symlinks and `..` segments)
- JarReader ref-counting handles shared underlying handles naturally

### Staleness detection
- Store last-modified time and file size at jar open time
- On each access, check mtime+size — if either changed, reopen the handle automatically
- `refresh_dependencies` triggers staleness checks on all study jars

### Persistence behavior
- Study jars are fully ephemeral — lost when project is unloaded
- Study jars survive `refresh_dependencies` (stored in separate `studyJars` map, not rebuilt with dependencies)
- No persistence file — user/agent re-adds study jars each session as needed

### Validation on add
- Accept any valid ZIP file — no requirement for `.java` files (class-only jars are allowed)
- Return stats on successful add: package count, class count, total entries
- Helpful error messages on failure (file not found, invalid ZIP, suggest `-sources.jar` variant)
- No size or entry count limits — accept arbitrarily large jars

### Claude's Discretion
- Exact `StudyJar` interface field names and types
- Safe character validation regex
- Auto-derive name sanitization (how filename maps to valid name)
- Staleness check implementation details (where in the read path to check)
- Stats computation approach

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Data model
- `src/project/types.ts` — `LoadedProject`, `DependencyEntry`, `JarCategory` definitions. Study jars add to this type system.

### Jar handle management
- `src/project/jar-reader.ts` — `JarReader` class with ref-counting, `registerProject`/`closeProject`. Phase 11 adds `addProjectJar`/`removeProjectJar`.
- `src/project/shared-jar-reader.ts` — Singleton `jarReader` instance used across all tools.

### Entry index cache
- `src/browsing/entry-index.ts` — `EntryIndex` class that builds package/class indexes from jar entries.
- `src/browsing/entry-index-cache.ts` — Cache layer with `getOrBuildIndex()` and `clearEntryIndexCache()`. Phase 11 adds single-entry eviction.

### Project lifecycle
- `src/state/project-store.ts` — `ProjectStore` managing loaded projects.
- `src/tools/load-project.ts` — Project loading flow (jar registration, JDT LS init).
- `src/tools/unload-project.ts` — Project unloading flow (handle cleanup).

### Source reading
- `src/browsing/source-adapter.ts` — `SourceAdapter` interface and factory functions. Study jars use `createJarAdapter()`.

### Test patterns
- `src/project/jar-reader.test.ts` — Ref-counting behavior tests (shared jar lifecycle).
- `src/browsing/entry-index.test.ts` — Index building and query tests.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `JarReader.getHandle()`: Private lazy-load pattern — study jar staleness check can wrap this
- `entryIndexCache`: Already keyed by jar path — `Map.delete(key)` gives free single-entry eviction
- `JarCategory` union type: Add `'study'` literal to existing union
- `DependencyEntry` interface: Study jars can create ephemeral `DependencyEntry` objects for downstream compatibility

### Established Patterns
- Ref-counting in JarReader: `projectHandles` tracks `Set<string>` per project — study jars follow same pattern
- ID namespacing: existing IDs are `minecraft`, `src`, or `group:artifact` — `study:name` avoids collision by design
- Domain/tool separation: Phase 11 is purely domain layer — no MCP tool registration

### Integration Points
- `LoadedProject.studyJars` — new field, consumed by Phase 12 (tool integration) and Phase 13 (management tools)
- `JarReader.addProjectJar()` / `removeProjectJar()` — new methods, called by Phase 13 tools
- `entryIndexCache.delete()` — new export, called on study jar removal
- `JarCategory` with `'study'` — consumed by Phase 12 for priority sorting (`'study': 4`, lowest)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-types-and-domain-logic*
*Context gathered: 2026-04-13*
