---
phase: quick
plan: 260413-pin
status: complete
completed: "2026-04-14T01:30:30Z"
duration: "5min"
tasks_completed: 2
tasks_total: 2
files_created:
  - src/tools/tool-helpers.ts
files_modified:
  - src/tools/find-definition.ts
  - src/tools/find-references.ts
  - src/tools/find-implementations.ts
  - src/tools/list-members.ts
  - src/tools/type-hierarchy.ts
  - src/tools/read-source.ts
  - src/tools/locate-in-source.ts
  - src/tools/resolve-symbol-position.ts
  - src/browsing/search.ts
  - src/tools/list-classes.ts
  - src/tools/list-packages.ts
key-decisions:
  - "Used actual LocateFailure interface from codebase (with CascadeStep[]) instead of plan's simplified version"
  - "Kept search.ts entryIndexCache independent from list-packages cache to avoid behavior change"
  - "Extracted classNameToEntryPath from search.ts too (not in plan) since it had the same inline duplication"
---

# Quick Task 260413-pin: Trivial DRY Extractions - Shared Tool Helpers

Extracted 5 duplicated utilities from 10+ tool files into shared src/tools/tool-helpers.ts, removing ~302 lines of duplication with zero behavior changes.

## Task Summary

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Create tool-helpers.ts with all shared utilities | 616715c | Created tool-helpers.ts with 5 exports; exported getOrBuildIndex from list-packages.ts |
| 2 | Update all tool files to use shared helpers | a34605c | Updated 10 files to import from tool-helpers.ts; removed all local duplicates |

## What Changed

### Created: src/tools/tool-helpers.ts
Single source of truth exporting:
- `CATEGORY_PRIORITY` - jar category ordering constant (was in 8 files)
- `sortByPriority()` - dependency entry sorting (was in 8 files)
- `classNameToEntryPath()` - FQN to jar entry path conversion (was inline in 9 files)
- `normalizeLocations()` - LSP Location/LocationLink[] normalizer (was in 2 files)
- `LocateFailure` - cascade failure interface (was in 3 files)

### Modified: src/tools/list-packages.ts
- Exported `getOrBuildIndex` and `entryIndexCache` for reuse by list-classes.ts

### Updated consumers (10 files)
All tool files now import shared utilities instead of defining their own copies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used actual LocateFailure interface instead of plan's simplified version**
- **Found during:** Task 1
- **Issue:** Plan specified a simplified LocateFailure with {className, jar, category: string, reason} but actual codebase uses {jar, category: JarCategory, provenanceChains, steps: CascadeStep[], failedStep, error?}
- **Fix:** Used the real interface from the codebase to avoid type errors
- **Files modified:** src/tools/tool-helpers.ts

**2. [Rule 2 - Missing] Extracted classNameToEntryPath from search.ts too**
- **Found during:** Task 2
- **Issue:** search.ts had the same inline FQN-to-path conversion that wasn't explicitly mentioned in the plan
- **Fix:** Added classNameToEntryPath import to search.ts and removed the inline copy
- **Files modified:** src/browsing/search.ts

## Verification

- All 327 tests pass (38 test files)
- `grep -r 'const CATEGORY_PRIORITY' src/tools/ src/browsing/` returns only tool-helpers.ts
- `grep -rn 'function sortByPriority' src/tools/ src/browsing/` returns only tool-helpers.ts
- `grep -rn 'interface LocateFailure' src/tools/` returns only tool-helpers.ts
- `grep -rn 'function normalizeLocations' src/tools/` returns only tool-helpers.ts
