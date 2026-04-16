---
phase: quick
plan: 260413-obn
type: execute
wave: 1
depends_on: []
files_modified:
  - src/browsing/types.ts
  - src/browsing/class-parser.ts
  - src/browsing/search.ts
  - src/tools/list-classes.ts
  - src/tools/search-classes.ts
  - src/tools/type-hierarchy.ts
  - tests/browsing/class-parser.test.ts
  - tests/browsing/search.test.ts
  - tests/tools/list-classes.test.ts
  - tests/tools/search-classes.test.ts
  - tests/tools/type-hierarchy.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "ClassReference type exists with name, fqn, kind fields"
    - "ClassInfo type extends ClassReference with access, modifiers, jars, optional innerClasses"
    - "Old types ClassEntry, ClassMetadata, InnerClassEntry, SearchClassResult, HierarchyEntry are removed"
    - "All tools compile and return data using new type shapes"
    - "All tests pass with updated assertions"
  artifacts:
    - path: "src/browsing/types.ts"
      provides: "ClassReference, ClassInfo, InnerClassInfo types"
      contains: "ClassReference"
    - path: "src/browsing/class-parser.ts"
      provides: "parseClassDeclaration returning kind instead of type"
    - path: "src/browsing/search.ts"
      provides: "searchClasses returning ClassInfo[] via SearchResponse"
    - path: "src/tools/type-hierarchy.ts"
      provides: "type_hierarchy using ClassReference instead of HierarchyEntry"
  key_links:
    - from: "src/browsing/class-parser.ts"
      to: "src/browsing/types.ts"
      via: "imports ClassReference or related types"
      pattern: "import.*types"
    - from: "src/tools/list-classes.ts"
      to: "src/browsing/types.ts"
      via: "imports ClassInfo, InnerClassInfo"
      pattern: "import.*ClassInfo"
---

<objective>
Refactor class data types to use a consistent two-tier model: ClassReference (lightweight pointer) and ClassInfo (full details). Remove ClassEntry, ClassMetadata, InnerClassEntry, SearchClassResult, and HierarchyEntry. Update all consuming tools and tests.

Purpose: Unify the scattered class type representations into a clean, consistent hierarchy that all tools share.
Output: Updated types, source files, tools, and passing tests.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/browsing/types.ts
@src/browsing/class-parser.ts
@src/browsing/search.ts
@src/tools/list-classes.ts
@src/tools/search-classes.ts
@src/tools/type-hierarchy.ts
@src/jdtls/symbol-kind.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Define new types and update class-parser return type</name>
  <files>src/browsing/types.ts, src/browsing/class-parser.ts</files>
  <action>
  In `src/browsing/types.ts`:
  1. Remove: `ClassMetadata`, `ClassEntry`, `InnerClassEntry`
  2. Add `ClassReference`:
     ```
     export interface ClassReference {
       name: string;      // simple name
       fqn: string;       // fully qualified name
       kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
     }
     ```
  3. Add `InnerClassInfo` extending ClassReference pattern:
     ```
     export interface InnerClassInfo {
       name: string;      // dollar-separated: "MinecraftClient$Options"
       fqn: string;       // "net.minecraft.client.MinecraftClient$Options"
       kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
       access: string;    // "public" | "protected" | "private" | "package-private"
       modifiers: string[];
     }
     ```
  4. Add `ClassInfo`:
     ```
     export interface ClassInfo {
       name: string;
       fqn: string;
       kind: string;
       access: string;
       modifiers: string[];
       jars: Array<{ id: string; category: JarCategory }>;
       innerClasses?: InnerClassInfo[];
     }
     ```
     Import `JarCategory` from `../project/types.js`.
  5. Keep `PackageEntry` unchanged.

  In `src/browsing/class-parser.ts`:
  - Change return type from `ClassMetadata & { name: string } | null` to `{ name: string; kind: string; access: string; modifiers: string[] } | null`
  - Rename the captured `type` field to `kind` in the return object: `return { access, modifiers, kind: type, name };`
  - Remove the `ClassMetadata` import since it no longer exists.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsc --noEmit src/browsing/types.ts src/browsing/class-parser.ts 2>&1 | head -20</automated>
  </verify>
  <done>New types ClassReference, ClassInfo, InnerClassInfo exported from types.ts. Old types ClassMetadata, ClassEntry, InnerClassEntry removed. class-parser returns `kind` instead of `type`.</done>
