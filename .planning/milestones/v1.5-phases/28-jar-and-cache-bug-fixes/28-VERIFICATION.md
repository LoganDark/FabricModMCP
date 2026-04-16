---
phase: 28-jar-and-cache-bug-fixes
verified: 2026-04-15T17:28:30Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 28: Jar and Cache Bug Fixes — Verification Report

**Phase Goal:** Jar reading, cache management, and error reporting are correct and race-free
**Verified:** 2026-04-15T17:28:30Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                      | Status     | Evidence                                                                                  |
| --- | ------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------- |
| 1   | Removing a project evicts all associated jar entries from entryIndexCache (no stale cache) | ✓ VERIFIED | `remove-project.ts` lines 53-73: iterates `getProjectJars` + all child paths, calls `evictEntryIndex` for each before `closeProject` |
| 2   | Concurrent getHandle() calls for the same jar return the same handle without duplicates    | ✓ VERIFIED | `jar-reader.ts` lines 114-138: `handlePromise` stored in `handles` map before first `await`; concurrent callers get same `Promise` |
| 3   | read_jar_entry error suggests list_packages and list_classes (not listEntries)             | ✓ VERIFIED | `read-jar-entry.ts` line 87: `'Check the file path -- use list_packages and list_classes to find available paths'` |
| 4   | jar-reader readEntry error suggests list_packages and list_classes (not listEntries)       | ✓ VERIFIED | `jar-reader.ts` line 77: `'Check the entry path -- use list_packages and list_classes to browse available paths'` |
| 5   | add_study_jar response envelope includes provenance metadata                               | ✓ VERIFIED | `add-study-jar.ts` lines 43-46: `makeSuccess({...}, { provenance: { tool: 'add_study_jar', project: loadedProject.name } })` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                           | Expected                             | Status     | Details                                                                                |
| ---------------------------------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `src/tools/remove-project.ts`      | Cache eviction before closeProject   | ✓ VERIFIED | Imports `evictEntryIndex`; calls it for jar paths and all child paths at lines 55-72; `closeProject` at line 76 |
| `src/project/jar-reader.ts`        | Race-safe getHandle, fixed error msg | ✓ VERIFIED | `handles` map typed as `Map<string, Promise<StreamZip.StreamZipAsync>>`; Promise stored before `await`; error at line 77 contains `list_packages and list_classes` |
| `src/tools/read-jar-entry.ts`      | Fixed error message                  | ✓ VERIFIED | Line 87: references `list_packages` and `list_classes`, not `listEntries`              |
| `src/tools/add-study-jar.ts`       | Provenance metadata in makeSuccess   | ✓ VERIFIED | Lines 39-46: `makeSuccess` called with `{ provenance: { tool, project } }` second arg  |

### Key Link Verification

| From                              | To                                  | Via                               | Status     | Details                                                                                            |
| --------------------------------- | ----------------------------------- | --------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `src/tools/remove-project.ts`     | `src/browsing/entry-index-cache.ts` | `evictEntryIndex` import + calls  | ✓ WIRED    | Import at line 11; called at lines 56, 64, 68, 71 — covering jar paths, dep sources, sources jar, and study-jar children |
| `src/tools/remove-project.ts`     | `src/project/jar-reader.ts`         | `getProjectJars` before `closeProject` | ✓ WIRED | `getProjectJars(project)` at line 53; `closeProject(project)` at line 76; eviction loop in between |

### Requirements Coverage

| Requirement | Description                                                                   | Status      | Evidence                                                                                 |
| ----------- | ----------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| FIX-01      | `remove_project` evicts entryIndexCache for all project jar paths             | ✓ SATISFIED | `evictEntryIndex` called for `getProjectJars` set + child dep jars + sourcesJar + study-jar children |
| FIX-03      | `JarReader.getHandle()` prevents race conditions by avoiding await in critical section | ✓ SATISFIED | `handles` map stores `Promise` immediately at line 126; no race window between check and set |
| FIX-07      | `read_jar_entry` error message references `list_packages`/`list_classes` instead of `listEntries` | ✓ SATISFIED | `read-jar-entry.ts` line 87 and `jar-reader.ts` line 77 both updated; `grep` of `src/` for "listEntries" returns only the method definition (line 82) and its call site, zero error messages |
| FIX-08      | `add_study_jar` includes provenance metadata in makeSuccess call              | ✓ SATISFIED | `add-study-jar.ts` lines 43-46 pass `{ provenance: { tool: 'add_study_jar', project } }` as second argument |

All four requirement IDs from the PLAN frontmatter are accounted for. No orphaned requirements: REQUIREMENTS.md shows FIX-01, FIX-03, FIX-07, FIX-08 all marked `[x]` and mapped to Phase 28 in the tracking table.

### Anti-Patterns Found

No blocker or warning anti-patterns detected in any of the four modified source files. No TODO/FIXME/placeholder comments. No stub return values (`return null`, `return []` without real logic). Error handlers rethrow as `DomainError` with meaningful messages.

### Human Verification Required

None. All behaviors are mechanically verifiable:
- Cache eviction is a deterministic data-structure operation (tested by removing cache entries and checking absence).
- Promise-based handle deduplication is testable with concurrent `Promise.all` calls (test at jar-reader.test.ts line 172).
- Error message strings are literal constants (grep-verifiable).
- Provenance metadata is a literal object in the return value (test at add-study-jar.test.ts line 84).

### Test Suite

All 670 tests pass (`npx vitest run`): 63 test files, 670 assertions, 0 failures. Five new tests were added by this phase:
- `remove-project.test.ts`: two new tests (cache eviction, eviction ordering)
- `jar-reader.test.ts`: two new tests (concurrent getHandle, failed sentinel cleanup)
- `add-study-jar.test.ts`: one new test (provenance metadata)

### Residual "listEntries" References

A grep of `src/` for `listEntries` returns exactly two hits:
1. `jar-reader.ts` line 82 — the method definition `async listEntries(jarPath: string)`
2. `source-adapter.ts` line 15 — a call to that method

Neither is an error message or user-facing string. The tool-name reference `listEntries` is fully purged from all error messages.

---

_Verified: 2026-04-15T17:28:30Z_
_Verifier: Claude (gsd-verifier)_
