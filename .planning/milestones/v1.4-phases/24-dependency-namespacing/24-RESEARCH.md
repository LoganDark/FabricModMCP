# Phase 24: Dependency Namespacing - Research

**Researched:** 2026-04-15
**Domain:** Internal refactoring -- dependency ID namespacing, scope parameter, jar resolution
**Confidence:** HIGH

## Summary

Phase 24 transforms the flat dependency ID space (where all jars share a single namespace) into a per-child namespaced system. Fabric mod dependencies get prefixed with the mod name (e.g., `my-mod/minecraft`), mod source uses the mod name directly as its jar ID (e.g., `my-mod` instead of `src`), and study jars remain bare at the project level. All tools gain an optional `scope` parameter for child-specific operation.

This is a pure internal refactoring phase -- no new external libraries are needed. The changes touch the dependency resolution layer (`dependency-discovery.ts`, `dependency-resolver.ts`, `jar-registry.ts`), the source adapter (`source-adapter.ts`), and every tool's parameter schema. The `"src"` magic string is removed entirely, and `matchesFilter` in `jar-registry.ts` must stop hardcoding `"minecraft"` and `"src"` in favor of per-child auto-include logic.

**Primary recommendation:** Implement in layers: (1) change how dependency IDs are generated/stored in the `FabricModChild`, (2) build namespace resolution logic with scope/defaultChild/bare-ID disambiguation, (3) add `scope` parameter to all tools, (4) update filter registry for per-child auto-include.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Separator is `/` -- e.g., `my-mod/minecraft`, `my-mod/net.fabricmc:fabric-api`
- Study jars stay bare (project-level, no namespace prefix)
- A fabric mod's own source uses just the mod name as its jar ID -- e.g., `"my-mod"` (not `my-mod/my-mod`)
- Namespaced IDs are the primary display format in all tool results
- `"src"` magic string is removed entirely -- no backward compat alias
- Bare IDs (e.g., `"minecraft"`) resolve only when unambiguous: exactly one child, or a default child is set
- Bare IDs error when ambiguous (multiple children, no default child set)
- Glob patterns in `jars` must be explicit -- `"minecraft"` does NOT auto-expand to `"*/minecraft"`
- `Project` gets an optional `defaultChild?: string` field
- Default child is set explicitly by the user, never auto-inferred
- When default child is set, bare IDs resolve within that child's namespace
- When only one child exists, bare IDs resolve to that child regardless of defaultChild setting
- All tools get an optional `scope` parameter to target a single child
- `scope` sets context: bare IDs in `jars` resolve within the scoped child's namespace
- Namespaced IDs in `jars` always override scope (explicit wins)
- Scope is always optional -- omit for project-wide operation
- Tools like `get-project-metadata` and `unload-project` become dual-purpose based on scope
- Always-include rule applies per-child automatically: each child's own source + its minecraft dep
- Each child has its own filterConfig -- filters apply only to that child's own dependencies
- No filter merging across children
- Each child has an auto-include flag controlling whether it appears in default results
- Explicit `jars` parameter bypasses filters entirely (existing behavior preserved)

### Claude's Discretion
- Internal implementation of namespace resolution logic
- Error message wording for ambiguous bare ID resolution
- How to implement the default child setter (tool parameter, separate tool, etc.)
- Order of migration steps

