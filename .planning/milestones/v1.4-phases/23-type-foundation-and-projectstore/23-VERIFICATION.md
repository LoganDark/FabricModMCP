---
phase: 23-type-foundation-and-projectstore
verified: 2026-04-15T10:10:00Z
status: passed
score: 19/19 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 18/19
  gaps_closed:
    - "All 592+ tests pass with zero regressions"
  gaps_remaining: []
  regressions: []
---

# Phase 23: Type Foundation and ProjectStore Verification Report

**Phase Goal:** Define new Project type hierarchy, build compat accessor layer, migrate all modules to new types
**Verified:** 2026-04-15T10:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (Plan 23-04, commit 0e87dff)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Project interface has only name, children Map, and optional jdtls | ✓ VERIFIED | `src/project/types.ts` lines 96-100: `name: string`, `children: Map<string, ProjectChild>`, `jdtls?: JdtLsSession` — no other fields |
| 2 | FabricModChild has kind 'fabric-mod' and owns mod-specific fields | ✓ VERIFIED | `src/project/types.ts` lines 73-82: kind, name, rootPath, gradleConfig, sourcesJar, fabricMod, dependencyJars, filterConfig all present |
| 3 | StudyJarChild has kind 'study-jar' and wraps StudyJar fields | ✓ VERIFIED | `src/project/types.ts` lines 84-92: kind, name, jarPath, mtime, size, autoInclude, stats all present |
| 4 | ProjectChild is a discriminated union of FabricModChild or StudyJarChild | ✓ VERIFIED | `src/project/types.ts` line 94: `export type ProjectChild = FabricModChild \| StudyJarChild` |
| 5 | LoadedProject is a type alias for Project | ✓ VERIFIED | `src/project/types.ts` line 102: `export type LoadedProject = Project` |
| 6 | Compat accessors resolve from sole fabric mod child, throw DomainError for zero or multiple | ✓ VERIFIED | `src/project/compat.ts` lines 4-31: getSoleFabricMod iterates children, throws NO_FABRIC_MOD and MULTIPLE_FABRIC_MODS correctly |
| 7 | getStudyJars returns Map of study-jar children from project.children | ✓ VERIFIED | `src/project/compat.ts` lines 57-65: iterates project.children filtering kind === 'study-jar' |
| 8 | Type guards correctly narrow ProjectChild by kind field | ✓ VERIFIED | `tests/project/types.test.ts`: 7 tests verify discriminated union narrowing at runtime |
| 9 | ProjectStore stores Project objects with default deletion protection | ✓ VERIFIED | `src/state/project-store.ts` lines 42-49: delete('default') throws CANNOT_DELETE_DEFAULT |
| 10 | loadFabricMod returns FabricModChild with name from fabricMod.id | ✓ VERIFIED | `src/project/loader.ts` lines 117-126: returns object with kind 'fabric-mod', name: fabricMod.id |
| 11 | Default project named 'default' exists at server startup | ✓ VERIFIED | `src/index.ts` lines 12-17: creates `{ name: 'default', children: new Map() }` and calls projectStore.set('default', ...) |
| 12 | --project CLI flag removed | ✓ VERIFIED | `src/cli/args.ts` has no `project` option in parseArgs; CliArgs interface only contains logLevel |
| 13 | dependency-resolver uses compat accessors | ✓ VERIFIED | `src/project/dependency-resolver.ts` lines 1-3: imports getDependencyJars and getStudyJars from compat.js; no direct field access |
| 14 | study-jar functions use project.children | ✓ VERIFIED | `src/project/study-jar.ts`: validateStudyJarId iterates project.children, createStudyJar checks project.children.has, autoUnloadConflictingStudyJars iterates project.children |
| 15 | tool-helpers.ts uses compat accessors for rootPath, filterConfig | ✓ VERIFIED | `src/tools/tool-helpers.ts` line 13: imports getRootPath, getFilterConfig from compat.js |
| 16 | load-project.ts uses loadFabricMod to create a FabricModChild and adds to project | ✓ VERIFIED | `src/tools/load-project.ts` lines 5,30,41-44: imports loadFabricMod, calls it, wraps in Project with children Map |
| 17 | Study jar tools use project.children instead of project.studyJars | ✓ VERIFIED | add-study-jar.ts:33, remove-study-jar.ts:31,44,49,54, configure-study-jar.ts:29,42 all use loadedProject.children |
| 18 | Test factory makeFakeProject returns new Project shape with children Map | ✓ VERIFIED | `tests/helpers/factories.ts` lines 50-57: returns `{ name: 'test', children: new Map([[mod.name, mod]]) }` |
| 19 | All 620 tests pass with zero regressions | ✓ VERIFIED | `npx vitest run` → 57 test files, 620/620 tests pass (0 failures) |

