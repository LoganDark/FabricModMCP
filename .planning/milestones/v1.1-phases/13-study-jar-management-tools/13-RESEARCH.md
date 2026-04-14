# Phase 13: Study Jar Management Tools - Research

**Researched:** 2026-04-13
**Domain:** MCP tool implementation (CRUD operations on study jar state)
**Confidence:** HIGH

## Summary

This phase adds four MCP tools (`add_study_jar`, `remove_study_jar`, `list_study_jars`, `configure_study_jar`) that expose study jar lifecycle management to users. All underlying infrastructure is already complete: `createStudyJar()` handles validation, ZIP opening, and stats computation; `JarReader.addProjectJar()`/`removeProjectJar()` manages handles; `evictEntryIndex()` clears caches. The tools are thin MCP wrappers around this existing domain logic.

The codebase has 21 existing tools with a rigid, well-documented registration pattern. Every tool follows the same structure: one file per tool, Zod schema in `inputSchema`, descriptions from `TOOL_DESCRIPTIONS`, shared params from `PARAMS`, `resolveProjectSafely()` at the top, dual text+structured response via `makeSuccess`/`returnError`. This phase is pure pattern replication with no novel technical challenges.

**Primary recommendation:** Follow the established tool pattern exactly. The domain logic is done -- each tool is 30-60 lines of glue code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Four separate tools: `add_study_jar`, `remove_study_jar`, `list_study_jars`, `configure_study_jar`
- Each tool has a single responsibility -- no combined management tool with mode switching
- Follows the existing pattern of one registration function per tool file
- Add tool response: text content (human-readable confirmation) + structured content (jar name, resolved path, auto-include status, stats)
- `remove_study_jar` and `configure_study_jar` accept multiple names in a single call (batch)
- `add_study_jar` is single-jar (each add needs its own path and optional name)
- `remove_study_jar` and `configure_study_jar` produce a hard error on nonexistent name -- no silent no-ops
- When batch: fail on the first nonexistent name (no partial application)

### Claude's Discretion
- Exact parameter names and Zod schemas
- Tool description text for `TOOL_DESCRIPTIONS`
- Whether `configure_study_jar` only handles auto-include or is designed for future config fields
- Error message wording and DomainError codes

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STUDY-01 | User can add a named source jar to a loaded project by file path | `createStudyJar()` handles all validation/opening; tool calls it, then `jarReader.addProjectJar()`, then stores in `loadedProject.studyJars` |
| STUDY-02 | User can remove a study jar from a project by name | Look up in `studyJars` map, call `jarReader.removeProjectJar()`, `evictEntryIndex()`, then `studyJars.delete()` |
| STUDY-03 | User can list all study jars on a project with their auto-include status | Read from `loadedProject.studyJars` map, format as array of jar details |
| STUDY-04 | User can set a study jar's auto-include flag (default: off) | Look up in `studyJars` map, set `autoInclude` property |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.29.x | MCP server + tool registration | Already in use; `McpServer.registerTool()` is the tool registration API |
| zod | 4.3.x | Tool parameter schemas | Already in use; `z.string()`, `z.array()`, `z.boolean()` for input validation |
| node-stream-zip | 1.15.x | ZIP/JAR reading | Already in use via `createStudyJar()` -- no direct usage needed in tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.x | Testing | Tool integration tests via `createTestPair()` |

No new dependencies required. All libraries are already installed.

## Architecture Patterns

### Recommended File Structure
```
src/tools/
  add-study-jar.ts          # registerAddStudyJarTool(server)
  remove-study-jar.ts       # registerRemoveStudyJarTool(server)
  list-study-jars.ts        # registerListStudyJarsTool(server)
  configure-study-jar.ts    # registerConfigureStudyJarTool(server)
  descriptions.ts           # Add 4 entries to TOOL_DESCRIPTIONS
  index.ts                  # Add 4 register calls to registerAllTools()
tests/tools/
  add-study-jar.test.ts
  remove-study-jar.test.ts
  list-study-jars.test.ts
  configure-study-jar.test.ts
```

### Pattern 1: Tool Registration (canonical)
**What:** Every tool follows the exact same structure
**When to use:** Always -- all 4 new tools
**Example:**
```typescript
// Source: src/tools/configure-filters.ts (existing exemplar)
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerAddStudyJarTool(server: McpServer): void {
	server.registerTool(
		'add_study_jar',
		{
			title: 'Add Study Jar',
			description: TOOL_DESCRIPTIONS.add_study_jar,
			inputSchema: {
				project: PARAMS.project,
				path: z.string().describe('...'),
				name: z.string().optional().describe('...'),
			},
		},
		async ({ project, path, name }) => {
			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;
			// ... domain logic ...
			return {
				content: [{ type: 'text' as const, text: '...' }],
				structuredContent: makeSuccess({ ... }),
			};
		},
	);
}
```

