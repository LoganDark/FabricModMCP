# Investigation: dep-sources failure for CreatorCore/Claude `auxcommands`

**Target project:** `/Users/LoganDark/Documents/Projects/CreatorCore/Claude` (no space — "Claude" is the project name)
**Failing dependency:** `net.logandark:auxcommands:1.0.0+1.21.11`
**Symptom:** When the Claude project is loaded into FabricModMCP, every other dependency lists/reads fine, but the `auxcommands` dep is silently absent from `list_classes` / `list_packages` / `read_source` results. If asked for it explicitly the tool layer returns `JAR_NOT_AVAILABLE`.

> NOTE on plan framing: the original PLAN.md was drafted under the misreading that the project path was `Claude auxcommands` (containing a space). The actual layout is two sibling projects under `CreatorCore/`: `Claude` (the consumer) and `AuxCommands` (a separately-published mod). The "space-in-path" investigation in the plan is therefore moot — the relevant question is why this *specific* dependency cannot be resolved while ~52 others can be. That is what this document answers. The "Space-in-Path Test" section below records the verification and the substitute investigation.

## Reproduction

Run the throwaway repro driver in this directory (loads the project end-to-end through `loadFabricMod`, dumps `dependencyJars`):

```
$ pnpm exec tsx .planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/repro.ts
```

Verbatim relevant output:

```
[2026-04-28T10:40:49.479Z] [INFO] Dependency discovery: 54 dependencies found (52 with sources, 2 without)
=== mod loaded ===
name: claude
rootPath: /Users/LoganDark/Documents/Projects/CreatorCore/Claude
mappingEra: mapped
sourcesJar: {
  path: '/Users/LoganDark/Documents/Projects/CreatorCore/Claude/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-dfc6d54c9b/1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/minecraft-merged-dfc6d54c9b-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4-sources.jar',
  exists: true
}
...
{"id":"claude/net.logandark:auxcommands","group":"net.logandark","artifact":"auxcommands","version":"1.0.0+1.21.11","category":"library","sourcesJarPath":null,"available":false}
=== total: 56 entries ===
```

The Minecraft sources jar resolves correctly (Loom per-project cache), 52 deps from `~/.gradle/caches/modules-2/files-2.1/` resolve correctly. The `auxcommands` entry is created (the gradle parser saw it), but `sourcesJarPath` is `null` and `available` is `false`. The only other unavailable dep is `com.mojang:patchy` (a Minecraft library that has no sources artifact published anywhere — different root cause, not in scope).

There is no thrown error and no surfaced warning. From the user's POV the dep just "isn't there" when browsing classes/packages, and an explicit `read_source` against the `auxcommands` jar would return:

```
{ ok: false, code: "JAR_NOT_AVAILABLE", message: "Sources for jar 'auxcommands' are not available", suggestions: ["The dependency does not have a sources jar"] }
```

(This is the tool-layer message synthesized in `src/tools/tool-helpers.ts:328`; not actually invoked in this repro because we stopped at the data layer, but the suggestion text in the envelope is misleading — the sources jar **does** exist on disk, just not where we look.)

## Project Shape on Disk

`ls -la /Users/LoganDark/Documents/Projects/CreatorCore/Claude` (relevant entries):

```
.git  .gitignore  .gradle  .idea  .jj  build
build.gradle.kts  gradle  gradle.properties  gradlew  gradlew.bat
README.md  run  run_server  scripts  settings.gradle.kts  src
```

Single-module project. Not a multi-module / composite build / included build.

`gradle.properties` (verbatim):

```
minecraft_version=1.21.11
yarn_mappings=1.21.11+build.4
loader_version=0.19.2
loom_version=1.16-SNAPSHOT

# Fabric API
fabric_api_version=0.141.3+1.21.11

# Mod identity
mod_project=claude
mod_group=net.logandark
mod_package=claude
mod_class=Claude
mod_id=claude
mod_name=Claude
mod_version=1.0-SNAPSHOT
mod_description=Ask Claude
```

`build.gradle.kts` — relevant `repositories { ... }` block:

```kotlin
repositories {
    maven {
        name = "LocalMaven"
        url = uri("file://${System.getProperty("user.home")}/maven")
    }

    mavenCentral()
}
```

`build.gradle.kts` — relevant `dependencies { ... }` block:

```kotlin
dependencies {
    minecraft("com.mojang:minecraft:${minecraft_version}")
    mappings("net.fabricmc:yarn:${yarn_mappings}")
    modImplementation("net.fabricmc:fabric-loader:${loader_version}")
    modImplementation(fabricApi.module("fabric-resource-loader-v0", fabric_api_version))
    modImplementation("net.logandark:auxcommands:1.0.0+1.21.11")
}
```

