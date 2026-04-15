# Requirements: MinecraftDevMCP

**Defined:** 2026-04-15
**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.

## v1.4 Requirements

Requirements for v1.4 Project Rearchitecture milestone. Each maps to roadmap phases.

### Container Model

- [x] **CONT-01**: Projects are pure named containers with only a name, children (fabric mods + study jars), filter config, and JDT LS session
- [x] **CONT-02**: Fabric mods are named children loaded from a root directory, each owning its own Gradle config, sources jar, dependencies, and fabric.mod.json
- [x] **CONT-03**: Study jars are named children at project level, not under any fabric mod
- [ ] **CONT-04**: A project can hold multiple fabric mods simultaneously
- [x] **CONT-05**: A default project named "default" is created at server startup
- [x] **CONT-06**: Each child (fabric mod or study jar) is responsible for serving requests about its own contents — the project delegates, not aggregates

### Dependency Resolution

- [ ] **DEP-01**: Fabric mod dependencies are namespaced by mod name within the project (e.g., `my-mod/minecraft`)
- [ ] **DEP-02**: A fabric mod's own source is accessible via its mod name as a jar ID (e.g., `my-mod`)
- [ ] **DEP-03**: Tools can operate across the whole project or be scoped to a single child via jar patterns
- [ ] **DEP-04**: `refresh_dependencies` can target a specific fabric mod child, not just the whole project

### Tool Integration

- [ ] **TOOL-01**: All existing jar-aware tools work with namespaced jar IDs
- [ ] **TOOL-02**: `load_project` adds a fabric mod child to a project (defaults to "default" project)
- [ ] **TOOL-03**: Tool results include namespaced jar IDs so the agent knows which child a result came from

### JDT LS

- [ ] **LSP-01**: One JDT LS workspace per project covers all children's sources
- [ ] **LSP-02**: Cross-mod navigation works (find-definition from one mod's source into another mod's dependencies)

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Persistence

- **PERS-01**: Project configuration can be persisted to a JSON file path specified via CLI
- **PERS-02**: Server restores project state from persistence file on startup

### Dependency Discovery

- **DISC-01**: Study jars can discover and expose their own transitive dependencies
- **DISC-02**: Study jar dependencies can be manually specified

### Convenience

- **CONV-01**: Short-form jar IDs (bare `minecraft`) resolve when only one fabric mod loaded
- **CONV-02**: `"src"` backward compat alias resolves to sole mod's source when one mod loaded

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-discovery of fabric mods in multi-mod repos | Gradle multi-project builds vary wildly; user explicitly loads each mod |
| Project nesting (projects containing projects) | One level of containment is sufficient |
| Renaming projects or children after creation | Unload + reload is sufficient; identity tracking is complex |
| Cross-project references | Projects are isolated; load both mods into same project if needed |
| Merging all deps into flat project-level map | Defeats namespacing purpose; children own their own resolution |
| JDT LS in-memory file support | Rejected by research — JDT LS requires real files on disk (Issue #1815) |
| Persistence / serialization | Deferred to future milestone; projects load fast, keep ephemeral |
| Automatic JDT LS restart on child add/remove | Incremental sync is cheaper; already proven in v1.1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONT-01 | Phase 23 | Complete |
| CONT-02 | Phase 23 | Complete |
| CONT-03 | Phase 23 | Complete |
| CONT-04 | Phase 25 | Pending |
| CONT-05 | Phase 23 | Complete |
| CONT-06 | Phase 23 | Complete |
| DEP-01 | Phase 24 | Pending |
| DEP-02 | Phase 24 | Pending |
| DEP-03 | Phase 24 | Pending |
| DEP-04 | Phase 25 | Pending |
| TOOL-01 | Phase 25 | Pending |
| TOOL-02 | Phase 25 | Pending |
| TOOL-03 | Phase 25 | Pending |
| LSP-01 | Phase 26 | Pending |
| LSP-02 | Phase 26 | Pending |

**Coverage:**
- v1.4 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-04-15*
*Last updated: 2026-04-15 after roadmap creation*
