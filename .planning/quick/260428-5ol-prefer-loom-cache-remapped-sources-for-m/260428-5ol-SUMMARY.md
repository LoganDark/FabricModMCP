---
phase: quick-260428-5ol
plan: 01
subsystem: project
tags: [loom, dependency-resolution, fabric-mod, remapped-mods, jar-probing]

requires:
  - phase: quick-260428-59m
    provides: Maven-roots-first probe ordering layered over the modules-2 fallback in findSourcesJar / findCompiledJar
provides:
  - resolveLoomRemappedJarPath resolver (in src/project/loom-cache.ts) that globs <projectRoot>/.gradle/loom-cache/remapped_mods/remapped/<group-as-path>/<artifact>-<hex>/<version>/ for Loom-remapped mod dep jars
  - Loom-remapped-mods-first probe ordering in findSourcesJar / findCompiledJar (loom-cache wins over Maven roots, Maven roots win over modules-2)
  - projectRoot threading through addDependencyEntry / followTransitiveDeps / formatUnresolvedSourcesWarn in dependency-discovery.ts
  - warn-log message extended to list the project-local loom-cache remapped_mods root as the FIRST tried root when projectRoot is provided
affects: [project loading, dependency discovery, browsing tools (list-classes, list-packages, read-source) for Fabric mod dependencies]

tech-stack:
  added: []
  patterns:
    - "Three-tier probe order for jar resolution: Loom remapped_mods cache (project-mapped) -> declared Maven roots (intermediary-mapped) -> Gradle modules-2 cache (intermediary-mapped). Earlier tiers carry mappings closer to what the IDE / compile classpath sees."
    - "Asymmetry between jar probe and POM probe: jars (sources + compiled) use loom-cache-first; POMs do NOT. Loom-emitted .pom files in remapped_mods are remapping byproducts; authoritative dependency-tree metadata lives in upstream POMs (Maven roots / modules-2)."

key-files:
  created:
    - .planning/quick/260428-5ol-prefer-loom-cache-remapped-sources-for-m/deferred-items.md
  modified:
    - src/project/loom-cache.ts
    - src/project/source-jar-finder.ts
    - src/project/dependency-discovery.ts
    - tests/project/loom-cache.test.ts
    - tests/project/source-jar-finder.test.ts
    - tests/project/dependency-discovery.test.ts

key-decisions:
  - "Same loom-cache-first logic applies to BOTH sources and compiled jars. The binary jar is also remapped to the project's mappings; falling through to Maven roots / modules-2 for the compiled jar would silently mismatch with the sources jar's symbols."
  - "findPom is intentionally NOT loom-cache-probed. Loom emits .pom files in remapped_mods as byproducts of the remapping pipeline; they are not authoritative for transitive resolution. Upstream POMs (Maven roots / modules-2) carry the correct dependency-tree metadata. Decision documented inline in dependency-discovery.ts."
  - "resolveLoomRemappedJarPath lives in src/project/loom-cache.ts alongside resolveSourcesJarPath and probeProjectLocal -- per the constraint that loom-cache concerns stay consolidated in one module."
  - "Artifact-dir matching uses startsWith + hex-only suffix verification rather than a regex with escape concerns; rejects bare-<artifact> dirs without a hash because Loom-remapped output always has a per-project fingerprint hash."
  - "projectRoot is the 5th parameter of findSourcesJar / findCompiledJar (after mavenRoots), so the existing 4-arg call shape and existing tests asserting on argument index 3 (mavenRoots) remain unchanged."

patterns-established:
  - "Resolver layering grows DOWNWARD: each new tier slots in BEFORE the previous chain (loom-cache -> maven-roots -> modules-2). Future resolvers (e.g. for Loom's `processed_mods` cache or a custom mappings classifier) can slot in at the front by accepting a projectRoot / config arg and probing first."
  - "Warn-log messages list tried roots in actual probe order, so the message itself documents the resolution semantics for future debugging."