### Deferred Ideas (OUT OF SCOPE)
- `refresh_dependencies` targeting a specific child (DEP-04) -- Phase 25
- Multiple fabric mods per project (CONT-04) -- Phase 25
- All existing tools working with namespaced IDs end-to-end (TOOL-01/02/03) -- Phase 25
- Cross-mod JDT LS navigation (LSP-01/02) -- Phase 26
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEP-01 | Fabric mod dependencies are namespaced by mod name within the project (e.g., `my-mod/minecraft`) | Dependency IDs generated in `dependency-discovery.ts` lines 121-140 must prefix with mod name. `DependencyEntry.id` field carries the namespaced ID. Resolution logic in `dependency-resolver.ts` aggregates per-child. |
| DEP-02 | A fabric mod's own source is accessible via its mod name as a jar ID (e.g., `my-mod`) | Currently `"src"` entry at `dependency-discovery.ts:132`. Must change to use `fabricMod.id` (from `fabric.mod.json`). `source-adapter.ts:63` checks `dep.id === 'src'` -- must change to check `dep.category === 'mod-source'`. |
| DEP-03 | Tools can operate across the whole project or be scoped to a single child via jar patterns | `getDependenciesForTool()` in `tool-helpers.ts:330` is the funnel point. Add `scope` parameter, resolve namespaced/bare IDs through new resolution layer. All tool schemas need `scope` added via `PARAMS`. |
</phase_requirements>

## Architecture Patterns

### Current Architecture (Being Changed)

```
Project
  children: Map<string, ProjectChild>
    "testmod" -> FabricModChild { dependencyJars: Map<"minecraft"|"src"|"group:artifact", ...> }
    "my-lib"  -> StudyJarChild { ... }
```

Dependencies flow: `dependency-discovery.ts` creates flat IDs -> `FabricModChild.dependencyJars` stores them -> `compat.ts:getDependencyJars()` extracts them -> `dependency-resolver.ts` merges with study jars -> `tool-helpers.ts:getDependenciesForTool()` applies filters/patterns -> tools consume.

### Target Architecture

```
Project
  defaultChild?: string
  children: Map<string, ProjectChild>
    "testmod" -> FabricModChild { dependencyJars: Map<"testmod/minecraft"|"testmod"|"testmod/group:artifact", ...> }
    "my-lib"  -> StudyJarChild { ... }
```

Dependencies flow changes:
1. `dependency-discovery.ts` generates namespaced IDs at creation time (e.g., `"testmod/minecraft"`, `"testmod"` for mod source)
2. `FabricModChild.dependencyJars` stores namespaced IDs as keys
3. `dependency-resolver.ts` iterates all children, collecting their dependencies into a unified map (namespaced IDs prevent collisions)
4. Study jars contribute bare IDs (unchanged)
5. New resolution layer handles: bare ID -> namespaced lookup, scope parameter, defaultChild
6. `getDependenciesForTool()` gains `scope` parameter, delegates to resolution layer
7. `jar-registry.ts:matchesFilter()` uses per-child auto-include instead of hardcoded `"minecraft"`/`"src"`

### Pattern 1: Namespace Resolution

**What:** A function that resolves bare or namespaced jar IDs within a project context, considering scope and defaultChild.

**When to use:** Every time a tool receives a `jars` or `jar` parameter from the user.

**Logic:**
```typescript
function resolveJarId(project: Project, jarId: string, scope?: string): string {
	// 1. Already namespaced (contains '/') -- return as-is
	if (jarId.includes('/')) return jarId;

	// 2. Matches a study jar name -- return as-is (bare)
	if (project.children.get(jarId)?.kind === 'study-jar') return jarId;

	// 3. Matches a fabric mod name (the mod's own source) -- return as-is (bare = mod source)
	if (project.children.get(jarId)?.kind === 'fabric-mod') return jarId;

	// 4. Bare dependency ID -- needs namespace prefix
	const targetChild = scope ?? project.defaultChild ?? inferSoleChild(project);
	if (!targetChild) {
		throw new DomainError('AMBIGUOUS_JAR_ID', ...);
	}
	return `${targetChild}/${jarId}`;
}
```

### Pattern 2: Scope-Aware Dependency Collection

**What:** Collecting dependencies respecting scope -- either all children or a single child.

**When to use:** In `getDependenciesForTool()` when assembling the dependency map.

