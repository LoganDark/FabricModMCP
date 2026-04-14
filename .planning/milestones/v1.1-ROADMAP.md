# Roadmap: MinecraftDevMCP

## Milestones

- ✅ **v1.0 MVP** — Phases 1-10 (shipped 2026-04-14) — [archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Study Jars** — Phases 11-14 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-10) — SHIPPED 2026-04-14</summary>

- [x] Phase 1: Server Bootstrap (2/2 plans)
- [x] Phase 2: Project Discovery (2/2 plans)
- [x] Phase 3: Dependency Discovery and Jar Registry (2/2 plans)
- [x] Phase 4: Multi-Project Sessions (2/2 plans)
- [x] Phase 5: Project Metadata (2/2 plans)
- [x] Phase 6: Source Browsing (2/2 plans)
- [x] Phase 7: Search (2/2 plans)
- [x] Phase 8: Cascading Regex Engine (2/2 plans)
- [x] Phase 9: Semantic Navigation (3/3 plans)
- [x] Phase 10: Advanced LSP Browsing (3/3 plans)

**10 phases, 22 plans, 46 requirements satisfied, 327 tests**

</details>

### 🚧 v1.1 Study Jars (In Progress)

**Milestone Goal:** Enable adding arbitrary source jars to projects for study, with opt-in inclusion in default tool resolution and full semantic navigation support.

- [x] **Phase 11: Types and Domain Logic** — Data model, jar handle management, and cache eviction for study jars (completed 2026-04-14)
- [x] **Phase 12: Existing Tool Integration** — Wire study jars into all jar-aware tools via combined dependency resolution (completed 2026-04-14)
- [x] **Phase 13: Study Jar Management Tools** — Four new MCP tools for add/remove/list/toggle operations (completed 2026-04-14)
- [x] **Phase 14: JDT LS Workspace Sync** — Incremental workspace extraction and classpath updates for semantic navigation (completed 2026-04-14)

## Phase Details

### Phase 11: Types and Domain Logic
**Goal**: Study jar data model and infrastructure extensions exist, enabling all downstream phases to build on stable contracts
**Depends on**: Phase 10 (v1.0 complete)
**Requirements**: INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. A study jar can be opened, tracked per-project, and closed with correct ref-counting (no handle leaks)
  2. Removing a study jar evicts its entry index cache so re-adding a rebuilt jar returns fresh data
  3. Study jar IDs use `study:` namespace prefix and collisions with existing dependency IDs are detected
  4. The `studyJars` map on LoadedProject survives `refresh_dependencies` without data loss
**Plans**: 2 plans

Plans:
- [x] 11-01-PLAN.md — Types and infrastructure extensions (StudyJar types, JarReader add/remove, cache eviction)
- [x] 11-02-PLAN.md — Study jar domain service and refresh_dependencies integration

### Phase 12: Existing Tool Integration
**Goal**: All existing jar-aware tools see study jars through a unified dependency resolution path
**Depends on**: Phase 11
**Requirements**: INTG-01, INTG-02
**Success Criteria** (what must be TRUE):
  1. User can select study jars via the `jars` parameter using `study:name` or `study:*` glob patterns on any jar-aware tool
  2. Study jars with auto-include=true appear in default results when `jars` parameter is omitted
  3. Study jars with auto-include=false are excluded from default results but reachable via explicit `jars` selection
  4. Study jars never shadow real dependencies in default resolution (lowest category priority)
**Plans**: 2 plans

Plans:
- [x] 12-01-PLAN.md — Dependency resolver module, CATEGORY_PRIORITY update, getDependenciesForTool helper, searchClasses signature simplification
- [x] 12-02-PLAN.md — Wire all tool files through resolver, eliminate direct dependencyJars access

### Phase 13: Study Jar Management Tools
**Goal**: Users can manage study jars on loaded projects through four dedicated MCP tools
**Depends on**: Phase 12
**Requirements**: STUDY-01, STUDY-02, STUDY-03, STUDY-04
**Success Criteria** (what must be TRUE):
  1. User can add a source jar by file path with a name and see it appear in project metadata
  2. User can remove a study jar by name and it disappears from all tool results
  3. User can list all study jars with their names, paths, and auto-include status
  4. User can toggle a study jar's auto-include flag without removing and re-adding
  5. Adding an invalid path, non-ZIP file, or duplicate name produces a clear error message
**Plans**: 2 plans

Plans:
- [x] 13-01-PLAN.md — Tool descriptions, four tool implementations, and registerAllTools wiring
- [x] 13-02-PLAN.md — Integration tests for all four study jar management tools

### Phase 14: JDT LS Workspace Sync
**Goal**: Semantic navigation (find-definition, find-references, type hierarchy) works for classes in study jars
**Depends on**: Phase 13
**Requirements**: LSP-01, LSP-02
**Success Criteria** (what must be TRUE):
  1. After adding a study jar, user can use find_definition to jump to definitions within study jar source
  2. After removing a study jar, its classes no longer appear in find_references or workspace_symbols results
  3. Adding or removing a study jar does not require a full project reload (incremental update)
**Plans**: 2 plans

Plans:
- [x] 14-01-PLAN.md — Workspace sync module: incremental extraction, classpath regeneration, JDT LS notification, probe-based readiness
- [x] 14-02-PLAN.md — Wire workspace sync into add/remove/list tool handlers with integration tests

## Progress

**Execution Order:**
Phases execute in numeric order: 11 -> 12 -> 13 -> 14

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 11. Types and Domain Logic | v1.1 | 2/2 | Complete    | 2026-04-14 |
| 12. Existing Tool Integration | v1.1 | 2/2 | Complete    | 2026-04-14 |
| 13. Study Jar Management Tools | v1.1 | 2/2 | Complete    | 2026-04-14 |
| 14. JDT LS Workspace Sync | v1.1 | 2/2 | Complete    | 2026-04-14 |
