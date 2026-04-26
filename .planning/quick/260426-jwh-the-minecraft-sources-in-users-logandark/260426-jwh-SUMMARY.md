---
phase: quick-260426-jwh
plan: 01
subsystem: project
tags: [loom, fabric, gradle, sources-jar, project-cache]

requires:
  - phase: quick-260426-2bj
    provides: per-project Loom cache resolver with hashed-dir probing for both eras
provides:
  - Bare `minecraft-merged-<hash>` probe for unmapped era in per-project Loom cache
  - Regression coverage for newer-Loom Pockets layout (MC 26.1, no yarn mappings)
affects: [project loading, sources jar resolution, Pockets-class projects]

tech-stack:
  added: []
  patterns:
    - "Era-encoded version, era-agnostic artifact prefix in newer Loom per-project cache"

key-files:
  created: []
  modified:
    - src/project/loom-cache.ts
    - tests/project/loom-cache.test.ts
    - CLAUDE.md

key-decisions:
  - "Add an unmapped-only secondary probe with the bare `minecraft-merged` prefix instead of broadening probeProjectLocal — preserves the mapped-era guard against deobf cross-matches byte-identically"
  - "Leave globalCachePath unchanged — the global cache really does use `-deobf` for unmapped era (verified against user's `~/.gradle/caches/fabric-loom/.../minecraft-merged-deobf/26.1.2/`)"

patterns-established:
  - "Era-prefix is the primary probe; bare prefix is an unmapped-era fallback. Era is encoded in the version string in newer Loom layouts."

requirements-completed:
  - LOOM-CACHE-UNMAPPED-BARE-PREFIX

duration: 2min
completed: 2026-04-26
---

# Phase quick-260426-jwh Plan 01: Sources Detection for Newer-Loom Unmapped Bare Prefix Summary

**Probes bare `minecraft-merged-<hash>` for unmapped-era per-project Loom caches, fixing Pockets (MC 26.1) sources-jar detection without disturbing mapped-era or global-cache behaviour.**

## Performance

- **Duration:** ~2 min (91s)
- **Started:** 2026-04-26T21:23:33Z
- **Completed:** 2026-04-26T21:25:04Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Pockets (`/Users/LoganDark/Documents/Projects/Fabric/Pockets`) now resolves both `sourcesJar` and `compiledJar` with `exists: true` at `.gradle/loom-cache/.../minecraft-merged-374c84699f/26.1/...`.
- Two new regression tests (sources + compiled) lock in the bare-prefix unmapped-era layout.
- All 708 tests pass; `tsc --noEmit` clean.
- CLAUDE.md updated to document the dual unmapped layouts (newer Loom bare prefix vs. older `-deobf` prefix).

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing regression tests for bare-prefix unmapped layout** — `46f87ad` (test)
2. **Task 2: GREEN — extend resolveSourcesJarPath / resolveCompiledJarPath with bare-prefix unmapped probe** — `ba43e2f` (fix)
3. **Task 3: Update CLAUDE.md sources-jar docs** — `5989bd1` (docs)

## Files Created/Modified

- `tests/project/loom-cache.test.ts` — Added two regression tests reproducing the Pockets bare-prefix layout (sources and compiled).
- `src/project/loom-cache.ts` — Added unmapped-only secondary `probeProjectLocal('minecraft-merged', version, ...)` calls in `resolveSourcesJarPath` and `resolveCompiledJarPath`, gated behind `mappingEra === 'unmapped'`.
- `CLAUDE.md` — Per-project cache bullet now states both eras use the bare `minecraft-merged-<hash>` prefix in newer Loom and the resolver probes both `-deobf-<hash>` and bare `<hash>` for unmapped era.

## Decisions Made

- **Dual probe over broadened helper:** Kept `probeProjectLocal` semantics unchanged (the mapped-era guard against `minecraft-merged-deobf*` lives there) and instead added an explicit unmapped-only second call with the bare prefix. Preserves the existing "mapped era rejects deobf-*" test byte-identically.
- **Global cache untouched:** User's `~/.gradle/caches/fabric-loom/.../minecraft-merged-deobf/26.1.2/...` confirms the global cache still uses `-deobf` for unmapped era. Only the per-project probe needed extension.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Pockets and other newer-Loom unmapped-era projects load cleanly.
- Older `minecraft-merged-deobf-<hash>` per-project layouts still resolve (test in place).
- No follow-up work identified.

## Self-Check: PASSED

Verified files and commits exist:
- FOUND: tests/project/loom-cache.test.ts (modified)
- FOUND: src/project/loom-cache.ts (modified)
- FOUND: CLAUDE.md (modified)
- FOUND: 46f87ad (test commit)
- FOUND: ba43e2f (fix commit)
- FOUND: 5989bd1 (docs commit)
- Verified: `pnpm exec vitest run` → 708/708 pass
- Verified: `pnpm exec tsc --noEmit` → 0 errors
- Verified: `loadFabricMod('/Users/LoganDark/Documents/Projects/Fabric/Pockets')` → `sourcesJar.exists: true`, `compiledJar.exists: true`

---
*Phase: quick-260426-jwh*
*Completed: 2026-04-26*
