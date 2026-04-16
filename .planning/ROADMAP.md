# Roadmap: MinecraftDevMCP

## Milestones

- ✅ **v1.0 MVP** — Phases 1-10 (shipped 2026-04-14) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Study Jars** — Phases 11-14 (shipped 2026-04-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Symbol Resolution** — Phases 15-18 (shipped 2026-04-14) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Context Management** — Phases 19-22 (shipped 2026-04-15) — [archive](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 Project Rearchitecture** — Phases 23-27 (shipped 2026-04-15) — [archive](milestones/v1.4-ROADMAP.md)
- 🚧 **v1.5 Quality & Consistency** — Phases 28-34 (in progress)

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

<details>
<summary>✅ v1.1 Study Jars (Phases 11-14) — SHIPPED 2026-04-14</summary>

- [x] Phase 11: Types and Domain Logic (2/2 plans)
- [x] Phase 12: Existing Tool Integration (2/2 plans)
- [x] Phase 13: Study Jar Management Tools (2/2 plans)
- [x] Phase 14: JDT LS Workspace Sync (2/2 plans)

**4 phases, 8 plans, 10 requirements satisfied, 423 tests**

</details>

<details>
<summary>✅ v1.2 Symbol Resolution (Phases 15-18) — SHIPPED 2026-04-14</summary>

- [x] Phase 15: Enable Method Search (1/1 plans)
- [x] Phase 16: Member Parser Domain Module (2/2 plans)
- [x] Phase 17: Structured Member Output (2/2 plans)
- [x] Phase 18: Member Inspection & Context Lines (2/2 plans)

**4 phases, 7 plans, 7 requirements satisfied, 526 tests**

</details>

<details>
<summary>✅ v1.3 Context Management (Phases 19-22) — SHIPPED 2026-04-15</summary>

- [x] Phase 19: Line-Range Reading (2/2 plans)
- [x] Phase 20: Member Context Lines (2/2 plans)
- [x] Phase 21: Navigation Pagination (2/2 plans)
- [x] Phase 22: Verbosity Audit (3/3 plans)

**4 phases, 9 plans, 11 requirements satisfied, 592 tests**

</details>

<details>
<summary>✅ v1.4 Project Rearchitecture (Phases 23-27) — SHIPPED 2026-04-15</summary>

- [x] Phase 23: Type Foundation and ProjectStore (4/4 plans)
- [x] Phase 24: Dependency Namespacing (3/3 plans)
- [x] Phase 25: Child Management Tools (2/2 plans)
- [x] Phase 25.1: Tool Rework — INSERTED (4/4 plans)
- [x] Phase 26: JDT LS Workspace Unification (2/2 plans)
- [x] Phase 27: Migration Cleanup (absorbed by Phase 25.1)

**6 phases, 15 plans, 15 requirements satisfied, 665 tests**

</details>

### 🚧 v1.5 Quality & Consistency (In Progress)

**Milestone Goal:** Address all findings from comprehensive 4-agent codebase audit — fix bugs, unify API patterns, improve documentation accuracy, and close gaps to make the server reliable and agent-friendly.

- [x] **Phase 28: Jar & Cache Bug Fixes** - Fix cache eviction leak, jar reader race condition, error messages, and missing metadata (completed 2026-04-16)
- [x] **Phase 29: JDT LS & Workspace Bug Fixes** - Fix data dir cleanup, type hierarchy cycles, inner class source reading, and workspace sync partial failure (completed 2026-04-16)
- [x] **Phase 30: API Consistency** - Unify pagination envelopes, rename parameters, validate enums, remove dead fields (completed 2026-04-16)
- [x] **Phase 31: Data Exposure** - Surface JDT LS status, build dependencies, jar locations, and inner class FQNs in tool responses (completed 2026-04-16)
- [x] **Phase 32: Per-Child Jar Filtering** - Fix getDependenciesForTool to apply each child's own filter instead of merged filter (completed 2026-04-16)
- [x] **Phase 33: Build File Re-parsing** - Extend refresh tools to re-parse gradle.properties, build.gradle.kts, and fabric.mod.json (completed 2026-04-16)
- [ ] **Phase 34: Documentation & Instructions** - Accurate tool descriptions, complete SERVER_INSTRUCTIONS, and filled CLAUDE.md sections

## Phase Details

### Phase 28: Jar & Cache Bug Fixes
**Goal**: Jar reading, cache management, and error reporting are correct and race-free
**Depends on**: Nothing (independent bug fixes)
**Requirements**: FIX-01, FIX-03, FIX-07, FIX-08
**Success Criteria** (what must be TRUE):
  1. Removing a project evicts all associated entries from entryIndexCache (no memory leak across project lifecycle)
  2. Concurrent getHandle() calls for the same jar path do not create duplicate handles or corrupt state
  3. read_jar_entry error messages direct user to list_packages/list_classes (not non-existent listEntries)
  4. add_study_jar response includes provenance metadata matching other jar-adding tools
**Plans**: 1 plan

Plans:
- [x] 28-01-PLAN.md — Fix cache eviction, race condition, error messages, and provenance metadata

### Phase 29: JDT LS & Workspace Bug Fixes
**Goal**: JDT LS lifecycle and workspace sync are resilient to edge cases and clean up after themselves
**Depends on**: Nothing (independent bug fixes)
**Requirements**: FIX-02, FIX-04, FIX-05, FIX-06
**Success Criteria** (what must be TRUE):
  1. JDT LS data directories are cleaned up on normal server exit and SIGTERM/SIGINT
  2. type_hierarchy does not hang or crash when the class hierarchy contains cycles (returns results with cycle broken)
  3. read_source accepts inner class FQNs (e.g., `net.minecraft.client.Foo$Bar`) and returns the outer class source
  4. syncFabricModToWorkspace removes partially extracted files when extraction fails midway
**Plans**: 1 plan

Plans:
- [x] 29-01-PLAN.md — Fix data dir cleanup, type hierarchy cycles, inner class read_source, and workspace sync partial failure

### Phase 30: API Consistency
**Goal**: All tool schemas use consistent naming, validated enums, and unified pagination envelopes
**Depends on**: Nothing (schema changes are independent)
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07
**Success Criteria** (what must be TRUE):
  1. Every paginated tool response includes both `limit` and `hasMore` fields
  2. search_classes uses `query` parameter (not `pattern`) and validates kind filter via z.enum
  3. remove_project_member uses `names` parameter (not `members`)
  4. search_symbols returns all results by default (no implicit limit) and `field` is not a valid kind value
  5. get_symbol_info response does not include `javadoc` field
**Plans**: 1 plan

Plans:
- [x] 30-01-PLAN.md — Unify pagination envelopes, rename parameters, fix schema validation, remove dead fields

### Phase 31: Data Exposure
**Goal**: Tool responses surface all available metadata that agents need for informed decisions
**Depends on**: Phase 29 (FIX-05 inner class handling informs DATA-04 inner class FQNs)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. get_project_info response includes JDT LS availability status and failure reason for each project
  2. get_member_info response includes declared build dependencies from GradleConfig (configuration, group, artifact, version)
  3. type_hierarchy ClassReference entries include jar ID identifying which jar the type was found in
  4. list_members compact output includes FQN field for inner class entries
**Plans**: 1 plan

Plans:
- [x] 31-01-PLAN.md — Surface JDT LS status, build dependencies, jar locations in type hierarchy, and inner class FQNs

### Phase 32: Per-Child Jar Filtering
**Goal**: Multi-mod projects apply each child's own include/exclude filter to its own jar set instead of merging filters incorrectly
**Depends on**: Nothing (core dependency resolver change)
**Requirements**: BEH-01
**Success Criteria** (what must be TRUE):
  1. getDependenciesForTool without scope returns jars where each child's filter is applied only to that child's own dependencies
  2. In a project with two mods having different filters, browsing tools without scope show correctly filtered results from both mods (not one mod's filter applied to all)
  3. Scoped calls continue to work identically (single child, single filter)
**Plans**: 1 plan

Plans:
- [x] 32-01-PLAN.md — Fix getDependenciesForTool to apply per-child filtering in unscoped path

### Phase 33: Build File Re-parsing
**Goal**: Refresh tools detect and apply changes to build configuration files without requiring project removal and re-creation
**Depends on**: Nothing (extends existing refresh tools)
**Requirements**: BEH-02
**Success Criteria** (what must be TRUE):
  1. refresh_project re-reads gradle.properties and build.gradle.kts, detecting changes to Minecraft version, mappings, and dependencies
  2. refresh_project_members re-reads fabric.mod.json for each fabric mod child, detecting changes to mod metadata
  3. After modifying gradle.properties and calling refresh, the project reflects the updated configuration (e.g., new Minecraft version)
**Plans**: 1 plan

Plans:
- [x] 33-01-PLAN.md — Extract shared re-parsing helper and wire into both refresh tools

### Phase 34: Documentation & Instructions
**Goal**: All tool descriptions, SERVER_INSTRUCTIONS, and CLAUDE.md accurately describe the server's actual behavior and API
**Depends on**: Phases 28-33 (documents the final state after all code changes)
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05
**Success Criteria** (what must be TRUE):
  1. Every JDT LS-dependent tool description states the JDT LS requirement, and SERVER_INSTRUCTIONS explains JDT LS availability checking
  2. SERVER_INSTRUCTIONS documents the response envelope structure, study jar workflow, scope dual-effect, refresh guidance, and configure_filters usage
  3. All tool descriptions match their actual schemas, response fields, and behavior (no stale references to removed/renamed params or fields)
  4. CLAUDE.md Architecture, Conventions, and Project Structure sections are filled in with current information and stale Phase references removed
**Plans**: 1 plan

Plans:
- [ ] 34-01-PLAN.md — Update SERVER_INSTRUCTIONS, all tool descriptions, and CLAUDE.md sections

## Progress

**Execution Order:**
Phases execute in numeric order: 28 → 29 → 30 → 31 → 32 → 33 → 34

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-10 | v1.0 | 22/22 | Complete | 2026-04-14 |
| 11-14 | v1.1 | 8/8 | Complete | 2026-04-14 |
| 15-18 | v1.2 | 7/7 | Complete | 2026-04-14 |
| 19-22 | v1.3 | 9/9 | Complete | 2026-04-15 |
| 23-27 | v1.4 | 15/15 | Complete | 2026-04-15 |
| 28. Jar & Cache Bug Fixes | v1.5 | 1/1 | Complete    | 2026-04-16 |
| 29. JDT LS & Workspace Bug Fixes | v1.5 | 1/1 | Complete    | 2026-04-16 |
| 30. API Consistency | v1.5 | 1/1 | Complete    | 2026-04-16 |
| 31. Data Exposure | v1.5 | 1/1 | Complete    | 2026-04-16 |
| 32. Per-Child Jar Filtering | v1.5 | 1/1 | Complete    | 2026-04-16 |
| 33. Build File Re-parsing | v1.5 | 1/1 | Complete    | 2026-04-16 |
| 34. Documentation & Instructions | v1.5 | 0/1 | Not started | - |
