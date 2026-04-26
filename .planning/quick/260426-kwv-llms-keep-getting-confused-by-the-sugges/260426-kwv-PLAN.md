---
phase: quick-260426-kwv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/refresh-project.ts
  - src/tools/refresh-project-members.ts
  - src/tools/read-jar-entry.ts
autonomous: true
requirements:
  - QUICK-260426-KWV-01
must_haves:
  truths:
    - "MCP responses no longer suggest running ./gradlew downloadSources for missing dependency source jars"
    - "Minecraft genSources suggestion in SOURCES_JAR_NOT_FOUND remains intact and unchanged"
    - "Minecraft genSources warning in loader.ts (line 93) remains intact and unchanged"
    - "Existing test asserting on the genSources suggestion still passes"
    - "All other tests still pass (no regression)"
  artifacts:
    - path: "src/tools/refresh-project.ts"
      provides: "refresh_project tool without dependency-download suggestion"
      not_contains: "downloadSources"
    - path: "src/tools/refresh-project-members.ts"
      provides: "refresh_project_members tool without dependency-download suggestion"
      not_contains: "downloadSources"
    - path: "src/tools/read-jar-entry.ts"
      provides: "JAR_NO_SOURCES error without download suggestion"
      not_contains: "downloadSources"
  key_links:
    - from: "src/project/loader.ts"
      to: "SOURCES_JAR_NOT_FOUND error"
      via: "DomainError suggestions[]"
      pattern: "Run \\./gradlew genSources"
      note: "MUST remain — this is the keep-it suggestion"
---

<objective>
Remove every "download sources for dependencies" suggestion string from MCP tool responses. LLM clients (Claude Code) keep getting confused by these suggestions and trying to run `./gradlew downloadSources` unnecessarily. The Minecraft `genSources` suggestion in `src/project/loader.ts` (SOURCES_JAR_NOT_FOUND error and the related warning) is useful and MUST be preserved exactly as-is.

Purpose: Reduce LLM confusion / spurious gradle invocations.
Output: Three tool files with the dependency download suggestions removed; Minecraft genSources suggestion untouched; tests still passing.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/types/envelope.ts
@src/tools/refresh-project.ts
@src/tools/refresh-project-members.ts
@src/tools/read-jar-entry.ts
@src/project/loader.ts

<interfaces>
<!-- Suggestion sites already located. Do not re-search; act on these exact lines. -->

REMOVE — src/tools/refresh-project.ts (lines 132-137):
```typescript
const suggestions: string[] = [];
if (totalSummary.withoutSources > 0) {
    suggestions.push(
        `${totalSummary.withoutSources} dependencies are missing source jars. Run ./gradlew downloadSources in the project directory to download them, then refresh again.`,
    );
}
```
…and the `suggestions,` field in the makeSuccess envelope at line 143.

REMOVE — src/tools/refresh-project-members.ts (lines 170-175):
```typescript
const suggestions: string[] = [];
if (totalSummary.withoutSources > 0) {
    suggestions.push(
        `${totalSummary.withoutSources} dependencies are missing source jars. Run ./gradlew downloadSources in the project directory to download them, then refresh again.`,
    );
}
```
…and the `suggestions,` field in the makeSuccess envelope at line 181.

EDIT — src/tools/read-jar-entry.ts (lines 97-103) JAR_NO_SOURCES error:
```typescript
return returnError(
    'JAR_NO_SOURCES',
    `Source jar for '${jar}' is not available`,
    [jar],
    ['Run ./gradlew downloadSources in the project directory, then use refresh_project'],
);
```
The 4th argument (suggestions array) must be removed entirely (returnError accepts `suggestions?: string[]`, so just drop the argument).

KEEP UNTOUCHED — src/project/loader.ts:
- Line 93: `warnings.push('New sources jar not found. Run ./gradlew genSources, then refresh again.');`
- Lines 174-181: SOURCES_JAR_NOT_FOUND DomainError including suggestions `'Run ./gradlew genSources in your project directory'` and the loom-cache hint.

KEEP UNTOUCHED — descriptions.ts mentions of `downloadSources` in tool descriptions (lines 98, 241, 244). These are documentation explaining when to use refresh tools, not LLM-confusing suggestion strings in error/response envelopes. User explicitly scoped removal to "suggestions" (envelope field), not docs.

KEEP UNTOUCHED — `'The dependency does not have a sources jar'` strings in tool-helpers.ts, source-adapter.ts, locate-in-source.ts. These are descriptive (state of affairs), not action suggestions to download.

Tests asserting on removed strings: NONE found. Searched tests/ for `downloadSources`, `JAR_NO_SOURCES`, and the specific message text — no matches. The only `genSources` test assertion (`tests/project/loader.test.ts:62` and `tests/project/reload-config.test.ts:226`) covers the KEEP-intact Minecraft suggestion and must continue to pass.

`returnError` signature (from src/tools/tool-helpers.ts:178):
```typescript
export function returnError(code: string, message: string, tried: string[], suggestions?: string[])
```
`suggestions` is optional — safely droppable.

