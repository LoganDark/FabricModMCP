# Phase 26: JDT LS Workspace Unification - Research

**Researched:** 2026-04-15
**Domain:** JDT LS process lifecycle, LSP workspace management, incremental source extraction
**Confidence:** HIGH

## Summary

Phase 26 wires the existing but uncalled JDT LS infrastructure (`extractSourcesToTemp`, `startJdtLs`, `generateClasspathFile`) into the project lifecycle. Currently, `extractSourcesToTemp` and `startJdtLs` exist as fully implemented functions but are never invoked from any tool -- they are dead code awaiting this phase. The workspace-sync pattern for study jars (`syncStudyJarToWorkspace`, `unsyncStudyJarFromWorkspace`) is already proven and serves as the template for fabric mod sync.

The key architectural decision is per-child isolated extraction: each fabric mod's dependencies get namespaced directories (e.g., `my-mod--minecraft`) even if two children depend on the same artifact at the same version. This avoids version collision entirely. The `jarIdToDirName()` function already handles the namespace separator (`/` -> `--`) and Maven coordinate separator (`:` -> `__`), so namespaced jar IDs like `my-mod/minecraft` already produce correct directory names (`my-mod--minecraft`).

JDT LS starts eagerly in `create_project`, and each `add_fabric_mod` incrementally syncs the new child's sources. The remove and refresh paths need corresponding workspace cleanup/resync. Navigation tools already read from `project.jdtls` and require no changes if the session structure stays the same.

**Primary recommendation:** Follow the study jar sync pattern exactly -- extract per-child, update `jarIdToDirName`, regenerate `.classpath`, notify JDT LS via `workspace/didChangeWatchedFiles`. Build a `syncFabricModToWorkspace` function parallel to `syncStudyJarToWorkspace`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Per-child isolated extraction directories -- each child's dependencies get namespaced directories (e.g., `mymod--minecraft`, `othermod--minecraft`)
- Even if two children depend on the same artifact at the same version, they get separate extracted directories
- Trade-off accepted: some disk duplication for simplicity and correctness
- Start JDT LS eagerly on project creation (inside `create_project`)
- Navigation tools do NOT need a lazy "not ready yet" path -- JDT LS is always available if the project exists
- If Java 21 or JDT LS binary is unavailable, graceful degradation (`jdtls.available = false`)
- Always incremental sync -- add new child's sources to existing workspace without full re-extract or restart
- Follow the study jar sync pattern: extract to tempDir, regenerate `.classpath`, notify JDT LS via `workspace/didChangeWatchedFiles`
- Removing a child: delete its extracted directories, regenerate `.classpath`, notify JDT LS
- No full workspace rebuild needed

### Claude's Discretion
- Whether `jarIdToDirName` map needs restructuring to track per-child ownership or if namespace prefixes in directory names are sufficient
- Exact directory naming scheme -- follow existing `jarIdToDirName()` conventions
- Whether to extract on `create_project` (empty workspace) and then incrementally add on `add_fabric_mod`, or batch the first child's extraction into the startup sequence
- Error handling for JDT LS process crashes mid-session

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LSP-01 | One JDT LS workspace per project covers all children's sources | `create_project` starts JDT LS eagerly; `add_fabric_mod`/`add_study_jar` incrementally sync; single tempDir + single `.classpath` covers all |
| LSP-02 | Cross-mod navigation works (find-definition from one mod's source into another mod's dependencies) | All children's sources extracted to same tempDir, all dirs listed in single `.classpath`, JDT LS indexes everything as one project -- cross-references resolve naturally |
</phase_requirements>

## Standard Stack

No new dependencies needed. All required infrastructure exists in the codebase.

### Core (existing, no changes)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| ts-lsp-client | 1.1.x | LSP client for JDT LS communication | Already in use |
| node-stream-zip | 1.15.x | Reading .java from source jars | Already in use |

