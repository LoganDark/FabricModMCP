---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Project Rearchitecture
status: unknown
stopped_at: Completed 26-01-PLAN.md
last_updated: "2026-04-15T23:05:33.332Z"
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 15
  completed_plans: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.
**Current focus:** Phase 26 — jdt-ls-workspace-unification

## Current Position

Phase: 26 (jdt-ls-workspace-unification) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**v1.3 Velocity:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 19 P01 | 1min | 1 | 2 |
| Phase 19 P02 | 2min | 2 | 4 |
| Phase 20 P01 | 3min | 1 | 4 |
| Phase 20 P02 | 4min | 2 | 3 |
| Phase 21 P01 | 2min | 2 | 3 |
| Phase 21 P02 | 4min | 2 | 6 |
| Phase 22 P01 | 4min | 2 | 12 |
| Phase 22 P02 | 12min | 3 | 11 |
| Phase 22 P03 | 2min | 2 | 4 |

**Total:** 9 plans, 34min, 17 tasks, 49 files
| Phase 23 P01 | 2min | 3 tasks | 4 files |
| Phase 23 P02 | 7min | 2 tasks | 11 files |
| Phase 23 P03 | 15min | 3 tasks | 30 files |
| Phase 23 P04 | 1min | 1 tasks | 1 files |
| Phase 24 P01 | 7min | 2 tasks | 13 files |
| Phase 24 P02 | 5min | 2 tasks | 9 files |
| Phase 24 P03 | 13min | 2 tasks | 25 files |
| Phase 25-01 P01 | 4min | 2 tasks | 8 files |
| Phase 25 P02 | 4min | 2 tasks | 6 files |
| Phase 25.1 P01 | 5min | 2 tasks | 19 files |
| Phase 25.1 P03 | 5min | 2 tasks | 14 files |
| Phase 25.1 P02 | 5min | 2 tasks | 12 files |
| Phase 25.1 P04 | 7min | 2 tasks | 30 files |
| Phase 26 P01 | 5min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full decision log.

- v1.4: Dependencies resolve per-child, NOT merged at project level — project delegates to children
- v1.4: JDT LS in-memory files rejected (Issue #1815) — tmpdir extraction remains
- v1.4: LoadedProject kept as compat alias during migration, removed only in Phase 27
- [Phase 23]: StudyJar interface kept alongside StudyJarChild -- StudyJar is internal, StudyJarChild adds kind discriminant
- [Phase 23]: load-project tool updated inline (Rule 3) to wrap FabricModChild into Project
- [Phase 23]: All tool files migrated to compat accessors; test factory split into makeFakeFabricMod + makeFakeProject
- [Phase 24]: Namespace separator is '/' -- resolveJarId detects via includes('/') check
- [Phase 24]: resolveJarId parameter order: (project, jarId, scope) -- project first for consistency
- [Phase 24]: Fallback Fabric API entry also gets namespaced ID for consistency
- [Phase 24]: autoIncludeIds parameter is optional -- existing callers keep working until Plan 03 wires them
- [Phase 24]: resolve-symbol-position evolved to use getDependenciesForTool for scope consistency
- [Phase 24]: get-project-metadata with scope returns child-specific dep inventory
- [Phase 25]: load_project defaults to 'default' project instead of auto-generating from basename
- [Phase 25]: Child auto-suffix uses -2, -3 pattern; JDT LS workspace sync deferred to Phase 26
- [Phase 25]: Scoped refresh uses removeProjectJar/addProjectJar per-jar, never closeProject/registerProject
- [Phase 25]: Scoped collision check uses autoUnloadConflictingStudyJarsForDeps against refreshed child's deps only
- [Phase 25]: Scoped unload rebuilds .classpath and notifies JDT LS after removing child workspace entries
- [Phase 25.1]: LoadedProject alias removed entirely rather than deprecated -- no consumers outside this codebase
- [Phase 25.1]: get_project_info always returns full member list, no toggle flags
- [Phase 25.1]: list_projects simplified to name/memberCount/activeChild/isActive -- use get_project_info for details
- [Phase 25.1]: add_fabric_mod auto-registers project with jar reader if not yet registered (handles create_project -> add_fabric_mod flow)
- [Phase 25.1]: getRootPathForScope returns undefined instead of throwing -- createSourceAdapter guards with DomainError
- [Phase 26]: Mod-source deps extract under fabricMod.name dir, not dep.id dir -- keeps mod source at clean path
- [Phase 26]: Dual-key jarIdToDirName: both dep.id and fabricMod.name point to same mod-source dir

### Roadmap Evolution

- Phase 25.1 inserted after Phase 25: Rework tools and tests for native architecture without compatibility shims (URGENT)

### Pending Todos

None.

### Blockers/Concerns

- Phase 26 (JDT LS): Multi-mod workspace with overlapping classes (different MC versions) unvalidated — needs research spike before implementation

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-81t | Remove study: prefix from study jar IDs | 2026-04-15 | c46f7c2 | [260415-81t-remove-study-prefix-from-study-jar-ids](./quick/260415-81t-remove-study-prefix-from-study-jar-ids/) |
| 260415-8hc | Split innerClasses into separate detail flag | 2026-04-14 | 7cf52c0 | [260415-8hc-split-innerclasses-into-separate-detail-](./quick/260415-8hc-split-innerclasses-into-separate-detail-/) |

## Session Continuity

Last session: 2026-04-15T23:05:33.330Z
Stopped at: Completed 26-01-PLAN.md
Resume file: None
