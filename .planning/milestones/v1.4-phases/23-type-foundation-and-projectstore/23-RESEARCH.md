# Phase 23: Type Foundation and ProjectStore - Research

**Researched:** 2026-04-15
**Domain:** TypeScript type system refactoring, discriminated unions, compatibility layers
**Confidence:** HIGH

## Summary

Phase 23 restructures the project model from a monolithic `LoadedProject` interface into a `Project` container with typed children (`FabricModChild | StudyJarChild`). The codebase is well-understood -- all type definitions, access patterns, and test infrastructure have been audited directly from source. This is a pure TypeScript refactoring phase with no new dependencies.

The key challenge is maintaining backward compatibility across 592 tests and 15+ tool files that access `project.rootPath`, `project.gradleConfig`, `project.sourcesJar`, `project.fabricMod`, `project.dependencyJars`, `project.filterConfig`, and `project.studyJars` directly. A compat layer with accessor functions must bridge old access patterns to the new child-based structure.

**Primary recommendation:** Define new types first, build compat accessors, then update `ProjectStore` and `loadProject()` -- validating all 592 tests pass at each step.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Discriminated union: `ProjectChild = FabricModChild | StudyJarChild` with a `kind` discriminant field
- Shared fields on union base: `name` + `kind` only -- everything else is kind-specific
- `Project` holds `children: Map<string, ProjectChild>` (single map, not separate maps per kind)
- Plain interfaces + standalone functions (not classes) -- matches existing codebase style
- FabricModChild owns: `rootPath`, `gradleConfig`, `sourcesJar`, `fabricMod`, `dependencyJars`, `filterConfig`
- StudyJarChild shape: existing `StudyJar` fields + `kind: 'study-jar'` discriminant
- Project shape: `name`, `children` map, `jdtls` session (optional). No `rootPath`, no `filterConfig`
- `LoadedProject` becomes a type alias for `Project`
- Compat accessors in `src/project/compat.ts` resolve from sole fabric mod child, throw `DomainError` if zero or >1
- "default" project created at server startup unconditionally
- "default" cannot be deleted during compat phase
- Remove `--project` CLI flags entirely
- `load_project` MCP tool becomes sole way to add fabric mods

### Claude's Discretion
- Internal helper function signatures and naming
- Test factory implementation details
- Order of refactoring steps (which modules to update first)
- Error message wording for compat accessor failures

### Deferred Ideas (OUT OF SCOPE)
- CLI redesign for --project flags -- defer to future phase
- Multi-mod loading in a single command -- Phase 25
- Making "default" project deletable -- future multi-project management phase
- Study jar transitive dependency discovery (DISC-01/02) -- future milestone

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONT-01 | Projects are pure named containers with name, children, and JDT LS session | New `Project` interface with `children: Map<string, ProjectChild>` and optional `jdtls` field. No rootPath. |
| CONT-02 | Fabric mods are named children loaded from a root directory, owning Gradle config, sources jar, dependencies, and fabric.mod.json | `FabricModChild` interface with `kind: 'fabric-mod'` and all fields from current `LoadedProject` except `name`, `studyJars`, `jdtls` |
| CONT-03 | Study jars are named children at project level, not under any fabric mod | `StudyJarChild` interface with `kind: 'study-jar'` wrapping existing `StudyJar` fields; stored in `Project.children` alongside fabric mods |
| CONT-05 | Default project "default" created at server startup | Add to `src/index.ts`: create empty Project with name "default" and insert into projectStore before any loading |
| CONT-06 | Each child delegates its own content serving -- project does not aggregate | Compat layer bridges this temporarily by resolving from sole fabric mod child; full delegation comes in later phases |

</phase_requirements>

## Standard Stack

No new libraries needed. This phase is pure refactoring of existing TypeScript types.

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| TypeScript | 5.7+ | Type system for discriminated unions | Already in project |
| vitest | 3.x | Test runner (592 tests) | Already in project |
| zod | 4.x | Schema validation (no changes needed) | Already in project |

### Supporting
No new dependencies required.

## Architecture Patterns

