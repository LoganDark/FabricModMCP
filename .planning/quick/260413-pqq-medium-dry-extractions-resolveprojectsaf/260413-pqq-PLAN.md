---
phase: quick
plan: 260413-pqq
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/tool-helpers.ts
  - src/tools/find-definition.ts
  - src/tools/find-references.ts
  - src/tools/find-implementations.ts
  - src/tools/get-symbol-info.ts
  - src/tools/list-members.ts
  - src/tools/locate-in-source.ts
  - src/tools/read-source.ts
  - src/tools/type-hierarchy.ts
  - src/tools/read-jar-entry.ts
  - src/tools/list-packages.ts
  - src/tools/list-classes.ts
  - src/tools/search-classes.ts
  - src/tools/search-symbols.ts
  - src/tools/get-project-metadata.ts
  - src/tools/load-project.ts
  - src/tools/unload-project.ts
  - src/tools/configure-filters.ts
  - src/tools/refresh-dependencies.ts
  - src/tools/set-default-project.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "All 327 tests still pass with zero behavior changes"
    - "No tool file contains inline resolveProject try/catch boilerplate"
    - "find-definition.ts and find-references.ts use resolveSymbolPosition() instead of inline cascade+jar resolution"
  artifacts:
    - path: "src/tools/tool-helpers.ts"
      provides: "resolveProjectSafely() and returnError() helpers"
      exports: ["resolveProjectSafely", "returnError"]
    - path: "src/tools/find-definition.ts"
      provides: "find_definition tool using resolveSymbolPosition"
    - path: "src/tools/find-references.ts"
      provides: "find_references tool using resolveSymbolPosition"
  key_links:
    - from: "src/tools/tool-helpers.ts"
      to: "src/state/project-store.js"
      via: "resolveProjectSafely wraps projectStore.resolveProject"
    - from: "src/tools/tool-helpers.ts"
      to: "src/types/envelope.js"
      via: "returnError wraps makeError"
---

<objective>
DRY extraction of three repeated patterns across all tool files: resolveProjectSafely() for the project resolution try/catch, returnError() for the MCP error response builder, and migration of find-definition.ts and find-references.ts to use the shared resolveSymbolPosition() helper.

Purpose: Eliminate ~500 lines of duplicated boilerplate across ~19 tool files
Output: Cleaner tool files with shared helpers, all tests passing
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/tools/tool-helpers.ts
@src/tools/resolve-symbol-position.ts
@src/types/envelope.ts
@src/tools/find-definition.ts
@src/tools/find-references.ts
@src/tools/find-implementations.ts (reference: already uses resolveSymbolPosition)

<interfaces>
From src/types/envelope.ts:
```typescript
export interface ToolError {
	success: false;
	error: { code: string; message: string; tried: string[]; suggestions?: string[] };
	metadata: Record<string, unknown>;
}
export function makeError(code: string, message: string, tried: string[], suggestions?: string[], metadata?: Record<string, unknown>): ToolError;
```

From src/tools/tool-helpers.ts (current exports):
```typescript
export interface LocateFailure { jar: string; category: JarCategory; provenanceChains: string[][]; steps: CascadeStep[]; failedStep: number; error?: string; }
export const CATEGORY_PRIORITY: Record<JarCategory, number>;
export function sortByPriority(entries: [string, DependencyEntry][]): [string, DependencyEntry][];
export function classNameToEntryPath(className: string): string;
export function normalizeLocations(result: any): Array<{ uri: string; range: any }>;
```

From src/tools/resolve-symbol-position.ts:
```typescript
export type SymbolPositionResult = SymbolPositionSuccess | SymbolPositionCascadeFailure | SymbolPositionNotFound | SymbolPositionJarError;
export async function resolveSymbolPosition(loadedProject: LoadedProject, className: string, patterns: string[], jar?: string): Promise<SymbolPositionResult>;
```

