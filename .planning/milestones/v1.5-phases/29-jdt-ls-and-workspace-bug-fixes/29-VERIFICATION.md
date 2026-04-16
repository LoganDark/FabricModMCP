---
phase: 29-jdt-ls-and-workspace-bug-fixes
verified: 2026-04-15T17:47:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 29: JDT LS & Workspace Bug Fixes Verification Report

**Phase Goal:** JDT LS lifecycle and workspace sync are resilient to edge cases and clean up after themselves
**Verified:** 2026-04-15T17:47:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                          | Status     | Evidence                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 1   | JDT LS data directories are cleaned up on normal server exit and SIGTERM/SIGINT                | VERIFIED   | `cleanupAllSessions()` in `src/index.ts` iterates `projectStore.list()`, cleans tempDir+dataDir; wired into both SIGINT and SIGTERM handlers |
| 2   | type_hierarchy does not hang or crash on circular class hierarchies                             | VERIFIED   | `Set<string> seen` seeded with target FQN; superFqn checked before adding to chain in `src/tools/type-hierarchy.ts` lines 118-131 |
| 3   | read_source accepts inner class FQNs like net.minecraft.Outer$Inner and returns outer class source with position hint | VERIFIED | `lookupClassName`/`innerName` split at `$` in `src/tools/read-source.ts`; `findInnerClassHint()` returns `{ innerClass: { name, startLine } }`; applied to both single-jar and all-jars code paths |
| 4   | syncFabricModToWorkspace removes partially extracted directories when extraction fails midway    | VERIFIED   | `createdDirs: string[]` tracked in `src/jdtls/workspace-sync.ts`; catch block calls `rm(dir, { recursive: true, force: true })` for each entry |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                           | Expected                                   | Status     | Details                                                                      |
| ---------------------------------- | ------------------------------------------ | ---------- | ---------------------------------------------------------------------------- |
| `src/index.ts`                     | Signal handlers for data dir cleanup       | VERIFIED   | `process.on('SIGTERM', ...)` at line 53; `cleanupAllSessions()` at line 30; imports `cleanupTempDir` from workspace.ts and `projectStore` |
| `src/tools/type-hierarchy.ts`      | Cycle detection in supertype walk          | VERIFIED   | `const seen = new Set<string>()` at line 118; FQN check before extending chains at line 130 |
| `src/tools/read-source.ts`         | Inner class FQN handling with position hint | VERIFIED  | `findInnerClassHint()` function at lines 17-27; inner class branch at lines 55-59; spread into both SourceResult objects |
| `src/jdtls/workspace-sync.ts`      | Partial extraction directory cleanup on error | VERIFIED | `createdDirs` array at line 168; populated before extraction at line 180; rm loop in catch at lines 214-216 |
| `src/browsing/types.ts`            | Optional innerClass field on SourceResult  | VERIFIED   | `innerClass?: { name: string; startLine: number }` at line 96                |

### Key Link Verification

| From                            | To                              | Via                                                    | Status   | Details                                                                               |
| ------------------------------- | ------------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------- |
| `src/index.ts`                  | `src/state/project-store.ts`    | `projectStore.list()` to iterate jdtls sessions        | WIRED    | `projectStore.list()` called at line 31; `project-store.ts` exports `list()` method  |
| `src/tools/read-source.ts`      | `src/tools/tool-helpers.ts`     | `classNameToEntryPath(lookupClassName)` after $ strip   | WIRED    | `classNameToEntryPath` imported at line 7; called with `lookupClassName` at line 61  |
| `src/jdtls/workspace-sync.ts`   | `node:fs/promises`              | `rm()` for created directories in catch block          | WIRED    | `rm` imported at line 9; called in catch at line 215 with `{ recursive: true, force: true }` |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                      | Status      | Evidence                                                                      |
| ----------- | ----------- | -------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| FIX-02      | 29-01-PLAN  | JDT LS data directory cleaned up on server exit and catchable termination signals | SATISFIED   | SIGINT+SIGTERM handlers call `cleanupAllSessions()`; tempDir+dataDir both cleaned; errors swallowed |
| FIX-04      | 29-01-PLAN  | type_hierarchy supertype walk has cycle detection                                | SATISFIED   | `Set<string> seen` with FQN dedup; loop breaks on repeated superFqn; test at line 319 of type-hierarchy.test.ts |
| FIX-05      | 29-01-PLAN  | read_source handles inner class FQNs by stripping $Inner to find outer class file | SATISFIED  | `$` detection strips inner name; outer class file read; `innerClass` hint metadata included; 4 tests covering all paths |
| FIX-06      | 29-01-PLAN  | syncFabricModToWorkspace cleans up extracted files on partial failure            | SATISFIED   | `createdDirs` tracked; `rm(dir, { recursive: true, force: true })` in catch; test at line 564 of workspace-sync.test.ts |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

No anti-patterns detected in any phase 29 modified files.

### Test Results

All 56 tests across the three phase 29 test files pass:
- `tests/tools/type-hierarchy.test.ts` — includes circular hierarchy termination test (line 319)
- `tests/tools/read-source.test.ts` — includes 4 inner class FQN tests (lines 169, 190, 207, 223)
- `tests/jdtls/workspace-sync.test.ts` — includes partial extraction cleanup test (line 564)

No TypeScript errors in any phase 29 files (`src/index.ts`, `src/tools/type-hierarchy.ts`, `src/tools/read-source.ts`, `src/jdtls/workspace-sync.ts`, `src/browsing/types.ts`).

### Human Verification Required

None — all four fixes are structural/behavioral and fully verifiable by code inspection and automated tests.

### Summary

All four bug fixes are implemented correctly and completely. The implementations match the CONTEXT.md decisions:

- **FIX-02**: `cleanupAllSessions()` iterates `projectStore.list()` and calls `cleanupTempDir` on both `tempDir` and `dataDir` with per-call try/catch error swallowing. Both SIGINT and SIGTERM handlers call it before `process.exit(0)`.
- **FIX-04**: `seen` Set is seeded with the target class FQN before the loop, ensuring self-referential cycles are caught immediately. The superFqn check happens before adding to `extendsChain`, so only reachable-without-cycle entries appear in the result.
- **FIX-05**: Inner class handling is in `read_source` only (not `classNameToEntryPath`), per scope guidance. The `findInnerClassHint` local function scans line-by-line for the class declaration regex and returns a 1-based `startLine`. Both the explicit-jar and all-jars paths use the spread.
- **FIX-06**: `createdDirs` is populated with `depDir` before extraction begins, so even a first-iteration failure will clean up the directory that was about to be (or partially) written. The catch swallows rm errors silently via empty catch blocks.

---

_Verified: 2026-04-15T17:47:00Z_
_Verifier: Claude (gsd-verifier)_