### Key Internal Modules
| Module | Purpose | Changes Needed |
|--------|---------|----------------|
| `src/jdtls/client.ts` | `detectJava()`, `findJdtLs()`, `startJdtLs()`, `shutdownJdtLs()` | None -- use as-is |
| `src/jdtls/workspace.ts` | `extractSourcesToTemp()`, `generateClasspathFile()`, `cleanupTempDir()` | May refactor `extractSourcesToTemp` or build parallel per-child extraction |
| `src/jdtls/workspace-sync.ts` | `syncStudyJarToWorkspace()`, `unsyncStudyJarFromWorkspace()` | Add parallel `syncFabricModToWorkspace()`, `unsyncFabricModFromWorkspace()` |
| `src/jdtls/uri-mapper.ts` | `jarIdToDirName()`, `dirNameToJarId()`, `createUriMapper()` | No changes -- already handles namespaced IDs (`my-mod/minecraft` -> `my-mod--minecraft`) |
| `src/jdtls/types.ts` | `JdtLsSession` type | No changes needed |

## Architecture Patterns

### Current State (Phase 25 complete)

```
create_project  -->  creates Project with no jdtls field
add_fabric_mod  -->  adds child, registers jar handles, logs "deferred to Phase 26"
add_study_jar   -->  adds child, calls syncStudyJarToWorkspace (already works!)
remove_project  -->  calls shutdownJdtLs + cleanupTempDir (defensive, works even with no session)
remove_member   -->  inline JDT LS cleanup for fabric mods (deletes dirs, regenerates .classpath)
```

### Target State (Phase 26 complete)

```
create_project  -->  creates Project, starts JDT LS eagerly, stores session on project.jdtls
add_fabric_mod  -->  adds child, extracts child's deps to workspace, updates .classpath, notifies
add_study_jar   -->  (unchanged -- already works)
remove_project  -->  (unchanged -- already works)
remove_member   -->  (already handles workspace cleanup -- verify it works with real sessions)
refresh_*       -->  re-extract changed deps, update .classpath, notify
```

### Pattern 1: Eager JDT LS Startup in create_project

**What:** On `create_project`, detect Java, find JDT LS, create tempDir, start JDT LS process, store session.
**When to use:** Every project creation.
**Key insight:** The workspace starts empty (no children yet). JDT LS is fine with an empty classpath -- it just has nothing to index until the first `add_fabric_mod` or `add_study_jar`.

```typescript
// In create_project, after creating the Project object:
const java = detectJava();
const jdtlsFind = findJdtLs();

if (java.javaPath && jdtlsFind.jdtlsHome) {
	const tempDir = join(tmpdir(), 'mcp-jdtls-' + randomUUID());
	await mkdir(tempDir, { recursive: true });
	await writeFile(join(tempDir, '.project'), generateProjectFile());
	await writeFile(join(tempDir, '.classpath'), generateClasspathFile([]));

	const { process: proc, client, endpoint, dataDir } = await startJdtLs(
		java.javaPath, jdtlsFind.jdtlsHome, tempDir
	);

	project.jdtls = {
		available: true,
		tempDir,
		dataDir,
		jarIdToDirName: new Map(),
		client,
		endpoint,
		process: proc,
	};
} else {
	project.jdtls = {
		available: false,
		failureReason: java.javaPath ? jdtlsFind.error : java.error,
		tempDir: '',
		dataDir: '',
		jarIdToDirName: new Map(),
	};
}
```

### Pattern 2: Fabric Mod Workspace Sync (parallel to study jar sync)

**What:** Extract a fabric mod's dependencies into the JDT LS workspace.
**Template:** `syncStudyJarToWorkspace` in `workspace-sync.ts`.

```typescript
export async function syncFabricModToWorkspace(
	fabricMod: FabricModChild,
	jdtls: JdtLsSession | undefined,
	jarReader: JarReader,
): Promise<{ synced: boolean; warning?: string }> {
	if (!jdtls?.available || !jdtls.endpoint) {
		return { synced: false, warning: 'JDT LS unavailable' };
	}

	// Extract each dependency under its namespaced dir name
	for (const [, dep] of fabricMod.dependencyJars) {
		if (!dep.available) continue;
		const dirName = jarIdToDirName(dep.id);
		// ... extract .java files to join(jdtls.tempDir, dirName) ...
		jdtls.jarIdToDirName.set(dep.id, dirName);
	}

	// Also extract mod's own source
	if (fabricMod.sourcesJar.exists) {
		const dirName = jarIdToDirName(fabricMod.name);
		// ... extract from sourcesJar ...
		jdtls.jarIdToDirName.set(fabricMod.name, dirName);
	}

	// Regenerate .classpath with ALL dirs
	const allDirs = Array.from(jdtls.jarIdToDirName.values());
	await writeFile(join(resolvedTempDir, '.classpath'), generateClasspathFile(allDirs));

	// Notify JDT LS
	jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
		changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
	});

	return { synced: true };
}
```

