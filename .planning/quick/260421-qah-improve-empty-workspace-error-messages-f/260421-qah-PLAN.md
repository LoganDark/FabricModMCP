---
phase: quick-260421-qah
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/tool-helpers.ts
  - src/state/project-store.ts
  - src/tools/list-packages.ts
  - src/tools/list-classes.ts
  - src/tools/search-classes.ts
  - src/tools/read-source.ts
  - src/tools/locate-in-source.ts
  - src/tools/list-members.ts
  - src/tools/read-member.ts
  - src/tools/find-definition.ts
  - src/tools/find-references.ts
  - src/tools/find-implementations.ts
  - src/tools/get-symbol-info.ts
  - src/tools/get-member-info.ts
  - src/tools/search-symbols.ts
  - src/tools/type-hierarchy.ts
  - src/tools/resolve-symbol-position.ts
  - tests/tools/list-packages.test.ts
autonomous: true
must_haves:
  truths:
    - "When no projects are loaded, all browsing tools return a clear error explaining the MCP server has no state and guiding to create_project + add_fabric_mod/add_study_jar"
    - "When a project exists but has no children (no fabric mods or study jars), browsing tools return a clear error explaining the workspace is empty and guiding to add_fabric_mod or add_study_jar"
    - "Management tools (create_project, add_fabric_mod, add_study_jar, get_project_info, list_projects, etc.) are NOT affected by this change"
  artifacts:
    - path: src/tools/tool-helpers.ts
      provides: "requireDependencies helper that checks for empty workspace"
    - path: src/state/project-store.ts
      provides: "Improved NO_PROJECTS_LOADED error message"
  key_links:
    - from: "browsing tools (list_packages, read_source, etc.)"
      to: "tool-helpers.ts requireDependencies"
      via: "early return after resolveProjectSafely"
      pattern: "requireDependencies"
---

<objective>
Improve error messages when tools are called on an empty workspace (no fabric mod or study jar loaded). Currently, browsing tools give unhelpful "not found" or "0 results" responses when the workspace is empty, which confuses LLMs — especially in resumed conversations where the MCP server has restarted with no state.

Purpose: LLMs calling tools on an empty workspace should receive explicit guidance to add a fabric mod or study jar, not generic "class not found" errors that trigger investigation loops.
Output: Updated tool-helpers.ts with a new empty-workspace check, updated project-store.ts with better NO_PROJECTS_LOADED message, and all browsing tools updated to use the check.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/tools/tool-helpers.ts
@src/state/project-store.ts
@src/errors/domain-error.ts
@src/types/envelope.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add empty-workspace detection helper and improve NO_PROJECTS_LOADED message</name>
  <files>src/tools/tool-helpers.ts, src/state/project-store.ts</files>
  <action>
In `src/state/project-store.ts`, update the `NO_PROJECTS_LOADED` DomainError (line ~101) to have a more descriptive message and better suggestions for LLMs:
- Message: `'No projects are loaded. The MCP server may have restarted — all state is in-memory and must be re-created each session.'`
- Suggestions: `['Use create_project to create a project, then add_fabric_mod to register a Fabric mod directory, or add_study_jar to load an arbitrary jar for analysis']`

In `src/tools/tool-helpers.ts`, add a new exported function `requireDependencies` that checks whether a resolved project has any browseable content. It should:
1. Accept `(project: Project, scope?: string)` parameters
2. Check if the project has any children at all (`project.children.size === 0`). If so, return an error result using `returnError` with:
   - code: `'EMPTY_WORKSPACE'`
   - message: `"Project '{project.name}' has no fabric mods or study jars loaded. Add content before browsing."`
   - tried: `[]`
   - suggestions: `['Use add_fabric_mod to register a Fabric mod directory (provides Minecraft sources + dependencies)', 'Use add_study_jar to load any jar file for source browsing']`
3. If scope is specified, check that the specific child exists (already handled by getDependenciesForTool, so skip this).
4. If children exist, check if `getDependenciesForTool(project, undefined, scope)` returns an empty map AND no children have `available` dependencies. If so, return a similar error with code `'NO_SOURCES_AVAILABLE'` and message explaining that no source jars are available.
5. If there are dependencies, return `null` (no error).

The function signature should be:
```typescript
export function requireDependencies(project: Project, scope?: string): ReturnType<typeof returnError> | null
```

This keeps the pattern consistent with `resolveProjectSafely` — tools check the result and early-return the error if non-null.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>project-store.ts has improved NO_PROJECTS_LOADED message. tool-helpers.ts exports requireDependencies that returns a clear EMPTY_WORKSPACE error when project has no children.</done>
</task>