```typescript
function getDependenciesForTool(
	project: Project,
	jars?: string[],
	scope?: string,
): Map<string, DependencyEntry> {
	if (scope) {
		// Scoped: only this child's deps (+ study jars if autoInclude)
		const child = project.children.get(scope);
		// ... collect child's deps only
	} else {
		// Unscoped: all children's deps merged (namespaced IDs prevent collisions)
	}
	// Then apply jars filter if present
}
```

### Pattern 3: Category-Based Source Adapter Selection

**What:** Use `dep.category === 'mod-source'` instead of `dep.id === 'src'` to decide filesystem adapter.

**Why:** The mod source ID is now the mod name (e.g., `"testmod"`), not a magic string. Category is stable.

```typescript
// source-adapter.ts -- CHANGE THIS:
if (dep.id === 'src') { ... }
// TO THIS:
if (dep.category === 'mod-source') { ... }
```

### Anti-Patterns to Avoid
- **Hardcoding jar IDs for special behavior:** The `"src"` and `"minecraft"` checks scattered through the codebase are exactly what this phase eliminates. Use `category` field for type-based dispatch, not string matching on IDs.
- **Merging dependencies into a flat map before namespacing:** Dependencies must be namespaced at the point of creation (in `discoverDependencies`), not retroactively. The `FabricModChild.dependencyJars` map should already contain namespaced keys.
- **Auto-inferring defaultChild:** User decision explicitly forbids this. Default child must be set by user action only.

## Key Implementation Details

### Where `"src"` Is Referenced (Must Change)
1. **`dependency-discovery.ts:132`** -- `deps.set('src', {...})` -- change ID to mod name
2. **`dependency-discovery.ts:231`** -- `id === 'src'` in summary calculation -- change to check category
3. **`jar-registry.ts:6`** -- `jarId === 'src'` in always-include check -- remove, use per-child logic
4. **`source-adapter.ts:63`** -- `dep.id === 'src'` -- change to `dep.category === 'mod-source'`
5. **`descriptions.ts:32`** -- Server instructions mention `"src"` -- update documentation

### Where `"minecraft"` Is Hardcoded (Must Change for Per-Child Auto-Include)
1. **`jar-registry.ts:6`** -- `jarId === 'minecraft'` always-include check -- remove, use per-child logic
2. **`descriptions.ts:32`** -- Server instructions mention `"minecraft"` as special ID

### `discoverDependencies` Signature Change

Currently: `discoverDependencies(config, sourcesJarPath, projectRootPath)`
Needs: mod name to generate namespaced IDs.
New: `discoverDependencies(config, sourcesJarPath, projectRootPath, modName: string)`

The `"minecraft"` entry becomes `"${modName}/minecraft"` (ID: `"testmod/minecraft"`).
The `"src"` entry becomes `modName` (ID: `"testmod"`, category: `mod-source`).
All other deps become `"${modName}/${group}:${artifact}"`.

### `dependency-resolver.ts` Must Evolve

Currently uses `getDependencyJars(project)` (compat accessor that calls `getSoleFabricMod`). Must iterate ALL fabric mod children and collect their `dependencyJars` maps. Study jars contribute their bare IDs. No ID collisions possible because fabric mod deps are namespaced.

### Project Type Change

```typescript
export interface Project {
	name: string;
	defaultChild?: string;  // NEW
	children: Map<string, ProjectChild>;
	jdtls?: JdtLsSession;
}
```

### Filter Config Changes

Currently `matchesFilter` has a hardcoded always-include for `"minecraft"` and `"src"`. This must change to per-child auto-include logic:
- Each fabric mod child auto-includes its own source ID (the mod name) and its minecraft dep (`modName/minecraft`)
- Study jars have their existing `autoInclude` flag
- The `matchesFilter` function should receive context about which entries are auto-included, rather than hardcoding IDs

### PARAMS Changes in `descriptions.ts`

Add a shared `scope` parameter:
```typescript
export const PARAMS = {
	// ... existing
	scope: z.string().optional().describe('Child name to scope to (default: all children)'),
};
```