requirements-completed:
  - LOOMREMAP-01
  - LOOMREMAP-02
  - LOOMREMAP-03

duration: 6.5min
completed: 2026-04-28
---

# quick-260428-5ol: Prefer Loom-Cache Remapped Sources for Mod Deps Summary

**Fabric mod deps now resolve their sources/compiled jars to `<projectRoot>/.gradle/loom-cache/remapped_mods/remapped/...` (yarn-mapped, matching the IDE) instead of falling through to declared Maven roots or modules-2 (intermediary-mapped, silently wrong).**

## Performance

- **Duration:** ~6.5 minutes
- **Started:** 2026-04-28T11:09:35Z
- **Completed:** 2026-04-28T11:16:10Z
- **Tasks:** 2 (TDD, TDD + integration)
- **Test count:** 742 -> 750 (+8 new)

## Accomplishments

- Added `resolveLoomRemappedJarPath(projectRoot, group, artifact, version, suffix)` to `src/project/loom-cache.ts`, globbing the per-project Loom remapped_mods cache by `<artifact>-<hex>` (rejecting bare-artifact dirs without a hash, rejecting modules-2 dotted-name shape).
- Wired the new resolver in as the FIRST probe in `findSourcesJar` and `findCompiledJar`, ahead of the existing Maven-roots and modules-2 probes. Same logic for sources and compiled jars (both are remapped).
- Threaded `projectRoot` through `addDependencyEntry`, `followTransitiveDeps`, and `formatUnresolvedSourcesWarn` in `dependency-discovery.ts`. `findPom` left unchanged by design (decision documented inline).
- Extended the unresolved-sources warn message to list the loom-cache remapped_mods root as the FIRST tried root (matching probe order).
- Verified end-to-end against `/Users/LoganDark/Documents/Projects/CreatorCore/Claude`: `auxcommands` sources resolve to `<projectRoot>/.gradle/loom-cache/remapped_mods/remapped/net/logandark/auxcommands-12761da6/1.0.0+1.21.11/auxcommands-12761da6-1.0.0+1.21.11-sources.jar` (NOT `~/maven/...`). The compiled jar resolves to the matching `.jar` sibling. The leftover `patchy` warn line correctly lists the loom-cache root first.

## Task Commits

1. **Task 1 RED:** add failing tests for `resolveLoomRemappedJarPath` -- `d63afa3` (test)
2. **Task 1 GREEN:** add `resolveLoomRemappedJarPath` for per-project remapped mod jars -- `77669dd` (feat)
3. **Task 2 RED:** add failing tests for loom-cache-first probe ordering -- `881ff78` (test)
4. **Task 2 GREEN:** probe Loom remapped_mods cache first for mod dep sources/jars -- `3319de9` (feat)

## Files Created/Modified

- `src/project/loom-cache.ts` -- adds `resolveLoomRemappedJarPath`. Globs `<projectRoot>/.gradle/loom-cache/remapped_mods/remapped/<group-as-path>/` for entries that start with `<artifact>-` and whose suffix is hex-only. Rejects literal-dotted group dirs (modules-2 shape) by splitting group on `.` for the path join. Rejects bare-artifact dirs without a hash because Loom-remapped output always carries a per-project fingerprint.
- `src/project/source-jar-finder.ts` -- imports `resolveLoomRemappedJarPath`. Both `findSourcesJar` and `findCompiledJar` gain an optional `projectRoot: string | null = null` 5th parameter. When non-null, the loom-cache probe runs FIRST; on miss, falls through to the existing Maven-roots and modules-2 probes unchanged.
- `src/project/dependency-discovery.ts` -- threads `projectRootPath` through `addDependencyEntry`, `followTransitiveDeps`, and `formatUnresolvedSourcesWarn`. `findPom` intentionally NOT updated (Loom-emitted .pom files in remapped_mods are remapping byproducts, not authoritative for transitive resolution). Inline doc comments explain both decisions.
- `tests/project/loom-cache.test.ts` -- adds 8 tests under `describe('resolveLoomRemappedJarPath', ...)` covering: sources hit, compiled hit, group-as-path-vs-dotted-name shape, missing remapped_mods dir, missing group/artifact subtree, bare-artifact-dir rejection, multiple sibling hash dirs, verbatim CreatorCore/Claude shape.
- `tests/project/source-jar-finder.test.ts` -- adds 5 tests under `describe('findSourcesJar / findCompiledJar with projectRoot (loom-cache probe)', ...)` covering: loom-cache wins over Maven root, same for compiled jar, fall-through to Maven root when loom missing, all-miss returns null, projectRoot=null preserves prior behaviour. Plus 1 regression test in the default-modules-2 block (null projectRoot returns null).
- `tests/project/dependency-discovery.test.ts` -- adds 2 tests under `unresolved-sources warn log`: warn message lists loom-cache root as FIRST tried root; `findSourcesJar` / `findCompiledJar` are called with projectRoot as the 5th argument.
- `.planning/quick/260428-5ol-prefer-loom-cache-remapped-sources-for-m/deferred-items.md` -- records the fabric-api submodule discovery gap (out of scope for this task; tied to `fabricApi.module(...)` parsing in gradle-parser).

