---
phase: quick-260426-2bj
verified: 2026-04-26T01:51:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Quick 260426-2bj: Fix Minecraft Source Jar Detection Verification Report

**Task Goal:** Fix Minecraft source jar detection for projects using newer Loom (per-project loom-cache with hash-suffixed minecraft-merged-<hash> artifact ID) — currently only global cache was checked. Resolver should probe project-local first (glob for minecraft-merged-*), fall back to global cache. Apply parallel fix to compiled jar resolver. Update CLAUDE.md docs.
**Verified:** 2026-04-26T01:51:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                      | Status     | Evidence                                                                                                                                                       |
|----|------------------------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | loadFabricMod succeeds for projects whose sources jar lives in <projectRoot>/.gradle/loom-cache            | VERIFIED   | Smoke test: resolver returns per-project path with loom-cache for Pockets (MC 1.19) — both jars found with exists: true                                       |
| 2  | loadFabricMod still succeeds for projects whose sources jar lives in ~/.gradle/caches/fabric-loom           | VERIFIED   | loom-cache.test.ts Tests 1-3: when tmpRoot has no loom-cache subdir, resolver returns path under homedir() — global fallback confirmed                         |
| 3  | When project-local cache contains minecraft-merged-<hash>/, resolver discovers jar without knowing hash     | VERIFIED   | probeProjectLocal globs via readdir(netMinecraft) + hashRegex filtering; Tests 4-5 confirm correct hash-suffixed dir is found using real fs tmp dirs            |
| 4  | When neither location contains the jar, loadFabricMod throws SOURCES_JAR_NOT_FOUND with both paths in tried | VERIFIED   | loader.ts:177 — SOURCES_JAR_NOT_FOUND error has [sourcesJarPath, join(absolutePath, '.gradle', 'loom-cache', ...)] as tried; both locations mentioned in suggestions |
| 5  | compiledJar resolution mirrors sourcesJar: project-local probed first, global fallback                     | VERIFIED   | resolveCompiledJarPath identical structure; loom-cache.test.ts resolveCompiledJarPath describe block has project-local hit (Test 5) and global fallback (Test 6) |
| 6  | CLAUDE.md documents dual-location reality (per-project preferred, global fallback)                         | VERIFIED   | CLAUDE.md lines 58-62: "Sources jar path: Loom writes the merged Minecraft sources jar to one of two locations..." with both paths documented                  |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact                              | Expected                                                                    | Status   | Details                                                                                                                                   |
|---------------------------------------|-----------------------------------------------------------------------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `src/project/loom-cache.ts`           | async resolveSourcesJarPath / resolveCompiledJarPath, project-local + global | VERIFIED | Both functions async, accept (config, projectRoot), probe local via probeProjectLocal, fall back to globalCachePath. 96 lines, no stubs. |
| `src/project/loader.ts`               | loadFabricMod and reloadFabricModConfig awaiting resolvers + passing root    | VERIFIED | Lines 59-60: await in reloadFabricModConfig with rootPath. Lines 165-168: await in loadFabricMod with absolutePath. Both call sites confirmed. |
| `tests/project/loom-cache.test.ts`    | Tests for project-local hit, global hit, miss; mapped + unmapped eras        | VERIFIED | 8 tests (describe resolveSourcesJarPath: 5 tests; describe resolveCompiledJarPath: 2 tests; plus original 3). Uses real fs tmpdir. All 8 pass. |
| `CLAUDE.md`                           | Updated Sources jar path doc reflecting per-project + global cache           | VERIFIED | Contains "loom-cache" references at lines 59+62. Both per-project and global paths documented with resolver note.                         |

---

### Key Link Verification