### Pattern 3: Unsync on Member Removal

**What:** `remove_project_member` already has inline JDT LS cleanup for fabric mods (lines 64-108).
**Key insight:** This code already works structurally -- it deletes dirs, removes from `jarIdToDirName`, regenerates `.classpath`, notifies. It was written defensively in Phase 25. It should continue to work once JDT LS sessions are real.

### Discretion Decision: jarIdToDirName Map Structure

**Recommendation:** Namespace prefixes in directory names are sufficient -- no need to restructure the map to track per-child ownership.

**Reasoning:**
- Jar IDs are already namespaced: `my-mod/minecraft`, `other-mod/minecraft`
- `jarIdToDirName()` converts these to unique dir names: `my-mod--minecraft`, `other-mod--minecraft`
- The map naturally has unique keys per child because jar IDs include the child namespace
- On child removal, iterate `child.dependencyJars.keys()` to find which map entries to delete (already done in `remove_project_member`)
- No ownership tracking needed beyond what already exists

### Discretion Decision: Extract Timing

**Recommendation:** Create an empty workspace in `create_project`, incrementally add on `add_fabric_mod`.

**Reasoning:**
- JDT LS needs `.project` and `.classpath` files to initialize
- Starting with an empty workspace means JDT LS is ready immediately
- First `add_fabric_mod` call incrementally adds sources (same pattern as every subsequent call)
- Simpler than special-casing "first child" behavior

### Discretion Decision: JDT LS Crash Handling

**Recommendation:** Set `jdtls.available = false` on crash, log warning. Tools already check `jdtls.available` before making LSP calls.

**Reasoning:**
- All navigation tools already check `if (!loadedProject.jdtls?.available)` and return `JDTLS_NOT_AVAILABLE` error
- A crashed JDT LS is functionally identical to "never started" from the tool perspective
- User can `remove_project` + `create_project` to restart JDT LS
- Auto-restart adds complexity without clear benefit (JDT LS crashes are rare)

```typescript
// In create_project, after startJdtLs:
proc.on('exit', (code) => {
	if (code !== 0 && code !== null) {
		logger.warn(`JDT LS process exited with code ${code}`);
		project.jdtls!.available = false;
		project.jdtls!.failureReason = `JDT LS process exited with code ${code}`;
	}
});
```

### Anti-Patterns to Avoid
- **Full workspace rebuild on child add/remove:** Incremental sync is proven in study jar pattern. Never re-extract all children.
- **Lazy JDT LS init on first navigation call:** User decision is eager startup. Do not defer.
- **Shared extraction directories across children:** User decision is per-child isolation. Even identical artifacts get separate dirs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LSP client protocol | Custom JSON-RPC over stdio | `ts-lsp-client` | Already in use, battle-tested |
| `.classpath` XML generation | String concatenation | `generateClasspathFile()` | Already exists, tested |
| `.project` XML generation | String concatenation | `generateProjectFile()` | Already exists, tested |
| Jar ID to dir name conversion | Custom escaping | `jarIdToDirName()` / `dirNameToJarId()` | Already handles all separators, round-trip tested |
| Study jar workspace sync | Reimplementation | `syncStudyJarToWorkspace()` | Already works end-to-end |

## Common Pitfalls

### Pitfall 1: macOS /tmp Symlink Resolution
**What goes wrong:** JDT LS returns file URIs with resolved symlinks (`/private/var/...`) but the tempDir path uses `/tmp/...`.
**Why it happens:** macOS `/tmp` is a symlink to `/private/tmp`. JDT LS resolves symlinks internally.
**How to avoid:** Always use `realpathSync(tempDir)` before comparing URIs or writing `.classpath`. The workspace-sync code already does this.
**Warning signs:** URI mapping returns `null` for valid JDT LS responses.