## Decisions Made

See `key-decisions` in frontmatter. Most-load-bearing:

1. **Loom-cache-first applies to compiled jar too.** Falling through to Maven roots for the compiled jar would mean the compiled jar is intermediary-mapped while the sources jar is yarn-mapped -- a silent symbol mismatch that would break JDT LS indexing.
2. **findPom is NOT loom-cache-probed.** Loom-emitted .pom files in remapped_mods are remapping byproducts. Transitive resolution must use upstream POMs from Maven roots / modules-2.
3. **resolveLoomRemappedJarPath lives in loom-cache.ts**, alongside the existing `probeProjectLocal` and `resolveSourcesJarPath`/`resolveCompiledJarPath` -- per the constraint that all loom-cache concerns stay in one module.

## Deviations from Plan

None. Plan executed exactly as written. Two TDD pairs (RED then GREEN), two integration commits implicit in the GREEN commits, repro.ts created and removed without ever being committed.

## Issues Encountered

- **Plan's "fabric-api submodule resolves to loom-cache" check was unreachable.** The Claude project uses `fabricApi.module("fabric-resource-loader-v0", fabric_api_version)`, which the gradle-parser does not recognize -- it only sets `fabricApiVersion` when a literal `fabric-api` coord appears in the dependencies block. As a result, fabric-api submodules are never enumerated for this project, regardless of the loom-cache fix. This pre-existing gap is independent of 5ol (was true before 260428-59m too) and is recorded in `deferred-items.md`. The loom-cache resolver IS exercised correctly for fabric-api submodules in the unit tests; it just isn't exercised in this specific project's e2e flow because no fabric-api submodules reach the resolver.

  The verifiable end-to-end target (`auxcommands` resolves to `loom-cache/remapped_mods/remapped/...`) DOES pass, and that was the explicit primary success criterion in the plan.

## User Setup Required

None.

## Next Phase Readiness

- For Fabric mod dependencies that DO reach the resolver (any literal `modImplementation("group:artifact:version")` coord, including `auxcommands`), sources and compiled jars now route through the project-local loom-cache. Symbol names match the IDE; JDT LS workspace sync indexes the right sources.
- Once the deferred fabric-api-discovery follow-up lands (read `fabric_api_version` from `gradle.properties` directly), all fabric-api submodules will automatically benefit from the same loom-cache-first probe (no further code change needed in the resolver -- it already runs first).
- The warn-log on miss now names the loom-cache root, so any future "this dep is silently absent" report points directly at the relevant resolution paths.

---

*Phase: quick-260428-5ol*
*Completed: 2026-04-28*

## Self-Check: PASSED

All claimed source/test files exist on disk; all 4 task commits resolve in `git log`; repro.ts was created during Task 2 verification and removed before final commit (never committed). Full test suite green at 750 tests, `tsc --noEmit` clean.
