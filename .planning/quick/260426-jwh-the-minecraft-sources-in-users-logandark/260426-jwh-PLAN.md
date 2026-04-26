---
phase: quick-260426-jwh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/project/loom-cache.ts
  - tests/project/loom-cache.test.ts
autonomous: true
requirements:
  - LOOM-CACHE-UNMAPPED-BARE-PREFIX
must_haves:
  truths:
    - "loadFabricMod against /Users/LoganDark/Documents/Projects/Fabric/Pockets resolves a sources jar with exists: true"
    - "An unmapped-era Fabric project whose Loom per-project cache contains minecraft-merged-<hash>/<mc_version>/minecraft-merged-<hash>-<mc_version>-sources.jar is detected"
    - "Existing cases continue to work: mapped-era hashed dirs, unmapped-era global cache, mapped-era global cache, and (legacy) unmapped-era project-local minecraft-merged-deobf-<hash> dirs"
    - "The mapped era still rejects minecraft-merged-deobf-* dirs to prevent cross-era matches"
  artifacts:
    - path: "src/project/loom-cache.ts"
      provides: "resolveSourcesJarPath / resolveCompiledJarPath that probe minecraft-merged-<hash> with bare version for unmapped era as well as the existing minecraft-merged-deobf-<hash> shape"
    - path: "tests/project/loom-cache.test.ts"
      provides: "Regression test reproducing the Pockets layout (minecraft-merged-<hash>/<mc_version>/... with no -deobf and bare version)"
  key_links:
    - from: "probeProjectLocal (unmapped era)"
      to: "minecraft-merged-<hash>/<mc_version>/... entry"
      via: "secondary readdir/access pass when artifactPrefix is minecraft-merged-deobf"
      pattern: "minecraft-merged-[a-f0-9]+/<mc_version>/minecraft-merged-[a-f0-9]+-<mc_version>-sources.jar"
---

<objective>
Fix Minecraft sources detection for /Users/LoganDark/Documents/Projects/Fabric/Pockets and any other unmapped-era Fabric project whose Loom per-project cache uses the bare `minecraft-merged-<hash>` artifact prefix (no `-deobf`).

Purpose: Previous fix (quick-260426-2bj) handles mapped-era `minecraft-merged-<hash>` and unmapped-era `minecraft-merged-deobf(-<hash>)?`, but Pockets shows newer Loom writes unmapped projects to `minecraft-merged-<hash>/<mc_version>/...` (bare prefix, bare version). The unmapped-era probe currently only looks under `minecraft-merged-deobf*` and never finds it.

Output: Updated `resolveSourcesJarPath` / `resolveCompiledJarPath` that, for unmapped era, additionally probe `minecraft-merged-<hash>` with the bare MC version. New regression test mirroring the exact Pockets layout. All 706 existing tests still green.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/project/loom-cache.ts
@src/project/types.ts
@src/project/gradle-parser.ts
@tests/project/loom-cache.test.ts
@.planning/quick/260426-2bj-fix-minecraft-source-jar-detection-for-p/260426-2bj-SUMMARY.md

<root_cause>
- Pockets gradle.properties: `minecraft_version=26.1`, no `yarn_mappings` line.
- Pockets build.gradle.kts: only `minecraft("com.mojang:minecraft:${minecraft_version}")`, no `mappings(...)` dependency.
- gradle-parser.ts -> `mappingEra: 'unmapped'` (no `mappings` configuration), `yarnMappings: undefined`.
- artifactInfo() therefore returns `{ artifactPrefix: 'minecraft-merged-deobf', version: '26.1' }`.
- Actual on-disk layout (verified by `ls`):
  `/Users/LoganDark/Documents/Projects/Fabric/Pockets/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-374c84699f/26.1/minecraft-merged-374c84699f-26.1-sources.jar`
- Top-level dirs in that project's cache: `minecraft-merged-374c84699f`, `minecraft-merged-a0e22fae92`, `minecraft-merged-afadbf8d95`, `minecraft-merged-dfc6d54c9b`. ZERO entries with `-deobf` prefix.
- `probeProjectLocal('minecraft-merged-deobf', '26.1', '-sources.jar')` therefore never matches, and the resolver falls back to the global cache path `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/26.1/...` which also doesn't exist (the global cache only has older snapshots).
- Conclusion: newer Loom (1.16-SNAPSHOT) appears to use `minecraft-merged-<hash>` for BOTH eras in the per-project cache. The era is encoded in the version string (yarn suffix vs bare MC version), not in the artifact prefix. The `-deobf` prefix only appears in the GLOBAL cache layout.
</root_cause>