### Pitfall 2: JDT LS Startup Timeout
**What goes wrong:** `waitForReady` times out (120 seconds) on first start because JDT LS is indexing.
**Why it happens:** JDT LS needs to build its internal model. First start with many source dirs is slower.
**How to avoid:** The workspace starts empty (no source dirs). JDT LS initializes fast with empty classpath. Sources are added incrementally after initialization completes.
**Warning signs:** `create_project` hangs for > 2 minutes.

### Pitfall 3: Classpath Notification Race
**What goes wrong:** Multiple rapid `add_fabric_mod` calls overwrite `.classpath` concurrently.
**Why it happens:** No serialization of workspace mutations.
**How to avoid:** Each `add_fabric_mod` is an MCP tool call, and MCP tool calls are inherently sequential (one at a time from the client). This is not a practical concern unless the server is used by multiple clients simultaneously (not in scope).
**Warning signs:** `.classpath` missing some source dirs.

### Pitfall 4: createSourceAdapter Needs rootPath
**What goes wrong:** `createSourceAdapter` for mod-source category requires a rootPath to read from the filesystem.
**Why it happens:** Mod's own source is read from the project directory, not from a jar.
**How to avoid:** When extracting a fabric mod's sources, use `fabricMod.rootPath` for the mod-source dependency and jar paths for everything else.
**Warning signs:** Extraction fails for mod-source entries with "rootPath is undefined".

### Pitfall 5: Refresh Must Re-Extract Workspace
**What goes wrong:** `refresh_project_members` updates `dependencyJars` but leaves stale extracted files in the workspace.
**Why it happens:** Currently, refresh only updates jar reader registrations, not JDT LS workspace.
**How to avoid:** After refresh re-discovers dependencies, unsync old entries and sync new entries. Pattern: delete old child dirs from workspace, extract new deps, regenerate `.classpath`.
**Warning signs:** Navigation tools find stale definitions after dependency version changes.

## Code Examples

### Current study jar sync pattern (proven, to be replicated for fabric mods)

```typescript
// Source: src/jdtls/workspace-sync.ts
export async function syncStudyJarToWorkspace(
	studyJar: StudyJar,
	jdtls: JdtLsSession | undefined,
	jarReader: JarReader,
): Promise<{ synced: boolean; warning?: string }> {
	if (!jdtls?.available || !jdtls.endpoint) {
		return { synced: false, warning: 'Note: JDT LS unavailable -- semantic navigation disabled' };
	}

	try {
		const dirName = await extractStudyJarToWorkspace(studyJar, jdtls.tempDir, jarReader);
		jdtls.jarIdToDirName.set(studyJar.name, dirName);

		const allDirs = Array.from(jdtls.jarIdToDirName.values());
		const classpathXml = generateClasspathFile(allDirs);
		const resolvedTempDir = realpathSync(jdtls.tempDir);
		await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);

		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
		});

		return { synced: true };
	} catch (err) {
		jdtls.jarIdToDirName.delete(studyJar.name);
		return {
			synced: false,
			warning: 'Workspace sync failed: ' + (err instanceof Error ? err.message : String(err)),
		};
	}
}
```

### JDT LS session structure (no changes needed)

```typescript
// Source: src/jdtls/types.ts
export interface JdtLsSession {
	available: boolean;
	failureReason?: string;
	tempDir: string;
	dataDir: string;
	jarIdToDirName: Map<string, string>;
	client?: LspClient;
	endpoint?: JSONRPCEndpoint;
	process?: ChildProcess;
}
```

### Existing cleanup in remove_project_member (already handles fabric mod workspace cleanup)

