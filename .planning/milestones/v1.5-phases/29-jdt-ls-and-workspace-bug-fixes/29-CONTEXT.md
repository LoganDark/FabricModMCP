# Phase 29: JDT LS & Workspace Bug Fixes - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix four bugs in the JDT LS lifecycle, type hierarchy traversal, inner class source reading, and workspace sync cleanup. All fixes are well-defined by the audit.

</domain>

<decisions>
## Implementation Decisions

### FIX-02: JDT LS data directory cleanup
- `initJdtLsSession()` creates a data dir at `{tmpdir}/mcp-jdtls-data-{uuid}` that is never cleaned up
- Register cleanup for data directories on SIGINT, SIGTERM, and normal exit
- The cleanup handler should iterate all projects in `projectStore` and clean up both `tempDir` and `dataDir` from each project's `jdtls` session
- Use `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` in `index.ts` alongside the existing SIGINT handler
- Also clean up on normal server close (the existing `server.close()` path)
- Cleanup is best-effort — swallow errors, don't block exit

### FIX-04: Type hierarchy cycle detection
- The `while (true)` supertype walk at line 119 of `type-hierarchy.ts` can loop forever on circular hierarchies
- Add a `Set<string>` tracking seen FQNs; bail when a duplicate is encountered
- Return the supertypes collected up to the cycle point — do not error
- Key: use the `detail.name` or FQN from `toClassReference()` as the set key

### FIX-05: Inner class FQN in read_source
- `classNameToEntryPath('net.minecraft.Outer$Inner')` produces `net/minecraft/Outer$Inner.java` which doesn't exist
- Fix: detect `$` in the class name, strip to outer class, read the outer file
- Return the outer class source WITH a metadata hint indicating where the inner class starts
- The hint should include: `innerClass: { name: 'Inner', startLine: N }` (or similar) so agents know where to look
- Find the inner class declaration by scanning for `class Inner` or `interface Inner` etc. in the outer class source
- If the inner class is not found (e.g., anonymous), return the full outer source without the hint

### FIX-06: Workspace sync partial extraction cleanup
- `syncFabricModToWorkspace` on error rolls back `jarIdToDirName` entries but leaves extracted files on disk
- Add cleanup: in the catch block, after deleting map entries, also delete the directories that were created
- Track created directories alongside `addedKeys` — on error, `rm -rf` each created directory
- Use `rm(dir, { recursive: true, force: true })` to match existing cleanup patterns

### Claude's Discretion
- Exact signal handler registration pattern in index.ts
- Whether to extract the inner class start-line scanner to a utility or inline it
- Test structure and naming

</decisions>

<specifics>
## Specific Ideas

- Inner class position hint: return `innerClass: { name, startLine }` in the response metadata so agents can immediately call `read_source` with `startLine` to jump to the right section
- For cycle detection, the set key should be the FQN (not the LSP item object) for reliable dedup

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Data dir cleanup (FIX-02)
- `src/index.ts` — Current SIGINT handler and startup sequence
- `src/jdtls/startup.ts` — `initJdtLsSession()` creates `tempDir` and `dataDir`
- `src/jdtls/workspace.ts` — `cleanupTempDir()` utility (only cleans tempDir currently)

### Cycle detection (FIX-04)
- `src/tools/type-hierarchy.ts` — Lines 118-135, the `while (true)` supertype walk

### Inner class read_source (FIX-05)
- `src/tools/read-source.ts` — Uses `classNameToEntryPath()` at line 36
- `src/tools/tool-helpers.ts` — `classNameToEntryPath()` and `resolveClassSource()` implementations
- `src/tools/read-member.ts` — Reference: already handles inner class FQNs by stripping `$` suffix

### Workspace sync cleanup (FIX-06)
- `src/jdtls/workspace-sync.ts` — `syncFabricModToWorkspace()` lines 158-217, especially the catch block at lines 208-216

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cleanupTempDir(dir)` in `workspace.ts`: `rm(dir, { recursive: true, force: true })` — reuse for data dir cleanup
- `read-member.ts` inner class handling: strips `$` from class name to find outer file — same pattern for read_source
- `classNameToEntryPath()` in tool-helpers.ts: needs to be called on the outer class name, not the inner

### Established Patterns
- Signal handlers in `index.ts`: currently only SIGINT with `server.close()` + `process.exit(0)`
- Error swallowing in cleanup: `try { cleanup } catch { logger.warn(...) }` pattern used in remove-project.ts
- Source scanning: `type-hierarchy.ts` already scans for class declaration regex — reusable pattern for inner class detection

### Integration Points
- `classNameToEntryPath()` is used by read_source, list_classes, search_classes, and all tools via `resolveClassSource()`
- Changes to inner class handling should be in `classNameToEntryPath()` or `resolveClassSource()` to benefit all tools, OR in read_source only if we want to limit the scope
- Signal handlers must coexist with the MCP SDK's own cleanup

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 29-jdt-ls-and-workspace-bug-fixes*
*Context gathered: 2026-04-15*