</task>

<task type="auto">
  <name>Task 2: Update all tools and search module to use new types</name>
  <files>src/browsing/search.ts, src/tools/list-classes.ts, src/tools/search-classes.ts, src/tools/type-hierarchy.ts</files>
  <action>
  **search.ts:**
  1. Remove `SearchClassResult` interface entirely.
  2. Update `SearchResponse` to use `ClassInfo[]` from types.ts: `results: ClassInfo[]`
  3. Import `ClassInfo` from `./types.js` (and `JarCategory` is already imported from project/types).
  4. In the internal `resultMap`, rename the `type` field to `kind` throughout.
  5. When `parseClassDeclaration` returns, use `parsed.kind` (not `parsed.type`) since class-parser now returns `kind`.
  6. Add `modifiers: string[]` to the internal accumulator (set from `parsed.modifiers` or `[]`).
  7. In the final `sliced.map()`, produce `ClassInfo`-shaped objects:
     - `name`: derive from FQN (substring after last `.`)
     - `fqn`, `kind`, `access`, `modifiers`, `jars` -- all present
     - NO `innerClasses` (omitted for search results per spec)

  **list-classes.ts:**
  1. Remove imports of `ClassEntry`, `ClassMetadata`, `InnerClassEntry` from types.ts.
  2. Import `ClassInfo`, `InnerClassInfo` from `../browsing/types.js`.
  3. Update `readClassMetadata` to return `{ kind: string; access: string; modifiers: string[] } | null` -- rename `type` to `kind` from parsed result.
  4. Change `mergedClasses` from `Map<string, ClassEntry>` to `Map<string, ClassInfo>`.
  5. Update object construction -- flatten metadata fields into ClassInfo directly:
     - `kind: metadata?.kind ?? 'unknown'`
     - `access: metadata?.access ?? 'unknown'`
     - `modifiers: metadata?.modifiers ?? []`
     - `jars: [{ id, category: dep.category }]` (use `{id, category}` objects, not plain strings)
  6. Update inner class construction to use `InnerClassInfo`:
     - `name`, `fqn`, `kind`, `access`, `modifiers` -- all flattened from metadata
  7. Update merge logic: `jars` is now `Array<{id, category}>`, check with `.some(j => j.id === id)` and push `{id, category: dep.category}`.
  8. Remove the unused `clearEntryIndexCache` import if no longer needed.

  **search-classes.ts:**
  No code changes needed -- it delegates to `searchClasses()` and passes through the response. The type change in SearchResponse flows through automatically.

  **type-hierarchy.ts:**
  1. Remove the local `HierarchyEntry` interface.
  2. Import `ClassReference` from `../browsing/types.js`.
  3. Replace `HierarchyEntry` with `ClassReference` in extends/implements/subtypes arrays.
  4. Simplify `toHierarchyEntry` to return `ClassReference`:
     - `name: item.name`
     - `fqn: item.detail ? \`${item.detail}.${item.name}\` : item.name` (was `qualifiedName`)
     - `kind`: normalize from LSP SymbolKind -- `SYMBOL_KIND_NAME[item.kind]?.toLowerCase() ?? 'unknown'`. Note: SYMBOL_KIND_NAME already returns lowercase for "class", "interface", "enum" -- verify values match. The existing map has lowercase values like 'class', 'interface', 'enum' so `.toLowerCase()` is just a safety net.
  5. Remove `jar` and `provenance` fields from the returned objects.
  6. Update result envelope: `extends`, `implements`, `subtypes` now contain `ClassReference[]`.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>All source files compile with new types. SearchClassResult and HierarchyEntry removed. Tools produce ClassInfo/ClassReference shaped output.</done>
</task>

