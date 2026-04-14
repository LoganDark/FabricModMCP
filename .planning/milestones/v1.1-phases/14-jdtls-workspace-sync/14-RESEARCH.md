# Phase 14: JDT LS Workspace Sync - Research

**Researched:** 2026-04-14
**Domain:** JDT LS incremental workspace updates, LSP classpath management, source extraction
**Confidence:** MEDIUM

## Summary

Phase 14 adds incremental JDT LS workspace sync when study jars are added or removed. The core challenge is: after extracting study jar sources to disk and updating the `.classpath` file, how to notify JDT LS of the change and block until it has re-indexed.

The existing codebase already has all the building blocks: `extractSourcesToTemp` for source extraction, `generateClasspathFile` for `.classpath` generation, `jarIdToDirName` for directory naming, `waitForReady` for readiness detection, and `endpoint.notify()` for sending LSP notifications. The new work is: (1) an incremental extraction function for a single study jar, (2) `.classpath` regeneration with updated source dirs, (3) `workspace/didChangeWatchedFiles` notification to trigger JDT LS reload, and (4) a readiness detection strategy for incremental updates (since `ServiceReady` may only fire at initial startup).

**Primary recommendation:** Use the file-based approach -- write updated `.classpath` to disk, then send `workspace/didChangeWatchedFiles` notification via `endpoint.notify()`. This leverages JDT LS's built-in `EclipseBuildSupport.fileChanged()` which refreshes and reapplies the classpath. Detect readiness via a short post-notification delay plus a probe request (e.g., `workspace/symbol` query), since `ServiceReady` is not guaranteed to fire after incremental changes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Tool response text only mentions workspace sync on failure -- success messages stay clean, add a warning line if sync failed
- If workspace sync fails but jar was added successfully (handle registered, entry index working, browsing works), return success with a warning -- jar is usable for browsing, just no semantic nav
- `remove_study_jar` response mentions that semantic navigation results have been updated
- `list_study_jars` shows a `workspaceSynced` field per study jar
- `add_study_jar` blocks until JDT LS has fully indexed new sources before returning -- agents call tools back-to-back with no sense of time, so immediate availability is required
- Same 120s timeout as initial workspace load
- `remove_study_jar` also blocks until JDT LS acknowledges the classpath change
- When JDT LS is unavailable, `add_study_jar` always warns -- "Note: JDT LS unavailable -- semantic navigation disabled" (every add, not just the first)
- `list_study_jars` always shows `workspaceSynced` per jar, even when JDT LS is globally unavailable (all show false)
- If JDT LS crashes mid-session, sync attempts fail gracefully with warning -- same as any sync failure, no auto-restart
- `remove_study_jar` does not warn about JDT LS unavailability -- only relevant on add

### Claude's Discretion
- Extraction implementation (reuse `extractSourcesToTemp` pattern or factor out incremental extraction)
- How to notify JDT LS of classpath changes (didChangeWatchedFiles, didChangeConfiguration, or custom notification)
- Whether to regenerate full .classpath or patch it incrementally
- How to detect JDT LS readiness after incremental update (reuse waitForReady or different signal)
- File cleanup strategy on removal (immediate delete vs deferred)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LSP-01 | Study jars are extracted to JDT LS workspace and included in classpath | Extraction reuses `jarIdToDirName` + `createJarAdapter` pattern; `.classpath` regenerated with all current source dirs; `workspace/didChangeWatchedFiles` triggers JDT LS reimport |
| LSP-02 | JDT LS workspace updates incrementally when study jars are added or removed | File-based `.classpath` update + `didChangeWatchedFiles` notification; no full project reload needed; `EclipseBuildSupport.fileChanged()` handles classpath refresh internally |
</phase_requirements>

## Architecture Patterns

### Recommended Approach: File-Based Classpath Update

**What:** Write updated `.classpath` to the existing temp directory, then notify JDT LS via `workspace/didChangeWatchedFiles` LSP notification.

**Why this over command-based:** JDT LS's `java.project.addToSourcePath` is designed for "invisible project" scenarios (standalone Java files) and has restrictions on Maven/Gradle projects. The file-based approach via `workspace/didChangeWatchedFiles` maps directly to how JDT LS handles Eclipse project classpath changes internally -- `EclipseBuildSupport.fileChanged()` detects `.classpath` in its `isBuildFile()` check, then does a refresh-and-reapply of the full classpath. This is the most reliable and well-tested path.