### Pattern 2: Batch Operations with Fail-Fast
**What:** `remove_study_jar` and `configure_study_jar` accept `names: string[]` and fail on first nonexistent name
**When to use:** For batch tools per user decision
**Example:**
```typescript
// Validate all names exist BEFORE mutating any state
for (const name of names) {
	if (!loadedProject.studyJars.has(name)) {
		return returnError(
			'STUDY_JAR_NOT_FOUND',
			`Study jar '${name}' not found on project '${loadedProject.name}'`,
			[name],
			['Use list_study_jars to see available study jars'],
		);
	}
}
// Then apply mutations
for (const name of names) {
	// ... remove or configure ...
}
```

### Pattern 3: Add Tool Flow
**What:** Orchestrate existing domain functions for the add operation
**When to use:** `add_study_jar` tool
**Example:**
```typescript
// 1. createStudyJar() validates path, opens ZIP, computes stats, checks duplicates
const studyJar = await createStudyJar(path, name, loadedProject);
// 2. Store in project
loadedProject.studyJars.set(studyJar.name, studyJar);
// 3. Register jar handle for reading
jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);
```

### Pattern 4: Remove Tool Flow
**What:** Clean up all state when removing a study jar
**When to use:** `remove_study_jar` tool
**Example:**
```typescript
const studyJar = loadedProject.studyJars.get(name)!;
// 1. Remove jar handle (ref-counted, only closes if no other project uses it)
await jarReader.removeProjectJar(loadedProject.name, studyJar.jarPath);
// 2. Evict cached entry index
evictEntryIndex(studyJar.jarPath);
// 3. Remove from project state
loadedProject.studyJars.delete(name);
```

### Anti-Patterns to Avoid
- **Skipping validation before mutation:** Always validate all batch items exist before applying any changes. The user decided on fail-fast with no partial application.
- **Forgetting evictEntryIndex on remove:** The entry index cache is keyed by jar path. Removing a study jar without evicting leaves stale cache entries.
- **Re-implementing createStudyJar logic:** The domain function handles path resolution, name derivation, name validation, duplicate checking, ZIP validation, and stats computation. The tool should NOT replicate any of this.
- **Returning nested JSON in text content:** Per project memory, MCP text responses must NOT be `JSON.stringify`'d duplicates of `structuredContent`. Text content should be human-readable summaries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Jar validation & stats | Custom ZIP opening/stat logic | `createStudyJar()` | Already handles path resolution, ZIP validation, stats computation, name derivation, duplicate checking |
| Jar handle lifecycle | Manual StreamZip management | `jarReader.addProjectJar()`/`removeProjectJar()` | Ref-counted, handles multi-project sharing |
| Cache invalidation | Manual cache management | `evictEntryIndex()` | Single function, already tested |
| Project resolution | Manual project lookup | `resolveProjectSafely()` | Standard error envelope on failure |
| Error responses | Custom error formatting | `returnError()` | Consistent error envelope format |
| Name validation | Custom regex | `validateStudyJarName()` | Already exists with proper DomainError |

**Key insight:** The entire domain layer (Phase 11) and integration layer (Phase 12) are complete. These tools are pure glue code -- calling existing functions and formatting responses.

## Common Pitfalls

### Pitfall 1: Forgetting to Update TOOL_DESCRIPTIONS and PARAMS
**What goes wrong:** Tool registration silently works without centralized descriptions but creates inconsistency
**Why it happens:** Developer inlines descriptions in the `registerTool` call instead of adding to `descriptions.ts`
**How to avoid:** Add all 4 tool descriptions to `TOOL_DESCRIPTIONS` before writing tool files. Add any new shared params to `PARAMS`.
**Warning signs:** Inline string literals in `description:` field of `registerTool`

### Pitfall 2: Missing registerAllTools Entry
**What goes wrong:** Tool exists but is never registered with the server, invisible to clients
**Why it happens:** File created but `index.ts` not updated
**How to avoid:** Add import and register call to `src/tools/index.ts` for each new tool
**Warning signs:** Tool file exists but `callTool` returns "tool not found"