`settings.gradle.kts` — single-module (no `include(...)` lines for subprojects); the `pluginManagement` block also lists `LocalMaven` first.

Loom layout: `<projectRoot>/.gradle/loom-cache/` exists (newer per-project Loom cache — confirmed by the resolved Minecraft sources path above).

**The key piece of the project shape:** the `auxcommands` dependency comes from a sibling project, `/Users/LoganDark/Documents/Projects/CreatorCore/AuxCommands`, which is published to the user's local Maven repository at `~/maven` via `maven-publish`. The Claude project's `repositories` block declares that Maven repo *first* (before `mavenCentral()`), so Gradle resolves `net.logandark:auxcommands` directly out of that file-based Maven layout. **Gradle does not copy file-protocol Maven repository artifacts into `~/.gradle/caches/modules-2/files-2.1/`** — they are read in place. That cache is the materialization of network downloads (`maven-resolver` and friends), not of every resolved coordinate.

Concrete on-disk state of the local Maven repo (verbatim `ls`):

```
~/maven/net/logandark/auxcommands/1.0.0+1.21.11/
  auxcommands-1.0.0+1.21.11-sources.jar          (13502 bytes)  <-- the file we want
  auxcommands-1.0.0+1.21.11-sources.jar.{md5,sha1,sha256,sha512}
  auxcommands-1.0.0+1.21.11.jar                  (23535 bytes)
  auxcommands-1.0.0+1.21.11.jar.{md5,sha1,sha256,sha512}
  auxcommands-1.0.0+1.21.11.module               (2932 bytes)
  auxcommands-1.0.0+1.21.11.pom                  (977 bytes)
```

The artifact, the sources jar, and the POM are all present and readable — just at `~/maven/...` instead of `~/.gradle/caches/modules-2/files-2.1/...`.

## Code-Path Trace

For the `auxcommands` coordinate, the path through the FabricModMCP code is:

1. **Parse** — `src/project/gradle-parser.ts:parseBuildGradle` (lines 16-77).
   Regex on line 31 `/(\w+)\(\s*"([^"]+)"\s*\)/g` matches `modImplementation("net.logandark:auxcommands:1.0.0+1.21.11")`, splits into `{configuration: "modImplementation", group: "net.logandark", artifact: "auxcommands", version: "1.0.0+1.21.11", raw: "net.logandark:auxcommands:1.0.0+1.21.11"}`. The `repositories { ... }` block is **never inspected** — repo declarations are not extracted at all. Confirmed via repro output `gradleConfig.dependencies` — the auxcommands coord is present and well-formed.

2. **Discover** — `src/project/dependency-discovery.ts:discoverDependencies` (lines 117-256).
   Step 3 ("Other Declared Dependencies"), lines 222-234, iterates declared deps and calls `addDependencyEntry`. The `auxcommands` coord is not in the skip lists (lines 224-225: `minecraft`/`mappings` configs, `fabric-api`/`fabric-loader` artifacts), so it reaches `addDependencyEntry` on line 232.

3. **Add entry** — `src/project/dependency-discovery.ts:addDependencyEntry` (lines 47-78).
   Line 65: `const sourcesJarPath = await findSourcesJar(group, artifact, version);`
   Line 75: `available: sourcesJarPath !== null`.

4. **Find sources jar** — `src/project/source-jar-finder.ts:findSourcesJar` (lines 9-33). **THE BUG IS HERE.**
   Line 5 hardcodes `gradleCacheBase()` to `~/.gradle/caches/modules-2/files-2.1`. Line 14 builds `versionDir = ~/.gradle/caches/modules-2/files-2.1/net.logandark/auxcommands/1.0.0+1.21.11`. Line 18 `readdir(versionDir)` throws `ENOENT` (the directory genuinely does not exist — Gradle never created it because the coord was resolved from a file-protocol Maven repo). The catch on line 28 silently swallows the error and the function returns `null` on line 32.

   The function has no notion of additional Maven repositories declared in the project's `build.gradle.kts`, no fallback to the user's `~/maven`, no scan of `~/.m2/repository`, no Gradle init script-style "local repo" lookup. It is a single-source resolver pointed at exactly one cache.

5. **Transitive walk** — `src/project/dependency-discovery.ts:followTransitiveDeps` (lines 80-115) → `findPomInModules2` (lines 18-45). Same pattern: only consults `~/.gradle/caches/modules-2/files-2.1/`, so the `auxcommands` POM at `~/maven/.../auxcommands-1.0.0+1.21.11.pom` is never opened. Auxcommands has no compile-scope deps that would matter here, but the same blindness would hit any locally-published artifact with transitive deps.

