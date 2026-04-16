---
phase: quick
plan: 260413-pin
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/tool-helpers.ts
  - src/tools/find-definition.ts
  - src/tools/find-references.ts
  - src/tools/find-implementations.ts
  - src/tools/list-members.ts
  - src/tools/type-hierarchy.ts
  - src/tools/read-source.ts
  - src/tools/locate-in-source.ts
  - src/tools/resolve-symbol-position.ts
  - src/browsing/search.ts
  - src/tools/list-classes.ts
  - src/tools/list-packages.ts
autonomous: true
must_haves:
  truths:
    - "All duplicated CATEGORY_PRIORITY, sortByPriority, classNameToEntryPath, normalizeLocations, and LocateFailure definitions are removed from individual tool files"
    - "All tool files import shared utilities from tool-helpers.ts"
    - "list-classes.ts uses shared entryIndex cache from list-packages.ts instead of its own duplicate"
    - "All existing tests pass without modification"
  artifacts:
    - path: "src/tools/tool-helpers.ts"
      provides: "Shared tool utilities"
      exports: ["classNameToEntryPath", "CATEGORY_PRIORITY", "sortByPriority", "normalizeLocations", "LocateFailure"]
  key_links:
    - from: "src/tools/*.ts"
      to: "src/tools/tool-helpers.ts"
      via: "named imports"
      pattern: "import.*from.*tool-helpers"
---

<objective>
Extract duplicated utility code from 8+ tool files into a shared src/tools/tool-helpers.ts module, then update all consumers to import from it.

Purpose: Eliminate 8 copies of CATEGORY_PRIORITY/sortByPriority, 7 copies of FQN-to-path conversion, 3 copies of LocateFailure, and 2+ copies of normalizeLocations. Also deduplicate entryIndex cache in list-classes.ts.
Output: Single source of truth for shared tool utilities with zero behavior changes.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@src/tools/find-definition.ts (reference implementation of all helpers)
@src/tools/find-implementations.ts (normalizeLocations copy)
@src/tools/list-packages.ts (entryIndex cache + clearEntryIndexCache export)
@src/tools/list-classes.ts (duplicate entryIndex cache)
@src/project/types.ts (JarCategory, DependencyEntry types)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create tool-helpers.ts with all shared utilities</name>
  <files>src/tools/tool-helpers.ts, src/tools/list-packages.ts</files>
  <action>
Create src/tools/tool-helpers.ts exporting:

1. `classNameToEntryPath(className: string): string` — Extract from find-definition.ts lines 114-121. The function takes a fully qualified class name and returns the jar entry path:
   ```ts
   export function classNameToEntryPath(className: string): string {
     const lastDot = className.lastIndexOf('.');
     if (lastDot === -1) return `${className}.java`;
     const packagePath = className.substring(0, lastDot).replaceAll('.', '/');
     const simpleNameWithInner = className.substring(lastDot + 1);
     return `${packagePath}/${simpleNameWithInner}.java`;
   }
   ```

2. `CATEGORY_PRIORITY: Record<JarCategory, number>` — Import JarCategory from '../project/types.js'. Extract the constant:
   ```ts
   export const CATEGORY_PRIORITY: Record<JarCategory, number> = {
     minecraft: 0,
     'mod-source': 1,
     'fabric-api': 2,
     library: 3,
   };
   ```

3. `sortByPriority(entries: [string, DependencyEntry][]): [string, DependencyEntry][]` — Import DependencyEntry from '../project/types.js':
   ```ts
   export function sortByPriority(entries: [string, DependencyEntry][]): [string, DependencyEntry][] {
     return entries.sort((a, b) => {
       const pa = CATEGORY_PRIORITY[a[1].category] ?? 99;
       const pb = CATEGORY_PRIORITY[b[1].category] ?? 99;
       return pa - pb;
     });
   }
   ```

4. `normalizeLocations(result: any): Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>` — Extract from find-definition.ts lines 47+. Handles Location, Location[], and LocationLink[] union from LSP.

5. `LocateFailure` interface:
   ```ts
   export interface LocateFailure {
     className: string;
     jar: string;
     category: string;
     reason: string;
   }
   ```

Also update src/tools/list-packages.ts to export `getOrBuildIndex` and `entryIndexCache` so list-classes.ts can reuse them instead of duplicating. The `clearEntryIndexCache` export already exists -- just add exports for the other two. Keep the existing function signatures identical.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsx --eval "import { classNameToEntryPath, CATEGORY_PRIORITY, sortByPriority, normalizeLocations } from './src/tools/tool-helpers.js'; console.log(classNameToEntryPath('net.minecraft.client.MinecraftClient')); console.log(Object.keys(CATEGORY_PRIORITY).length === 4 ? 'OK' : 'FAIL')"</automated>
  </verify>
  <done>tool-helpers.ts exists with all 5 exports. list-packages.ts exports getOrBuildIndex and entryIndexCache.</done>
</task>

<task type="auto">
  <name>Task 2: Update all tool files to use shared helpers</name>
  <files>src/tools/find-definition.ts, src/tools/find-references.ts, src/tools/find-implementations.ts, src/tools/list-members.ts, src/tools/type-hierarchy.ts, src/tools/read-source.ts, src/tools/locate-in-source.ts, src/tools/resolve-symbol-position.ts, src/browsing/search.ts, src/tools/list-classes.ts</files>
  <action>