### Current Type Structure (being replaced)
```
LoadedProject (monolithic)
  ├── name, rootPath
  ├── gradleConfig, sourcesJar, fabricMod
  ├── dependencyJars: Map<string, DependencyEntry>
  ├── filterConfig: FilterConfig
  ├── studyJars: Map<string, StudyJar>
  └── jdtls?: JdtLsSession
```

### New Type Structure
```
Project (pure container)
  ├── name: string
  ├── children: Map<string, ProjectChild>
  └── jdtls?: JdtLsSession

ProjectChild = FabricModChild | StudyJarChild

FabricModChild
  ├── kind: 'fabric-mod'
  ├── name: string
  ├── rootPath: string
  ├── gradleConfig: GradleConfig
  ├── sourcesJar: ResolvedJar
  ├── fabricMod: FabricModJson
  ├── dependencyJars: Map<string, DependencyEntry>
  └── filterConfig: FilterConfig

StudyJarChild
  ├── kind: 'study-jar'
  ├── name: string
  ├── jarPath: string
  ├── mtime: number
  ├── size: number
  ├── autoInclude: boolean
  └── stats: StudyJarStats
```

### Recommended File Structure
```
src/project/
  ├── types.ts          # New types (Project, FabricModChild, StudyJarChild, ProjectChild)
  │                     # LoadedProject becomes type alias for Project
  ├── compat.ts         # NEW: Compat accessor functions
  ├── loader.ts         # Updated: returns FabricModChild (or Project with child added)
  ├── study-jar.ts      # Updated: takes Project instead of LoadedProject
  ├── dependency-discovery.ts  # Unchanged (already works with GradleConfig)
  ├── dependency-resolver.ts   # Updated: resolves from children
  ├── jar-reader.ts     # Unchanged
  └── jar-registry.ts   # Unchanged
```

### Pattern 1: Discriminated Union with Type Guards
**What:** TypeScript discriminated union with `kind` field
**When to use:** Everywhere ProjectChild is handled
**Example:**
```typescript
// src/project/types.ts

export interface FabricModChild {
	kind: 'fabric-mod';
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, DependencyEntry>;
	filterConfig: FilterConfig;
}

export interface StudyJarChild {
	kind: 'study-jar';
	name: string;
	jarPath: string;
	mtime: number;
	size: number;
	autoInclude: boolean;
	stats: StudyJarStats;
}

export type ProjectChild = FabricModChild | StudyJarChild;

export interface Project {
	name: string;
	children: Map<string, ProjectChild>;
	jdtls?: JdtLsSession;
}

// Compat alias -- existing code can still use LoadedProject
export type LoadedProject = Project;
```

### Pattern 2: Compat Accessor Functions
**What:** Functions that extract old-style fields from new Project structure
**When to use:** All existing tool code that accesses project.gradleConfig etc.
**Example:**
```typescript
// src/project/compat.ts

import { DomainError } from '../errors/domain-error.js';
import type { Project, FabricModChild, StudyJarChild } from './types.js';

export function getSoleFabricMod(project: Project): FabricModChild {
	const mods: FabricModChild[] = [];
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') mods.push(child);
	}
	if (mods.length === 0) {
		throw new DomainError(
			'NO_FABRIC_MOD',
			`No fabric mod loaded in project '${project.name}'`,
			[project.name],
			['Load a fabric mod using the load_project tool'],
		);
	}
	if (mods.length > 1) {
		throw new DomainError(
			'MULTIPLE_FABRIC_MODS',
			`Multiple fabric mods in project '${project.name}' -- specify which one`,
			mods.map(m => m.name),
			['This operation requires exactly one fabric mod'],
		);
	}
	return mods[0];
}

export function getGradleConfig(project: Project) {
	return getSoleFabricMod(project).gradleConfig;
}

export function getSourcesJar(project: Project) {
	return getSoleFabricMod(project).sourcesJar;
}

export function getFabricMod(project: Project) {
	return getSoleFabricMod(project).fabricMod;
}

export function getDependencyJars(project: Project) {
	return getSoleFabricMod(project).dependencyJars;
}

export function getFilterConfig(project: Project) {
	return getSoleFabricMod(project).filterConfig;
}

export function getRootPath(project: Project) {
	return getSoleFabricMod(project).rootPath;
}

export function getStudyJars(project: Project): Map<string, StudyJarChild> {
	const result = new Map<string, StudyJarChild>();
	for (const [name, child] of project.children) {
		if (child.kind === 'study-jar') result.set(name, child);
	}
	return result;
}
```

