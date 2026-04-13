---
phase: 02-project-discovery
verified: 2026-04-12T22:40:30Z
status: passed
score: 13/13 must-haves verified
re_verification: false
human_verification:
  - test: "Run server without --project flag"
    expected: "Process exits with non-zero code and prints 'Missing required --project flag' message to stderr"
    why_human: "Requires spawning the actual server process and inspecting stderr output"
  - test: "Run server with --project pointing to a real Fabric mod with a generated sources jar"
    expected: "Server starts, logs project name/MC version/mapping era/sources jar path, then accepts MCP connections"
    why_human: "Requires a real Fabric project with a populated Loom cache to test the happy path end-to-end"
---

# Phase 2: Project Discovery Verification Report

**Phase Goal:** Project loading -- parse gradle.properties, resolve Fabric Loom cache paths, load fabric.mod.json metadata, and wire project context into the MCP server startup pipeline.
**Verified:** 2026-04-12T22:40:30Z
**Status:** passed
**Re-verification:** No -- initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | gradle.properties key=value pairs are parsed into a Map<string, string> | VERIFIED | `parseGradleProperties` in `src/project/gradle-parser.ts` splits on newlines, skips `#`/`!`/blank, splits on first `=`, returns `Map<string, string>`. 4 passing tests confirm this. |
| 2  | build.gradle.kts dependency declarations are extracted with variable substitution from gradle.properties | VERIFIED | `parseBuildGradle` substitutes `${var}` patterns via `properties.get()` before extracting `(\w+)\("([^"]+)"\)` dependency calls. Tests confirm yarn-era fixture yields all expected dependencies. |
| 3  | Yarn era is detected when a mappings() call is present in build.gradle.kts | VERIFIED | Era detection: `dependencies.some(d => d.configuration === 'mappings')`. Yarn-era fixture test asserts `mappingEra === 'yarn'`. |
| 4  | Unobfuscated era is detected when no mappings() call is present | VERIFIED | Same logic: absence of `mappings` configuration yields `'unobfuscated'`. Unobfuscated-era fixture test asserts `mappingEra === 'unobfuscated'` and `yarnMappings === undefined`. |
| 5  | Loom cache path is correctly constructed for yarn era: minecraft-merged with sanitized yarn version | VERIFIED | `resolveSourcesJarPath` constructs `minecraft-merged/{mcVer}-net.fabricmc.yarn.{mcVer_sanitized}.{yarnMappings}/...`. loom-cache test asserts exact path segment `minecraft-merged/1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/minecraft-merged-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4-sources.jar`. |
| 6  | Loom cache path is correctly constructed for unobfuscated era: minecraft-merged-deobf with MC version only | VERIFIED | `resolveSourcesJarPath` uses `minecraft-merged-deobf` and only `config.minecraftVersion`. loom-cache test asserts `minecraft-merged-deobf/26.2-snapshot-2/minecraft-merged-deobf-26.2-snapshot-2-sources.jar`. |
| 7  | fabric.mod.json is parsed and validated with Zod | VERIFIED | `parseFabricMod` in `src/project/fabric-mod.ts` JSON-parses then Zod-validates with `.passthrough()`. Tests confirm valid fixture parses, literal `${version}` string passes, malformed JSON throws `FABRIC_MOD_INVALID_JSON`, missing fields throw `FABRIC_MOD_VALIDATION`. |
| 8  | Server requires --project flag and errors with clear message if missing | VERIFIED | `src/index.ts` checks `if (!args.project)` and calls `logger.error('Missing required --project flag. Usage: minecraft-dev-mcp --project /path/to/mod')` then `process.exit(1)`. |
| 9  | --project . resolves to absolute path and uses directory basename as project name | VERIFIED | `src/cli/args.ts` applies `resolve(values.project)`. `src/project/loader.ts` applies `resolve(projectPath)` then `basename(absolutePath)`. |
| 10 | Project loader validates directory exists, parses gradle, resolves sources jar, parses fabric.mod.json | VERIFIED | `loadProject` in `src/project/loader.ts` orchestrates all four steps in sequence with distinct `DomainError` codes for each failure point. |
| 11 | Sources jar existence is verified on disk; missing jar produces DomainError with tried paths and genSources suggestion | VERIFIED | `fileExists()` helper checks via `fs.access`. Missing jar throws `DomainError('SOURCES_JAR_NOT_FOUND', ..., [sourcesJarPath], ['Run ./gradlew genSources ...', ...])`. loader.test.ts verifies `tried[0]` contains `fabric-loom` and `minecraft-merged`. |
| 12 | Loaded project is stored in Map<string, LoadedProject> keyed by name | VERIFIED | `ProjectStore` wraps `Map<string, LoadedProject>`. `src/index.ts` calls `projectStore.set(project.name, project)`. ProjectStore tests cover set/get/has/list/delete/size. |
| 13 | Server startup loads project before connecting transport | VERIFIED | In `src/index.ts`: `await loadProject(args.project)` and `projectStore.set(...)` both appear before `createServer()` and `server.connect(transport)`. |