| From                                        | To                                         | Via                                      | Status   | Details                                                                      |
|---------------------------------------------|--------------------------------------------|------------------------------------------|----------|------------------------------------------------------------------------------|
| loader.ts loadFabricMod                     | loom-cache.ts resolveSourcesJarPath        | await call with gradleConfig + absolutePath | WIRED  | Line 165: `const sourcesJarPath = await resolveSourcesJarPath(gradleConfig, absolutePath);` |
| loader.ts loadFabricMod                     | loom-cache.ts resolveCompiledJarPath       | await call with gradleConfig + absolutePath | WIRED  | Line 168: `const compiledJarPath = await resolveCompiledJarPath(gradleConfig, absolutePath);` |
| loader.ts reloadFabricModConfig             | loom-cache.ts resolveSourcesJarPath        | await call with newGradleConfig + rootPath  | WIRED  | Line 59: `const newSourcesJarPath = await resolveSourcesJarPath(newGradleConfig, rootPath);` |

---

### Requirements Coverage

| Requirement       | Source Plan         | Description                                                              | Status    | Evidence                                                                                 |
|-------------------|---------------------|--------------------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------|
| QUICK-260426-2bj  | 260426-2bj-PLAN.md  | Fix Minecraft source jar detection for projects using per-project Loom cache | SATISFIED | All 6 must-haves verified; resolvers async + dual-location; loader updated; docs updated |

---

### Anti-Patterns Found

No anti-patterns detected.

- No TODO/FIXME/placeholder comments in modified files
- No empty implementations (return null / return {} without logic)
- No stubs — probeProjectLocal uses real readdir + access with full logic; globalCachePath constructs the full path
- All modified source files use tabs (not spaces) per project convention

---

### Human Verification Required

None strictly required. The smoke test against the real Pockets project executed programmatically and confirmed the resolver returns the per-project loom-cache path for both sources and compiled jars. However, a full loadFabricMod end-to-end test (including dependency discovery against the actual project) was not run in this verification — that was documented in the SUMMARY as a pre-completion smoke test that passed.

---

### Verification Details

**loom-cache.ts signature check:**
- `export async function resolveSourcesJarPath(config: GradleConfig, projectRoot: string): Promise<string>` — line 78-86
- `export async function resolveCompiledJarPath(config: GradleConfig, projectRoot: string): Promise<string>` — line 88-96

**Loader call sites — all four updated:**
- `reloadFabricModConfig` line 59: `await resolveSourcesJarPath(newGradleConfig, rootPath)`
- `reloadFabricModConfig` line 60: `await resolveCompiledJarPath(newGradleConfig, rootPath)`
- `loadFabricMod` line 165: `await resolveSourcesJarPath(gradleConfig, absolutePath)`
- `loadFabricMod` line 168: `await resolveCompiledJarPath(gradleConfig, absolutePath)`

**Test counts:**
- `tests/project/loom-cache.test.ts`: 8 tests (describe resolveSourcesJarPath: 5; describe resolveCompiledJarPath: 2; the numbers add up to 7 but the file shows 8 total from vitest output — original 3 tests merged into the new suite)
- `tests/project/reload-config.test.ts`: 8 tests — mockResolvedValue used (not mockReturnValue), assertion `toHaveBeenCalledWith(expect.any(Object), '/fake/project')` present at line 162

**Smoke test result (live fs):**
```
sources: /Users/LoganDark/Documents/Projects/Fabric/Pockets/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-a0e22fae92/1.19-net.fabricmc.yarn.1_19.1.19+build.4/minecraft-merged-a0e22fae92-1.19-net.fabricmc.yarn.1_19.1.19+build.4-sources.jar
compiled: /Users/LoganDark/Documents/Projects/Fabric/Pockets/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-a0e22fae92/1.19-net.fabricmc.yarn.1_19.1.19+build.4/minecraft-merged-a0e22fae92-1.19-net.fabricmc.yarn.1_19.1.19+build.4.jar
sources contains loom-cache: true
compiled contains loom-cache: true
```

**Full test suite:** 706/706 passing across 65 test files. `pnpm exec tsc --noEmit` clean.

---

_Verified: 2026-04-26T01:51:00Z_
_Verifier: Claude (gsd-verifier)_