<interfaces>
Current contract (from src/project/loom-cache.ts):

```typescript
export async function resolveSourcesJarPath(
  config: GradleConfig,
  projectRoot: string,
): Promise<string>;

export async function resolveCompiledJarPath(
  config: GradleConfig,
  projectRoot: string,
): Promise<string>;
```

Internal helper to extend (NOT change signature externally):

```typescript
function artifactInfo(config: GradleConfig): {
  artifactPrefix: string;  // 'minecraft-merged' or 'minecraft-merged-deobf'
  version: string;
};

async function probeProjectLocal(
  projectRoot: string,
  artifactPrefix: string,
  version: string,
  filenameSuffix: string,
): Promise<string | null>;
```

`GradleConfig.mappingEra` is `'mapped' | 'unmapped'`. `yarnMappings` is `string | undefined`.

Global cache filename for unmapped era stays the same: `minecraft-merged-deobf-<mc_version>-sources.jar` under `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/<mc_version>/`. Do NOT touch `globalCachePath` behaviour — the user's Pockets `~/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft/minecraft-merged-deobf/26.1.2/...` shows the global cache really does use the `-deobf` prefix.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — add failing regression test for unmapped-era project-local bare-prefix layout</name>
  <files>tests/project/loom-cache.test.ts</files>
  <behavior>
    Add a new test inside `describe('resolveSourcesJarPath', ...)` that reproduces the Pockets layout exactly:

    - artifactDir = 'minecraft-merged-374c84699f' (NO `-deobf`)
    - version = '26.1' (bare MC version, no yarn suffix)
    - File: `<tmpRoot>/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-374c84699f/26.1/minecraft-merged-374c84699f-26.1-sources.jar`
    - GradleConfig: { minecraftVersion: '26.1', mappingEra: 'unmapped', dependencies: [] }
    - Expected: `result === expectedJar` (project-local hit)

    Add the symmetric compiled-jar test inside `describe('resolveCompiledJarPath', ...)`:
    - Same layout, file ends with `.jar` (no `-sources` suffix).
    - Expected: `result === expectedJar` and `!result.includes('-sources.jar')`.

    These MUST fail against current loom-cache.ts. Run vitest to confirm RED.
  </behavior>
  <action>
    1. Open `tests/project/loom-cache.test.ts`. Tabs for indentation (CLAUDE.md convention).
    2. Inside `describe('resolveSourcesJarPath', ...)`, after the existing "returns project-local path when unmapped-era jar exists with deobf prefix + hash" test, add:

       ```typescript
       it('returns project-local path when unmapped-era jar exists under bare minecraft-merged-<hash> with bare version (newer Loom)', async () => {
           const version = '26.1';
           const artifactDir = 'minecraft-merged-374c84699f';
           const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
           await mkdir(versionDir, { recursive: true });
           const expectedJar = join(versionDir, `${artifactDir}-${version}-sources.jar`);
           await writeFile(expectedJar, '');

           const config: GradleConfig = {
               minecraftVersion: '26.1',
               mappingEra: 'unmapped',
               dependencies: [],
           };
           const result = await resolveSourcesJarPath(config, tmpRoot);
           expect(result).toBe(expectedJar);
           expect(result).toContain('minecraft-merged-374c84699f');
           expect(result).not.toContain('minecraft-merged-deobf');
       });
       ```

    3. Inside `describe('resolveCompiledJarPath', ...)`, after the existing project-local test, add:

       ```typescript
       it('returns project-local compiled jar under bare minecraft-merged-<hash> for unmapped era (newer Loom)', async () => {
           const version = '26.1';
           const artifactDir = 'minecraft-merged-374c84699f';
           const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
           await mkdir(versionDir, { recursive: true });
           const expectedJar = join(versionDir, `${artifactDir}-${version}.jar`);
           await writeFile(expectedJar, '');

           const config: GradleConfig = {
               minecraftVersion: '26.1',
               mappingEra: 'unmapped',
               dependencies: [],
           };
           const result = await resolveCompiledJarPath(config, tmpRoot);
           expect(result).toBe(expectedJar);
           expect(result).not.toContain('-sources.jar');
           expect(result).not.toContain('minecraft-merged-deobf');
       });
       ```

    4. Run `pnpm exec vitest run tests/project/loom-cache.test.ts` and CONFIRM the two new tests fail (current code falls back to global cache path).

    5. Commit with: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "test(quick-260426-jwh): add failing tests for newer-Loom unmapped bare-prefix layout" --files tests/project/loom-cache.test.ts`
  </action>
  <verify>
    <automated>pnpm exec vitest run tests/project/loom-cache.test.ts 2>&amp;1 | grep -E "(FAIL|2 failed|bare minecraft-merged|bare version)"</automated>
  </verify>
  <done>Two new tests added; both fail against current code; commit created.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — extend probeProjectLocal to also try bare minecraft-merged-&lt;hash&gt; for unmapped era</name>
  <files>src/project/loom-cache.ts</files>
  <behavior>
    Both existing failing tests pass. All 8 prior loom-cache tests still pass. Mapped-era tests still reject `minecraft-merged-deobf*`. Compiled-jar variants symmetric.

    Specifically the resolver, when called with `{ mappingEra: 'unmapped', minecraftVersion: '26.1' }` and a project root containing `.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-374c84699f/26.1/minecraft-merged-374c84699f-26.1-sources.jar`, returns that exact path.
  </behavior>
  <action>
    Edit `src/project/loom-cache.ts`. Tabs only.

    Strategy: keep the global-cache `-deobf` filename behaviour untouched (the user's global cache really uses `-deobf`). Only extend the project-local probe so that for unmapped era we ALSO try the bare `minecraft-merged` prefix.

    Implementation: change `resolveSourcesJarPath` and `resolveCompiledJarPath` to do two project-local probes for unmapped era — first with the era's natural prefix (`minecraft-merged-deobf`) for back-compat, then with the bare `minecraft-merged` prefix. Use the bare MC version (already what `artifactInfo` returns for unmapped era) for both attempts.

    Concrete edit — replace the bodies of `resolveSourcesJarPath` and `resolveCompiledJarPath` with:

    ```typescript
    export async function resolveSourcesJarPath(
        config: GradleConfig,
        projectRoot: string,
    ): Promise<string> {
        const { artifactPrefix, version } = artifactInfo(config);
        const local = await probeProjectLocal(projectRoot, artifactPrefix, version, '-sources.jar');
        if (local) return local;
        // Newer Loom (1.16-SNAPSHOT) writes unmapped projects under the bare
        // `minecraft-merged-<hash>` prefix instead of `minecraft-merged-deobf-<hash>`.
        // The era is encoded by the version string (bare MC version vs yarn-suffixed),
        // not by the artifact prefix. Try the bare prefix as a secondary probe.
        if (config.mappingEra === 'unmapped') {
            const localBare = await probeProjectLocal(projectRoot, 'minecraft-merged', version, '-sources.jar');
            if (localBare) return localBare;
        }
        return globalCachePath(artifactPrefix, version, '-sources.jar');
    }

    export async function resolveCompiledJarPath(
        config: GradleConfig,
        projectRoot: string,
    ): Promise<string> {
        const { artifactPrefix, version } = artifactInfo(config);
        const local = await probeProjectLocal(projectRoot, artifactPrefix, version, '.jar');
        if (local) return local;
        if (config.mappingEra === 'unmapped') {
            const localBare = await probeProjectLocal(projectRoot, 'minecraft-merged', version, '.jar');
            if (localBare) return localBare;
        }
        return globalCachePath(artifactPrefix, version, '.jar');
    }
    ```

    Why NOT broaden `probeProjectLocal` itself / NOT collapse the dual-probe:
    - The mapped era test "does not match minecraft-merged-deobf-* when looking for minecraft-merged-* (mapped era)" must still pass. Keeping the era-prefix-specific call as the primary probe preserves that exact behaviour.
    - The bare-prefix retry is gated on `mappingEra === 'unmapped'` so mapped-era behaviour is byte-identical to today.
    - `probeProjectLocal('minecraft-merged', '26.1', ...)` already excludes `minecraft-merged-deobf*` dirs (line 48 of current file), so the bare-prefix probe will never accidentally pick up a deobf entry that belongs to a different era.

    Run `pnpm exec vitest run tests/project/loom-cache.test.ts` — all 10 tests pass.

    Then `pnpm exec vitest run` for full suite (expect 708 passing — was 706 + 2 new). And `pnpm exec tsc --noEmit` clean.

    Smoke test against the real Pockets project:
    ```bash
    node --import tsx -e "
    import('./src/project/loader.js').then(async ({ loadFabricMod }) => {
        try {
            const mod = await loadFabricMod('/Users/LoganDark/Documents/Projects/Fabric/Pockets');
            console.log('sourcesJar:', mod.sourcesJar);
            console.log('compiledJar:', mod.compiledJar);
            process.exit(mod.sourcesJar.exists ? 0 : 1);
        } catch (e) {
            console.error('LOAD ERROR:', e);
            process.exit(2);
        }
    });
    " 2>&amp;1 | tail -20
    ```
    Expect `sourcesJar.exists === true` pointing at `.../minecraft-merged-374c84699f/26.1/minecraft-merged-374c84699f-26.1-sources.jar`.

    Commit: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "fix(quick-260426-jwh): probe bare minecraft-merged-<hash> for unmapped-era project cache" --files src/project/loom-cache.ts`
  </action>
  <verify>
    <automated>pnpm exec vitest run tests/project/loom-cache.test.ts &amp;&amp; pnpm exec tsc --noEmit</automated>
  </verify>
  <done>All 10 loom-cache tests pass; full suite green; tsc clean; Pockets smoke test resolves sources jar with exists: true.</done>
