# Roadmap: MinecraftDevMCP

## Milestones

- ✅ **v1.0 MVP** — Phases 1-10 (shipped 2026-04-14) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Study Jars** — Phases 11-14 (shipped 2026-04-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Symbol Resolution** — Phases 15-18 (shipped 2026-04-14) — [archive](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Context Management** — Phases 19-22 (shipped 2026-04-15) — [archive](milestones/v1.3-ROADMAP.md)
- 🚧 **v1.4 Project Rearchitecture** — Phases 23-27 (in progress)

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

### 🚧 v1.4 Project Rearchitecture (In Progress)

**Milestone Goal:** Restructure projects from monolithic Fabric-only containers into composable named containers that hold any mix of fabric mods and study jars, with namespaced dependency resolution and flexible scoping.

- [x] **Phase 23: Type Foundation and ProjectStore** - New container types, compatibility layer, default project at startup (completed 2026-04-15)
- [ ] **Phase 24: Dependency Namespacing** - Per-child dependency resolution with mod-name prefixes and scope parameter
- [ ] **Phase 25: Child Management Tools** - Multi-mod support, load/add/refresh tools, namespaced jar IDs in results
- [ ] **Phase 26: JDT LS Workspace Unification** - Single workspace covering all children with cross-mod navigation
- [ ] **Phase 27: Migration Cleanup** - Remove compatibility shims, finalize test factories, verify clean codebase

## Phase Details

### Phase 23: Type Foundation and ProjectStore
**Goal**: Projects exist as pure named containers with typed children, enabling incremental migration from monolithic LoadedProject
**Depends on**: Phase 22 (v1.3 complete)
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-05, CONT-06
**Success Criteria** (what must be TRUE):
  1. A project can be created with only a name and holds no root directory of its own
  2. A fabric mod child loaded from a root directory owns its own Gradle config, sources jar, dependencies, and fabric.mod.json
  3. Study jars exist at project level, not nested under any fabric mod child
  4. A default project named "default" exists immediately at server startup without any explicit creation
  5. All existing tools and tests continue passing through a compatibility layer (no regressions)
**Plans:** 4/4 plans complete
Plans:
- [x] 23-01-PLAN.md — Define new type hierarchy (Project, FabricModChild, StudyJarChild) and compat accessor layer
- [x] 23-02-PLAN.md — Update core modules (ProjectStore, loader, CLI, dependency-resolver, study-jar) and their tests
- [x] 23-03-PLAN.md — Migrate all tool files and test factories to use compat accessors, verify full suite
- [x] 23-04-PLAN.md — Fix failing CLI args tests (gap closure: removed --project flag tests)

### Phase 24: Dependency Namespacing
**Goal**: Each child resolves its own dependencies independently, with mod-name prefixes preventing ID collisions across children
**Depends on**: Phase 23
**Requirements**: DEP-01, DEP-02, DEP-03
**Success Criteria** (what must be TRUE):
  1. A fabric mod's dependencies appear with namespaced IDs (e.g., `my-mod/minecraft`, `my-mod/fabric-api`) — the project delegates to each child, not aggregates
  2. A fabric mod's own source is accessible via its mod name as a jar ID (e.g., `my-mod` instead of `src`)
  3. Tools accept an optional scope parameter to target a single child, with auto-resolve when only one child exists
  4. Bare jar ID patterns (e.g., `minecraft`) still work when exactly one fabric mod is loaded (backward compatibility)
**Plans**: TBD

### Phase 25: Child Management Tools
**Goal**: Agents can build multi-mod projects by adding fabric mods to existing projects, with all tools producing namespaced results
**Depends on**: Phase 24
**Requirements**: CONT-04, DEP-04, TOOL-01, TOOL-02, TOOL-03
**Success Criteria** (what must be TRUE):
  1. A project can hold multiple fabric mods simultaneously, each with its own namespaced dependencies
  2. `load_project` adds a fabric mod child to a project (defaulting to the "default" project)
  3. `refresh_dependencies` can target a specific fabric mod child rather than refreshing everything
  4. All jar-aware tools work correctly with namespaced jar IDs (e.g., `my-mod/minecraft`)
  5. Tool results include the namespaced jar ID so the agent knows which child produced each result
**Plans**: TBD

### Phase 26: JDT LS Workspace Unification
**Goal**: Semantic navigation works across all children in a project through a single JDT LS workspace
**Depends on**: Phase 25
**Requirements**: LSP-01, LSP-02
**Success Criteria** (what must be TRUE):
  1. One JDT LS workspace per project covers all fabric mods' and study jars' sources
  2. find_definition from one fabric mod's source correctly navigates into another fabric mod's dependencies
  3. Extraction directories use namespace-aware naming (e.g., `my-mod__minecraft`) to avoid collisions
**Plans**: TBD

### Phase 27: Migration Cleanup
**Goal**: The codebase is fully migrated to the new container model with no legacy compatibility shims remaining
**Depends on**: Phase 26
**Requirements**: (completion phase — all requirements delivered in Phases 23-26)
**Success Criteria** (what must be TRUE):
  1. The `LoadedProject` type alias and any compatibility adapters are removed from the codebase
  2. All test factories produce the new `Project` / `FabricModChild` / `StudyJarChild` types directly
  3. All 592+ tests pass against the new types with zero legacy shim usage
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 23 -> 24 -> 25 -> 26 -> 27

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-10 | v1.0 | 22/22 | Complete | 2026-04-14 |
| 11-14 | v1.1 | 8/8 | Complete | 2026-04-14 |
| 15-18 | v1.2 | 7/7 | Complete | 2026-04-14 |
| 19-22 | v1.3 | 9/9 | Complete | 2026-04-15 |
| 23. Type Foundation | v1.4 | 4/4 | Complete   | 2026-04-15 |
| 24. Dep Namespacing | v1.4 | 0/? | Not started | - |
| 25. Child Mgmt Tools | v1.4 | 0/? | Not started | - |
| 26. JDT LS Unification | v1.4 | 0/? | Not started | - |
| 27. Migration Cleanup | v1.4 | 0/? | Not started | - |
