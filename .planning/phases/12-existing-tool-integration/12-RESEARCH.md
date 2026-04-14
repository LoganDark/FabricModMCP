# Phase 12: Existing Tool Integration - Research

**Researched:** 2026-04-13
**Domain:** Internal refactoring — unified dependency resolution with study jar support
**Confidence:** HIGH

## Summary

Phase 12 is a pure internal refactoring phase. No new libraries, no new external dependencies, no new tool registrations. The work is: (1) create a resolver layer that merges `dependencyJars` with `studyJars`, (2) add `'study': 4` to `CATEGORY_PRIORITY`, and (3) update every tool that currently accesses `loadedProject.dependencyJars` directly to go through the resolver instead.

The codebase already has all the building blocks: `studyJarToDependencyEntry()` converts StudyJar to DependencyEntry, `filterDependenciesByJarPattern()` uses picomatch and will match `study:*` patterns out of the box, `sortByPriority()` will sort study jars last once the priority entry exists, and `CATEGORY_PRIORITY` just needs a `'study': 4` entry. The `matchesFilter()` function in jar-registry should NOT apply to study jars (they use autoInclude logic instead).

**Primary recommendation:** Create a `dependency-resolver.ts` module with `getResolvedDependencies(project)` and `getAllDependencies(project)` functions, then systematically replace all `loadedProject.dependencyJars` access points in tools with resolver calls.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- New shared resolver function(s) replace all direct `dependencyJars` access in tools
- Two-mode API: `getResolvedDependencies(project)` (default set: real deps + autoInclude=true study jars) and `getAllDependencies(project)` (everything including autoInclude=false study jars)
- Tools call `getResolvedDependencies` for default path, `getAllDependencies` when `jars` parameter is provided
- Returns a new `Map<string, DependencyEntry>` each call — no caching, no invalidation complexity
- Every tool that reads `dependencyJars` gets updated, not just the 3 with explicit `jars` parameters
- `autoInclude=true` study jars included in default set; `autoInclude=false` excluded from defaults
- `jars` parameter is a strict whitelist — `jars=['study:*']` returns ONLY study jars, not study jars plus defaults
- When a class exists in both real dependency and study jar, both appear in results, priority-sorted (real deps first)
- No deduplication, no warnings, no special indicators
- `read_source` resolves through standard priority chain, no special-case logic
- Staleness checks happen when a tool reads from a jar, not during dependency resolution
- Resolver just reads current `studyJars` state without filesystem I/O

### Claude's Discretion
- Exact function signatures and parameter names for the resolver
- Where the resolver lives (new file vs. existing `jar-registry.ts` vs. `tool-helpers.ts`)
- How to structure the tool updates (bulk refactor vs. incremental per-tool)
- Whether to add a shared utility for "resolve then filter by jars param" since that's a common two-step

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTG-01 | Study jars selectable via existing `jars` parameter on all jar-aware tools | Resolver provides `getAllDependencies()` which includes study jars; `filterDependenciesByJarPattern()` already matches `study:*` via picomatch |
| INTG-02 | Study jars with auto-include=true are included in the default jar set when `jars` is omitted | `getResolvedDependencies()` merges real deps + autoInclude=true study jars |
</phase_requirements>

## Architecture Patterns

### Recommended New Module

```
src/project/dependency-resolver.ts   # New file — resolver functions
```

**Rationale for new file:** `jar-registry.ts` handles filter logic (include/exclude patterns). `tool-helpers.ts` handles tool-level utilities (error formatting, class resolution, picomatch filtering). The resolver is a project-level concern (merging dependency maps with study jar maps) that logically belongs alongside `jar-registry.ts` in `src/project/`. Keeping it separate from jar-registry avoids bloating that module and keeps single-responsibility clean.

### Resolver Design

