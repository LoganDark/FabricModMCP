# Phase 15: Enable Method Search - Research

**Researched:** 2026-04-14
**Domain:** JDT LS configuration, workspace/symbol protocol, readiness probe removal
**Confidence:** HIGH

## Summary

Phase 15 is a surgical configuration and cleanup phase -- no new libraries, no new protocols, no new domain types. The entire phase consists of: (1) adding one JDT LS initialization setting, (2) removing the `waitForWorkspaceSync` function and its callers, and (3) updating a tool description string.

The existing codebase already handles method results correctly -- `KIND_NAME_TO_NUMBER` includes `method: 6` and `constructor: 9`, `SYMBOL_KIND_NAME` maps these to display names, and the transform logic in `search-symbols.ts` already reads `containerName` generically. Enabling `includeSourceMethodDeclarations` will cause JDT LS to return method results in the same `SymbolInformation` format already handled.

**Primary recommendation:** Make the three targeted changes (setting, probe removal, description update), update affected tests, and verify with existing test infrastructure. No architectural decisions needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Remove `waitForWorkspaceSync` entirely from `workspace-sync.ts` -- do not replace with a sentinel query
- JDT LS handles indexing internally; real queries will naturally wait or return partial results
- The existing probe was only a liveness check (checks "got an array back"), not a completeness guarantee
- Callers of `waitForWorkspaceSync` (study jar add/remove tools) should stop awaiting it
- This satisfies SRCH-02 by eliminating the explosion-prone `query: '*'` probe entirely
- Add `includeSourceMethodDeclarations: true` to JDT LS initialization settings at `client.ts` `initializationOptions.settings.java`
- No other JDT LS config changes needed -- this single setting unlocks method results in `workspace/symbol`
- No guardrails needed -- JDT LS has its own internal result cap, and `search_symbols` already has pagination
- No truncation warnings, no smart kind filtering, no default filters
- Be precise about what is findable: types (classes, interfaces, enums) and methods/constructors
- Explicitly note that fields are not searchable via workspace/symbol (no `includeSourceFieldDeclarations` setting exists)
- Remove "fields" from the current description which falsely lists them as searchable

### Claude's Discretion
- Exact wording of updated tool description
- Whether to update the server instructions workflow section mentioning search_symbols
- Any internal refactoring of workspace-sync.ts after removing the probe function

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-01 | search_symbols returns method results from JDT LS workspace/symbol | Adding `symbols.includeSourceMethodDeclarations: true` to init settings enables this. Existing code already handles SymbolKind 6 (Method) and 9 (Constructor). |
| SRCH-02 | Readiness probe query changed to avoid result explosion with method declarations enabled | Remove `waitForWorkspaceSync` entirely. Both `syncStudyJarToWorkspace` and `unsyncStudyJarFromWorkspace` call it -- remove those calls. |
| SRCH-04 | search_symbols tool description accurately documents it finds types and methods, not fields | Update `TOOL_DESCRIPTIONS.search_symbols` in `descriptions.ts`. Remove false "fields" claim. |
</phase_requirements>

## Standard Stack

No new libraries needed. This phase modifies configuration and removes code within the existing stack.

### Existing Stack (unchanged)
| Library | Version | Role in This Phase |
|---------|---------|-------------------|
| ts-lsp-client | 1.x | LSP client that sends `initialize` with the new setting |
| vitest | 3.x | Test runner for verifying changes |

No `npm install` needed.

## Architecture Patterns

### Change 1: JDT LS Initialization Setting

**File:** `src/jdtls/client.ts` lines 220-229
**Pattern:** Add `symbols` key to `initializationOptions.settings.java`:

```typescript
initializationOptions: {
	settings: {
		java: {
			autobuild: { enabled: true },
			symbols: {
				includeSourceMethodDeclarations: true,
			},
			import: {
				maven: { enabled: false },
				gradle: { enabled: false },
			},
		},
	},
},
```

**Source:** JDT LS `Preferences.java` -- the setting path is `java.symbols.includeSourceMethodDeclarations`. In the LSP `initializationOptions.settings` tree, this maps to `settings.java.symbols.includeSourceMethodDeclarations`. HIGH confidence -- verified by prior project research against JDT LS source and nvim-jdtls community.

### Change 2: Remove waitForWorkspaceSync

