---
phase: quick
plan: 260415-txd
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/search-symbols.ts
  - tests/tools/search-symbols.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "search_symbols returns entryPath (e.g. 'net/minecraft/client/MinecraftClient.java') in location.uri when jar mapping succeeds"
    - "search_symbols falls back to raw file:// URI when jar mapping fails"
  artifacts:
    - path: "src/tools/search-symbols.ts"
      provides: "Fixed URI mapping in search results"
      contains: "mapping?.entryPath"
    - path: "tests/tools/search-symbols.test.ts"
      provides: "Test verifying entryPath is used in location.uri"
  key_links:
    - from: "src/tools/search-symbols.ts"
      to: "src/jdtls/uri-mapper.ts"
      via: "uriMapper.fromFileUri() -> mapping.entryPath"
      pattern: "mapping\\?\\.entryPath"
---

<objective>
Fix search_symbols to use entryPath from URI mapper instead of raw file:// URI in location.uri field.

Purpose: Currently search_symbols returns raw file:///private/var/... URIs in results, while find-definition/find-references/find-implementations use processNavigationLocations which correctly maps to entryPath. This makes search_symbols results inconsistent and exposes internal temp directory paths.
Output: One-line fix in search-symbols.ts, one new test assertion.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/tools/search-symbols.ts
@src/tools/tool-helpers.ts (processNavigationLocations for reference pattern)
@src/jdtls/uri-mapper.ts
@tests/tools/search-symbols.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add test assertion for entryPath in location.uri, then fix search-symbols.ts</name>
  <files>tests/tools/search-symbols.test.ts, src/tools/search-symbols.ts</files>
  <behavior>
    - Test: When jar mapping succeeds, location.uri should be the entryPath (e.g. "net/minecraft/client/MinecraftClient.java"), not the raw file:// URI
    - Test: location.jar should still be populated (existing assertion at line 141)
  </behavior>
  <action>
RED: In tests/tools/search-symbols.test.ts, add an assertion to the existing "returns symbol results with name, kind, containerName, location" test (after the existing `first.location.jar` check around line 141):
```
expect(first.location.uri).toBe('net/minecraft/client/MinecraftClient.java');
```
Run tests -- this should FAIL because location.uri currently returns the raw file:// URI.

GREEN: In src/tools/search-symbols.ts line 109, change:
```
uri: sym.location.uri,
```
to:
```
uri: mapping?.entryPath ?? sym.location.uri,
```
This matches how processNavigationLocations in tool-helpers.ts uses mapping.entryPath (line 311) for navigation results. When the URI mapper recognizes the file:// URI as belonging to a known jar, it returns the entryPath (e.g. "net/minecraft/client/MinecraftClient.java"). When mapping fails (unknown URI), it falls back to the raw URI.

Run tests -- should now PASS.
  </action>
  <verify>
    <automated>cd /Users/LoganDark/Documents/Projects/FabricModMCP && pnpm test -- --run tests/tools/search-symbols.test.ts</automated>
  </verify>
  <done>location.uri in search_symbols results contains the entryPath when jar mapping succeeds, matching the behavior of find-definition/find-references/find-implementations. All existing tests still pass.</done>
</task>

</tasks>

<verification>
Run full test suite: `pnpm test -- --run`
Confirm no regressions across all tool tests.
</verification>

<success_criteria>
- search_symbols returns entryPath in location.uri when jar mapping succeeds
- Fallback to raw URI when mapping returns null
- All existing tests pass, new assertion validates the fix
</success_criteria>

<output>
After completion, create `.planning/quick/260415-txd-fix-search-symbols-to-use-entrypath-from/260415-txd-SUMMARY.md`
</output>