```typescript
// src/project/dependency-resolver.ts

import type { DependencyEntry, LoadedProject } from './types.js';
import { studyJarToDependencyEntry } from './study-jar.js';

/**
 * Default dependency set: real deps + autoInclude=true study jars.
 * Used when no `jars` parameter is provided.
 */
export function getResolvedDependencies(project: LoadedProject): Map<string, DependencyEntry> {
	const merged = new Map(project.dependencyJars);
	for (const studyJar of project.studyJars.values()) {
		if (studyJar.autoInclude) {
			const entry = studyJarToDependencyEntry(studyJar);
			merged.set(entry.id, entry);
		}
	}
	return merged;
}

/**
 * All dependencies including autoInclude=false study jars.
 * Used when `jars` parameter is provided (so glob can match any study jar).
 */
export function getAllDependencies(project: LoadedProject): Map<string, DependencyEntry> {
	const merged = new Map(project.dependencyJars);
	for (const studyJar of project.studyJars.values()) {
		const entry = studyJarToDependencyEntry(studyJar);
		merged.set(entry.id, entry);
	}
	return merged;
}
```

### CATEGORY_PRIORITY Update

The current `CATEGORY_PRIORITY` in `tool-helpers.ts` is missing `'study'`:

```typescript
// Current (missing study):
export const CATEGORY_PRIORITY: Record<JarCategory, number> = {
	'minecraft': 0,
	'mod-source': 1,
	'fabric-api': 2,
	'library': 3,
};

// Updated:
export const CATEGORY_PRIORITY: Record<JarCategory, number> = {
	'minecraft': 0,
	'mod-source': 1,
	'fabric-api': 2,
	'library': 3,
	'study': 4,
};
```

This is critical because `sortByPriority()` uses `?? 99` as fallback, which works but is imprecise. Adding the explicit entry is correct and type-safe (since `JarCategory` already includes `'study'`).

### Tool Update Pattern

Every tool follows the same transformation:

**Before (3 tools with `jars` param):**
```typescript
let filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
if (jars && jars.length > 0) {
	filtered = filterDependenciesByJarPattern(filtered, jars);
}
```

**After:**
```typescript
let deps: Map<string, DependencyEntry>;
if (jars && jars.length > 0) {
	deps = filterDependenciesByJarPattern(getAllDependencies(loadedProject), jars);
} else {
	deps = getFilteredDependencies(getResolvedDependencies(loadedProject), loadedProject.filterConfig);
}
```

**Before (tools without `jars` param that call getFilteredDependencies):**
```typescript
const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
```

**After:**
```typescript
const filtered = getFilteredDependencies(getResolvedDependencies(loadedProject), loadedProject.filterConfig);
```

**Before (tools that do direct `dependencyJars.get(jar)`):**
```typescript
const dep = loadedProject.dependencyJars.get(jar);
```

**After:**
```typescript
const dep = getAllDependencies(loadedProject).get(jar);
```

### Shared "resolve then filter" Utility (Recommended)

Since the "resolve, then optionally filter by jars param" is a 3-step pattern repeated in 3+ tools, a shared helper reduces boilerplate:

```typescript
/**
 * Get the effective dependency set for a tool invocation.
 * - If jars provided: strict whitelist from ALL deps (including autoInclude=false study jars)
 * - If jars omitted: default set (real deps + autoInclude=true study jars) with filter applied
 */
export function getDependenciesForTool(
	project: LoadedProject,
	jars?: string[],
): Map<string, DependencyEntry> {
	if (jars && jars.length > 0) {
		return filterDependenciesByJarPattern(getAllDependencies(project), jars);
	}
	return getFilteredDependencies(getResolvedDependencies(project), project.filterConfig);
}
```

This can live in `tool-helpers.ts` since it's a tool-layer concern that wraps the project-layer resolver.

### Complete Inventory of `dependencyJars` Access Points

Every location in the codebase that accesses `dependencyJars` and what needs to change:

