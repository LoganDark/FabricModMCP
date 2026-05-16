---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: Windows Support
status: executing
stopped_at: Phase 37 context gathered
last_updated: "2026-05-16T12:40:33.465Z"
last_activity: 2026-05-16 -- Phase 37 execution started
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 10
  completed_plans: 6
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.
**Current focus:** Phase 37 — smarter-java-discovery-cross-platform

## Current Position

Phase: 37 (smarter-java-discovery-cross-platform) — EXECUTING
Plan: 1 of 4
Status: Executing Phase 37
Last activity: 2026-05-16 -- Phase 37 execution started

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full decision log.

- [Phase quick]: compiledJarPath nullable on DependencyEntry, optional on StudyJar; source param defaults to sources for backward compat

### Pending Todos

None.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260415-81t | Remove study: prefix from study jar IDs | 2026-04-15 | c46f7c2 |  | [260415-81t-remove-study-prefix-from-study-jar-ids](./quick/260415-81t-remove-study-prefix-from-study-jar-ids/) |
| 260415-8hc | Split innerClasses into separate detail flag | 2026-04-14 | 7cf52c0 |  | [260415-8hc-split-innerclasses-into-separate-detail-](./quick/260415-8hc-split-innerclasses-into-separate-detail-/) |
| 260415-reo | Fix v1.5 audit tech debt | 2026-04-16 | bbb3f90 |  | [260415-reo-fix-v1-5-audit-tech-debt-datadir-cleanup](./quick/260415-reo-fix-v1-5-audit-tech-debt-datadir-cleanup/) |
| 260415-tn5 | Gradle property substitution in fabric.mod.json | 2026-04-16 | 843e661 |  | [260415-tn5-investigate-why-the-mod-at-fabric-templa](./quick/260415-tn5-investigate-why-the-mod-at-fabric-templa/) |
| 260415-txd | Fix search_symbols to use entryPath in location.uri | 2026-04-15 | d8a1630 |  | [260415-txd-fix-search-symbols-to-use-entrypath-from](./quick/260415-txd-fix-search-symbols-to-use-entrypath-from/) |
| 260421-qah | Improve empty workspace error messages | 2026-04-21 | 6b6fe8c |  | [260421-qah-improve-empty-workspace-error-messages-f](./quick/260421-qah-improve-empty-workspace-error-messages-f/) |
| 260421-tes | Support reading resource files from jars | 2026-04-21 | 9900aec |  | [260421-tes-support-reading-resource-files-from-jars](./quick/260421-tes-support-reading-resource-files-from-jars/) |
| 260424-hn5 | Add Large Responses pagination guidance to SERVER_INSTRUCTIONS | 2026-04-24 | 9bcbe1d |  | [260424-hn5-in-the-server-instructions-be-clear-that](./quick/260424-hn5-in-the-server-instructions-be-clear-that/) |
| 260426-2bj | Fix Minecraft source jar detection for per-project Loom cache | 2026-04-26 | 9826d30 | Verified | [260426-2bj-fix-minecraft-source-jar-detection-for-p](./quick/260426-2bj-fix-minecraft-source-jar-detection-for-p/) |
| 260426-jwh | Fix sources detection for newer-Loom unmapped bare-prefix layout (Pockets) | 2026-04-26 | 5989bd1 |  | [260426-jwh-the-minecraft-sources-in-users-logandark](./quick/260426-jwh-the-minecraft-sources-in-users-logandark/) |
| 260426-kwv | Drop downloadSources suggestion from MCP tool response envelopes | 2026-04-26 | c195fa6 |  | [260426-kwv-llms-keep-getting-confused-by-the-sugges](./quick/260426-kwv-llms-keep-getting-confused-by-the-sugges/) |
| 260428-4zp | Investigate auxcommands dep-source failure (CreatorCore/Claude) | 2026-04-28 | 157439d | Investigation | [260428-4zp-investigate-why-the-users-logandark-docu](./quick/260428-4zp-investigate-why-the-users-logandark-docu/) |
| 260428-59m | Support local Maven repositories (file://, mavenLocal) for dep sources | 2026-04-28 | 26602d2 | Verified | [260428-59m-support-local-maven-repositories](./quick/260428-59m-support-local-maven-repositories/) |
| 260428-5ol | Prefer Loom-cache remapped sources for mod deps | 2026-04-28 | 3319de9 | Verified | [260428-5ol-prefer-loom-cache-remapped-sources-for-m](./quick/260428-5ol-prefer-loom-cache-remapped-sources-for-m/) |
| 260507-nff | Add record_feedback tool inspired by lldb-mcp | 2026-05-07 | 057e0cb |  | [260507-nff-add-record-feedback-tool-inspired-by-lld](./quick/260507-nff-add-record-feedback-tool-inspired-by-lld/) |
| 260515-6c5 | Fix gradle-parser top-level block extraction (buildscript wrapper) | 2026-05-15 | 1fa14c8 |  | [260515-6c5-fix-gradle-parser-top-level-block-extrac](./quick/260515-6c5-fix-gradle-parser-top-level-block-extrac/) |
| 260515-d0i | Add --java-home CLI flag for JDT LS | 2026-05-15 | 4e94b4b | Verified | [260515-java-home-flag](./quick/260515-java-home-flag/) |

## Session Continuity

Last session: 2026-05-16T10:55:13.558Z
Stopped at: Phase 37 context gathered
Resume file: .planning/phases/37-smarter-java-discovery-cross-platform/37-CONTEXT.md
