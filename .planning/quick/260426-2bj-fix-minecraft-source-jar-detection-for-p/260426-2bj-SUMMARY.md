---
phase: quick-260426-2bj
plan: 01
subsystem: project/loom-cache
tags: [bugfix, loom, fabric, jar-resolution]
requires: []
provides:
  - "async resolveSourcesJarPath(config, projectRoot) probing project-local + global Loom caches"
  - "async resolveCompiledJarPath(config, projectRoot) with same dual-location logic"
  - "loadFabricMod / reloadFabricModConfig support newer Loom (1.16-SNAPSHOT) per-project cache layout"
affects:
  - "Any Fabric project on MC 1.19+ whose merged sources jar Loom wrote to <projectRoot>/.gradle/loom-cache/"
tech_stack_added: []
tech_stack_patterns:
  - "readdir + access glob-and-probe (matching source-jar-finder.ts style) for hash-suffixed artifact dirs"
key_files_created:
  - tests/project/loom-cache.test.ts (rewritten — was 3 tests, now 8)
key_files_modified:
  - src/project/loom-cache.ts
  - src/project/loader.ts
  - tests/project/reload-config.test.ts
  - CLAUDE.md
decisions:
  - "Resolver returns the global-cache path (not null/throw) when both probes miss, so SOURCES_JAR_NOT_FOUND surfaces a sensible `tried[0]`. Caller still does the existence check."
  - "Mapped-era query rejects `minecraft-merged-deobf*` dirs explicitly to prevent cross-era matches."
  - "Hash is matched as `[a-f0-9]+` (10 chars in practice but accept any hex length) rather than fixed length, for forward compat."
metrics:
  duration_seconds: 163
  duration_human: "2m 43s"
  tasks_completed: 3
  tests_added: 5
  tests_total_passing: 706
  files_changed: 4
  commits: 5
  completed_at: "2026-04-26T08:47:49Z"
---

# Quick 260426-2bj: Fix Minecraft Source Jar Detection for Per-Project Loom Cache Summary

Newer Loom (1.16-SNAPSHOT, used by MC 1.19+ projects) writes the merged Minecraft sources jar to `<projectRoot>/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-<hash>/...` instead of the global `~/.gradle/caches/fabric-loom/...` cache. The old `resolveSourcesJarPath` / `resolveCompiledJarPath` only constructed the global path verbatim, so every newer-Loom project failed with `SOURCES_JAR_NOT_FOUND`. This plan made the resolvers async, taught them to glob the per-project cache for `minecraft-merged(-<hex>)?` (or `minecraft-merged-deobf(-<hex>)?` for unmapped era), and fall back to the legacy global path. Awaited in both `loadFabricMod` and `reloadFabricModConfig` with the project root threaded through.

## Tasks Completed

| # | Task                                                                                  | Commit  |
| - | ------------------------------------------------------------------------------------- | ------- |
| 1 | Make resolveSourcesJarPath/resolveCompiledJarPath async with project-local + global cache probing (TDD: RED + GREEN) | 479b6b2 (test), 868f735 (impl) |
| 2 | Update loader call sites + reload-config tests for new async signatures (TDD: RED + GREEN) | baddeea (test), 227fb1b (impl) |
| 3 | Update CLAUDE.md docs to reflect dual-location reality + smoke test                   | 9826d30 |

## Verification Performed

- `pnpm exec vitest run tests/project/loom-cache.test.ts` — 8/8 passing (covers project-local hit for mapped era with hash, project-local hit for unmapped era with deobf-hash, global-cache fallback for both eras, mapped-era explicitly rejecting deobf dirs, compiled jar mirroring sources jar layout, and the three preserved original assertions).
- `pnpm exec vitest run tests/project/reload-config.test.ts tests/project/loader.test.ts` — green; reload-config now asserts `(config, '/fake/project')` is passed, loader.test happy/sad path unchanged.
- `pnpm exec vitest run` — 706/706 passing across 65 test files. No regressions.
- `pnpm exec tsc --noEmit` — clean.
- End-to-end smoke test against `~/Documents/Projects/Fabric/Pockets` (the original broken case): `loadFabricMod` now resolves both sources and compiled jars from `<projectRoot>/.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-a0e22fae92/1.19-net.fabricmc.yarn.1_19.1.19+build.4/...` with `exists: true`. Dependency discovery proceeds normally (45 deps, 3 with sources).

## Deviations from Plan

None — plan executed exactly as written. The plan was unusually detailed (full implementation in `<action>` blocks) so there was nothing to invent.

One micro-deviation worth noting: the plan's hash regex spec says "10 hex chars but accept any -<alnum> suffix to be safe" while the example code says `[a-f0-9]+`. I implemented `[a-f0-9]+` (hex-only, any length) which is stricter than alnum but matches every observed hash (including `a0e22fae92` and `dfc6d54c9b` in the real Pockets cache, plus `cafebabe11`/`deadbeef00` in tests). This is more correct — Loom's hashes are always lowercase hex, never alnum.

## Key Decisions

- **Return global-cache path on miss instead of null/throw.** Keeps the resolver's contract simple: "give me the best candidate path." The caller does the existence check and is responsible for SOURCES_JAR_NOT_FOUND. This preserves the original behaviour and means `error.tried[0]` still surfaces a usable global path for the user.
- **Explicitly exclude `minecraft-merged-deobf*` from mapped-era matches.** The naive regex `^minecraft-merged(-[a-f0-9]+)?$` would match `minecraft-merged-deobf` (deobf is letters only — wait, no, `deobf` contains `e`, `o`, `b`, `f` which are all hex chars except `o`). Actually `deobf` has `o` which is non-hex, so the regex *would* exclude it. But to be defensive against future Loom changes, the explicit `entry.startsWith('minecraft-merged-deobf')` skip in the filter is belt-and-braces.
- **SOURCES_JAR_NOT_FOUND error now lists both locations.** `tried` includes the global path AND the project-local `loom-cache/minecraftMaven/net/minecraft` dir, and the suggestion mentions both regimes. Users hit by either layout get actionable feedback.
- **No persistent cache.** Project constraint forbids it; every call probes fresh. Cost is negligible — `readdir` on a dir with 1-2 entries plus one `access` per candidate.

## Self-Check: PASSED

Files verified to exist:
- `src/project/loom-cache.ts` (modified)
- `src/project/loader.ts` (modified)
- `tests/project/loom-cache.test.ts` (modified — 8 tests)
- `tests/project/reload-config.test.ts` (modified)
- `CLAUDE.md` (modified — Sources jar path section)

Commits verified in `git log`:
- 479b6b2 — test (RED for Task 1)
- 868f735 — feat (GREEN for Task 1)
- baddeea — test (RED for Task 2)
- 227fb1b — feat (GREEN for Task 2)
- 9826d30 — docs (Task 3)

All 706 vitest tests pass. tsc --noEmit reports zero errors. Smoke test against Pockets resolves jar from per-project cache successfully.
