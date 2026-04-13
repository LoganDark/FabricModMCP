---
phase: 03-dependency-discovery
verified: 2026-04-13T07:45:00Z
re-verified: 2026-04-13T07:55:00Z
status: passed
score: 12/12 must-haves verified
gaps: []
---

# Phase 3: Dependency Discovery and Jar Registry — Verification Report

**Phase Goal:** Server discovers all dependency source jars for a loaded project and can read individual entries from any jar on demand without extracting to disk
**Verified:** 2026-04-13T07:45:00Z
**Re-verified:** 2026-04-13T07:55:00Z (PROJ-10 re-scoped out of Phase 3)
**Status:** passed

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Dependency discovery finds Minecraft libraries from mojang_minecraft_info.json | VERIFIED | `dependency-discovery.ts` L131-149: reads `mojang_minecraft_info.json`, parses `libraries[].name`, creates DependencyEntry with category="library"; test in `dependency-discovery.test.ts` |
| 2 | Dependency discovery finds Fabric API modules from Loom-cached POM | VERIFIED | `dependency-discovery.ts` L152-196: reads Loom POM at `~/.gradle/caches/fabric-loom/fabric-api/fabric-api-{version}.pom`, parses compile-scope deps as category="fabric-api" |
| 3 | Dependency discovery finds other declared dependencies via POM traversal in modules-2 cache | VERIFIED | `dependency-discovery.ts` L199-209: Strategy C iterates `config.dependencies`, calls `followTransitiveDeps` with depth limit 5 and cycle detection via visited Set |
| 4 | Minecraft sources jar gets the stable identifier "minecraft" | VERIFIED | `dependency-discovery.ts` L110-118: hardcoded `id: 'minecraft'`, `category: 'minecraft'`; PROJ-09 satisfied |
| 5 | Each discovered dependency has a category (minecraft, mod-source, fabric-api, library) | VERIFIED | `types.ts` L38: `export type JarCategory = 'minecraft' \| 'mod-source' \| 'fabric-api' \| 'library'`; all addDependencyEntry calls pass correct category |
| 6 | Dependencies without source jars appear in registry with available=false | VERIFIED | `dependency-discovery.ts` L57-66: `addDependencyEntry` calls `findSourcesJar`, sets `available: sourcesJarPath !== null`; test verifies this |
| 7 | Individual .java files can be read from any jar by path without extracting to disk | VERIFIED | `jar-reader.ts`: JarReader uses `node-stream-zip` with `entryData()` — no extraction; `read_jar_entry` tool reads from `sourcesJarPath` via JarReader |
| 8 | Include/exclude filtering uses glob patterns on jar identifiers | VERIFIED | `jar-registry.ts`: uses `picomatch` for glob matching; supports `net.fabricmc.fabric-api:*` and `**:gson` patterns |
| 9 | Default filter mode is include-all with empty exclude list | VERIFIED | `loader.ts` L125: `filterConfig: { mode: 'include-all', patterns: [] }` |
| 10 | minecraft and src identifiers are always included regardless of filter | VERIFIED | `jar-registry.ts` L6: `if (jarId === 'minecraft' \|\| jarId === 'src') return true` |
| 11 | User can configure include/exclude patterns via MCP tool | VERIFIED | `configure-filters.ts` exports `registerConfigureFiltersTool`; registers `configure_filters` tool with `mode` and `patterns` params; wired in `tools/index.ts` |
| 12 | User can refresh dependency discovery via MCP tool | VERIFIED | `refresh-dependencies.ts` exports `registerRefreshDependenciesTool`; calls `discoverDependencies` and updates `project.dependencyJars`; wired in `tools/index.ts` |

**Score:** 12/12 truths verified