<task type="auto">
  <name>Task 2: Add requireDependencies checks to all browsing tools</name>
  <files>src/tools/list-packages.ts, src/tools/list-classes.ts, src/tools/search-classes.ts, src/tools/read-source.ts, src/tools/locate-in-source.ts, src/tools/list-members.ts, src/tools/read-member.ts, src/tools/find-definition.ts, src/tools/find-references.ts, src/tools/find-implementations.ts, src/tools/get-symbol-info.ts, src/tools/get-member-info.ts, src/tools/search-symbols.ts, src/tools/type-hierarchy.ts</files>
  <action>
In each of the following browsing tools, add a `requireDependencies` check immediately after the `resolveProjectSafely` check succeeds. The pattern is:

```typescript
const resolved = resolveProjectSafely(project);
if (!resolved.ok) return resolved.error;
const loadedProject = resolved.project;

// ADD THIS:
const depCheck = requireDependencies(loadedProject, scope);
if (depCheck) return depCheck;
```

Import `requireDependencies` from `./tool-helpers.js` in each file (add to the existing import from tool-helpers).

Tools to update (all tools that browse jar content):
1. `list-packages.ts` — has `scope` param, use it
2. `list-classes.ts` — has `scope` param, use it
3. `search-classes.ts` — has `scope` param, use it
4. `read-source.ts` — has `scope` param, use it. Place the check BEFORE the inner class handling and line-range validation.
5. `locate-in-source.ts` — has `scope` param, use it
6. `list-members.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
7. `read-member.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
8. `find-definition.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
9. `find-references.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
10. `find-implementations.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
11. `get-symbol-info.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
12. `get-member-info.ts` — has `scope` param, use it
13. `search-symbols.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.
14. `type-hierarchy.ts` — has `scope` param, use it. Place BEFORE the JDT LS availability check.

Do NOT add this check to management tools: `create-project.ts`, `add-fabric-mod.ts`, `add-study-jar.ts`, `get-project-info.ts`, `list-projects.ts`, `list-study-jars.ts`, `remove-project.ts`, `remove-project-member.ts`, `refresh-project.ts`, `refresh-project-members.ts`, `set-active-project.ts`, `set-active-child.ts`, `configure-filters.ts`, `configure-study-jar.ts`, `read-jar-entry.ts`.

For tools that don't have `scope` in their input schema, pass `undefined` as the scope parameter.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx tsc --noEmit 2>&1 | head -30 && pnpm test 2>&1 | tail -30</automated>
  </verify>
  <done>All 14 browsing tools have requireDependencies check after resolveProjectSafely. TypeScript compiles cleanly. Existing tests pass (tests may need minor updates if they test empty-project scenarios — if so, update them to expect the new EMPTY_WORKSPACE error code).</done>
</task>

<task type="auto">
  <name>Task 3: Add test for empty workspace error path</name>
  <files>tests/tools/list-packages.test.ts</files>
  <action>
Add a test case to `tests/tools/list-packages.test.ts` (or the most appropriate existing test file) that verifies the empty workspace error path. The test should:

1. Create a project with no children (use the test helpers/fixtures already in the test file)
2. Call `list_packages` on it
3. Assert the response contains error code `'EMPTY_WORKSPACE'`
4. Assert the suggestions mention `add_fabric_mod` and `add_study_jar`

Look at the existing test patterns in that file to match the style. If the test file uses the MCP server test harness, use the same approach. If it directly calls functions, match that pattern.

Also verify that the existing tests still pass — if any existing test was relying on the old "0 results" behavior from an empty project, update it to expect the new EMPTY_WORKSPACE error.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && pnpm test 2>&1 | tail -40</automated>
  </verify>
  <done>Test exists that verifies EMPTY_WORKSPACE error is returned for a project with no children. All tests pass.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` — no type errors
2. `pnpm test` — all tests pass including new empty workspace test
3. Manual check: the EMPTY_WORKSPACE error message clearly tells the LLM what to do next
</verification>

<success_criteria>
- When any browsing tool is called with no projects loaded, the error message explicitly mentions the MCP server may have restarted and guides to create_project + add_fabric_mod
- When any browsing tool is called on a project with no children, the error is EMPTY_WORKSPACE with suggestions to add_fabric_mod or add_study_jar
- Management tools are unaffected
- All existing tests pass
- New test validates the empty workspace error path
</success_criteria>

<output>
After completion, create `.planning/quick/260421-qah-improve-empty-workspace-error-messages-f/260421-qah-SUMMARY.md`
</output>