**Files affected:**
1. `src/jdtls/workspace-sync.ts` -- delete the `waitForWorkspaceSync` function (lines 74-101)
2. `src/jdtls/workspace-sync.ts` -- remove the `await waitForWorkspaceSync(...)` calls from `syncStudyJarToWorkspace` (line 143) and `unsyncStudyJarFromWorkspace` (line 183)
3. `src/jdtls/workspace-sync.ts` -- remove the `JSONRPCEndpoint` import if no longer needed after removal

**Callers outside workspace-sync.ts:** None. The study jar tools (`add-study-jar.ts`, `remove-study-jar.ts`) call `syncStudyJarToWorkspace` and `unsyncStudyJarFromWorkspace` respectively -- those higher-level functions are kept, just without the internal probe call.

**Pattern for sync/unsync after removal:** The functions still extract/remove files, update `.classpath`, and notify JDT LS via `workspace/didChangeWatchedFiles`. They just no longer block on a probe query. The functions become fire-and-notify -- JDT LS re-indexes asynchronously.

### Change 3: Tool Description Update

**File:** `src/tools/descriptions.ts` line 143-144

Current description falsely claims: "methods, fields, classes, constructors, etc."

Updated description should:
- State types (classes, interfaces, enums) and methods/constructors are searchable
- Explicitly state fields are NOT searchable via this tool (use `list_members` instead)
- Keep the existing guidance about filtering by kind and pagination

### Anti-Patterns to Avoid
- **Do NOT add a replacement probe query** -- the decision is to remove the probe entirely, not replace `*` with a sentinel
- **Do NOT add query length validation** -- no guardrails per user decision
- **Do NOT filter out method kinds from results** -- the whole point is to return them

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Method kind handling | Custom kind mapping | Existing `KIND_NAME_TO_NUMBER` and `SYMBOL_KIND_NAME` | Already maps method (6) and constructor (9) correctly |
| Method containerName | Custom container resolution | JDT LS `containerName` field | Already populated by JDT LS, already read by search-symbols.ts line 99 |

## Common Pitfalls

### Pitfall 1: Setting Placement in Init Options
**What goes wrong:** Placing `includeSourceMethodDeclarations` at the wrong nesting level (e.g., directly under `java` instead of under `java.symbols`) causes JDT LS to silently ignore it.
**Why it happens:** The setting path `java.symbols.includeSourceMethodDeclarations` must be decomposed into the nested object `settings.java.symbols.includeSourceMethodDeclarations`.
**How to avoid:** Follow the exact nesting shown in Architecture Patterns above. Verify by checking that method-kind results appear after startup.
**Warning signs:** search_symbols still only returns class-kind results after the change.

### Pitfall 2: Dangling Export of waitForWorkspaceSync
**What goes wrong:** Removing the function body but forgetting to remove the export from the module, causing TypeScript compilation to succeed but tests to reference a non-existent function.
**Why it happens:** The function is exported and imported by the test file `tests/jdtls/workspace-sync.test.ts`.
**How to avoid:** Remove the function, update the test file to remove tests for `waitForWorkspaceSync`, and remove the import.

### Pitfall 3: Test Assertions Still Expecting Probe Call
**What goes wrong:** `tests/jdtls/workspace-sync.test.ts` line 235 asserts `endpoint.send` was called with `{ query: '*' }` (the probe). After removal, this assertion fails.
**Why it happens:** The test for `syncStudyJarToWorkspace` explicitly checks the probe was called.
**How to avoid:** Remove or update the assertion. The sync test should verify extraction, classpath write, and notification -- but NOT the probe call.

### Pitfall 4: search_symbols Kind Filter Still Lists 'field'
**What goes wrong:** The Zod schema in `search-symbols.ts` line 29 includes `'field'` in the `kind` enum. After updating the description to say fields are not searchable, users might still pass `kind: 'field'` and get zero results silently.
**Why it happens:** The schema allows it but JDT LS never returns field-kind results from workspace/symbol.
**How to avoid:** This is a known limitation documented in REQUIREMENTS.md "Out of Scope" table. The kind enum can stay (it does not cause errors, just empty results). The tool description should make this clear. Optionally, the `kind` enum could drop `'field'` and `'property'` but this is Claude's discretion and not required.

### Pitfall 5: Forgetting the JSONRPCEndpoint Import
**What goes wrong:** After removing `waitForWorkspaceSync`, the `JSONRPCEndpoint` type import at line 18 of `workspace-sync.ts` may become unused if no remaining function uses it directly.
**Why it happens:** `waitForWorkspaceSync` was the only function with `JSONRPCEndpoint` as a parameter type.
**How to avoid:** Check if `JSONRPCEndpoint` is still used elsewhere in the file. If `syncStudyJarToWorkspace` and `unsyncStudyJarFromWorkspace` access `jdtls.endpoint` (typed as `JSONRPCEndpoint` via the `JdtLsSession` type), the direct import may not be needed. Remove if unused.

