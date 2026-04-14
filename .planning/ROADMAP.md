# Roadmap: MinecraftDevMCP

## Milestones

- ✅ **v1.0 MVP** — Phases 1-10 (shipped 2026-04-14) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Study Jars** — Phases 11-14 (shipped 2026-04-14) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Symbol Resolution** — Phases 15-18 (shipped 2026-04-14) — [archive](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Context Management** — Phases 19-22 (in progress)

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

- [x] Phase 11: Types and Domain Logic (2/2 plans) — completed 2026-04-14
- [x] Phase 12: Existing Tool Integration (2/2 plans) — completed 2026-04-14
- [x] Phase 13: Study Jar Management Tools (2/2 plans) — completed 2026-04-14
- [x] Phase 14: JDT LS Workspace Sync (2/2 plans) — completed 2026-04-14

**4 phases, 8 plans, 10 requirements satisfied, 423 tests**

</details>

<details>
<summary>✅ v1.2 Symbol Resolution (Phases 15-18) — SHIPPED 2026-04-14</summary>

- [x] Phase 15: Enable Method Search (1/1 plans) — completed 2026-04-14
- [x] Phase 16: Member Parser Domain Module (2/2 plans) — completed 2026-04-14
- [x] Phase 17: Structured Member Output (2/2 plans) — completed 2026-04-14
- [x] Phase 18: Member Inspection & Context Lines (2/2 plans) — completed 2026-04-14

**4 phases, 7 plans, 7 requirements satisfied, 526 tests**

</details>

### 🚧 v1.3 Context Management (In Progress)

**Milestone Goal:** Give agents control over response size to prevent context window overflow from large tool results.

- [x] **Phase 19: Line-Range Reading** - read_source returns specific line ranges with metadata instead of full source files (completed 2026-04-14)
- [ ] **Phase 20: Member Context Lines** - read_member includes surrounding source context on demand
- [ ] **Phase 21: Navigation Pagination** - find_references, find_implementations, and find_definition accept pagination controls
- [ ] **Phase 22: Verbosity Audit** - Measure and reduce response sizes across search and navigation tools

## Phase Details

### Phase 19: Line-Range Reading
**Goal**: Agents can read specific line ranges from source files instead of consuming entire 1,000-5,000 line classes
**Depends on**: Nothing (first phase of v1.3; architecturally independent)
**Requirements**: READ-01, READ-02, READ-04
**Success Criteria** (what must be TRUE):
  1. Agent can call read_source with startLine and lineCount to receive only the requested line range
  2. Agent receives an error with a jar list when requesting a line range without specifying a single jar
  3. Every read_source response (with or without line range) includes totalLineCount, startLine, endLine, and truncated metadata
  4. Reading a file in consecutive chunks and concatenating produces identical content to reading without range params
**Plans**: 2 plans

Plans:
- [x] 19-01-PLAN.md — Create sliceLines pure utility function with comprehensive tests
- [x] 19-02-PLAN.md — Wire line-range into read_source tool, extend SourceResult, add integration tests

### Phase 20: Member Context Lines
**Goal**: Agents can see the source context surrounding a member without a separate read_source call
**Depends on**: Nothing (architecturally independent of Phase 19)
**Requirements**: READ-03
**Success Criteria** (what must be TRUE):
  1. Agent can call read_member with linesBefore and linesAfter to see surrounding source around the extracted member
  2. Calling read_member without linesBefore/linesAfter produces identical output to pre-v1.3 behavior
  3. Context line metadata (startLine, endLine) reflects the expanded range including context
**Plans**: TBD

Plans:
- [ ] 20-01: TBD

### Phase 21: Navigation Pagination
**Goal**: Agents can paginate large navigation result sets instead of receiving unbounded results
**Depends on**: Nothing (architecturally independent of Phases 19-20)
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):
  1. Agent can call find_references with limit and offset to receive a page of results, with total count and hasMore in the response
  2. Agent can call find_implementations with limit and offset to receive a page of results, with total count and hasMore in the response
  3. Agent can call find_definition with limit and offset to receive a page of results, with total count and hasMore in the response
  4. Omitting limit and offset on any paginated tool returns all results (backward compatible)
**Plans**: TBD

Plans:
- [ ] 21-01: TBD

### Phase 22: Verbosity Audit
**Goal**: Default response sizes are measured and worst offenders get opt-in compact modes
**Depends on**: Phases 19, 20, 21 (audit is meaningful only after size controls exist)
**Requirements**: VERB-01, VERB-02, VERB-03
**Success Criteria** (what must be TRUE):
  1. Documented audit of response sizes across all search and navigation tools using real Minecraft project data
  2. Default verbosity is reduced where safe without breaking existing structuredContent shapes
  3. Tools identified as worst offenders accept a compact mode parameter that reduces per-result size
  4. Calling any modified tool without new parameters produces identical structuredContent to pre-audit behavior
**Plans**: TBD

Plans:
- [ ] 22-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 19 → 20 → 21 → 22

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Server Bootstrap | v1.0 | 2/2 | Complete | 2026-04-14 |
| 2. Project Discovery | v1.0 | 2/2 | Complete | 2026-04-14 |
| 3. Dependency Discovery | v1.0 | 2/2 | Complete | 2026-04-14 |
| 4. Multi-Project Sessions | v1.0 | 2/2 | Complete | 2026-04-14 |
| 5. Project Metadata | v1.0 | 2/2 | Complete | 2026-04-14 |
| 6. Source Browsing | v1.0 | 2/2 | Complete | 2026-04-14 |
| 7. Search | v1.0 | 2/2 | Complete | 2026-04-14 |
| 8. Cascading Regex Engine | v1.0 | 2/2 | Complete | 2026-04-14 |
| 9. Semantic Navigation | v1.0 | 3/3 | Complete | 2026-04-14 |
| 10. Advanced LSP Browsing | v1.0 | 3/3 | Complete | 2026-04-14 |
| 11. Types and Domain Logic | v1.1 | 2/2 | Complete | 2026-04-14 |
| 12. Existing Tool Integration | v1.1 | 2/2 | Complete | 2026-04-14 |
| 13. Study Jar Management Tools | v1.1 | 2/2 | Complete | 2026-04-14 |
| 14. JDT LS Workspace Sync | v1.1 | 2/2 | Complete | 2026-04-14 |
| 15. Enable Method Search | v1.2 | 1/1 | Complete | 2026-04-14 |
| 16. Member Parser Domain Module | v1.2 | 2/2 | Complete | 2026-04-14 |
| 17. Structured Member Output | v1.2 | 2/2 | Complete | 2026-04-14 |
| 18. Member Inspection & Context Lines | v1.2 | 2/2 | Complete | 2026-04-14 |
| 19. Line-Range Reading | v1.3 | 2/2 | Complete    | 2026-04-14 |
| 20. Member Context Lines | v1.3 | 0/? | Not started | - |
| 21. Navigation Pagination | v1.3 | 0/? | Not started | - |
| 22. Verbosity Audit | v1.3 | 0/? | Not started | - |
