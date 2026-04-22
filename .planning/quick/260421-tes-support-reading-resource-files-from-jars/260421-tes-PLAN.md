---
phase: quick
plan: 260421-tes
type: execute
wave: 1
depends_on: []
files_modified:
  - src/project/types.ts
  - src/project/source-jar-finder.ts
  - src/project/loom-cache.ts
  - src/project/dependency-discovery.ts
  - src/project/loader.ts
  - src/project/study-jar.ts
  - src/tools/read-jar-entry.ts
  - src/tools/add-study-jar.ts
  - src/tools/descriptions.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "DependencyEntry has compiledJarPath field alongside sourcesJarPath"
    - "Minecraft dependency has both sources and compiled jar paths populated"
    - "Gradle cache dependencies have compiled jar paths discovered via sha1 dir scanning"
    - "Study jars support optional compiled jar path"
    - "read_jar_entry can read from either sources or compiled jar via a source parameter"
  artifacts:
    - path: "src/project/types.ts"
      provides: "compiledJarPath field on DependencyEntry"
      contains: "compiledJarPath"
    - path: "src/project/source-jar-finder.ts"
      provides: "findCompiledJar function"
      exports: ["findCompiledJar"]
    - path: "src/project/loom-cache.ts"
      provides: "resolveCompiledJarPath function"
      exports: ["resolveCompiledJarPath"]
    - path: "src/tools/read-jar-entry.ts"
      provides: "source parameter for choosing sources vs compiled"
  key_links:
    - from: "src/project/dependency-discovery.ts"
      to: "src/project/source-jar-finder.ts"
      via: "findCompiledJar call"
      pattern: "findCompiledJar"
    - from: "src/project/loader.ts"
      to: "src/project/loom-cache.ts"
      via: "resolveCompiledJarPath call"
      pattern: "resolveCompiledJarPath"
    - from: "src/tools/read-jar-entry.ts"
      to: "DependencyEntry.compiledJarPath"
      via: "source parameter routing"
      pattern: "compiledJarPath"
---

<objective>
Add compiled jar support so tools can read non-source resource files (lang files, shaders, textures, etc.) from jars.

Purpose: Source jars only contain .java files. Many Minecraft resources (lang files, shaders, textures, JSON data) live in compiled jars. This enables Claude to read those resources for mod development.

Output: Updated types, jar finders, dependency discovery, and read_jar_entry tool with `source` parameter.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/project/types.ts
@src/project/source-jar-finder.ts
@src/project/loom-cache.ts
@src/project/dependency-discovery.ts
@src/project/loader.ts
@src/project/study-jar.ts
@src/tools/read-jar-entry.ts
@src/tools/add-study-jar.ts
@src/tools/descriptions.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add compiledJarPath to types, finders, and discovery</name>
  <files>src/project/types.ts, src/project/source-jar-finder.ts, src/project/loom-cache.ts, src/project/dependency-discovery.ts, src/project/loader.ts, src/project/study-jar.ts</files>
  <action>
**types.ts:**
- Add `compiledJarPath: string | null` to `DependencyEntry` (after `sourcesJarPath`)
- Add `compiledJarPath?: string` to `StudyJar` (optional, since study jars may not have one)
- Add `compiledJar?: ResolvedJar` to `FabricModChild` (alongside existing `sourcesJar`)

**source-jar-finder.ts:**
- Add `findCompiledJar(group, artifact, version)` function. Same logic as `findSourcesJar` but looks for `${artifact}-${version}.jar` (no `-sources` suffix). Same sha1 directory scanning pattern.

**loom-cache.ts:**
- Add `resolveCompiledJarPath(config: GradleConfig)` function. Same path construction as `resolveSourcesJarPath` but the filename drops `-sources`: instead of `${artifactId}-${version}-sources.jar`, use `${artifactId}-${version}.jar`.