### Pattern 3: Default Project Creation
**What:** Empty project created at startup
**Example:**
```typescript
// In src/index.ts, before tool registration:
const defaultProject: Project = {
	name: 'default',
	children: new Map(),
};
projectStore.set('default', defaultProject);
```

### Anti-Patterns to Avoid
- **Direct field access on Project:** Never access `project.gradleConfig` -- use compat accessor `getGradleConfig(project)`. The type alias makes this a compile-time issue if done correctly.
- **Separate maps for different child types:** Use single `children: Map<string, ProjectChild>` with `kind` discriminant, not `fabricMods: Map<...>` + `studyJars: Map<...>`.
- **Making compat layer elegant:** It's temporary scaffolding for Phase 27 deletion. Optimize for easy deletion, not beauty.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type discrimination | Manual `if (child.type === ...)` | TypeScript discriminated unions with `kind` | Compiler ensures exhaustive matching, narrowing is automatic |
| Iterating children by type | Separate maps per type | Helper functions like `getStudyJars()`, `getSoleFabricMod()` | Single source of truth in `children` map |

## Common Pitfalls

### Pitfall 1: Type Alias Does Not Enforce Compile-Time Safety
**What goes wrong:** `LoadedProject = Project` makes them interchangeable at compile time, but code still doing `project.rootPath` will type-check if `rootPath` is still on the type.
**Why it happens:** The alias is there for import compatibility, not field-level enforcement.
**How to avoid:** Remove `rootPath`, `gradleConfig`, `sourcesJar`, `fabricMod`, `dependencyJars`, `filterConfig`, `studyJars` from the `Project` interface entirely. The compiler will flag every access site that needs updating to use compat accessors.
**Warning signs:** Tests passing without any code changes -- means the type migration is incomplete.

### Pitfall 2: Study Jar Collision Detection Breaks
**What goes wrong:** `validateStudyJarId()` currently checks `project.dependencyJars.has(name)`. After refactoring, dependency jars are on the fabric mod child, and study jars are children of the project.
**Why it happens:** Collision detection needs to check across child boundaries -- a study jar name cannot match a dependency ID in any fabric mod child.
**How to avoid:** Update collision detection to iterate fabric mod children and check each one's `dependencyJars`.
**Warning signs:** Study jar tests failing with "cannot read property of undefined".

### Pitfall 3: Compat Accessors Must Handle No-Mod State
**What goes wrong:** The "default" project starts empty (no children). Compat accessors that call `getSoleFabricMod()` will throw `NO_FABRIC_MOD` on an empty project.
**Why it happens:** Previously, `NO_PROJECTS_LOADED` was the error for this case; now a project exists but has no mod children.
**How to avoid:** Existing tools already check for project existence via `resolveProjectSafely()`. The new error (`NO_FABRIC_MOD`) replaces `NO_PROJECTS_LOADED` semantically. Ensure error messages are clear.
**Warning signs:** Tools giving confusing errors when no mod is loaded but a project exists.

### Pitfall 4: loadProject Return Type Change
**What goes wrong:** `loadProject()` currently returns `LoadedProject` (which becomes `Project`). But it really creates a fabric mod child, not a project.
**Why it happens:** The function's responsibility shifts -- it should create a `FabricModChild` that gets added to a `Project`.
**How to avoid:** Split `loadProject()` into: (1) `loadFabricMod()` that returns `FabricModChild`, and (2) tool-level code in `load_project.ts` that adds the child to the target project. This matches CONT-02 exactly.
**Warning signs:** Circular logic where loadProject creates a Project that then gets nested inside another Project.

### Pitfall 5: rootPath Usage Throughout Codebase
**What goes wrong:** 16+ call sites pass `loadedProject.rootPath` to `createSourceAdapter()` and other functions. All need updating.
**Why it happens:** `rootPath` moves from Project to FabricModChild. Every call site must resolve through the compat layer.
**How to avoid:** Use `getRootPath(project)` from compat.ts at every call site. The compiler will catch these if the type change is clean.
**Warning signs:** Grep for `project.rootPath` or `loadedProject.rootPath` -- should return zero hits after migration.

