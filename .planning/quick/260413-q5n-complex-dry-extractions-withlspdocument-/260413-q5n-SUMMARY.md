---
phase: quick
plan: 260413-q5n
subsystem: tools
tags: [refactoring, DRY, LSP]
key-files:
  created: []
  modified:
    - src/tools/tool-helpers.ts
    - src/tools/find-definition.ts
    - src/tools/find-references.ts
    - src/tools/find-implementations.ts
    - src/tools/get-symbol-info.ts
    - src/tools/list-members.ts
    - src/tools/type-hierarchy.ts
    - src/tools/read-source.ts
decisions:
  - withLspDocument uses try/finally to guarantee didClose even on error
  - resolveClassSource returns discriminated union for type-safe error handling
  - read-source uses resolveClassSource only for specific-jar path (all-jars has different collect-all semantics)
metrics:
  duration: 5min
  completed: "2026-04-14T01:57:28Z"
---

# Quick Task 260413-q5n: Complex DRY Extractions - withLspDocument + resolveClassSource

**One-liner:** Extracted withLspDocument (didOpen/try/finally/didClose lifecycle) and resolveClassSource (jar-lookup-and-read) helpers, eliminating 263 net lines of duplicated boilerplate across 8 tool files.

## Changes Made

### Task 1: Add withLspDocument and resolveClassSource helpers

- **withLspDocument**: Generic wrapper that handles `didOpen`/`try`/`finally`/`didClose` lifecycle for any LSP operation. Takes an `LspClient`, file URI, source text, and async callback.
- **resolveClassSource**: Handles jar lookup and source reading with a typed discriminated union result (`success | jar-not-found | jar-not-available | class-not-found`). Supports both specific-jar and all-jars-priority-sorted modes.
- **Commit:** f1db6b8

### Task 2: Migrate all 8 tool files

**withLspDocument migration (6 files):**
- find-definition.ts: Replaced try/catch with didClose-in-catch pattern
- find-references.ts: Same pattern replacement
- find-implementations.ts: Same pattern replacement
- get-symbol-info.ts: Same pattern replacement
- list-members.ts: Replaced try/finally pattern
- type-hierarchy.ts: Replaced try/finally pattern

**resolveClassSource migration (3 files):**
- list-members.ts: Replaced ~70-line inline jar resolution block
- type-hierarchy.ts: Replaced ~70-line inline jar resolution block
- read-source.ts: Replaced specific-jar path only (~25 lines); all-jars loop kept as-is (collect-all semantics differ)

**Removed unused imports** from migrated files: `getFilteredDependencies`, `jarReader`, `createSourceAdapter`, `sortByPriority`.

- **Commit:** 732c4b1

## Verification

- All 327 tests pass (vitest run)
- No new tsc errors introduced (all errors in modified files are pre-existing)
- Net line reduction: -263 lines (333 removed, 70 added)

## Deviations from Plan

None -- plan executed exactly as written.