### Pitfall 3: Partial Mutation on Batch Failure
**What goes wrong:** If removing 3 jars and the 2nd doesn't exist, the 1st is already removed
**Why it happens:** Checking existence inside the mutation loop instead of pre-validating
**How to avoid:** Validate ALL names exist in a first pass, THEN apply all mutations in a second pass
**Warning signs:** State changes even when the tool returns an error

### Pitfall 4: createStudyJar Throws DomainError
**What goes wrong:** Unhandled DomainError crashes the tool handler
**Why it happens:** `createStudyJar()` throws on invalid path, invalid name, duplicate name, invalid ZIP, and ID collision
**How to avoid:** Catch `DomainError` and convert to `returnError()` response
**Warning signs:** MCP client receives a transport error instead of a structured error envelope

### Pitfall 5: Tab Indentation
**What goes wrong:** Code review failure
**Why it happens:** Default editor settings use spaces
**How to avoid:** All source files MUST use tab indentation per project convention (from user memory)
**Warning signs:** Mixed indentation in PR

## Code Examples

### Add Study Jar Tool (complete handler logic)
```typescript
// Source: derived from existing patterns in codebase
import { createStudyJar } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { DomainError } from '../errors/domain-error.js';

// Inside handler:
try {
	const studyJar = await createStudyJar(path, name, loadedProject);
	loadedProject.studyJars.set(studyJar.name, studyJar);
	jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);

	return {
		content: [{ type: 'text' as const, text: `Added study jar '${studyJar.name}' (${studyJar.stats.classCount} classes, ${studyJar.stats.packageCount} packages)` }],
		structuredContent: makeSuccess({
			name: studyJar.name,
			path: studyJar.jarPath,
			autoInclude: studyJar.autoInclude,
			stats: studyJar.stats,
		}),
	};
} catch (err) {
	if (err instanceof DomainError) {
		return returnError(err.code, err.message, err.tried, err.suggestions);
	}
	throw err;
}
```

### Remove Study Jar Tool (batch with fail-fast)
```typescript
// Source: derived from existing patterns
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { jarReader } from './shared-jar-reader.js';

// Inside handler:
// Pre-validate all names
for (const name of names) {
	if (!loadedProject.studyJars.has(name)) {
		return returnError(
			'STUDY_JAR_NOT_FOUND',
			`Study jar '${name}' not found on project '${loadedProject.name}'`,
			[name],
			['Use list_study_jars to see available study jars'],
		);
	}
}

// Apply removals
const removed: string[] = [];
for (const name of names) {
	const studyJar = loadedProject.studyJars.get(name)!;
	await jarReader.removeProjectJar(loadedProject.name, studyJar.jarPath);
	evictEntryIndex(studyJar.jarPath);
	loadedProject.studyJars.delete(name);
	removed.push(name);
}
```

### List Study Jars Tool (read-only)
```typescript
// Inside handler:
const jars = Array.from(loadedProject.studyJars.values()).map(jar => ({
	name: jar.name,
	path: jar.jarPath,
	autoInclude: jar.autoInclude,
	stats: jar.stats,
	size: jar.size,
}));

return {
	content: [{ type: 'text' as const, text: jars.length === 0
		? 'No study jars configured'
		: `${jars.length} study jar(s): ${jars.map(j => j.name).join(', ')}`
	}],
	structuredContent: makeSuccess({ jars, count: jars.length }),
};
```

### Configure Study Jar Tool (batch toggle)
```typescript
// Inside handler:
// Pre-validate
for (const name of names) {
	if (!loadedProject.studyJars.has(name)) {
		return returnError(
			'STUDY_JAR_NOT_FOUND',
			`Study jar '${name}' not found on project '${loadedProject.name}'`,
			[name],
			['Use list_study_jars to see available study jars'],
		);
	}
}

// Apply configuration
const updated: Array<{ name: string; autoInclude: boolean }> = [];
for (const name of names) {
	const studyJar = loadedProject.studyJars.get(name)!;
	if (autoInclude !== undefined) {
		studyJar.autoInclude = autoInclude;
	}
	updated.push({ name: studyJar.name, autoInclude: studyJar.autoInclude });
}
```

### Test Pattern (tool integration test via TestPair)
```typescript
// Source: tests/tools/echo.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope } from '../helpers/factories.js';

describe('add_study_jar tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		pair = await createTestPair();
		// Load a project first...
	});

	afterEach(async () => {
		await pair.cleanup();
	});

	it('adds a study jar and returns stats', async () => {
		const result = await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { path: '/path/to/sources.jar' },
		});
		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBeDefined();
		expect(envelope.data.stats.classCount).toBeGreaterThan(0);
	});
});
```