**Score:** 13/13 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/project/types.ts` | MappingEra, DependencyCoordinate, GradleConfig, FabricModJson, ResolvedJar, LoadedProject types | VERIFIED | All 6 types exported. File is 45 lines of pure type declarations, no stubs. |
| `src/project/gradle-parser.ts` | parseGradleProperties, parseBuildGradle | VERIFIED | Both functions exported, substantive implementations (78 lines). Imports types from `./types.js` and `DomainError` from `../errors/domain-error.js`. |
| `src/project/loom-cache.ts` | resolveSourcesJarPath | VERIFIED | Exported function, 18 lines, handles both eras with correct path construction. Imports `GradleConfig` from `./types.js`. |
| `src/project/fabric-mod.ts` | parseFabricMod | VERIFIED | Exported function, 43 lines, Zod schema with `.passthrough()`, two distinct DomainError codes. |
| `src/project/loader.ts` | loadProject orchestrator | VERIFIED | Exported async function, 120 lines, orchestrates all four parsers, six distinct DomainError codes. |
| `src/state/project-store.ts` | ProjectStore class with get/set/has/list, projectStore singleton | VERIFIED | Class with all 6 methods, singleton export. 31 lines, no stubs. |
| `src/cli/args.ts` | Updated with path resolution for --project | VERIFIED | `resolve(values.project)` present at line 47. Interface keeps `project?: string` as planned. |
| `src/index.ts` | Startup pipeline: parseCli -> loadProject -> store -> createServer -> connect | VERIFIED | All five steps present in correct order (lines 9-47). |
| `tests/fixtures/yarn-era/` | Gradle and fabric.mod.json fixture files | VERIFIED | `gradle.properties`, `build.gradle.kts`, `src/main/resources/fabric.mod.json` all exist. |
| `tests/fixtures/unobfuscated-era/` | Gradle and fabric.mod.json fixture files (no mappings) | VERIFIED | Same structure exists, `build.gradle.kts` has no `mappings(` call, `gradle.properties` has no `yarn_mappings`. |

---

### Key Link Verification

**From 02-01-PLAN.md:**

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/project/gradle-parser.ts` | `src/project/types.ts` | imports GradleConfig, DependencyCoordinate, MappingEra | WIRED | Line 2: `import type { DependencyCoordinate, GradleConfig, MappingEra } from './types.js'` |
| `src/project/loom-cache.ts` | `src/project/types.ts` | imports GradleConfig | WIRED | Line 3: `import type { GradleConfig } from './types.js'` |
| `src/project/loom-cache.ts` | `src/project/gradle-parser.ts` | uses GradleConfig output to construct cache path | WIRED | Receives `GradleConfig` via parameter; `config.minecraftVersion` and `config.mappingEra` used in path construction |

**From 02-02-PLAN.md:**

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/project/loader.ts` | `src/project/gradle-parser.ts` | calls parseGradleProperties and parseBuildGradle | WIRED | Line 4: `import { parseGradleProperties, parseBuildGradle } from './gradle-parser.js'`; both called at lines 59 and 76 |
| `src/project/loader.ts` | `src/project/loom-cache.ts` | calls resolveSourcesJarPath | WIRED | Line 5: `import { resolveSourcesJarPath } from './loom-cache.js'`; called at line 79 |
| `src/project/loader.ts` | `src/project/fabric-mod.ts` | calls parseFabricMod | WIRED | Line 6: `import { parseFabricMod } from './fabric-mod.js'`; called at line 110 |
| `src/index.ts` | `src/project/loader.ts` | calls loadProject before transport connect | WIRED | Line 6: `import { loadProject } from './project/loader.js'`; `await loadProject(args.project)` at line 20 precedes `createServer()` at line 43 |
| `src/index.ts` | `src/state/project-store.ts` | stores loaded project in projectStore | WIRED | Line 7: `import { projectStore } from './state/project-store.js'`; `projectStore.set(project.name, project)` at line 21 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PROJ-01 | 02-02-PLAN.md | User can load a Fabric/Loom Gradle project by providing its root directory path | SATISFIED | `loadProject(projectPath)` accepts a path, resolves it, validates it is a Fabric/Loom project, and returns `LoadedProject`. `--project` flag wires this into server startup. |
| PROJ-06 | 02-01-PLAN.md | Server auto-discovers the Minecraft sources jar from gradle.properties (minecraft_version, yarn_mappings) and the Loom cache path structure | SATISFIED | `parseGradleProperties` extracts `minecraft_version` and `yarn_mappings`; `resolveSourcesJarPath` constructs the Loom cache path from those values and validates file existence. |
| PROJ-11 | 02-01-PLAN.md + 02-02-PLAN.md | Server correctly handles both Yarn-mapped jar era (MC <=1.21.11) and unobfuscated jar era (MC >=26.1) with different Loom cache path structures | SATISFIED | `MappingEra` type and era detection in `parseBuildGradle`; `resolveSourcesJarPath` branches on `config.mappingEra` to produce `minecraft-merged` (yarn) or `minecraft-merged-deobf` (unobfuscated) paths. Tests cover both eras. |

**Orphaned requirements check:** No requirements mapped to Phase 2 in REQUIREMENTS.md beyond PROJ-01, PROJ-06, and PROJ-11.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/tools/echo.ts` | Pre-existing TypeScript error: `ToolSuccess<T>` is missing index signature for `structuredContent` field | Info | `pnpm exec tsc --noEmit` exits non-zero, but this error is pre-existing (predates Phase 2, documented in both Phase 2 summaries as out-of-scope), and all 35 tests pass. No Phase 2 files are affected. |

No TODOs, FIXMEs, placeholder comments, empty implementations, or stub returns found in any Phase 2 source files.

---

### Test Results

```
Test Files  6 passed (6)
     Tests  35 passed (35)
  Duration  226ms
```

All 35 tests pass including:
- 4 `parseGradleProperties` tests
- 10 `parseBuildGradle` tests (both eras, error case)
- 3 `resolveSourcesJarPath` tests (yarn-era path, unobfuscated-era path, homedir prefix)
- 4 `parseFabricMod` tests (valid, template literal value, invalid JSON, missing fields)
- 4 `loadProject` tests (PROJECT_NOT_FOUND, GRADLE_PROPERTIES_NOT_FOUND, SOURCES_JAR_NOT_FOUND/happy path, environment-adaptive)
- 2 `ProjectStore` tests (set/get/has/list/delete/size, undefined for missing)
- Plus 8 tests from Phase 1 (server bootstrap)

---

### Human Verification Required

#### 1. Missing --project flag error behavior

**Test:** Start the server with `pnpm start` (no `--project` flag).
**Expected:** Process exits immediately with a non-zero exit code and prints `Missing required --project flag. Usage: minecraft-dev-mcp --project /path/to/mod` to stderr.
**Why human:** Requires spawning the actual server process and inspecting stderr, which cannot be safely done in this environment.

#### 2. End-to-end project load with real Loom cache

**Test:** Run `pnpm start --project /path/to/a/real/fabric/mod` on a machine that has run `./gradlew genSources`.
**Expected:** Server logs project name, Minecraft version, mapping era, and sources jar path to stderr, then connects the MCP transport successfully.
**Why human:** Requires a real Fabric project with a populated Loom cache (`~/.gradle/caches/fabric-loom/`). The test suite already covers the SOURCES_JAR_NOT_FOUND path; only the full happy path needs human confirmation.

---

### Gaps Summary

No gaps found. All 13 observable truths are verified, all 10 artifacts exist and are substantive and wired, all 8 key links are confirmed, and all 3 requirements are satisfied. The only issue (pre-existing tsc error in `src/tools/echo.ts`) is out of scope for Phase 2 and was documented in both summaries before this verification.

---

_Verified: 2026-04-12T22:40:30Z_
_Verifier: Claude (gsd-verifier)_