### Tools Needing `scope` Parameter

All jar-aware tools (16+ tools). Specifically:
- Browsing: `list_packages`, `list_classes`, `search_classes`, `list_members`, `read_source`, `read_member`, `read_jar_entry`
- Position: `locate_in_source`
- LSP: `find_definition`, `find_references`, `find_implementations`, `get_symbol_info`, `search_symbols`, `type_hierarchy`
- Configuration: `configure_filters`
- Metadata: `get_project_metadata` (dual-purpose)
- Management: `unload_project` (dual-purpose -- with scope = unload child)

### Dual-Purpose Tool Behavior

`get_project_metadata`:
- Without scope: returns project-level overview (all children, aggregate jar count)
- With scope: returns that child's specific metadata (its gradle config, its fabric.mod.json, its jar inventory)

`unload_project`:
- Without scope: unload entire project (existing behavior)
- With scope: unload just that child from the project

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching on namespaced IDs | Custom string splitting/matching | picomatch (already used) | picomatch handles `*/minecraft`, `testmod/*` patterns naturally -- `/` is just a path separator |
| ID collision detection | Manual iteration | Map key semantics | Namespaced IDs are unique by construction -- `Map.set()` handles it |

## Common Pitfalls

### Pitfall 1: Forgetting to Namespace in Test Factories
**What goes wrong:** Tests create `DependencyEntry` with old-style bare IDs (`"minecraft"`, `"src"`), passing when they shouldn't.
**Why it happens:** `makeFakeFabricMod()` in `tests/helpers/factories.ts` creates deps with `id: 'minecraft'`.
**How to avoid:** Update factories to generate namespaced IDs. Update all tests that assert on specific dependency IDs.
**Warning signs:** Tests pass but integration fails because IDs don't match.

### Pitfall 2: Breaking `source-adapter.ts` with String Check
**What goes wrong:** The `dep.id === 'src'` check in `createSourceAdapter` no longer matches because the ID is now the mod name.
**Why it happens:** Forgot to change the check from ID-based to category-based.
**How to avoid:** Change to `dep.category === 'mod-source'` early in the migration.
**Warning signs:** Mod source reads fail with "JAR_NOT_AVAILABLE" errors.

