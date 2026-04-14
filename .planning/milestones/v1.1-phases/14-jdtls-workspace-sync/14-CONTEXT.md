# Phase 14: JDT LS Workspace Sync - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Semantic navigation (find-definition, find-references, type hierarchy) works for classes in study jars. Adding or removing a study jar incrementally updates the JDT LS workspace — no full project reload required. Covers: source extraction to existing temp dir, .classpath regeneration, JDT LS re-indexing notification, and blocking until ready.

</domain>

<decisions>
## Implementation Decisions

### Sync feedback
- Tool response text only mentions workspace sync on failure — success messages stay clean, add a warning line if sync failed
- If workspace sync fails but jar was added successfully (handle registered, entry index working, browsing works), return success with a warning — jar is usable for browsing, just no semantic nav
- `remove_study_jar` response mentions that semantic navigation results have been updated
- `list_study_jars` shows a `workspaceSynced` field per study jar

### Blocking behavior
- `add_study_jar` blocks until JDT LS has fully indexed new sources before returning — agents call tools back-to-back with no sense of time, so immediate availability is required
- Same 120s timeout as initial workspace load
- `remove_study_jar` also blocks until JDT LS acknowledges the classpath change

### Degraded mode messaging
- When JDT LS is unavailable, `add_study_jar` always warns — "Note: JDT LS unavailable — semantic navigation disabled" (every add, not just the first)
- `list_study_jars` always shows `workspaceSynced` per jar, even when JDT LS is globally unavailable (all show false) — omitting the field would be extra logic and state
- If JDT LS crashes mid-session, sync attempts fail gracefully with warning — same as any sync failure, no auto-restart
- `remove_study_jar` does not warn about JDT LS unavailability — only relevant on add

### Claude's Discretion
- Extraction implementation (reuse `extractSourcesToTemp` pattern or factor out incremental extraction)
- How to notify JDT LS of classpath changes (didChangeConfiguration, didChangeWatchedFiles, or custom notification)
- Whether to regenerate full .classpath or patch it incrementally
- How to detect JDT LS readiness after incremental update (reuse waitForReady or different signal)
- File cleanup strategy on removal (immediate delete vs deferred)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### JDT LS workspace management
- `src/jdtls/workspace.ts` — Current full-extraction logic (`extractSourcesToTemp`), `.classpath`/`.project` generation, temp dir cleanup
- `src/jdtls/client.ts` — JDT LS process lifecycle, `startJdtLs`, `waitForReady` (readiness detection pattern), `shutdownJdtLs`
- `src/jdtls/types.ts` — `JdtLsSession` interface (tempDir, jarIdToDirName, client, endpoint, process)

### Study jar tools (integration points)
- `src/tools/add-study-jar.ts` — Current add flow: createStudyJar + jarReader.addProjectJar. Phase 14 adds workspace sync here.
- `src/tools/remove-study-jar.ts` — Current remove flow: removeProjectJar + evictEntryIndex. Phase 14 adds workspace cleanup here.
- `src/tools/list-study-jars.ts` — Needs `workspaceSynced` field added to output

### Project lifecycle
- `src/tools/load-project.ts` — Full JDT LS init flow (detect java, find jdtls, extract, start, wait). Reference for how workspace is set up initially.
- `src/tools/unload-project.ts` — JDT LS shutdown and temp dir cleanup on project unload

### Supporting modules
- `src/jdtls/uri-mapper.ts` — `jarIdToDirName` mapping used for extraction directory naming
- `src/browsing/source-adapter.ts` — `createSourceAdapter` used to read entries from jars for extraction
- `src/project/types.ts` — `LoadedProject`, `StudyJar`, `DependencyEntry`, `JdtLsSession` type definitions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extractSourcesToTemp()`: Full extraction logic — study jar incremental extraction can follow the same per-jar loop pattern (lines 44-65)
- `generateClasspathFile()`: Takes `sourceDirs: string[]` and generates `.classpath` XML — can be called with updated dir list
- `waitForReady()`: Listens for `ServiceReady` on `language/status` — may be reusable for incremental readiness detection
- `jarIdToDirName()`: Converts jar IDs to safe directory names — reusable for study jar extraction dirs
- `createSourceAdapter()`: Creates adapter for reading jar entries — used in extraction loop

### Established Patterns
- Eager JDT LS init with graceful degradation: `load-project.ts` tries init, stores failure reason if it fails
- `JdtLsSession.jarIdToDirName` map: tracks which jars are extracted where — study jars should be added to this map
- Source extraction loop: iterate entries, mkdir + writeFile per entry — same pattern for study jars
- Warning-on-failure pattern: JDT LS failures logged but don't block tool success

### Integration Points
- `add-study-jar.ts`: After `jarReader.addProjectJar()`, add workspace extraction + classpath update + wait for ready
- `remove-study-jar.ts`: After `evictEntryIndex()`, remove extracted dir + update classpath + wait for acknowledgment
- `list-study-jars.ts`: Check `project.jdtls.jarIdToDirName` to determine `workspaceSynced` per study jar
- `JdtLsSession.jarIdToDirName`: Must be updated on add/remove to stay in sync

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-jdtls-workspace-sync*
*Context gathered: 2026-04-14*
