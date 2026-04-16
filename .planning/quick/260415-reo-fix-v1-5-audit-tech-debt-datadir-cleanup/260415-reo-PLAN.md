---
phase: quick
plan: 260415-reo
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/remove-project.ts
  - src/tools/tool-helpers.ts
  - src/tools/descriptions.ts
autonomous: true
requirements: ["REMOVE_PROJECT_DATADIR", "STALE_IMPORT", "DESCRIPTION_UNDERSTATEMENT"]
must_haves:
  truths:
    - "remove_project cleans up both tempDir and dataDir on interactive removal"
    - "tool-helpers.ts has no unused imports"
    - "refresh_project_members description mentions build.gradle.kts re-parsing"
  artifacts:
    - path: "src/tools/remove-project.ts"
      provides: "dataDir cleanup alongside tempDir cleanup"
      contains: "cleanupTempDir(proj.jdtls.dataDir)"
    - path: "src/tools/tool-helpers.ts"
      provides: "clean imports"
    - path: "src/tools/descriptions.ts"
      provides: "accurate refresh_project_members description"
      contains: "build.gradle.kts"
  key_links:
    - from: "src/tools/remove-project.ts"
      to: "cleanupTempDir"
      via: "already imported from ../jdtls/workspace.js"
      pattern: "cleanupTempDir\\(proj\\.jdtls\\.dataDir\\)"
---

<objective>
Fix three tech debt items from the v1.5 milestone audit.

Purpose: Close low-severity integration gap (dataDir leak on interactive remove_project) and clean up stale import and understated description found during audit.
Output: Three files patched with trivial one-liner fixes.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/v1.5-MILESTONE-AUDIT.md
@src/tools/remove-project.ts
@src/tools/tool-helpers.ts
@src/tools/descriptions.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix three v1.5 audit tech debt items</name>
  <files>src/tools/remove-project.ts, src/tools/tool-helpers.ts, src/tools/descriptions.ts</files>
  <action>
Three independent one-liner fixes:

1. **src/tools/remove-project.ts** (dataDir cleanup): After the existing `cleanupTempDir(proj.jdtls.tempDir)` block (lines 44-49), add a parallel block for dataDir:
```typescript
if (proj.jdtls?.dataDir) {
	try {
		await cleanupTempDir(proj.jdtls.dataDir);
	} catch (err) {
		logger.warn(`Data dir cleanup error for ${project}: ${err}`);
	}
}
```
This mirrors the tempDir cleanup pattern exactly. `cleanupTempDir` is already imported. Place it immediately after the tempDir cleanup block (after line 50).

2. **src/tools/tool-helpers.ts** (stale import): On line 26, change:
```typescript
import { getResolvedDependencies, getAllDependencies } from '../project/dependency-resolver.js';
```
to:
```typescript
import { getAllDependencies } from '../project/dependency-resolver.js';
```
`getResolvedDependencies` is unused after the Phase 32 per-child filtering refactor.

3. **src/tools/descriptions.ts** (description understatement): On line 229, the `refresh_project_members` description says "Re-parses gradle.properties and fabric.mod.json for each specified member." Update to:
```
'Re-scan specific fabric mod members for dependency source jars. Re-parses gradle.properties, build.gradle.kts, and fabric.mod.json for each specified member. ...'
```
This matches the actual behavior (build file re-parsing was added in Phase 33) and aligns with the `refresh_project` description which already mentions build.gradle.kts.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && npx vitest run --reporter=verbose 2>&1 | tail -5</automated>
  </verify>
  <done>
- remove-project.ts cleans dataDir after tempDir (grep confirms cleanupTempDir called twice)
- tool-helpers.ts no longer imports getResolvedDependencies
- descriptions.ts refresh_project_members mentions build.gradle.kts
- All existing tests pass
  </done>
</task>

</tasks>

<verification>
- `grep -c "cleanupTempDir" src/tools/remove-project.ts` returns 2 (tempDir + dataDir)
- `grep "getResolvedDependencies" src/tools/tool-helpers.ts` returns nothing
- `grep "build.gradle.kts" src/tools/descriptions.ts` matches in refresh_project_members description
- `npx vitest run` passes all 696+ tests
</verification>

<success_criteria>
All three audit tech debt items resolved. Tests green. No behavioral regressions.
</success_criteria>

<output>
After completion, create `.planning/quick/260415-reo-fix-v1-5-audit-tech-debt-datadir-cleanup/260415-reo-SUMMARY.md`
</output>