### Pitfall 6: ProjectStore.set() and resolveProject() Return Types
**What goes wrong:** `ProjectStore` stores `Map<string, LoadedProject>` which becomes `Map<string, Project>`. The `set()` method needs to accept `Project` objects (which may have no children).
**Why it happens:** Previously, `set()` only accepted fully-loaded projects. Now it must accept empty projects too (for "default").
**How to avoid:** Remove the `LoadedProject` import in project-store.ts, use `Project` directly. The `set()` method signature stays the same.
**Warning signs:** Type errors when creating the empty "default" project.

## Code Examples

### Complete Type Definitions
```typescript
// Source: Derived from current src/project/types.ts

export interface FabricModChild {
	kind: 'fabric-mod';
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, DependencyEntry>;
	filterConfig: FilterConfig;
}

export interface StudyJarChild {
	kind: 'study-jar';
	name: string;
	jarPath: string;
	mtime: number;
	size: number;
	autoInclude: boolean;
	stats: StudyJarStats;
}

export type ProjectChild = FabricModChild | StudyJarChild;

export interface Project {
	name: string;
	children: Map<string, ProjectChild>;
	jdtls?: JdtLsSession;
}

export type LoadedProject = Project;
```

### ProjectStore Updates
```typescript
// Source: Current src/state/project-store.ts needs these changes:
// 1. Import Project instead of LoadedProject
// 2. Map stores Project objects
// 3. resolveProject() returns Project
// 4. "default" project protection in delete()

delete(name: string): boolean {
	if (name === 'default') {
		throw new DomainError(
			'CANNOT_DELETE_DEFAULT',
			"Cannot delete the 'default' project during compatibility mode",
			['default'],
			['The default project is required during the v1.4 migration'],
		);
	}
	// ... rest unchanged
}
```

### loadProject -> loadFabricMod Transformation
```typescript
// Source: Current src/project/loader.ts refactored

export async function loadFabricMod(projectPath: string): Promise<FabricModChild> {
	// ... same validation and parsing logic ...
	return {
		kind: 'fabric-mod',
		name: fabricMod.id,  // default name from fabric.mod.json
		rootPath: absolutePath,
		gradleConfig,
		sourcesJar: { path: sourcesJarPath, exists: true },
		fabricMod,
		dependencyJars: discovery.dependencies,
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}
```

### Tool Migration Example (getDependenciesForTool)
```typescript
// Source: Current src/tools/tool-helpers.ts line 329-337
// Before:
export function getDependenciesForTool(project: LoadedProject, jars?: string[]) {
	// accesses project.filterConfig directly
	return getFilteredDependencies(getResolvedDependencies(project), project.filterConfig);
}

// After:
import { getFilterConfig, getDependencyJars } from '../project/compat.js';
export function getDependenciesForTool(project: Project, jars?: string[]) {
	if (jars && jars.length > 0) {
		return filterDependenciesByJarPattern(getAllDependencies(project), jars);
	}
	return getFilteredDependencies(getResolvedDependencies(project), getFilterConfig(project));
}
```

## Integration Surface Audit

Files that directly access `LoadedProject` fields (must be updated with compat accessors):

| File | Fields Accessed | Update Strategy |
|------|----------------|-----------------|
| `src/tools/tool-helpers.ts` | `filterConfig`, `rootPath` | Use `getFilterConfig()`, `getRootPath()` |
| `src/tools/load-project.ts` | `dependencyJars`, `sourcesJar`, `rootPath`, `gradleConfig`, `jdtls` | Refactor to create FabricModChild + add to project |
| `src/tools/get-project-metadata.ts` | `gradleConfig`, `fabricMod` | Use `getGradleConfig()`, `getFabricMod()` |
| `src/tools/refresh-dependencies.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/list-members.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/list-classes.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/list-packages.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/read-member.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/read-source.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/locate-in-source.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/resolve-symbol-position.ts` | `rootPath` | Use `getRootPath()` |
| `src/tools/search-classes.ts` | `rootPath` | Use `getRootPath()` |
| `src/project/dependency-resolver.ts` | `dependencyJars`, `studyJars` | Update to work with children |
| `src/project/study-jar.ts` | `studyJars`, `dependencyJars` | Update to work with Project.children |
| `src/index.ts` | CLI project loading, project creation | Refactor startup, add default project |
| `src/cli/args.ts` | `--project` flag | Remove flag |