**Score:** 19/19 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/project/types.ts` | Project, FabricModChild, StudyJarChild, ProjectChild, LoadedProject alias | ✓ VERIFIED | All 5 types exported; LoadedProject is type alias; old LoadedProject interface replaced |
| `src/project/compat.ts` | 8 compat accessor functions | ✓ VERIFIED | getSoleFabricMod, getGradleConfig, getSourcesJar, getFabricMod, getDependencyJars, getFilterConfig, getRootPath, getStudyJars all exported |
| `tests/project/compat.test.ts` | Tests for compat accessors, min 50 lines | ✓ VERIFIED | 175 lines, 14 tests covering all error cases, delegation, and study jar filtering |
| `tests/project/types.test.ts` | Tests for type hierarchy correctness, min 30 lines | ✓ VERIFIED | 157 lines, 7 tests covering discriminated union narrowing, mixed children, and LoadedProject alias |
| `src/state/project-store.ts` | ProjectStore using Project type with CANNOT_DELETE_DEFAULT | ✓ VERIFIED | Line 2: `import type { Project }`, line 43-49: deletion protection |
| `src/project/loader.ts` | loadFabricMod returning FabricModChild | ✓ VERIFIED | Line 20: `export async function loadFabricMod`, line 119: name: fabricMod.id |
| `src/index.ts` | Default project creation at startup | ✓ VERIFIED | Lines 12-17: `projectStore.set('default', defaultProject)` |
| `src/cli/args.ts` | CLI args without --project flag | ✓ VERIFIED | No project option or projects field in interface |
| `src/project/dependency-resolver.ts` | Uses getDependencyJars via compat | ✓ VERIFIED | Line 2: imports from compat.js |
| `src/project/study-jar.ts` | Uses project.children for study jars | ✓ VERIFIED | 3 functions iterate project.children with kind discriminant |
| `src/tools/tool-helpers.ts` | Uses getRootPath, getFilterConfig | ✓ VERIFIED | Line 13: compat import present; used in resolveClassSource and filterDependenciesByJarPattern |
| `src/tools/load-project.ts` | Uses loadFabricMod | ✓ VERIFIED | Line 5: import, line 30: call |
| `tests/helpers/factories.ts` | makeFakeProject returns Project with children Map | ✓ VERIFIED | Lines 50-57: new Map([[mod.name, mod]]) |
| `tests/cli/args.test.ts` | 7 tests covering current CLI behavior (no --project references) | ✓ VERIFIED | 7 tests: default logLevel, --verbose, -v, --log-level, override priority, invalid fallback, unknown flag throws; zero `args.projects` references; commit 0e87dff |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/project/compat.ts` | `src/project/types.ts` | imports Project, FabricModChild, StudyJarChild | ✓ WIRED | Line 2: `import type { Project, FabricModChild, StudyJarChild } from './types.js'` |
| `src/project/compat.ts` | `src/errors/domain-error.ts` | throws DomainError | ✓ WIRED | Line 1: `import { DomainError }`, used on lines 12-28 |
| `src/state/project-store.ts` | `src/project/types.ts` | imports Project | ✓ WIRED | Line 2: `import type { Project } from '../project/types.js'` |
| `src/project/loader.ts` | `src/project/types.ts` | returns FabricModChild | ✓ WIRED | Line 9: `import type { FabricModChild }`, returned on line 117 |
| `src/index.ts` | `src/state/project-store.ts` | creates default project in store | ✓ WIRED | Line 16: `projectStore.set('default', defaultProject)` |
| `src/project/dependency-resolver.ts` | `src/project/compat.ts` | uses getDependencyJars, getStudyJars | ✓ WIRED | Line 2: import; lines 10, 11, 25, 27: usage |
| `src/tools/tool-helpers.ts` | `src/project/compat.ts` | imports getRootPath, getFilterConfig | ✓ WIRED | Line 13: import present; used in resolveClassSource and filterDependenciesByJarPattern |
| `src/tools/load-project.ts` | `src/project/loader.ts` | imports loadFabricMod | ✓ WIRED | Line 5: import; line 30: call with await |
| `tests/helpers/factories.ts` | `src/project/types.ts` | imports Project, FabricModChild | ✓ WIRED | Line 2: `import type { Project, FabricModChild, DependencyEntry }` |
| `tests/cli/args.test.ts` | `src/cli/args.ts` | imports parseCli | ✓ WIRED | Line 2: `import { parseCli } from '../../src/cli/args.js'` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CONT-01 | 23-01, 23-03 | Projects are pure named containers with only name, children, filter config, and JDT LS session | ✓ SATISFIED | Project interface has name, children, jdtls only; filterConfig moved to FabricModChild |
| CONT-02 | 23-01, 23-03 | Fabric mods are named children loaded from root directory, each owning Gradle config, sources jar, dependencies, fabric.mod.json | ✓ SATISFIED | FabricModChild owns all these fields; loadFabricMod constructs it with name from fabricMod.id |
| CONT-03 | 23-01, 23-03 | Study jars are named children at project level, not under any fabric mod | ✓ SATISFIED | StudyJarChild is a ProjectChild; study jar tools use project.children; getStudyJars filters by kind |
| CONT-05 | 23-02 | A default project named "default" is created at server startup | ✓ SATISFIED | src/index.ts creates and stores default project before server starts |
| CONT-06 | 23-01, 23-02 | Each child serves requests about its own contents — project delegates, not aggregates | ✓ SATISFIED | Compat layer delegates to FabricModChild fields; no aggregation on Project; 8 accessor functions all delegate through getSoleFabricMod |

Note: CONT-04 (multiple fabric mods simultaneously) is assigned to Phase 25, not Phase 23 — correctly out of scope.

### Anti-Patterns Found

None. The previously identified blocker (3 tests referencing the removed `--project` flag) was eliminated by Plan 23-04 (commit 0e87dff). The test file now uses tab indentation and contains only current CLI behavior tests.

### Human Verification Required

None. All behavioral correctness is verifiable from code and test runner output.

### Gap Closure Summary

The single gap from the initial verification has been closed:

**Gap:** `tests/cli/args.test.ts` contained 3 tests referencing `args.projects` and the `--project` flag, which was removed from `src/cli/args.ts` in Phase 23. This caused 3 test failures on every run.

**Fix (Plan 23-04, commit 0e87dff):** The entire test file was replaced with 7 new tests covering current `parseCli` behavior: default logLevel, `--verbose`, `-v`, `--log-level`, `--verbose` override priority, invalid log level fallback, and unknown flag rejection (which also confirms `--project` is truly removed). Zero references to `args.projects` remain.

**Result:** 620/620 tests pass. All 19 truths are verified. Phase goal is fully achieved.

---

_Verified: 2026-04-15T10:10:00Z_
_Verifier: Claude (gsd-verifier)_
