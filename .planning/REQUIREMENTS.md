# Requirements: MinecraftDevMCP

**Defined:** 2026-04-15
**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.

## v1.5 Requirements

Requirements for v1.5 Quality & Consistency milestone. Derived from comprehensive 4-agent codebase audit.

### Documentation

- [ ] **DOC-01**: Each JDT LS-dependent tool description states the JDT LS requirement, and SERVER_INSTRUCTIONS explains what JDT LS is and how to check availability
- [ ] **DOC-02**: SERVER_INSTRUCTIONS documents the response envelope structure (`{ ok, data }` / `{ ok, code, message, tried, suggestions }`)
- [ ] **DOC-03**: SERVER_INSTRUCTIONS includes study jar workflow, scope dual-effect explanation, refresh guidance, and configure_filters mention
- [ ] **DOC-04**: All tool descriptions accurately match their actual input schemas, response fields, and behavior (fixes: locate_in_source matchedText, list_study_jars totalEntries, create_project JDT LS init, read_member FQN format, type_hierarchy depth semantics, set_active_child description, configure_filters pattern example, search_symbols field kind note)
- [ ] **DOC-05**: CLAUDE.md sections filled in (Architecture, Conventions, Project Structure) with stale Phase references removed

### Pagination & API Consistency

- [x] **API-01**: All paginated tools return both `limit` and `hasMore` in response envelopes
- [x] **API-02**: `search_classes` parameter renamed from `pattern` to `query`
- [x] **API-03**: `remove_project_member` parameter renamed from `members` to `names`
- [x] **API-04**: `search_symbols` default limit removed (return all by default like other tools)
- [x] **API-05**: `search_classes` kind filter uses z.enum validation instead of unvalidated string array
- [x] **API-06**: `field` removed from `search_symbols` kind enum with documentation that field search is not supported
- [x] **API-07**: `javadoc` field removed from `get_symbol_info` response (always empty), TODO comment left for future

### Bug Fixes

- [x] **FIX-01**: `remove_project` evicts entryIndexCache for all project jar paths
- [x] **FIX-02**: JDT LS data directory cleaned up on server exit and catchable termination signals
- [x] **FIX-03**: `JarReader.getHandle()` prevents race conditions by avoiding await in critical section
- [x] **FIX-04**: `type_hierarchy` supertype walk has cycle detection (retains seen set, bails on loop)
- [x] **FIX-05**: `read_source` handles inner class FQNs by stripping `$Inner` to find outer class file
- [x] **FIX-06**: `syncFabricModToWorkspace` cleans up extracted files on partial failure
- [x] **FIX-07**: `read_jar_entry` error message references `list_packages`/`list_classes` instead of non-existent `listEntries`
- [x] **FIX-08**: `add_study_jar` includes provenance metadata in makeSuccess call

### Behavioral Improvements

- [x] **BEH-01**: `getDependenciesForTool` without scope applies each child's own filter to its own jar set rather than applying one mod's filter to merged results
- [x] **BEH-02**: `refresh_project` and `refresh_project_members` re-parse build files (gradle.properties, build.gradle.kts, fabric.mod.json) not just re-scan jar files

### Data Exposure

- [x] **DATA-01**: `get_project_info` includes JDT LS availability status and failure reason per project
- [x] **DATA-02**: `get_member_info` exposes GradleConfig.dependencies (declared build dependencies with configuration, group, artifact, version)
- [x] **DATA-03**: `type_hierarchy` ClassReference output includes jar ID for each supertype/subtype
- [x] **DATA-04**: `list_members` compact output includes FQN for inner class entries

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Navigation

- **NAV-01**: FQN-based navigation shortcut for LSP tools (optional `memberFqn` param as alternative to `match` patterns)

### Search

- **SRCH-01**: Annotation-based search (find classes/methods by annotation like @Mixin, @Inject)

### Diagnostics

- **DIAG-01**: Server health/diagnostic tool (open jar count, JDT LS status, cache sizes, workspace sync status)

### Batch Operations

- **BATCH-01**: Batch class reading (read_sources accepting multiple FQNs)
- **BATCH-02**: Batch member listing (list_members for multiple classes)

### Input Flexibility

- **FLEX-01**: Inner class dot notation tolerance (accept `Outer.Inner` as well as `Outer$Inner`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mixin-specific tooling (injection point analysis) | Get the symbol foundation right first |
| Code generation / writing files | This is a read/analysis server |
| Non-Fabric toolchains (Forge, NeoForge, Quilt) | Fabric + Loom only for now |
| list_members regex fallback without JDT LS | Java regex parsing too fragile |
| Annotation filtering in search_classes | Requires full file reads — major performance hit |
| cascadeRegex timeout | User-provided patterns are trusted input |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOC-01 | Phase 34 | Pending |
| DOC-02 | Phase 34 | Pending |
| DOC-03 | Phase 34 | Pending |
| DOC-04 | Phase 34 | Pending |
| DOC-05 | Phase 34 | Pending |
| API-01 | Phase 30 | Complete |
| API-02 | Phase 30 | Complete |
| API-03 | Phase 30 | Complete |
| API-04 | Phase 30 | Complete |
| API-05 | Phase 30 | Complete |
| API-06 | Phase 30 | Complete |
| API-07 | Phase 30 | Complete |
| FIX-01 | Phase 28 | Complete |
| FIX-02 | Phase 29 | Complete |
| FIX-03 | Phase 28 | Complete |
| FIX-04 | Phase 29 | Complete |
| FIX-05 | Phase 29 | Complete |
| FIX-06 | Phase 29 | Complete |
| FIX-07 | Phase 28 | Complete |
| FIX-08 | Phase 28 | Complete |
| BEH-01 | Phase 32 | Complete |
| BEH-02 | Phase 33 | Complete |
| DATA-01 | Phase 31 | Complete |
| DATA-02 | Phase 31 | Complete |
| DATA-03 | Phase 31 | Complete |
| DATA-04 | Phase 31 | Complete |

**Coverage:**
- v1.5 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-04-15*
*Last updated: 2026-04-15 after roadmap creation*