## State of the Art

No changes in approach. The MCP SDK, Zod, and tool registration patterns are all current and stable. No deprecated APIs are in use.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | N/A | N/A | N/A |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/tools/add-study-jar.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STUDY-01 | Add study jar by path with name, appears in project | integration | `npx vitest run tests/tools/add-study-jar.test.ts -x` | Wave 0 |
| STUDY-01 | Add with invalid path returns clear error | integration | `npx vitest run tests/tools/add-study-jar.test.ts -x` | Wave 0 |
| STUDY-01 | Add with non-ZIP file returns clear error | integration | `npx vitest run tests/tools/add-study-jar.test.ts -x` | Wave 0 |
| STUDY-01 | Add with duplicate name returns clear error | integration | `npx vitest run tests/tools/add-study-jar.test.ts -x` | Wave 0 |
| STUDY-02 | Remove study jar by name, disappears from metadata | integration | `npx vitest run tests/tools/remove-study-jar.test.ts -x` | Wave 0 |
| STUDY-02 | Remove nonexistent name returns hard error | integration | `npx vitest run tests/tools/remove-study-jar.test.ts -x` | Wave 0 |
| STUDY-02 | Batch remove fails on first nonexistent (no partial) | integration | `npx vitest run tests/tools/remove-study-jar.test.ts -x` | Wave 0 |
| STUDY-03 | List shows all jars with names, paths, auto-include | integration | `npx vitest run tests/tools/list-study-jars.test.ts -x` | Wave 0 |
| STUDY-03 | List returns empty when no study jars | integration | `npx vitest run tests/tools/list-study-jars.test.ts -x` | Wave 0 |
| STUDY-04 | Toggle auto-include flag | integration | `npx vitest run tests/tools/configure-study-jar.test.ts -x` | Wave 0 |
| STUDY-04 | Configure nonexistent name returns hard error | integration | `npx vitest run tests/tools/configure-study-jar.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/tools/{tool-name}.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/add-study-jar.test.ts` -- covers STUDY-01
- [ ] `tests/tools/remove-study-jar.test.ts` -- covers STUDY-02
- [ ] `tests/tools/list-study-jars.test.ts` -- covers STUDY-03
- [ ] `tests/tools/configure-study-jar.test.ts` -- covers STUDY-04
- [ ] Test helper: function to create a temporary valid JAR file (already exists in `tests/project/study-jar.test.ts` as `createTestZip` -- can be extracted to `tests/helpers/` or reused inline)
- [ ] Test helper: function to load a project into the test server (needed for all 4 tool tests)

## Open Questions

1. **configure_study_jar: auto-include only vs. extensible?**
   - What we know: Currently `StudyJar` only has `autoInclude` as a configurable field. User left this to Claude's discretion.
   - Recommendation: Design the schema to accept `autoInclude: z.boolean().optional()` as a named field rather than a generic key-value bag. This is simpler now and can be extended with more optional fields later without breaking the schema. Avoid over-engineering.

2. **Test fixture for loading a project**
   - What we know: Tool tests need a loaded project before testing study jar operations. `load_project` requires a real Gradle project on disk.
   - What's unclear: Whether to mock project loading or create a minimal fixture project.
   - Recommendation: Use `projectStore.registerProject()` directly with `makeFakeProject()` in test setup, bypassing `load_project` tool. This is how other tool tests work (e.g., `list-classes.test.ts` likely registers directly). The `add_study_jar` test specifically needs a real JAR file -- reuse the `createTestZip` pattern from `tests/project/study-jar.test.ts`.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/tools/configure-filters.ts`, `src/tools/descriptions.ts`, `src/tools/tool-helpers.ts`, `src/tools/index.ts` -- canonical tool patterns
- Codebase analysis: `src/project/study-jar.ts` -- complete domain logic for all CRUD operations
- Codebase analysis: `src/project/jar-reader.ts` -- `addProjectJar()`, `removeProjectJar()` APIs
- Codebase analysis: `src/browsing/entry-index-cache.ts` -- `evictEntryIndex()` API
- Codebase analysis: `src/project/types.ts` -- `StudyJar`, `LoadedProject.studyJars` types
- Codebase analysis: `tests/project/study-jar.test.ts` -- test fixture patterns for study jars

### Secondary (MEDIUM confidence)
- None needed -- this phase is entirely internal to the existing codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing
- Architecture: HIGH -- exact pattern replication of 21 existing tools
- Pitfalls: HIGH -- derived from codebase analysis of actual patterns and conventions

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- internal codebase patterns)