<task type="auto">
  <name>Task 3: Update all test assertions to match new type shapes</name>
  <files>tests/browsing/class-parser.test.ts, tests/browsing/search.test.ts, tests/tools/list-classes.test.ts, tests/tools/search-classes.test.ts, tests/tools/type-hierarchy.test.ts</files>
  <action>
  **class-parser.test.ts:**
  - All `toEqual` assertions: rename `type:` to `kind:` in expected objects.
  - E.g., `{ access: 'public', modifiers: [], type: 'class', name: 'Foo' }` becomes `{ access: 'public', modifiers: [], kind: 'class', name: 'Foo' }`
  - Update all occurrences (there are ~10 assertions using `type`).

  **search.test.ts:**
  - `r.type` references become `r.kind` throughout (in `.map(r => r.type)`, `.every(r => r.type ===`, etc.).
  - Add `r.name` assertions if desired (search results now include `name`).
  - Add `r.modifiers` spot checks if desired.
  - The `jars` shape is already `Array<{id, category}>` in search results -- no change needed there.

  **list-classes.test.ts:**
  - `mc.metadata.access` becomes `mc.access`
  - `mc.metadata.type` becomes `mc.kind`
  - `mc.metadata.modifiers` becomes `mc.modifiers`
  - `server.metadata.access` becomes `server.access`
  - `server.metadata.modifiers` becomes `server.modifiers`
  - `server.metadata.type` becomes `server.kind`
  - `opts.metadata.type` becomes `opts.kind`
  - `mc.jars` was `string[]` (e.g., `['minecraft']`), now `Array<{id, category}>` -- update assertions:
    - `expect(mc.jars).toContain('minecraft')` becomes `expect(mc.jars).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'minecraft' })]))` or similar.
    - `expect(id.jars).toEqual(['minecraft'])` becomes `expect(id.jars).toEqual([{ id: 'minecraft', category: 'minecraft' }])`.
  - Inner class assertions: `ic.metadata.type` becomes `ic.kind`.

  **search-classes.test.ts:**
  - `match.type` becomes `match.kind` in assertions.
  - `match.access` stays the same.
  - `match.jars` shape is already `Array<{id, category}>` -- no change needed.

  **type-hierarchy.test.ts:**
  - `entry.qualifiedName` becomes `entry.fqn` throughout.
  - Remove assertions on `entry.jar` and `entry.provenance` (these fields no longer exist on ClassReference).
  - `entry.kind` remains (already present) but values are now lowercase. The existing mock data uses SymbolKind numbers (5=class, 11=interface), and the SYMBOL_KIND_NAME map already returns lowercase strings ('class', 'interface'), so `entry.kind` assertions like `'interface'` remain correct.
  - Specifically remove/update:
    - `expect(envelope.data.extends[0].provenance).toBe('java')` -- remove
    - `expect(envelope.data.extends[0].jar).toBeNull()` -- remove
    - `expect(envelope.data.extends[0].qualifiedName).toBe(...)` -- change to `.fqn`
    - `expect(envelope.data.implements[0].qualifiedName).toBe(...)` -- change to `.fqn`
    - `expect(envelope.data.subtypes[0].qualifiedName).toBe(...)` -- change to `.fqn`
    - `expect(envelope.data.subtypes[0].jar).toBe('minecraft')` -- remove
    - `expect(envelope.data.extends[0].provenance).toBe('java')` in JDK test -- remove
    - `expect(envelope.data.extends[0].jar).toBeNull()` in JDK test -- remove
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx vitest run tests/browsing/class-parser.test.ts tests/browsing/search.test.ts tests/tools/list-classes.test.ts tests/tools/search-classes.test.ts tests/tools/type-hierarchy.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>All 5 test files pass. Assertions use `kind` not `type`, `fqn` not `qualifiedName`, flattened fields not nested `metadata`, and `{id, category}` jar objects. No references to removed types remain.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` -- full project compiles with zero errors
2. `npx vitest run` -- all tests pass (not just the 5 updated files)
3. `grep -r 'ClassEntry\|ClassMetadata\|InnerClassEntry\|SearchClassResult\|HierarchyEntry' src/ tests/` -- returns no matches (old types fully removed)
</verification>

<success_criteria>
- ClassReference and ClassInfo types defined and exported from types.ts
- ClassEntry, ClassMetadata, InnerClassEntry, SearchClassResult, HierarchyEntry types fully removed
- class-parser returns `kind` field instead of `type`
- list_classes returns ClassInfo[] with flattened fields and {id, category} jars
- search_classes returns ClassInfo[] (without innerClasses) with flattened fields
- type_hierarchy returns ClassReference[] (name, fqn, kind only) in extends/implements/subtypes
- All tests pass with zero type errors
</success_criteria>

<output>
After completion, create `.planning/quick/260413-obn-refactor-class-data-types-create-classre/260413-obn-SUMMARY.md`
</output>