From src/state/project-store.ts:
```typescript
// projectStore.resolveProject(project?) throws DomainError with { code, message, tried, suggestions }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add resolveProjectSafely + returnError to tool-helpers.ts, then migrate all 19 tool files</name>
  <files>src/tools/tool-helpers.ts, src/tools/find-definition.ts, src/tools/find-references.ts, src/tools/find-implementations.ts, src/tools/get-symbol-info.ts, src/tools/list-members.ts, src/tools/locate-in-source.ts, src/tools/read-source.ts, src/tools/type-hierarchy.ts, src/tools/read-jar-entry.ts, src/tools/list-packages.ts, src/tools/list-classes.ts, src/tools/search-classes.ts, src/tools/search-symbols.ts, src/tools/get-project-metadata.ts, src/tools/load-project.ts, src/tools/unload-project.ts, src/tools/configure-filters.ts, src/tools/refresh-dependencies.ts, src/tools/set-default-project.ts</files>
  <action>
1. Add two new exports to `src/tools/tool-helpers.ts`:

   - `resolveProjectSafely(project?: string)` -- wraps `projectStore.resolveProject(project)` in the standard try/catch. Returns discriminated union: `{ ok: true; project: LoadedProject }` or `{ ok: false; error: McpToolResponse }`. Import `projectStore` from `../state/project-store.js`, `LoadedProject` from `../project/types.js`, `makeError` from `../types/envelope.js`. The `McpToolResponse` type is just the inline `{ content: ..., structuredContent: ... }` shape -- use an explicit return type annotation rather than a named type.

   - `returnError(code, message, tried, suggestions?)` -- wraps `makeError()` and builds the `{ content: [{ type: 'text', text }], structuredContent: envelope }` return shape. Every place in the codebase that does `const envelope = makeError(...); return { content: [...], structuredContent: envelope };` should use this instead.

2. In ALL 17 tool files that have the resolveProject try/catch pattern, replace the 10-line block with:
   ```ts
   const resolved = resolveProjectSafely(project);
   if (!resolved.ok) return resolved.error;
   const loadedProject = resolved.project;
   ```
   Update imports: add `resolveProjectSafely` from `./tool-helpers.js`, remove `projectStore` import if no longer used, remove `makeError` import if no longer used.

3. In ALL ~19 tool files, replace every remaining `makeError` + `return { content, structuredContent }` pattern with `return returnError(code, message, tried, suggestions)`. The text content line `Error [${code}]: ${message}` is standardized by returnError. Update imports accordingly -- remove `makeError` from `../types/envelope.js` if the file no longer uses it directly.

   IMPORTANT: Some files also use `makeSuccess` from envelope.ts -- do NOT remove the envelope import if makeSuccess is still used. Only remove `makeError` from the import.

   IMPORTANT: `load-project.ts` and `set-default-project.ts` use `projectStore` for more than just resolveProject (e.g., `projectStore.set()`, `projectStore.has()`, `projectStore.setDefault()`). Keep the projectStore import in those files.

   IMPORTANT: Tab indentation throughout, per project conventions.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx vitest run 2>&1 | tail -5</automated>
  </verify>
  <done>All 327 tests pass. No tool file contains the inline resolveProject try/catch pattern. All makeError+return patterns replaced with returnError() calls.</done>
</task>

<task type="auto">
  <name>Task 2: Migrate find-definition.ts to resolveSymbolPosition</name>
  <files>src/tools/find-definition.ts</files>
  <action>
Replace the ~110-line inline cascade+jar resolution block in find-definition.ts (lines 77-190 approximately: the specific-jar mode, all-jars mode, and error handling) with a call to `resolveSymbolPosition()`, following the same pattern used in find-implementations.ts.

1. Add import: `import { resolveSymbolPosition } from './resolve-symbol-position.js';`
2. Remove now-unused imports: `getFilteredDependencies`, `jarReader`, `createSourceAdapter`, `cascadeRegex`, `sortByPriority`, `CascadeSuccess`, and `LocateFailure` (if no longer referenced).
3. Replace the entire block from `// Resolve source position via cascading regex` through the end of the if/else with:
   ```ts
   const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar);
   ```