6. **Surface to tools** — entry stored in `mod.dependencyJars` with `available: false`. From there:
   - `src/tools/list-classes.ts:66` `if (!dep.available) continue;` — silently skipped.
   - `src/tools/list-packages.ts:42` `if (!dep.available) continue;` — silently skipped.
   - `src/tools/read-source.ts:120` `if (!dep.available) continue;` — silently skipped on cascade.
   - `src/tools/tool-helpers.ts:230-231` — explicit jar request returns `JAR_NOT_AVAILABLE`.

The error never surfaces as a warning at load time, either: there is no log message that says "couldn't find auxcommands". The `discoverDependencies` info log line (`logger.info` in `src/project/loader.ts:204`) only reports aggregate counts (`52 with sources, 2 without`), so the user sees a benign-looking "2 without sources" tally and has no signal that one of those two is a project-shape problem on our side rather than a genuinely-missing-sources artifact like `com.mojang:patchy`.

**Silent-catch branches found in the trace:**
- `source-jar-finder.ts:28` (and again at 56 in `findCompiledJar`): `try/catch {}` swallows the `ENOENT` from `readdir`.
- `dependency-discovery.ts:40-42` and `113`: same pattern in POM lookup and POM parsing.

These are the only places where the path-not-found state is converted to "not available", and none of them carry context out for the tool layer to surface.

## Cache Reality Check

For `net.logandark:auxcommands:1.0.0+1.21.11`:

- `~/.gradle/caches/modules-2/files-2.1/net.logandark/` — **does not exist** (`ls` empty/ENOENT). Confirmed: `find ~/.gradle/caches -name "auxcommands*"` returns zero hits, anywhere in the entire Gradle caches tree.
- `~/maven/net/logandark/auxcommands/1.0.0+1.21.11/auxcommands-1.0.0+1.21.11-sources.jar` — **exists** (13502 bytes, mtime 2026-04-28 02:40). See verbatim listing in "Project Shape on Disk" above.

For comparison, the deps that DO work — e.g. `org.lwjgl:lwjgl:3.3.3` — live at `~/.gradle/caches/modules-2/files-2.1/org.lwjgl/lwjgl/3.3.3/<sha1>/lwjgl-3.3.3-sources.jar` and resolve normally through `findSourcesJar`. The cache-presence pattern correlates 1:1 with `available: true` across all 52 working deps.

So: this is **not** a "user must run genSources" problem and **not** a "Gradle hasn't downloaded the sources yet" problem. The sources jar is fully materialized on disk. The bug is on our side: `findSourcesJar` is looking in the wrong (single, hardcoded) place.

For `com.mojang:patchy:2.2.10` (the only OTHER unavailable dep): `~/.gradle/caches/modules-2/files-2.1/com.mojang/patchy/2.2.10/` exists (the compiled jar is cached) but contains no `*-sources.jar`. That dep genuinely has no sources artifact published — different problem, out of scope.

## Space-in-Path Test

Substitute investigation, per the corrected framing in the orchestrator's prompt: rather than testing whether a space in the path breaks anything (the path has no space), test whether the failure correlates with anything other than the repository-resolution mechanism.

Verifications performed:

- **Path comparison:** `/Users/LoganDark/Documents/Projects/CreatorCore/Claude` contains no whitespace. `node:path.resolve` (used in `loadFabricMod` line 106), `node:path.join` (used throughout), and `node:fs.readdir` all handle the path without incident — confirmed by the 52 successful resolutions and the cleanly-loaded Minecraft sources jar at the deeply-nested Loom-cache path.
- **Dependency comparison:** every other declared and transitive dep in this project resolves successfully *except* `auxcommands` and `patchy`. The two failures have totally different shapes — `patchy` is in modules-2 but with no sources artifact; `auxcommands` is not in modules-2 at all but has a sources artifact in `~/maven`. So the "auxcommands-specific" question reduces to: what is special about how `auxcommands` is resolved? Answer: it comes from a non-Gradle-cache Maven repository (`file://${user.home}/maven`) declared in the project's `repositories` block, which our resolver does not know exists.
- **Project-shape comparison:** the same Claude project, with `auxcommands` removed from the dep list, would fully succeed (all other modImplementations resolve). The same Claude project, with `auxcommands` re-published into the Gradle cache instead of `~/maven`, would also succeed. So the failure is specific to the *repository topology* (file-based local Maven repo), not to the dep coord, the dep version, the parent project's path, or the dep's own contents.

Verdict on the original "is the space guilty?" question: **innocent** — there is no space, and no path-handling code is implicated. Verdict on the substitute "why this dep specifically?" question: the dep is published to a `file://` Maven repo that the resolver does not consult.

## Root Cause

The failure originates in `src/project/source-jar-finder.ts:findSourcesJar` (and symmetrically `findCompiledJar`), because that function only consults `~/.gradle/caches/modules-2/files-2.1/` and has no awareness of additional Maven repositories declared in the project's `build.gradle.kts` `repositories { ... }` block.