| File | Line(s) | Current Usage | Action |
|------|---------|---------------|--------|
| `tool-helpers.ts:147` | `loadedProject.dependencyJars.get(jar)` in `resolveClassSource` specific-jar mode | Use `getAllDependencies(loadedProject).get(jar)` |
| `tool-helpers.ts:164` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` in `resolveClassSource` all-jars mode | Use `getResolvedDependencies(loadedProject)` |
| `tool-helpers.ts:288` | `loadedProject.dependencyJars.get(mapping.jar)` in `processNavigationLocations` | Use `getAllDependencies(loadedProject).get(mapping.jar)` |
| `resolve-symbol-position.ts:74` | `loadedProject.dependencyJars.get(jar)` specific-jar mode | Use `getAllDependencies(loadedProject).get(jar)` |
| `resolve-symbol-position.ts:117` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` all-jars mode | Use `getResolvedDependencies(loadedProject)` |
| `list-packages.ts:34` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` | Use `getDependenciesForTool(loadedProject, jars)` |
| `list-classes.ts:57` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` | Use `getDependenciesForTool(loadedProject, jars)` |
| `search-classes.ts:35` | `loadedProject.dependencyJars` passed to `searchClasses()` | Pass resolver output instead |
| `read-source.ts:37` | `loadedProject.dependencyJars.get(jar)!` specific-jar mode | Use `getAllDependencies(loadedProject).get(jar)` |
| `read-source.ts:63` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` all-jars mode | Use `getResolvedDependencies(loadedProject)` |
| `locate-in-source.ts:43` | `loadedProject.dependencyJars.get(jar)` specific-jar mode | Use `getAllDependencies(loadedProject).get(jar)` |
| `locate-in-source.ts:109` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` all-jars mode | Use `getResolvedDependencies(loadedProject)` |
| `read-jar-entry.ts:28,30` | `loadedProject.dependencyJars.get(jar)` and `.keys()` | Use `getAllDependencies(loadedProject)` |
| `configure-filters.ts:40,44,49` | `getFilteredDependencies(loadedProject.dependencyJars, ...)` and `.size` | Use `getResolvedDependencies(loadedProject)` for size reporting |
| `get-project-metadata.ts:55` | `project.dependencyJars` iterated for jar inventory | Use `getAllDependencies(project)` to include study jars in inventory |
| `list-projects.ts:24` | `p.dependencyJars.size` for count display | Use `getResolvedDependencies(p).size` |
| `refresh-dependencies.ts:38` | `loadedProject.dependencyJars = result.dependencies` | Keep as-is (writes to the raw field, not a read) |
| `load-project.ts:44,79,115,122` | Various `dependencyJars` access during initial load | Keep as-is (happens before study jars exist on project) |
| `study-jar.ts:35` | `project.dependencyJars.has(id)` collision check | Keep as-is (checks raw deps only, intentional) |

### Files That Should NOT Change

- `loader.ts` — Sets `dependencyJars` during project load, before study jars exist. Correct as-is.
- `refresh-dependencies.ts:38` — Writes the raw `dependencyJars` field. This is data mutation, not tool resolution.
- `study-jar.ts:35` — `validateStudyJarId()` checks if a study jar ID collides with a real dependency. Must check raw deps.
- `load-project.ts` — Initial project loading. Study jars don't exist yet at load time.

### `searchClasses()` Function Signature Change

The `searchClasses()` function in `src/browsing/search.ts` currently receives raw `dependencies` and `filterConfig` as separate parameters. The cleanest change is to have the caller (search-classes.ts tool) pass the already-resolved dependency map:

```typescript
// Before: searchClasses(options, loadedProject.dependencyJars, loadedProject.filterConfig, ...)
// After:  searchClasses(options, getDependenciesForTool(loadedProject, options.jars), ...)
```

This means `searchClasses()` no longer needs its own `getFilteredDependencies` + `filterDependenciesByJarPattern` calls internally -- the caller handles resolution. The function signature simplifies.

### Anti-Patterns to Avoid