4. Handle the discriminated union result, mapping each failure kind to the appropriate `returnError()` call (use returnError from Task 1):
   - `jar-not-found` -> `returnError('JAR_NOT_FOUND', ...)`
   - `jar-not-available` -> `returnError('JAR_NOT_AVAILABLE', ...)`
   - `cascade-failure` -> return makeSuccess with failures array (same as current behavior, same as find-implementations.ts)
   - `not-found` -> `returnError('CLASS_NOT_FOUND', ...)`
5. On success, destructure `{ sourceJarId, sourceText, cascadeResult, fileUri }` from posResult.
6. The rest of the function (didOpen, definition request, didClose, result processing) stays the same.
7. Remove the `classNameToEntryPath` import if no longer used directly (resolveSymbolPosition handles it internally). Keep `normalizeLocations` -- still used for processing LSP results.

The `uriMapper` creation can also be removed from this file since resolveSymbolPosition creates its own internally. However, the function still needs uriMapper for processing LSP *results* (the `fromFileUri` call). So keep the uriMapper creation.

Match error messages exactly to current behavior so tests pass unchanged.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx vitest run 2>&1 | tail -5</automated>
  </verify>
  <done>find-definition.ts uses resolveSymbolPosition(). No inline cascade/jar resolution logic remains. All tests pass.</done>
</task>

<task type="auto">
  <name>Task 3: Migrate find-references.ts to resolveSymbolPosition</name>
  <files>src/tools/find-references.ts</files>
  <action>
Identical migration as Task 2 but for find-references.ts.

1. Add import: `import { resolveSymbolPosition } from './resolve-symbol-position.js';`
2. Remove now-unused imports: `getFilteredDependencies`, `jarReader`, `createSourceAdapter`, `cascadeRegex`, `sortByPriority`, `CascadeSuccess`, `LocateFailure`.
3. Replace the entire cascade+jar resolution block (lines 77-189 approximately) with:
   ```ts
   const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar);
   ```
4. Handle the discriminated union result with returnError() calls, same pattern as Task 2 and find-implementations.ts.
5. On success, destructure `{ sourceJarId, sourceText, cascadeResult, fileUri }`.
6. The rest of the function (didOpen, references request with `{ includeDeclaration: true }`, didClose, result processing) stays the same.
7. Note: find-references uses `refResult ?? []` instead of `normalizeLocations()` since `references` returns `Location[] | null` not `Location | Location[] | LocationLink[]`. This stays the same.

Keep uriMapper creation for processing LSP results (fromFileUri calls).
Match error messages exactly to current behavior.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx vitest run 2>&1 | tail -5</automated>
  </verify>
  <done>find-references.ts uses resolveSymbolPosition(). No inline cascade/jar resolution logic remains. All 327 tests pass.</done>
</task>

</tasks>

<verification>
All 327 tests pass: `npx vitest run`
No remaining inline resolveProject try/catch: `grep -r "projectStore.resolveProject" src/tools/ | grep -v tool-helpers.ts` returns empty (except load-project.ts and set-default-project.ts if they use it for non-resolution purposes -- but they should also use resolveProjectSafely)
No remaining inline makeError+return pattern in tool files (all replaced with returnError)
</verification>

<success_criteria>
- All 327 tests pass with zero failures
- resolveProjectSafely() and returnError() exported from tool-helpers.ts
- All 17 tool files with resolveProject pattern migrated to resolveProjectSafely
- All ~92 makeError+return patterns replaced with returnError()
- find-definition.ts and find-references.ts use resolveSymbolPosition() with no inline cascade/jar logic
</success_criteria>

<output>
After completion, create `.planning/quick/260413-pqq-medium-dry-extractions-resolveprojectsaf/260413-pqq-SUMMARY.md`
</output>