**How it works:**
1. Extract study jar sources to `{tempDir}/{dirName}/` (same pattern as initial extraction)
2. Collect all current source directories from `jdtls.jarIdToDirName` map
3. Regenerate `.classpath` file via existing `generateClasspathFile()` (already exported)
4. Write `.classpath` to disk
5. Send `workspace/didChangeWatchedFiles` notification with `.classpath` URI and `Changed` type
6. Wait for JDT LS to finish rebuilding

**Confidence:** MEDIUM -- The `EclipseBuildSupport` handling of `.classpath` changes is verified from JDT LS source code. The `didChangeWatchedFiles` notification path is the standard LSP mechanism. The uncertainty is in readiness detection after incremental updates.

### Pattern 1: Incremental Source Extraction

**What:** Extract a single study jar's sources into the existing temp directory, rather than re-extracting everything.

**When to use:** On `add_study_jar` -- extract only the new jar's sources.

```typescript
// Follows existing extractSourcesToTemp pattern but for a single jar
async function extractStudyJarToWorkspace(
	studyJar: StudyJar,
	tempDir: string,
	jarReader: JarReader,
): Promise<string> {
	const dirName = jarIdToDirName(`study:${studyJar.name}`);
	const depDir = join(tempDir, dirName);

	const adapter = createJarAdapter(jarReader, studyJar.jarPath);
	const entries = await adapter.listJavaEntries();

	for (const entryPath of entries) {
		const targetPath = join(depDir, entryPath);
		await mkdir(dirname(targetPath), { recursive: true });
		const content = await adapter.readEntry(entryPath);
		await writeFile(targetPath, content);
	}

	return dirName;
}
```

### Pattern 2: Classpath Notification via didChangeWatchedFiles

**What:** Send the standard LSP `workspace/didChangeWatchedFiles` notification to tell JDT LS that `.classpath` has changed.

```typescript
// endpoint.notify() is available on JSONRPCEndpoint from ts-lsp-client
endpoint.notify('workspace/didChangeWatchedFiles', {
	changes: [{
		uri: `file://${resolvedTempDir}/.classpath`,
		type: 2, // FileChangeType.Changed (1=Created, 2=Changed, 3=Deleted)
	}],
});
```

**Confidence:** HIGH -- `endpoint.notify()` is confirmed available in ts-lsp-client. JDT LS's `JDTLanguageServer.didChangeWatchedFiles()` delegates to `WorkspaceEventsHandler` which processes the event queue. `.classpath` is recognized as a build file by `EclipseBuildSupport`.

### Pattern 3: Readiness Detection After Incremental Update

**What:** Detect when JDT LS has finished processing the classpath change.

**Challenge:** The `ServiceReady` / `Started` notification from `language/status` fires during initial startup. It is NOT guaranteed to fire again after incremental classpath changes. The codebase's existing `waitForReady()` may not work for incremental updates.

**Recommended approach: Probe-based readiness detection.**

After sending the `didChangeWatchedFiles` notification:
1. Wait a brief initial delay (500ms) to let the event queue process
2. Send a `workspace/symbol` request with a known class name from the newly added jar
3. If the result contains the expected symbol, the workspace is ready
4. If not, retry with exponential backoff up to the 120s timeout
5. For removal, probe with a class that should no longer appear

This is more reliable than listening for a notification that may not come.

**Alternative approach: Build job polling via language/progressReport.**

Listen for `language/progressReport` notifications. JDT LS sends progress reports during builds. Wait until no new progress reports arrive for a threshold period. This is less deterministic and harder to implement correctly.

**Recommendation:** Use probe-based approach. It is deterministic, testable, and works for both add and remove cases.

### Pattern 4: Workspace Synced Tracking

**What:** Track which study jars have been successfully synced to JDT LS workspace.

```typescript
// In JdtLsSession, jarIdToDirName already tracks extracted jars
// A study jar is "workspace synced" if its dir name is in jarIdToDirName
// and the extraction + classpath update succeeded

