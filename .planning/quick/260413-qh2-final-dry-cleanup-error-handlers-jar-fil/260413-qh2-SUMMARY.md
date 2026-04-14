---
phase: quick
plan: 260413-qh2
subsystem: tools, browsing
tags: [refactor, dry, cleanup]
dependency_graph:
  requires: [260413-pin, 260413-pqq, 260413-q5n]
  provides: [handleSymbolPositionError, handleClassSourceError, filterDependenciesByJarPattern, entry-index-cache, centralized-types]
  affects: [tool-helpers.ts, 12 consumer files, browsing/types.ts]
tech_stack:
  added: []
  patterns: [shared-error-handler, centralized-cache, canonical-type-location]
key_files:
  created:
    - src/browsing/entry-index-cache.ts
  modified:
    - src/tools/tool-helpers.ts
    - src/tools/find-definition.ts
    - src/tools/find-references.ts
    - src/tools/find-implementations.ts
    - src/tools/get-symbol-info.ts
    - src/tools/list-members.ts
    - src/tools/type-hierarchy.ts
    - src/tools/read-source.ts
    - src/tools/list-packages.ts
    - src/tools/list-classes.ts
    - src/tools/locate-in-source.ts
    - src/browsing/search.ts
    - src/browsing/types.ts
decisions:
  - handleSymbolPositionError uses type narrowing cast for not-found fallback
  - CATEGORY_PRIORITY stays imported in search.ts for results sorting (line 177-178)
  - picomatch import stays in search.ts for FQN pattern matching
metrics:
  duration: 7min
  completed: "2026-04-14T02:13:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 13
  files_created: 1
  lines_removed: ~298
  lines_added: ~63
---

# Quick Task 260413-qh2: Final DRY Cleanup -- Error Handlers, Jar Filtering, Entry Index Cache

Extracted six remaining DRY patterns into shared helpers: handleSymbolPositionError (4 consumers), handleClassSourceError (3 consumers), filterDependenciesByJarPattern (3 consumers), unified EntryIndex cache, sortByPriority reuse in search.ts, and three interfaces moved to browsing/types.ts.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Extract error handlers, jar filtering, entry-index-cache | bd16aff | Added 3 functions to tool-helpers.ts, created entry-index-cache.ts |
| 2 | Update all consumers, move types | 26a479d | Replaced duplicated code in 12 files, moved 3 interfaces to browsing/types.ts |

## What Changed

### New Shared Helpers in tool-helpers.ts

- **handleSymbolPositionError()**: Replaces identical ~40-line error handling blocks in find-definition, find-references, find-implementations, get-symbol-info
- **handleClassSourceError()**: Replaces identical ~8-line error handling blocks in list-members, type-hierarchy, read-source
- **filterDependenciesByJarPattern()**: Replaces identical picomatch jar filtering in list-packages, list-classes, search

### New Module: browsing/entry-index-cache.ts

Unified the EntryIndex cache that was previously duplicated in list-packages.ts and search.ts. Exports: entryIndexCache, getOrBuildIndex, clearEntryIndexCache.

### Types Moved to browsing/types.ts

- **LocateResult** (from locate-in-source.ts)
- **TransformedSymbol** (from list-members.ts)
- **SourceResult** (from read-source.ts)

### sortByPriority Reuse

search.ts now uses the shared sortByPriority function instead of reimplementing the same sorting logic inline.

## Net Code Reduction

-298 lines removed, +63 lines added across 12 consumer files. The shared helpers themselves added ~100 lines to tool-helpers.ts and entry-index-cache.ts, for a net reduction of ~135 lines of duplicated code.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

All 327 tests pass with zero failures. No behavioral changes. TypeScript compiles with only pre-existing type errors (unrelated to this refactor).

## Self-Check: PASSED