**dependency-discovery.ts:**
- In `addDependencyEntry`: call `findCompiledJar(group, artifact, version)` alongside existing `findSourcesJar` call. Set the new `compiledJarPath` field on the `DependencyEntry`.
- In `discoverDependencies`: for the minecraft seed entry, accept a `compiledJarPath` parameter and set it. For the mod-source seed entry, set `compiledJarPath: null` (mods don't have compiled jars).
- Update the `discoverDependencies` function signature to accept `compiledJarPath: string | null` as a 5th parameter (after `modName`... actually, better to pass it right after `sourcesJarPath`). The caller in loader.ts will provide it.

**loader.ts:**
- In `loadFabricMod`: call `resolveCompiledJarPath(gradleConfig)` to get the compiled jar path. Check if it exists on disk with `fileExists()`. Store as `compiledJar: { path: compiledJarPath, exists: compiledJarExists }` on the returned `FabricModChild`. Pass it to `discoverDependencies`.
- In `reloadFabricModConfig`: same — resolve the compiled jar path and update `mod.compiledJar`.

**study-jar.ts:**
- In `studyJarToDependencyEntry`: set `compiledJarPath: studyJar.compiledJarPath ?? null` on the returned entry.
- In `createStudyJar`: accept optional `compiledJarPath` parameter. If provided, validate it exists and is a valid ZIP (same pattern as sources jar validation). Store on returned StudyJar.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsc --noEmit 2>&1 | head -40</automated>
  </verify>
  <done>All types updated, findCompiledJar and resolveCompiledJarPath exist and are called during discovery. tsc passes with no errors.</done>
</task>

<task type="auto">
  <name>Task 2: Update read_jar_entry and add_study_jar tools with compiled jar support</name>
  <files>src/tools/read-jar-entry.ts, src/tools/add-study-jar.ts, src/tools/descriptions.ts</files>
  <action>
**descriptions.ts:**
- Update `read_jar_entry` description: mention that it can read from either source jars (Java source files) or compiled jars (resources like lang files, textures, shaders, JSON data). Mention the `source` parameter.
- Update `add_study_jar` description: mention optional `compiledJar` parameter for a compiled/resources jar path.
- Add to `PARAMS`: `source: z.enum(['sources', 'compiled']).default('sources').describe('Which jar to read from: "sources" for Java source files, "compiled" for resources (lang, shaders, textures, JSON)')` — but since this is specific to `read_jar_entry`, add it directly in the tool's inputSchema instead. Actually, it could go in PARAMS if we anticipate reuse. Use judgment — if only one tool uses it, keep it in the tool.

**read-jar-entry.ts:**
- Add `source` parameter to inputSchema: `z.enum(['sources', 'compiled']).default('sources').describe(...)` — optional, defaults to 'sources'.
- In the handler: when `source === 'compiled'`, use `entry.compiledJarPath` instead of `entry.sourcesJarPath`. If the compiled jar path is null or unavailable, return a clear error with code `JAR_NO_COMPILED` and message like "Compiled jar for '{jar}' is not available" with suggestion to check if the dependency has a compiled jar.
- Update the existing `JAR_NO_SOURCES` error check to only trigger when `source === 'sources'`.
- Update provenance in the success response to reflect which jar type was read (e.g., `sourcesJarPath` or `compiledJarPath` field, and add `source` to provenance).

**add-study-jar.ts:**
- Add optional `compiledJar` parameter: `z.string().optional().describe('Absolute path to a compiled/resources JAR file (for non-source resources like lang files, textures)')`.
- Pass it through to `createStudyJar(path, name, loadedProject, compiledJar)`.
- If a compiled jar is provided, also register it with `jarReader.addProjectJar` so it can be read.
- Include compiledJar path in the success response.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsc --noEmit 2>&1 | head -40</automated>
  </verify>
  <done>read_jar_entry accepts `source: "sources" | "compiled"` parameter (defaults to "sources"). add_study_jar accepts optional `compiledJar` path. Tool descriptions updated. tsc passes.</done>
</task>

<task type="auto">
  <name>Task 3: End-to-end verification and edge case handling</name>
  <files>src/tools/read-jar-entry.ts, src/project/dependency-discovery.ts</files>
  <action>
Run the full test suite to check for regressions. Then verify:

1. `pnpm build` succeeds (tsup bundles without errors).
2. `pnpm test` passes all existing tests.
3. Manually trace through the code path: `read_jar_entry` with `source: "compiled"` -> resolves jar -> gets `compiledJarPath` -> reads entry. Confirm no code path returns undefined where string is expected.
4. Check that the `DiscoverySummary` still makes sense — `available` on DependencyEntry currently means "sourcesJarPath is not null". This should remain unchanged — `available` tracks sources availability. Compiled jar availability is a separate concern (check `compiledJarPath !== null` when needed).
5. Verify `get_member_info` tool (which displays jar inventory) does not need changes — it reads from DependencyEntry fields, and the new `compiledJarPath` field will naturally appear in the structured output since it's part of the type. Check if it explicitly picks fields or spreads the object. If it explicitly picks, add `compiledJarPath` to the picked fields.

Fix any issues found. If `get_member_info` or other tools explicitly destructure DependencyEntry fields, add `compiledJarPath` to them.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && pnpm build && pnpm test 2>&1 | tail -30</automated>
  </verify>
  <done>Build succeeds, all tests pass, compiled jar path flows through from discovery to tool usage without type errors or runtime issues.</done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` passes with zero errors
- `pnpm build` succeeds
- `pnpm test` passes all existing tests
- `DependencyEntry` type includes `compiledJarPath: string | null`
- `read_jar_entry` tool accepts `source` parameter
- `add_study_jar` tool accepts `compiledJar` parameter
</verification>

<success_criteria>
- Compiled jar paths are discovered for Minecraft (Loom cache) and dependencies (modules-2 cache)
- read_jar_entry can read resource files from compiled jars when `source: "compiled"` is passed
- Study jars support optional compiled jar association
- All existing functionality remains backward-compatible (sources is the default everywhere)
- TypeScript compiles cleanly, build succeeds, tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/260421-tes-support-reading-resource-files-from-jars/260421-tes-SUMMARY.md`
</output>
