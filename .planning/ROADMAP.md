# Roadmap: MinecraftDevMCP

## Milestones

- ✅ **v1.0 MVP** — Phases 1-10 (shipped 2026-04-14) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Study Jars** — Phases 11-14 (shipped 2026-04-14) — [archive](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 Symbol Resolution** — Phases 15-17 (in progress)

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

### v1.2 Symbol Resolution (In Progress)

**Milestone Goal:** Make methods and fields first-class citizens in the symbol navigation system — searchable, inspectable, and structurally typed for future Mixin integration.

- [x] **Phase 15: Enable Method Search** — JDT LS config unlock, readiness probe fix, search_symbols returns methods (completed 2026-04-14)
- [ ] **Phase 16: Member Parser Domain Module** — MemberReference types and detail string parser for structured method/field representations
- [ ] **Phase 17: Structured Member Output** — Wire parser into list_members and search_symbols with member FQNs

## Phase Details

### Phase 15: Enable Method Search
**Goal**: search_symbols fulfills its promise of returning methods, not just types
**Depends on**: Phase 14
**Requirements**: SRCH-01, SRCH-02, SRCH-04
**Success Criteria** (what must be TRUE):
  1. Calling search_symbols with a method name (e.g., "tick") returns method results with SymbolKind Method/Constructor, not just type results
  2. The JDT LS readiness probe completes without triggering a result explosion — probe query uses a no-match sentinel instead of wildcard '*'
  3. search_symbols tool description accurately states it finds types and methods (not fields), matching actual behavior
  4. Method results include containerName identifying the declaring class
**Plans**: 1 plan

Plans:
- [x] 15-01-PLAN.md — Enable method declarations, remove readiness probe, update tool description

### Phase 16: Member Parser Domain Module
**Goal**: Pure domain types and parser that convert JDT LS detail strings into structured method/field representations
**Depends on**: Phase 15
**Requirements**: TYPE-01, TYPE-02
**Success Criteria** (what must be TRUE):
  1. MemberReference type (MethodReference | FieldReference) exists with ClassReference for parameter types and return types
  2. parseDetail() converts JDT LS detail strings like "(BlockPos, int) : BlockState" into structured ParameterInfo[] and returnType ClassReference
  3. Parser degrades gracefully on complex signatures (generics, varargs, annotations) — returns kind: "unresolved" ClassReferences rather than crashing
  4. Import map extraction resolves simple class names to fully qualified names from source file imports
**Plans**: TBD

Plans:
- [ ] 16-01: TBD
- [ ] 16-02: TBD

### Phase 17: Structured Member Output
**Goal**: list_members and search_symbols expose structured member types and FQNs in their output
**Depends on**: Phase 16
**Requirements**: SRCH-03, TYPE-03
**Success Criteria** (what must be TRUE):
  1. list_members output includes structured ParameterInfo[], returnType, and fieldType on method and field results respectively
  2. list_members output includes memberFqn (e.g., "MinecraftClient;tick()") on every method and field result
  3. search_symbols method results include memberFqn in the format "Class;method()" making results immediately actionable for downstream tools
**Plans**: TBD

Plans:
- [ ] 17-01: TBD
- [ ] 17-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 15 → 16 → 17

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
| 15. Enable Method Search | v1.2 | 1/1 | Complete    | 2026-04-14 |
| 16. Member Parser Domain Module | v1.2 | 0/? | Not started | - |
| 17. Structured Member Output | v1.2 | 0/? | Not started | - |