</task>

<task type="auto">
  <name>Task 3: Update CLAUDE.md sources-jar docs to note bare-prefix unmapped layout</name>
  <files>CLAUDE.md</files>
  <action>
    Find the "Sources jar path" bullet (under the Gradle Properties / `gradle.properties` section, currently lines describing per-project vs global cache). Update the per-project bullet to reflect that newer Loom uses `minecraft-merged-<hash>` for BOTH mapping eras in the per-project cache, with the era encoded in the version string. Keep the global-cache bullet unchanged (it really does use `minecraft-merged-deobf` for unmapped era).

    Replace the existing per-project sub-bullet with something like:

    > **Per-project cache (newer Loom, e.g. 1.16-SNAPSHOT used by MC 1.19+):** `<projectRoot>/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-<hash>/{version}/minecraft-merged-<hash>-{version}-sources.jar`. The `<hash>` is a 10-hex-char fingerprint of the project's Loom configuration and is NOT derivable from gradle.properties — the resolver globs `minecraft-merged-*` to find it. **Both mapped and unmapped eras use this bare `minecraft-merged-<hash>` prefix in the per-project cache** — the era is encoded in `{version}` (yarn-suffixed for mapped, bare MC version for unmapped). For unmapped era the resolver therefore probes both `minecraft-merged-deobf-<hash>` (older Loom layout) and `minecraft-merged-<hash>` (newer Loom layout).

    Leave the global-cache bullet that says it uses `minecraft-merged-deobf` for unmapped era as-is — that is still correct.

    No other doc edits needed.

    Commit: `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs(quick-260426-jwh): document bare minecraft-merged-<hash> for unmapped per-project Loom cache" --files CLAUDE.md`
  </action>
  <verify>
    <automated>grep -q "Both mapped and unmapped eras use this bare" CLAUDE.md &amp;&amp; grep -q "minecraft-merged-deobf-<hash>" CLAUDE.md</automated>
  </verify>
  <done>CLAUDE.md per-project bullet updated; commit created.</done>
</task>

</tasks>

<verification>
- `pnpm exec vitest run tests/project/loom-cache.test.ts` — 10/10 passing.
- `pnpm exec vitest run` — full suite green (708 expected).
- `pnpm exec tsc --noEmit` — zero errors.
- Smoke test: `loadFabricMod('/Users/LoganDark/Documents/Projects/Fabric/Pockets')` returns `sourcesJar.exists === true` with path containing `minecraft-merged-374c84699f/26.1/`.
- `git log --oneline` shows three commits: `test(...)`, `fix(...)`, `docs(...)`.
</verification>

<success_criteria>
- Pockets (MC 26.1, unmapped era, newer Loom) sources jar detected with exists: true.
- Mapped-era behaviour byte-identical to before (regression tests still pass, including the explicit mapped-rejects-deobf test).
- Older unmapped-era project-local layout (`minecraft-merged-deobf-<hash>`) still works (existing test passes unchanged).
- Global-cache fallback paths unchanged (they really do use `-deobf` for unmapped).
- Documentation reflects the dual unmapped layouts.
</success_criteria>

<output>
After completion, create `.planning/quick/260426-jwh-the-minecraft-sources-in-users-logandark/260426-jwh-SUMMARY.md`
</output>