- **Direct `dependencyJars` access in tools:** After this phase, no tool file should import or reference `loadedProject.dependencyJars` directly. All access goes through the resolver.
- **Caching merged maps:** The resolver returns a new Map each call. Do not cache the result on the project object -- study jars can be added/removed between tool calls.
- **Applying FilterConfig to study jars via matchesFilter:** Study jars use `autoInclude` logic, not the include/exclude filter patterns. `matchesFilter` should never see `study:*` IDs. The resolver handles this separation.
- **Study jar priority higher than library:** Study jars are `'study': 4`, lowest priority. Never sort them above real deps.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching for `study:*` patterns | Custom string matching | `filterDependenciesByJarPattern()` with picomatch | Already works for `study:*` patterns -- picomatch handles this |
| StudyJar to DependencyEntry conversion | Manual field mapping | `studyJarToDependencyEntry()` | Already exists, sets correct category/id/group/etc. |
| Priority sorting with study category | Custom sort logic | `sortByPriority()` with `CATEGORY_PRIORITY['study'] = 4` | One-line addition makes existing sort work |

## Common Pitfalls

### Pitfall 1: Forgetting the `jars` Whitelist Semantics
**What goes wrong:** Implementing `jars` parameter as "add these to defaults" instead of "use ONLY these."
**Why it happens:** The natural instinct is to add jars to the filtered set, but the decision is that `jars=['study:*']` returns ONLY study jars.
**How to avoid:** When `jars` is provided, call `filterDependenciesByJarPattern(getAllDependencies(project), jars)` -- no filter config applied, no default deps merged in.
**Warning signs:** Test with `jars=['study:*']` and verify no minecraft/library jars appear.

### Pitfall 2: Missing a `dependencyJars` Access Point
**What goes wrong:** One tool still accesses `dependencyJars` directly, so study jars are invisible through that tool.
**Why it happens:** Many tools access `dependencyJars` -- easy to miss one in a bulk refactor.
**How to avoid:** After refactoring, grep for `dependencyJars` in `src/tools/`. Only `refresh-dependencies.ts` (write) and `load-project.ts` (initial load) should remain.
**Warning signs:** `grep -r 'dependencyJars' src/tools/` returns hits outside the allowed exceptions.

### Pitfall 3: FilterConfig Applied to Study Jars
**What goes wrong:** A `configure_filters` exclude pattern like `study:*` hides study jars from the default set.
**Why it happens:** If `getResolvedDependencies` merges study jars BEFORE filterConfig is applied, the filter patterns could match study jar IDs.
**How to avoid:** This actually works correctly with the current design: `matchesFilter()` checks for `minecraft` and `src` as always-included, but `study:*` IDs go through normal filter logic. However, study jars with `autoInclude=true` are in the merged map so they WILL be subject to filterConfig. This is actually fine -- if a user explicitly filters out `study:*`, that's their choice. The key insight is that `matchesFilter` in jar-registry.ts does NOT need special-casing for study jars.

### Pitfall 4: processNavigationLocations Lookup Failure
**What goes wrong:** LSP navigation results reference a study jar ID, but `processNavigationLocations` can't find the dep because it looks up in raw `dependencyJars`.
**Why it happens:** `processNavigationLocations` does `loadedProject.dependencyJars.get(mapping.jar)` for category/provenance info.
**How to avoid:** Update to use `getAllDependencies(loadedProject).get(mapping.jar)`. Note: this is a display-only lookup for metadata, so using getAllDependencies is correct (we want to resolve the jar regardless of autoInclude status).

### Pitfall 5: searchClasses Dual-Filtering
**What goes wrong:** `searchClasses()` internally calls `getFilteredDependencies` + `filterDependenciesByJarPattern`, and the caller ALSO does filtering via the resolver, resulting in double-filtering or wrong behavior.
**Why it happens:** The function currently handles its own filtering, but after refactor the caller should handle resolution.
**How to avoid:** Either (a) change `searchClasses` to accept pre-resolved deps and skip internal filtering, or (b) pass the right inputs. Option (a) is cleaner.