### Test Files Needing Updates
| File | What Changes |
|------|-------------|
| `tests/state/project-store.test.ts` | `makeMockProject()` must return `Project` with a fabric mod child |
| `tests/project/study-jar.test.ts` | `makeProject()` must return `Project` |
| All tool test files | Mock projects must use new structure |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONT-01 | Project is pure container with name + children + jdtls | unit | `npx vitest run tests/state/project-store.test.ts -x` | Needs updating |
| CONT-02 | FabricModChild owns rootPath, gradleConfig, sourcesJar, fabricMod, dependencyJars, filterConfig | unit | `npx vitest run tests/project/types.test.ts -x` | Wave 0 |
| CONT-03 | StudyJars at project level, not under fabric mod | unit | `npx vitest run tests/project/study-jar.test.ts -x` | Needs updating |
| CONT-05 | Default project "default" created at startup | unit | `npx vitest run tests/state/project-store.test.ts -x` | Wave 0 |
| CONT-06 | Children serve own content, project delegates | unit | `npx vitest run tests/project/compat.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green (592+ tests) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project/compat.test.ts` -- covers CONT-06 (compat accessor functions, sole-mod resolution, error cases)
- [ ] `tests/project/types.test.ts` -- covers CONT-02 (type guard tests, discriminated union correctness)
- [ ] Update `tests/state/project-store.test.ts` -- covers CONT-01, CONT-05 (default project creation, new Project shape)
- [ ] Update `tests/project/study-jar.test.ts` -- covers CONT-03 (study jars as project-level children)
- [ ] Update all tool test `makeMockProject()` helpers to return new `Project` shape

## Open Questions

1. **dependency-resolver.ts behavior with new types**
   - What we know: `getResolvedDependencies()` and `getAllDependencies()` currently take `LoadedProject` and access `project.dependencyJars` and `project.studyJars` directly
   - What's unclear: Should these resolve from the compat layer (sole fabric mod), or should they be updated to iterate all children?
   - Recommendation: Use compat accessors for now (sole fabric mod + study jar children). Multi-mod aggregation comes in Phase 25.

2. **Study jar collision detection scope**
   - What we know: `validateStudyJarId()` checks `project.dependencyJars.has(name)` for collisions
   - What's unclear: With study jars as project-level children and deps on fabric mod children, should collision check cross all fabric mods?
   - Recommendation: Check all fabric mod children' `dependencyJars` maps. A study jar ID colliding with any fabric mod's dep ID is still invalid.

## Sources

### Primary (HIGH confidence)
- `src/project/types.ts` -- Current LoadedProject interface (84 lines)
- `src/state/project-store.ts` -- Current ProjectStore class (122 lines)
- `src/project/loader.ts` -- loadProject function (128 lines)
- `src/project/dependency-discovery.ts` -- Dependency resolution (247 lines)
- `src/project/dependency-resolver.ts` -- Merge deps + study jars (30 lines)
- `src/project/study-jar.ts` -- Study jar management (186 lines)
- `src/tools/tool-helpers.ts` -- All tool helper functions (448 lines)
- `src/tools/load-project.ts` -- Load project tool (137 lines)
- `src/tools/get-project-metadata.ts` -- Metadata tool (144 lines)
- `src/index.ts` -- Server entry point (59 lines)
- `src/cli/args.ts` -- CLI arg parsing (51 lines)
- `src/browsing/source-adapter.ts` -- Source adapter factory (77 lines)
- `src/project/jar-reader.ts` -- Jar handle management (122 lines)
- `src/project/jar-registry.ts` -- Filter application (31 lines)
- `tests/state/project-store.test.ts` -- ProjectStore tests (164 lines)
- All tool files via grep for `project.rootPath` usage (16+ call sites)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure refactoring
- Architecture: HIGH -- type hierarchy defined by user decisions, codebase fully audited
- Pitfalls: HIGH -- identified from direct code inspection of all integration surfaces

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- pure internal refactoring, no external dependency changes)