**Note:** PROJ-10 (manual jar path override) was re-scoped out of Phase 3 per user decision. It was explicitly deferred during phase planning (see CONTEXT.md) and has been removed from ROADMAP.md and REQUIREMENTS.md Phase 3 scope.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/project/types.ts` | DependencyEntry, JarCategory, FilterConfig types | VERIFIED | All three types present; LoadedProject updated with `dependencyJars: Map<string, DependencyEntry>` and `filterConfig: FilterConfig` |
| `src/project/pom-parser.ts` | POM XML dependency extraction | VERIFIED | Exports `parsePomDependencies` and `PomDependency` interface; handles comments, dependencyManagement, scope defaulting |
| `src/project/source-jar-finder.ts` | Gradle cache source jar path resolution | VERIFIED | Exports `findSourcesJar`; traverses SHA1 subdirs; returns null when not found |
| `src/project/dependency-discovery.ts` | Three-pronged discovery orchestrator | VERIFIED | Exports `discoverDependencies` and `DiscoveryResult`; implements all three strategies; cycle detection; depth limit 5 |
| `src/project/loader.ts` | Updated loader calling dependency discovery | VERIFIED | Imports and calls `discoverDependencies`; sets `dependencyJars` and `filterConfig` on returned project |
| `src/project/jar-reader.ts` | On-demand jar entry reading via node-stream-zip | VERIFIED | Exports `JarReader`; lazy handle management; `readEntry`, `listEntries`, `close`, `closeAll` |
| `src/project/jar-registry.ts` | Jar registry with include/exclude filtering | VERIFIED | Exports `matchesFilter` and `getFilteredDependencies`; uses picomatch |
| `src/tools/configure-filters.ts` | MCP tool for include/exclude configuration | VERIFIED | Exports `registerConfigureFiltersTool`; Zod schema with mode/patterns |
| `src/tools/refresh-dependencies.ts` | MCP tool to re-run dependency discovery | VERIFIED | Exports `registerRefreshDependenciesTool`; calls `discoverDependencies` |
| `src/tools/read-jar-entry.ts` | MCP tool to read a file from a jar | VERIFIED | Exports `registerReadJarEntryTool`; uses module-level `JarReader` singleton; checks availability |
| `src/tools/index.ts` | All three tools registered | VERIFIED | Imports and calls all three `register*` functions |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/project/dependency-discovery.ts` | `src/project/pom-parser.ts` | `parsePomDependencies` import | WIRED | Line 5: `import { parsePomDependencies } from './pom-parser.js'`; called at L88, L179 |
| `src/project/dependency-discovery.ts` | `src/project/source-jar-finder.ts` | `findSourcesJar` import | WIRED | Line 6: `import { findSourcesJar } from './source-jar-finder.js'`; called at L57 |
| `src/project/loader.ts` | `src/project/dependency-discovery.ts` | `discoverDependencies` call in `loadProject` | WIRED | Line 8: import; Line 115: `await discoverDependencies(...)` |
| `src/project/jar-reader.ts` | `node-stream-zip` | `StreamZip.async` import | WIRED | Line 1: `import StreamZip from 'node-stream-zip'`; used at L46 |
| `src/project/jar-registry.ts` | `picomatch` | picomatch import for glob matching | WIRED | Line 1: `import picomatch from 'picomatch'`; called at L12 |
| `src/tools/index.ts` | `src/tools/configure-filters.ts` | `registerConfigureFiltersTool` call | WIRED | Line 2: import; Line 9: called in `registerAllTools` |
| `src/tools/index.ts` | `src/tools/refresh-dependencies.ts` | `registerRefreshDependenciesTool` call | WIRED | Line 3: import; Line 10: called |
| `src/tools/index.ts` | `src/tools/read-jar-entry.ts` | `registerReadJarEntryTool` call | WIRED | Line 4: import; Line 11: called |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| PROJ-07 | 03-01-PLAN.md | Server auto-discovers dependency source jars (Fabric API, libraries) from Gradle dependency resolution | SATISFIED | Three-pronged discovery in `dependency-discovery.ts` covers mojang_minecraft_info.json (MC libs), Fabric API POM, and declared deps with transitive traversal |
| PROJ-08 | 03-02-PLAN.md | User can include/exclude specific dependencies from the discovered set | SATISFIED | `configure_filters` tool with picomatch glob patterns, `matchesFilter` in jar-registry |
| PROJ-09 | 03-01-PLAN.md | Minecraft sources jar has a stable, predictable identifier ("minecraft") distinct from other dependency jars | SATISFIED | Hardcoded id="minecraft", category="minecraft" in Step 0 of `discoverDependencies` |
| BROW-05 | 03-02-PLAN.md | Source files are read directly from jars on demand — no extraction to disk, no file caching | SATISFIED | `JarReader.readEntry` uses `node-stream-zip` `entryData()` — in-memory buffer returned, nothing written to disk |

**Note:** PROJ-10 removed from Phase 3 scope — deferred to future phase per user decision.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/project/dependency-discovery.ts` | 138 | `JSON.parse(mojangContent as string)` — `as string` cast after `readFile` already returns `string` when encoding is specified | Info | Minor type redundancy, no functional impact |
| `src/project/dependency-discovery.ts` | 163 | `await readFile(loomPomPath, 'utf-8') as string` — same redundant cast | Info | Minor type redundancy, no functional impact |

No blocker or warning anti-patterns found.

### Human Verification Required

None. All behaviors can be verified programmatically. The loader test at `tests/project/loader.test.ts` runs against a real fixture and logs "54 dependencies found (52 with sources, 2 without)" demonstrating live discovery against actual Gradle cache.

### Test Suite Status

All 66 tests pass across 10 test files:
- `tests/project/pom-parser.test.ts` — 7 tests (POM parsing edge cases)
- `tests/project/dependency-discovery.test.ts` — 8 tests (strategies, cycles, depth limits, availability)
- `tests/project/jar-reader.test.ts` — 6 tests (handle lifecycle, entry reading, error cases)
- `tests/project/jar-registry.test.ts` — 10 tests (filter matching, glob patterns)
- `tests/project/loader.test.ts` — includes integration test finding 54 real deps

---

_Verified: 2026-04-13T07:45:00Z_
_Re-verified: 2026-04-13T07:55:00Z_
_Verifier: Claude (gsd-verifier)_