`net.logandark:auxcommands:1.0.0+1.21.11` is published to the user's local Maven repository at `~/maven` (declared as `LocalMaven` in `build.gradle.kts` lines 27-30, with `url = uri("file://${System.getProperty("user.home")}/maven")`). Gradle resolves the coordinate directly out of that file-protocol repo and does not copy artifacts into the modules-2 cache, so `findSourcesJar`'s `readdir` of the version directory throws `ENOENT`, the `try/catch` on line 28 silently returns `null`, and `addDependencyEntry` records `available: false`. The dep is then silently filtered out of `list_classes`/`list_packages`/`read_source` results, and explicit access returns the (factually misleading) `JAR_NOT_AVAILABLE` error with suggestion text claiming the dependency has no sources jar — when in reality the sources jar exists at `~/maven/net/logandark/auxcommands/1.0.0+1.21.11/auxcommands-1.0.0+1.21.11-sources.jar`, just not in the location we look.

Supporting evidence from earlier sections:
- Reproduction shows `sourcesJarPath: null, available: false` for exactly this coord while 52 sibling deps succeed.
- Cache reality check confirms the file is present in `~/maven` and absent from `~/.gradle/caches`.
- Code-path trace pins the unconditional cache-base path on `source-jar-finder.ts:5` and the silent ENOENT swallow on `source-jar-finder.ts:28`.
- Project-shape inspection shows the `LocalMaven` repository declared in `build.gradle.kts` and `settings.gradle.kts`.

## Suggested Fix Direction

The fix lives primarily in `src/project/source-jar-finder.ts`. Extend `findSourcesJar` and `findCompiledJar` (and the analogous `findPomInModules2` in `dependency-discovery.ts`) to consult an ordered list of resolution roots, not just the modules-2 cache. Concretely:

1. Extract Maven repository declarations from `build.gradle.kts` (and `settings.gradle.kts`'s `pluginManagement.repositories` block, though plugin repos shouldn't matter for compile deps) by extending `gradle-parser.ts` to capture `maven { url = uri("file://...") }` blocks (and possibly `mavenLocal()` → `~/.m2/repository`, though that is not used here). Substitute `${System.getProperty("user.home")}` and similar placeholders.
2. Pass the resulting list of Maven roots through `GradleConfig` into `discoverDependencies`, then through to the finder functions.
3. Have `findSourcesJar` probe each Maven root in order using the **standard Maven layout** `<root>/<group-as-path>/<artifact>/<version>/<artifact>-<version>-sources.jar` as a *first* candidate (no sha1 subdirectory — Maven layout is flat), falling back to the existing modules-2 sha1-globbed lookup. The two layouts are sibling cases, not alternatives — the modules-2 layout is Gradle-specific and inserts a sha1 directory level that Maven proper does not have.
4. Mirror the same change for `findCompiledJar` and `findPomInModules2` so that transitive POM walking also works for locally-published artifacts.

A narrower interim fix (less code, less correctness): probe `~/maven` and `~/.m2/repository` unconditionally as well-known fallback roots, regardless of what the project's `repositories` block says. This wouldn't generalize to arbitrary `file://` repos with custom paths, but it would cover this user's case and the common `mavenLocal()` case for ~zero parsing cost. Recommended only if the proper repository-extraction path is too large for a quick task.

Out of either approach, also worth doing: when a dep's sources jar resolution returns `null`, log the dep's coord at warn level so the load-time aggregate "2 without sources" line is no longer the only visibility. Currently the silent catch in `source-jar-finder.ts:28` makes this class of bug invisible until a user notices the dep is missing from a class listing.

DO NOT change the tool-layer error message ("The dependency does not have a sources jar") in isolation — that suggestion is correct for the `patchy`-style case and only misleading for the `auxcommands`-style case. Fixing the resolver makes the message correct for the only remaining case.

## Out of Scope

- Implementing the fix. This task is investigation-only; the actual code change is deferred to a follow-up quick task.
- The `com.mojang:patchy:2.2.10` "no sources artifact published" case — that is a genuinely-missing-upstream-artifact problem, not a resolver problem. Different ticket if anyone cares (suggest: silently downgrade `patchy` to `available: false` without counting it in the warn-aggregate, since there is nothing to do).
- Multi-module / composite-build / `includeBuild` resolution. The Claude project is single-module and uses a published artifact, not an `includeBuild` of the AuxCommands project. If the user later switches to `includeBuild("../AuxCommands")`, that's a different code path (Gradle composite builds — the sources are in the sibling project's source tree, not in any cache) and a different fix.
- The leftover `repro.ts` in this directory. It is investigation scaffolding, lives only inside this quick-task directory, and may be removed during cleanup at the end of this plan.