Response envelope behavior: `makeSuccess` accepts arbitrary structured data; dropping the `suggestions` field from the object passed to it is safe (no required schema).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove dependency-download suggestion from refresh_project and refresh_project_members</name>
  <files>src/tools/refresh-project.ts, src/tools/refresh-project-members.ts</files>
  <action>
In BOTH files, delete the `suggestions` block and the `suggestions,` field from the `makeSuccess` payload.

src/tools/refresh-project.ts:
1. Delete lines 132-137 (the `const suggestions: string[] = [];` declaration and the `if (totalSummary.withoutSources > 0) { suggestions.push(...) }` block).
2. In the `makeSuccess({ ... })` call (around lines 139-146), remove the `suggestions,` line.
3. Verify no other references to the local `suggestions` variable remain in the file.

src/tools/refresh-project-members.ts:
1. Delete lines 170-175 (same pattern).
2. In the `makeSuccess({ ... })` call (around lines 177-184), remove the `suggestions,` line.
3. Verify no other references to the local `suggestions` variable remain in the file.

Use tab indentation (per CLAUDE.md). Do NOT modify any other code. Do NOT touch the `warnings` or `autoUnloaded` fields.
  </action>
  <verify>
    <automated>pnpm exec tsc --noEmit && pnpm test -- tests/tools/refresh-project.test.ts tests/tools/refresh-project-members.test.ts</automated>
  </verify>
  <done>
Both files no longer contain "downloadSources" or the "dependencies are missing source jars" string. TypeScript compiles. refresh-project and refresh-project-members tests pass. Response envelopes for these tools no longer include a `suggestions` field.
  </done>
</task>

<task type="auto">
  <name>Task 2: Remove download suggestion from read_jar_entry JAR_NO_SOURCES error</name>
  <files>src/tools/read-jar-entry.ts</files>
  <action>
In src/tools/read-jar-entry.ts at lines 98-103, the JAR_NO_SOURCES `returnError(...)` call passes a 4th argument `['Run ./gradlew downloadSources in the project directory, then use refresh_project']`. Remove that 4th argument entirely so the call becomes:

```typescript
return returnError(
    'JAR_NO_SOURCES',
    `Source jar for '${jar}' is not available`,
    [jar],
);
```

`returnError`'s `suggestions` parameter is optional, so omitting it is correct (do NOT pass `[]` or `undefined` explicitly — just drop the argument).

Use tab indentation. Do NOT modify the JAR_ENTRY_NOT_FOUND error block above it (which contains a different, valid suggestion about checking the file path) or any other code in the file.
  </action>
  <verify>
    <automated>pnpm exec tsc --noEmit && pnpm test</automated>
  </verify>
  <done>
read-jar-entry.ts no longer contains "downloadSources". TypeScript compiles. Full test suite passes — including the loader.test.ts assertion on the KEPT `'Run ./gradlew genSources in your project directory'` Minecraft suggestion (must still pass unchanged) and the reload-config.test.ts assertion on the KEPT `'Run ./gradlew genSources'` warning. Final grep `rg "downloadSources" src/tools/refresh-project.ts src/tools/refresh-project-members.ts src/tools/read-jar-entry.ts` returns zero matches.
  </done>
</task>

</tasks>

<verification>
After both tasks:

1. **Removed suggestions absent:** `rg "downloadSources" src/tools/` returns zero hits in `refresh-project.ts`, `refresh-project-members.ts`, `read-jar-entry.ts`. (Hits in `descriptions.ts` are expected and intentional — those are docs, not suggestion strings.)

2. **Minecraft genSources suggestion preserved:**
   - `rg "Run \./gradlew genSources" src/project/loader.ts` still finds line 93 (warning) and line 179 (suggestion).
   - `tests/project/loader.test.ts` assertion `expect(domainError.suggestions).toContain('Run ./gradlew genSources in your project directory')` still passes.
   - `tests/project/reload-config.test.ts` assertion `expect.stringContaining('Run ./gradlew genSources')` still passes.

3. **No regressions:** `pnpm test` passes in full.

4. **Type-clean:** `pnpm exec tsc --noEmit` reports no errors.
</verification>

<success_criteria>
- [ ] No "downloadSources" suggestion appears in any MCP tool response envelope (refresh_project, refresh_project_members, read_jar_entry).
- [ ] Minecraft `genSources` suggestion in SOURCES_JAR_NOT_FOUND error and loader warning remain byte-for-byte identical.
- [ ] `pnpm test` passes.
- [ ] `pnpm exec tsc --noEmit` passes.
- [ ] No tests required updating (verified during planning — none assert on removed strings).
</success_criteria>

<output>
After completion, create `.planning/quick/260426-kwv-llms-keep-getting-confused-by-the-sugges/260426-kwv-SUMMARY.md` summarizing:
- Files changed and lines removed
- Confirmation that genSources suggestion is preserved
- Test results
</output>