function isWorkspaceSynced(studyJar: StudyJar, jdtls: JdtLsSession): boolean {
	const dirName = jarIdToDirName(`study:${studyJar.name}`);
	return jdtls.jarIdToDirName.has(`study:${studyJar.name}`);
}
```

### Anti-Patterns to Avoid

- **Restarting JDT LS on every jar add/remove:** Defeats the purpose of incremental updates. JDT LS startup takes 10-30s.
- **Using `java.project.addToSourcePath`:** This command is intended for "invisible project" source paths, not Eclipse project `.classpath` source entries. It may not work correctly for our project structure.
- **Waiting for `ServiceReady` after incremental changes:** This notification may never come, causing a 120s timeout on every add.
- **Extracting all jars on every add:** The initial extraction can take seconds for large projects. Only extract the new jar.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Source extraction | Custom file reading | `createJarAdapter()` from source-adapter.ts | Already handles jar entry listing and reading |
| Directory naming | Custom sanitization | `jarIdToDirName()` from uri-mapper.ts | Handles colon-to-underscore conversion consistently |
| Classpath XML generation | XML template strings | `generateClasspathFile()` from workspace.ts | Already generates correct Eclipse .classpath format |
| Temp dir path resolution | `path.resolve()` | `realpathSync()` | macOS /tmp -> /private/var symlink resolution (already done in uri-mapper.ts) |

**Key insight:** Nearly all building blocks exist. The phase is primarily integration/orchestration work, not new infrastructure.

## Common Pitfalls

### Pitfall 1: macOS /tmp Symlink Resolution

**What goes wrong:** File URIs use `/tmp/mcp-jdtls-xxx/` but JDT LS resolves to `/private/var/folders/.../` (or vice versa), causing URI mismatches.
**Why it happens:** macOS `/tmp` is a symlink to `/private/tmp`. `realpathSync()` resolves this, but if you forget to resolve the `.classpath` URI sent in `didChangeWatchedFiles`, JDT LS may not match it.
**How to avoid:** Always use the same resolved temp dir path that `createUriMapper` uses. The existing `uri-mapper.ts` already calls `realpathSync(tempDir)` -- use the same resolved path.
**Warning signs:** didChangeWatchedFiles notification sent but JDT LS doesn't react.

### Pitfall 2: Race Condition Between Write and Notify

**What goes wrong:** The `didChangeWatchedFiles` notification arrives before the `.classpath` file write is fully flushed to disk.
**Why it happens:** `writeFile` returns when the write is buffered, not necessarily flushed. JDT LS reads the file in response to the notification.
**How to avoid:** Await `writeFile` fully before sending the notification. Node.js `writeFile` from `fs/promises` does await completion, so this should be fine as long as you don't fire-and-forget.
**Warning signs:** JDT LS reads stale `.classpath` content.

### Pitfall 3: Forgetting to Update jarIdToDirName Map

**What goes wrong:** Sources are extracted and JDT LS indexes them, but `fromFileUri()` in `uri-mapper.ts` cannot map file URIs back to jar IDs because the jarIdToDirName map is stale.
**Why it happens:** The `createUriMapper` builds a reverse map at construction time. If jarIdToDirName is updated after the mapper is created, the mapper won't see the new entries.
**How to avoid:** Update `jdtls.jarIdToDirName` BEFORE any navigation tool creates a new UriMapper. The UriMapper is created per-request (in find-definition.ts etc.), so updating the map on the JdtLsSession is sufficient.
**Warning signs:** find_definition works for original deps but returns null for study jar classes.

### Pitfall 4: Cleanup on Removal Leaving Stale Directories

**What goes wrong:** Study jar directory remains on disk after removal, potentially confusing JDT LS.
**Why it happens:** `.classpath` is updated to remove the source entry, but the directory and its .java files still exist in the temp dir.
**How to avoid:** Delete the extracted directory (`rm -rf`) before updating `.classpath`. Order: (1) delete extracted dir, (2) update jarIdToDirName map, (3) regenerate and write `.classpath`, (4) notify JDT LS.
**Warning signs:** JDT LS may still find symbols in the deleted jar's classes.

### Pitfall 5: Notification Sent When JDT LS Is Unavailable

**What goes wrong:** Calling `endpoint.notify()` on a null/undefined endpoint when JDT LS failed to start.
**Why it happens:** `jdtls.endpoint` is only present when `jdtls.available === true`.
**How to avoid:** Guard all JDT LS interactions with `jdtls.available` check. On add, return success with warning. On remove, skip sync silently.
**Warning signs:** Crash on property access of undefined.

## Code Examples

### Full Add Flow (Pseudocode)

```typescript
// In add-study-jar.ts, after createStudyJar + jarReader.addProjectJar:

