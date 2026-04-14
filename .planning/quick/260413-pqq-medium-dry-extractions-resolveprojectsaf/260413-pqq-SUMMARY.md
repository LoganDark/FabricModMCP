---
phase: quick
plan: 260413-pqq
subsystem: tools
tags: [refactor, dry, tool-helpers]
dependency-graph:
  requires: [tool-helpers.ts, resolve-symbol-position.ts, envelope.ts]
  provides: [resolveProjectSafely, returnError]
  affects: [all-19-tool-files]
tech-stack:
  added: []
  patterns: [resolveProjectSafely-pattern, returnError-pattern, resolveSymbolPosition-delegation]
key-files:
  created: []
  modified:
    - src/tools/tool-helpers.ts
    - src/tools/find-definition.ts
    - src/tools/find-references.ts
    - src/tools/find-implementations.ts
    - src/tools/get-symbol-info.ts
    - src/tools/list-members.ts
    - src/tools/locate-in-source.ts
    - src/tools/read-source.ts
    - src/tools/type-hierarchy.ts
    - src/tools/read-jar-entry.ts
    - src/tools/list-packages.ts
    - src/tools/list-classes.ts
    - src/tools/search-classes.ts
    - src/tools/search-symbols.ts
    - src/tools/get-project-metadata.ts
    - src/tools/load-project.ts
    - src/tools/unload-project.ts
    - src/tools/configure-filters.ts
    - src/tools/refresh-dependencies.ts
    - src/tools/set-default-project.ts
decisions:
  - resolveProjectSafely returns discriminated union { ok: true/false } instead of throwing
  - returnError builds both content and structuredContent in one call
  - unload-project.ts restructured to use resolveProjectSafely at top level instead of wrapping entire body in try/catch
  - load-project.ts and set-default-project.ts keep projectStore import for non-resolveProject operations
metrics:
  duration: 13min
  completed: "2026-04-14T01:48:00Z"
---

# Quick Task 260413-pqq: DRY Extractions -- resolveProjectSafely + returnError + resolveSymbolPosition Migration

resolveProjectSafely() and returnError() extracted to tool-helpers.ts, eliminating ~500 lines of duplicated try/catch and makeError boilerplate across 19 tool files. find-definition.ts and find-references.ts migrated from inline cascade+jar resolution to shared resolveSymbolPosition().

## Task Results

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add resolveProjectSafely + returnError, migrate all 19 tool files | e9f43ab | 20 files (-329 net lines) |
| 2 | Migrate find-definition.ts to resolveSymbolPosition | 848e11f | 1 file (-64 net lines) |
| 3 | Migrate find-references.ts to resolveSymbolPosition | 1b0e407 | 1 file (-64 net lines) |

## What Changed

### tool-helpers.ts (new exports)

- `resolveProjectSafely(project?)` -- wraps projectStore.resolveProject in try/catch, returns `{ ok: true, project }` or `{ ok: false, error }` discriminated union
- `returnError(code, message, tried, suggestions?)` -- wraps makeError + MCP response shape construction into a single call

### All 19 tool files

- Replaced 10-line inline resolveProject try/catch blocks with 3-line resolveProjectSafely pattern
- Replaced all `const envelope = makeError(...); return { content, structuredContent }` patterns with `return returnError(...)`
- Removed unused `makeError` and `projectStore` imports where applicable

### find-definition.ts and find-references.ts

- Replaced ~100-line inline cascade+jar resolution blocks with single `resolveSymbolPosition()` call
- Removed 7 now-unused imports each (getFilteredDependencies, jarReader, createSourceAdapter, cascadeRegex, sortByPriority, classNameToEntryPath, LocateFailure, CascadeSuccess)
- Error handling now follows the same pattern as find-implementations.ts and get-symbol-info.ts

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- All 327 tests pass (38 test files, zero failures)
- No tool file contains inline `projectStore.resolveProject` (only tool-helpers.ts)
- No tool file imports `makeError` directly (only tool-helpers.ts)
- find-definition.ts and find-references.ts both use `resolveSymbolPosition()`
- Net reduction: ~457 lines removed across all commits