## Code Examples

### Resolver Module (Complete)

```typescript
// src/project/dependency-resolver.ts
import type { DependencyEntry, LoadedProject } from './types.js';
import { studyJarToDependencyEntry } from './study-jar.js';

export function getResolvedDependencies(project: LoadedProject): Map<string, DependencyEntry> {
	const merged = new Map(project.dependencyJars);
	for (const studyJar of project.studyJars.values()) {
		if (studyJar.autoInclude) {
			const entry = studyJarToDependencyEntry(studyJar);
			merged.set(entry.id, entry);
		}
	}
	return merged;
}

export function getAllDependencies(project: LoadedProject): Map<string, DependencyEntry> {
	const merged = new Map(project.dependencyJars);
	for (const studyJar of project.studyJars.values()) {
		const entry = studyJarToDependencyEntry(studyJar);
		merged.set(entry.id, entry);
	}
	return merged;
}
```

### Tool-Level Helper (in tool-helpers.ts)

```typescript
import { getResolvedDependencies, getAllDependencies } from '../project/dependency-resolver.js';

export function getDependenciesForTool(
	project: LoadedProject,
	jars?: string[],
): Map<string, DependencyEntry> {
	if (jars && jars.length > 0) {
		return filterDependenciesByJarPattern(getAllDependencies(project), jars);
	}
	return getFilteredDependencies(getResolvedDependencies(project), project.filterConfig);
}
```

### Tool Update Example (list-packages.ts)

```typescript
// Before:
let filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
if (jars && jars.length > 0) {
	filtered = filterDependenciesByJarPattern(filtered, jars);
}

// After:
const filtered = getDependenciesForTool(loadedProject, jars);
```

### Verification Grep

```bash
# After all changes, this should only match allowed exceptions:
grep -rn 'dependencyJars' src/tools/
# Expected: refresh-dependencies.ts (write), load-project.ts (initial load)

# And in src/project/:
grep -rn 'dependencyJars' src/project/
# Expected: types.ts (definition), loader.ts (assignment), study-jar.ts (collision check)
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTG-01 | Study jars selectable via `jars` parameter with `study:*` globs | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "jars parameter"` | Wave 0 |
| INTG-01 | `filterDependenciesByJarPattern` matches `study:name` IDs | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "filterDependenciesByJarPattern"` | Wave 0 |
| INTG-02 | autoInclude=true study jars appear in getResolvedDependencies | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "getResolvedDependencies"` | Wave 0 |
| INTG-02 | autoInclude=false study jars excluded from getResolvedDependencies | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "getResolvedDependencies"` | Wave 0 |
| INTG-01+02 | getDependenciesForTool handles jars param vs default | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "getDependenciesForTool"` | Wave 0 |
| INTG-01 | CATEGORY_PRIORITY includes study at priority 4 | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "CATEGORY_PRIORITY"` | Wave 0 |
| INTG-02 | Study jars never shadow real deps (priority ordering) | unit | `npx vitest run tests/project/dependency-resolver.test.ts -t "priority"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/project/dependency-resolver.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project/dependency-resolver.test.ts` -- covers INTG-01, INTG-02 (resolver logic, tool helper, priority)
- No framework install needed (vitest already configured)
- Existing test files for tools (list-packages, search-classes, etc.) may need updates if function signatures change

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all files in `src/tools/` and `src/project/`
- `src/project/types.ts` -- `JarCategory` already includes `'study'`, `LoadedProject` already has `studyJars` field
- `src/project/study-jar.ts` -- `studyJarToDependencyEntry()` already exists and works
- `src/tools/tool-helpers.ts` -- `CATEGORY_PRIORITY`, `filterDependenciesByJarPattern`, `sortByPriority` all verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, pure internal refactoring
- Architecture: HIGH - all building blocks exist, design decisions are locked
- Pitfalls: HIGH - comprehensive grep of all access points, clear transformation pattern

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable internal refactoring, no external dependency drift)