### Pitfall 3: Picomatch `/` Handling
**What goes wrong:** Glob patterns like `"minecraft"` might or might not match `"testmod/minecraft"` depending on picomatch options.
**Why it happens:** picomatch treats `/` as a path separator by default. `"minecraft"` as a pattern will NOT match `"testmod/minecraft"` -- this is actually the desired behavior per user decision (bare patterns don't auto-expand).
**How to avoid:** Verify picomatch behavior with namespaced IDs. `"*/minecraft"` WILL match `"testmod/minecraft"`. `"minecraft"` will NOT. This aligns with the user's explicit decision.
**Warning signs:** Glob patterns returning unexpected results.

### Pitfall 4: Filter Auto-Include Must Be Context-Aware
**What goes wrong:** `matchesFilter` returns wrong results because it no longer knows which entries are auto-included.
**Why it happens:** The hardcoded `"minecraft"` and `"src"` check was simple but wrong for multi-mod. Per-child auto-include requires knowing WHICH child's context we're filtering in.
**How to avoid:** Pass a `Set<string>` of auto-include IDs to `matchesFilter` (or to `getFilteredDependencies`), computed from the child's mod name and minecraft dep ID.
**Warning signs:** Mod source or minecraft dep getting filtered out of results.

### Pitfall 5: `dependency-discovery.ts` Summary Calculation
**What goes wrong:** The summary at the bottom of `discoverDependencies` skips entries where `id === 'minecraft' || id === 'src'`. After namespacing, these checks fail.
**Why it happens:** Hardcoded ID checks.
**How to avoid:** Change to `category === 'minecraft' || category === 'mod-source'`.

## Code Examples

### Namespaced Dependency Creation (dependency-discovery.ts)

```typescript
// Before:
deps.set('minecraft', {
	id: 'minecraft',
	// ...
});
deps.set('src', {
	id: 'src',
	category: 'mod-source',
	// ...
});

// After:
deps.set(`${modName}/minecraft`, {
	id: `${modName}/minecraft`,
	// ...
});
deps.set(modName, {
	id: modName,
	category: 'mod-source',
	// ...
});
```

### Bare ID Resolution

```typescript
function resolveBareId(
	project: Project,
	bareId: string,
	scope?: string,
): string | null {
	// Check if it's a child name (mod source or study jar)
	if (project.children.has(bareId)) return bareId;

	// Determine which child to resolve within
	const childName = scope
		?? project.defaultChild
		?? (getFabricModCount(project) === 1 ? getSoleFabricModName(project) : null);

	if (!childName) return null; // Ambiguous

	return `${childName}/${bareId}`;
}
```

### Per-Child Auto-Include Set

```typescript
function getAutoIncludeIds(child: FabricModChild): Set<string> {
	const ids = new Set<string>();
	ids.add(child.name); // mod source is always included
	// Find the minecraft dep in this child's deps
	for (const [id, dep] of child.dependencyJars) {
		if (dep.category === 'minecraft') {
			ids.add(id);
		}
	}
	return ids;
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest implicit (package.json `"test": "vitest run"`) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEP-01 | Dependency IDs are namespaced by mod name | unit | `npx vitest run tests/project/dependency-discovery.test.ts -x` | Yes (needs update) |
| DEP-01 | Resolver aggregates namespaced deps from all children | unit | `npx vitest run tests/project/dependency-resolver.test.ts -x` | Yes (needs update) |
| DEP-02 | Mod source uses mod name as jar ID, not "src" | unit | `npx vitest run tests/project/dependency-discovery.test.ts -x` | Yes (needs update) |
| DEP-02 | Source adapter uses category, not ID string | unit | `npx vitest run tests/browsing/source-adapter.test.ts -x` | No -- Wave 0 gap (but source-adapter.ts is small) |
| DEP-03 | Scope parameter in getDependenciesForTool | unit | `npx vitest run tests/tools/tool-helpers.test.ts -x` | No -- Wave 0 gap |
| DEP-03 | Bare ID resolution (ambiguous/unambiguous) | unit | `npx vitest run tests/project/namespace-resolver.test.ts -x` | No -- Wave 0 (new file) |
| DEP-03 | Filter auto-include per child | unit | `npx vitest run tests/project/jar-registry.test.ts -x` | Yes (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/project/namespace-resolver.test.ts` -- covers bare ID resolution, scope resolution, ambiguity errors
- [ ] Update `tests/helpers/factories.ts` -- `makeFakeFabricMod` must generate namespaced dep IDs
- [ ] Update `tests/project/dependency-discovery.test.ts` -- assertions on namespaced IDs
- [ ] Update `tests/project/dependency-resolver.test.ts` -- multi-child aggregation
- [ ] Update `tests/project/jar-registry.test.ts` -- per-child auto-include instead of hardcoded IDs

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `src/project/dependency-discovery.ts`, `src/project/dependency-resolver.ts`, `src/project/jar-registry.ts`, `src/tools/tool-helpers.ts`, `src/browsing/source-adapter.ts`, `src/project/types.ts`, `src/project/compat.ts`, `src/state/project-store.ts`, `src/tools/descriptions.ts`
- Phase 24 CONTEXT.md -- locked user decisions

### Secondary (MEDIUM confidence)
- picomatch `/` separator behavior -- based on picomatch documentation (glob semantics treat `/` as path separator by default)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, pure internal refactoring
- Architecture: HIGH -- all touch points identified through direct codebase inspection
- Pitfalls: HIGH -- derived from concrete code analysis of hardcoded string checks

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- internal refactoring, no external dependency changes)