## Code Examples

### JDT LS Init Settings (the one-line change)
```typescript
// Source: src/jdtls/client.ts -- add 'symbols' block
initializationOptions: {
	settings: {
		java: {
			autobuild: { enabled: true },
			symbols: {
				includeSourceMethodDeclarations: true,
			},
			import: {
				maven: { enabled: false },
				gradle: { enabled: false },
			},
		},
	},
},
```

### syncStudyJarToWorkspace After Probe Removal
```typescript
// Source: src/jdtls/workspace-sync.ts -- syncStudyJarToWorkspace simplified
try {
	const dirName = await extractStudyJarToWorkspace(studyJar, jdtls.tempDir, jarReader);
	jdtls.jarIdToDirName.set('study:' + studyJar.name, dirName);

	const allDirs = Array.from(jdtls.jarIdToDirName.values());
	const classpathXml = generateClasspathFile(allDirs);
	const resolvedTempDir = realpathSync(jdtls.tempDir);
	await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);

	jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
		changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
	});

	// No probe -- JDT LS re-indexes asynchronously
	return { synced: true };
} catch (err) {
	// ... error handling unchanged
}
```

### Expected Method Result Shape from workspace/symbol
```typescript
// What JDT LS returns for methods after enabling the setting:
{
	name: "tick",
	kind: 6,                    // SymbolKind.Method
	tags: [],
	location: {
		uri: "file:///tmp/jdtls/minecraft/net/minecraft/client/MinecraftClient.java",
		range: { start: { line: 120, character: 14 }, end: { line: 120, character: 18 } },
	},
	containerName: "net.minecraft.client.MinecraftClient",
}
// This is already handled by search-symbols.ts transform logic -- no code changes needed there.
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test -- --reporter=dot` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | Method results returned with SymbolKind Method/Constructor | unit | `pnpm test -- tests/tools/search-symbols.test.ts -t "method" -x` | Existing -- already has method fixtures in SAMPLE_SYMBOLS |
| SRCH-02 | Probe removed; sync/unsync no longer call workspace/symbol | unit | `pnpm test -- tests/jdtls/workspace-sync.test.ts -x` | Existing -- tests need updating (remove probe assertions) |
| SRCH-04 | Tool description mentions types and methods, not fields | unit | `pnpm test -- tests/tools/search-symbols.test.ts -x` | Existing -- description tested indirectly via tool registration |

### Sampling Rate
- **Per task commit:** `pnpm test -- tests/tools/search-symbols.test.ts tests/jdtls/workspace-sync.test.ts tests/jdtls/client.test.ts -x`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/jdtls/workspace-sync.test.ts` -- remove `waitForWorkspaceSync` describe block, update `syncStudyJarToWorkspace` test to NOT assert probe call
- [ ] `tests/tools/search-symbols.test.ts` -- existing SAMPLE_SYMBOLS already includes methods (kind 6); existing test "filters by kind" already verifies method filtering works. Tests may need a new case verifying `containerName` is present on method results (it already is, but explicit assertion helps).

*(No new test files or framework installs needed -- existing infrastructure covers all requirements)*

## Sources

### Primary (HIGH confidence)
- `src/jdtls/client.ts` -- current initialization options structure (direct code inspection)
- `src/jdtls/workspace-sync.ts` -- current `waitForWorkspaceSync` implementation (direct code inspection)
- `src/tools/search-symbols.ts` -- current kind handling and transform logic (direct code inspection)
- `src/tools/descriptions.ts` -- current tool description text (direct code inspection)
- `.planning/research/STACK.md` -- prior research confirming `java.symbols.includeSourceMethodDeclarations` path and behavior
- `.planning/research/PITFALLS.md` -- prior research documenting explosion risk and setting placement
- `.planning/research/ARCHITECTURE.md` -- prior research with exact code patterns for the changes

### Secondary (MEDIUM confidence)
- [nvim-jdtls Discussion #676](https://github.com/mfussenegger/nvim-jdtls/discussions/676) -- community confirmation of method-only scope
- [JDT LS Preferences.java](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/preferences/Preferences.java) -- authoritative source for available settings

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, only config changes to existing stack
- Architecture: HIGH -- exact code locations identified, patterns confirmed by prior research and direct code inspection
- Pitfalls: HIGH -- all pitfalls verified by reading current code and test files

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- no external dependencies changing)
