# Phase 33: Build File Re-parsing - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend refresh_project and refresh_project_members to re-parse build configuration files (gradle.properties, build.gradle.kts, fabric.mod.json) before re-discovering dependencies. Currently they use stale config from the original load.

</domain>

<decisions>
## Implementation Decisions

### Re-parsing scope
- Before calling `discoverDependencies()`, re-read and re-parse:
  1. `gradle.properties` — via `parseGradleProperties()`
  2. `build.gradle.kts` — via `parseBuildGradle()` with updated properties
  3. Resolve new sources jar path — via `resolveSourcesJarPath()` with new config
  4. `fabric.mod.json` — via the existing Zod parser
- Update `mod.gradleConfig`, `mod.sourcesJar`, and `mod.fabricMod` on the child before dependency discovery

### Minecraft version change behavior
- If the Minecraft version changes (detected by comparing old vs new `gradleConfig.minecraftVersion`), update in place AND include a warning in the response
- Warning text: `"Minecraft version changed from {old} to {new} — sources jar path updated"`
- The agent can decide whether to take any further action based on the warning

### Mod ID change behavior
- If `fabric.mod.json` `id` field changes, keep the original child name (do NOT rename)
- Include a warning: `"fabric.mod.json id changed from '{old}' to '{new}' — child name kept as '{old}' for namespace stability"`
- The mod's internal `fabricMod` field gets updated but the `children` map key and `mod.name` stay the same

### Sources jar missing after version change
- If the new sources jar path doesn't exist on disk (user changed version but hasn't run `./gradlew genSources`), the behavior should match the original load: set `sourcesJar.exists = false`
- Include a suggestion: `"New sources jar not found. Run ./gradlew genSources, then refresh again."`
- Dependencies can still be discovered (they come from Gradle cache, not the sources jar)

### Shared re-parsing logic
- Both `refresh_project` and `refresh_project_members` need the same re-parsing logic
- Extract a shared helper (e.g., `reloadFabricModConfig(mod)`) that re-reads all files and returns the updated config
- This avoids duplicating the re-parsing code in both tools

### Claude's Discretion
- Where to place the shared helper (loader.ts or a new module)
- Exact helper signature and return type
- Test structure

</decisions>

<specifics>
## Specific Ideas

- The re-parsing helper should reuse `parseGradleProperties`, `parseBuildGradle`, `resolveSourcesJarPath`, and the fabric.mod.json Zod parser — all already exist in `src/project/`
- The helper should return warnings (version change, mod ID change) as an array so the tool can include them in the response
- `loadFabricMod()` in `loader.ts` already does this full sequence — the helper could be extracted from it

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Refresh tools (being extended)
- `src/tools/refresh-project.ts` — uses stale `mod.gradleConfig` and `mod.sourcesJar.path` at lines 64-70
- `src/tools/refresh-project-members.ts` — same pattern at lines 95-100

### Parsing infrastructure (reuse these)
- `src/project/loader.ts` — `loadFabricMod()` does the full parse sequence (gradle → loom → fabric.mod.json → deps)
- `src/project/gradle-parser.ts` — `parseGradleProperties()`, `parseBuildGradle()`
- `src/project/loom-cache.ts` — `resolveSourcesJarPath()`
- `src/project/fabric-mod.ts` — fabric.mod.json Zod parsing

### Types
- `src/project/types.ts` — `GradleConfig`, `FabricModJson`, `FabricModChild`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseGradleProperties(content)` — parses k=v properties file
- `parseBuildGradle(content, properties)` — extracts deps, mapping era, returns GradleConfig
- `resolveSourcesJarPath(config)` — computes Minecraft sources jar path from GradleConfig
- `parseFabricMod(json)` — Zod-validated fabric.mod.json parser
- `loadFabricMod(rootPath)` — orchestrates all of the above in sequence

### Established Patterns
- The refresh loop pattern: save old state → close old handles → re-discover → register new handles → evict cache → resync workspace
- The re-parsing step slots in between "save old state" and "close old handles"

### Integration Points
- `mod.gradleConfig`, `mod.sourcesJar`, `mod.fabricMod` are mutable fields on `FabricModChild` — update them directly
- `discoverDependencies()` takes `(gradleConfig, sourcesJarPath, rootPath, modName)` — pass the updated config

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 33-build-file-re-parsing*
*Context gathered: 2026-04-16*