```typescript
// Source: src/tools/remove-project-member.ts, lines 64-108
// This code already:
// 1. Iterates child.dependencyJars.keys() to find jarIdToDirName entries
// 2. Deletes jarIdToDirName entries for each dep
// 3. Deletes jarIdToDirName entry for mod source
// 4. Regenerates .classpath from remaining entries
// 5. Notifies JDT LS via workspace/didChangeWatchedFiles
// 6. Deletes extracted directories from tempDir
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dead `extractSourcesToTemp` / `startJdtLs` code | Wire into project lifecycle | Phase 26 (now) | JDT LS actually starts and serves navigation |
| Phase 26 TODO log in `add_fabric_mod` | Incremental workspace sync | Phase 26 (now) | Fabric mod sources indexed by JDT LS |
| Navigation tools return JDTLS_NOT_AVAILABLE | Navigation tools work with real JDT LS | Phase 26 (now) | Full semantic navigation across all children |

## Open Questions

1. **JDT LS with overlapping classes across children**
   - What we know: Two fabric mods may depend on different Minecraft versions. Both extract `net.minecraft.client.MinecraftClient` but with different source code.
   - What's unclear: JDT LS behavior with duplicate FQCNs across multiple source directories in one `.classpath`. Eclipse projects typically don't have this.
   - Recommendation: Per-child isolation (separate directories) means JDT LS sees both versions. It may produce errors or pick one arbitrarily. This is acceptable for the common case (one mod per project) and edge case (multi-mod with same MC version). For different MC versions, the user should use separate projects. Document this limitation.
   - **Confidence:** MEDIUM -- JDT LS likely warns about duplicate types but still functions. Cross-mod navigation still works for non-overlapping types (fabric-api, libraries).

2. **Refresh + workspace resync complexity**
   - What we know: `refresh_project_members` re-discovers dependencies but doesn't touch the workspace.
   - What's unclear: Best approach -- full unsync+resync for refreshed child, or diff-based sync?
   - Recommendation: Full unsync+resync per refreshed child (delete all child dirs, re-extract all). Simpler than diffing, and refresh is rare. Follows the same pattern as remove+add.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run --reporter=verbose` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LSP-01 | JDT LS session created on project creation with workspace covering all children | unit | `pnpm vitest run tests/tools/create-project.test.ts -t "jdtls"` | Needs new tests |
| LSP-01 | Fabric mod sync adds extracted dirs to workspace | unit | `pnpm vitest run tests/jdtls/workspace-sync.test.ts -t "fabric"` | Needs new tests |
| LSP-01 | Classpath includes all children after multiple add_fabric_mod calls | unit | `pnpm vitest run tests/jdtls/workspace-sync.test.ts -t "classpath"` | Needs new tests |
| LSP-02 | URI mapper resolves cross-child references (mod A source -> mod B dep) | unit | `pnpm vitest run tests/jdtls/uri-mapper.test.ts` | Existing tests sufficient |
| LSP-02 | find_definition navigates from one mod's source into another mod's deps | integration (manual) | Manual -- requires real JDT LS + Java 21 | N/A |

### Sampling Rate
- **Per task commit:** `pnpm vitest run --reporter=verbose`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/jdtls/workspace-sync.test.ts` -- add `syncFabricModToWorkspace` / `unsyncFabricModFromWorkspace` tests (parallel to existing study jar tests)
- [ ] `tests/tools/create-project.test.ts` -- add JDT LS eager startup tests (mock detectJava/findJdtLs/startJdtLs)
- [ ] `tests/tools/add-fabric-mod.test.ts` -- add workspace sync integration tests

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/jdtls/client.ts`, `src/jdtls/workspace.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/uri-mapper.ts`, `src/jdtls/types.ts` -- full implementation read
- Codebase inspection: `src/tools/create-project.ts`, `src/tools/add-fabric-mod.ts`, `src/tools/remove-project.ts`, `src/tools/remove-project-member.ts`, `src/tools/refresh-project.ts`, `src/tools/refresh-project-members.ts` -- all integration points
- Codebase inspection: `src/tools/find-definition.ts`, `src/tools/resolve-symbol-position.ts` -- navigation tool patterns
- Existing tests: `tests/jdtls/workspace.test.ts`, `tests/jdtls/workspace-sync.test.ts`, `tests/jdtls/uri-mapper.test.ts` -- proven patterns

### Secondary (MEDIUM confidence)
- CONTEXT.md canonical references -- verified against actual source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all infrastructure exists and is tested
- Architecture: HIGH -- follows proven study jar sync pattern exactly, all integration points identified
- Pitfalls: HIGH -- pitfalls derived from actual code inspection (macOS symlink, createSourceAdapter rootPath, etc.)
- Cross-mod overlapping classes: MEDIUM -- JDT LS behavior with duplicate FQCNs is known-unknown

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- internal architecture, no external dependency changes)