async function syncStudyJarToWorkspace(
	studyJar: StudyJar,
	project: LoadedProject,
	jarReader: JarReader,
): Promise<{ synced: boolean; warning?: string }> {
	const jdtls = project.jdtls;
	if (!jdtls?.available || !jdtls.endpoint) {
		return { synced: false, warning: 'Note: JDT LS unavailable -- semantic navigation disabled' };
	}

	try {
		// 1. Extract sources
		const dirName = await extractStudyJarToWorkspace(studyJar, jdtls.tempDir, jarReader);

		// 2. Update jarIdToDirName
		jdtls.jarIdToDirName.set(`study:${studyJar.name}`, dirName);

		// 3. Regenerate .classpath
		const allDirs = Array.from(jdtls.jarIdToDirName.values());
		const classpathXml = generateClasspathFile(allDirs);
		const resolvedTempDir = realpathSync(jdtls.tempDir);
		await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);

		// 4. Notify JDT LS
		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: `file://${resolvedTempDir}/.classpath`, type: 2 }],
		});

		// 5. Wait for readiness (probe-based)
		await waitForWorkspaceSync(jdtls, studyJar, 120_000);

		return { synced: true };
	} catch (err) {
		// Rollback jarIdToDirName on failure
		jdtls.jarIdToDirName.delete(`study:${studyJar.name}`);
		return { synced: false, warning: `Workspace sync failed: ${err instanceof Error ? err.message : String(err)}` };
	}
}
```

### Sending didChangeWatchedFiles Notification

```typescript
// Source: ts-lsp-client JSONRPCEndpoint.notify() method
// FileChangeType enum: 1=Created, 2=Changed, 3=Deleted
endpoint.notify('workspace/didChangeWatchedFiles', {
	changes: [
		{ uri: `file://${resolvedTempDir}/.classpath`, type: 2 },
	],
});
```

### Probe-Based Readiness Detection

```typescript
async function waitForWorkspaceSync(
	jdtls: JdtLsSession,
	studyJar: StudyJar,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let delay = 500;

	// Pick a class name from the study jar to probe for
	// (caller should pass a known class name)
	while (Date.now() < deadline) {
		await new Promise(r => setTimeout(r, delay));

		try {
			// workspace/symbol is a lightweight probe
			const result = await jdtls.endpoint!.send('workspace/symbol', {
				query: 'SomeKnownClassFromJar',
			});
			if (Array.isArray(result) && result.length > 0) {
				return; // Workspace has indexed the new sources
			}
		} catch {
			// JDT LS may be busy, retry
		}

		delay = Math.min(delay * 1.5, 5000);
	}

	throw new Error(`JDT LS did not index study jar within ${timeoutMs}ms`);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full re-extraction on any change | Incremental extraction per jar | This phase | Avoids re-extracting all deps when adding one study jar |
| `ServiceReady` for all readiness | Probe-based for incremental | This phase | Reliable detection of incremental update completion |

## Open Questions

1. **Does `ServiceReady` fire after incremental classpath changes?**
   - What we know: It fires during initial startup. JDT LS source shows it's tied to `InitHandler` completing.
   - What's unclear: Whether `EclipseBuildSupport.fileChanged()` triggers a `ServiceReady` notification after classpath refresh.
   - Recommendation: Implement probe-based readiness as primary strategy. If empirical testing shows `ServiceReady` does fire, the existing `waitForReady` can be reused as a simpler alternative. Keep probe-based as fallback.

2. **Does JDT LS also need didChangeWatchedFiles for new .java files?**
   - What we know: JDT LS watches for file changes in source directories. The `didChangeWatchedFiles` for `.classpath` triggers a full classpath refresh.
   - What's unclear: Whether the classpath refresh also causes JDT LS to scan for new files in newly added source dirs, or whether each new `.java` file needs its own notification.
   - Recommendation: Start with just `.classpath` notification. The classpath refresh should cause JDT LS to discover new source dirs and their contents. If empirical testing shows otherwise, add bulk file change notifications for extracted `.java` files.

3. **How long does incremental re-indexing take?**
   - What we know: Full initial indexing for ~6,600 Minecraft files takes up to 120s. A single study jar is likely much smaller (10s-1000s of files).
   - What's unclear: Exact timing for incremental updates.
   - Recommendation: Keep 120s timeout as per user decision. In practice, expect 2-15s for typical study jars.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/jdtls/workspace.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LSP-01 | Study jar extracted to workspace temp dir | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "extracts study jar"` | Wave 0 |
| LSP-01 | .classpath includes study jar source dir | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "classpath"` | Wave 0 |
| LSP-01 | jarIdToDirName updated after extraction | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "jarIdToDirName"` | Wave 0 |
| LSP-02 | add_study_jar triggers workspace sync | integration | `npx vitest run tests/tools/add-study-jar.test.ts -t "workspace sync"` | Wave 0 |
| LSP-02 | remove_study_jar removes extracted dir and updates classpath | integration | `npx vitest run tests/tools/remove-study-jar.test.ts -t "workspace"` | Wave 0 |
| LSP-02 | list_study_jars shows workspaceSynced field | integration | `npx vitest run tests/tools/list-study-jars.test.ts -t "workspaceSynced"` | Wave 0 |
| LSP-02 | Sync failure returns success with warning | unit | `npx vitest run tests/jdtls/workspace-sync.test.ts -t "failure warning"` | Wave 0 |
| LSP-02 | JDT LS unavailable returns warning on add | integration | `npx vitest run tests/tools/add-study-jar.test.ts -t "JDT LS unavailable"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/jdtls/workspace-sync.test.ts tests/tools/add-study-jar.test.ts tests/tools/remove-study-jar.test.ts tests/tools/list-study-jars.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/jdtls/workspace-sync.test.ts` -- covers LSP-01, LSP-02 (unit tests for extraction, classpath, notification)
- [ ] Updates to `tests/tools/add-study-jar.test.ts` -- integration tests with mocked JDT LS
- [ ] Updates to `tests/tools/remove-study-jar.test.ts` -- integration tests for workspace cleanup
- [ ] Updates to `tests/tools/list-study-jars.test.ts` -- workspaceSynced field tests

## Sources

### Primary (HIGH confidence)
- `src/jdtls/workspace.ts` -- existing extraction and classpath generation (read directly)
- `src/jdtls/client.ts` -- JDT LS lifecycle and waitForReady pattern (read directly)
- `src/jdtls/types.ts` -- JdtLsSession interface (read directly)
- `src/jdtls/uri-mapper.ts` -- URI mapping and jarIdToDirName (read directly)
- `src/tools/add-study-jar.ts`, `remove-study-jar.ts`, `list-study-jars.ts` -- current tool implementations (read directly)
- `src/tools/find-definition.ts` -- how UriMapper is created per-request (read directly)
- ts-lsp-client `endpoint.notify()` method -- confirmed via node_modules source inspection

### Secondary (MEDIUM confidence)
- [EclipseBuildSupport.java](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/master/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/managers/EclipseBuildSupport.java) -- `.classpath` recognized as build file, refresh-and-reapply pattern
- [JDTLanguageServer.java didChangeWatchedFiles](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/master/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/JDTLanguageServer.java) -- delegates to WorkspaceEventsHandler
- [JDT LS issue #3155](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/3155) -- classpath change revalidation behavior with autobuild
- [JDT LS discussion #3191](https://github.com/eclipse-jdtls/eclipse.jdt.ls/discussions/3191) -- .classpath + .project for Eclipse project recognition
- [JDT LS LSP Extensions Wiki](https://github.com/eclipse-jdtls/eclipse.jdt.ls/wiki/Language-Server-Protocol-Extensions) -- language/status notification

### Tertiary (LOW confidence)
- ServiceReady behavior after incremental changes -- not verified, flagged for empirical validation
- `workspace/symbol` probe reliability for readiness detection -- reasonable assumption, needs testing
- Whether `.classpath` notification alone triggers full source dir scan -- needs empirical validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: MEDIUM -- file-based classpath update approach is well-supported by JDT LS source code, but readiness detection after incremental changes needs empirical validation
- Pitfalls: HIGH -- identified from direct code reading and macOS-specific experience in the codebase

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable domain, JDT LS behavior unlikely to change)