For each file, add an import from './tool-helpers.js' (or '../tools/tool-helpers.js' for search.ts) and remove the local definitions:

**find-definition.ts**: Remove local LocateFailure interface (lines 17-24), CATEGORY_PRIORITY const (lines 27-32), sortByPriority function (lines 34-39), normalizeLocations function (lines 47+), and the inline FQN-to-path conversion (lines 114-121 — replace with `entryPath = classNameToEntryPath(className)`). Import { classNameToEntryPath, CATEGORY_PRIORITY, sortByPriority, normalizeLocations, LocateFailure } from './tool-helpers.js'. Remove the `import type { JarCategory, DependencyEntry }` if no longer used directly (CATEGORY_PRIORITY and sortByPriority are in helper now, but check if DependencyEntry is used elsewhere in the file).

**find-references.ts**: Remove local LocateFailure (lines 17-24), CATEGORY_PRIORITY (lines 27-32), sortByPriority (lines 34-39), inline FQN conversion (lines 92-99). Import { classNameToEntryPath, sortByPriority, LocateFailure } from './tool-helpers.js'. This file does NOT use normalizeLocations currently -- keep as-is (the spec mentioned it could use it, but that would be a behavior change; skip for pure extraction).

**find-implementations.ts**: Remove local normalizeLocations (lines 16+). Import { normalizeLocations } from './tool-helpers.js'.

**list-members.ts**: Remove CATEGORY_PRIORITY (lines 14-19), sortByPriority (lines 21-26), inline FQN conversion (around line 143-150). Import { classNameToEntryPath, sortByPriority } from './tool-helpers.js'.

**type-hierarchy.ts**: Remove CATEGORY_PRIORITY (lines 15-20), sortByPriority (lines 22-27), inline FQN conversion (around line 92-99). Import { classNameToEntryPath, sortByPriority } from './tool-helpers.js'.

**read-source.ts**: Remove CATEGORY_PRIORITY (lines 20-25), sortByPriority (lines 27-32), inline FQN conversion (around line 67-74). Import { classNameToEntryPath, sortByPriority } from './tool-helpers.js'.

**locate-in-source.ts**: Remove LocateFailure (lines 23-29), CATEGORY_PRIORITY (lines 33-38), sortByPriority (lines 40-45), inline FQN conversion (around line 81-88). Import { classNameToEntryPath, sortByPriority, LocateFailure } from './tool-helpers.js'.

**resolve-symbol-position.ts**: Remove CATEGORY_PRIORITY (lines 18-23), sortByPriority (lines 25-30), inline FQN conversion (around line 87-94). Import { classNameToEntryPath, sortByPriority } from './tool-helpers.js'.

**src/browsing/search.ts**: Remove CATEGORY_PRIORITY (lines 10-16). Import { CATEGORY_PRIORITY } from '../tools/tool-helpers.js'. Keep the inline sort comparison on lines 72-73 and 191-192 as they reference CATEGORY_PRIORITY directly (just the const moves, not the sort call sites). Also remove the local entryIndexCache and getOrBuildIndex (lines 34-42) and import { getOrBuildIndex } from '../tools/list-packages.js' (or keep the search.ts cache separate if it needs independent clearing -- check if search.ts cache is cleared by clearEntryIndexCache. If NOT, keep search.ts cache independent to avoid behavior change).

**list-classes.ts**: Remove local entryIndexCache and getOrBuildIndex (lines 19-28). Import { getOrBuildIndex } from './list-packages.js'. Remove the unused `clearEntryIndexCache` import if getOrBuildIndex replaces its purpose. Keep `clearEntryIndexCache` import if it's still called somewhere in the file.

IMPORTANT: For each file, verify that removing type imports (JarCategory, DependencyEntry) is safe -- only remove if no other code in the file references them directly. The sorted/filtered patterns use DependencyEntry in their type annotations sometimes.

Use tab indentation consistently per project convention.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx vitest run 2>&1 | tail -20</automated>
  </verify>
  <done>All local duplicates removed. All files import from tool-helpers.ts or list-packages.ts. All tests pass. Zero behavior changes.</done>
</task>

</tasks>

<verification>
- `npx vitest run` passes all tests
- `grep -r 'const CATEGORY_PRIORITY' src/tools/ src/browsing/` returns only src/tools/tool-helpers.ts
- `grep -rn 'function sortByPriority' src/tools/ src/browsing/` returns only src/tools/tool-helpers.ts
- `grep -rn 'interface LocateFailure' src/tools/` returns only src/tools/tool-helpers.ts
- `grep -c 'normalizeLocations' src/tools/find-definition.ts src/tools/find-implementations.ts` shows import usage, not local definition
</verification>

<success_criteria>
- tool-helpers.ts is the single source of truth for CATEGORY_PRIORITY, sortByPriority, classNameToEntryPath, normalizeLocations, and LocateFailure
- No tool file contains a local copy of any of these utilities
- list-classes.ts shares the entryIndex cache from list-packages.ts
- All existing tests pass without modification
</success_criteria>

<output>
After completion, create `.planning/quick/260413-pin-trivial-dry-extractions-shared-tool-help/260413-pin-SUMMARY.md`
</output>
