---
phase: 31-data-exposure
verified: 2026-04-15T18:26:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 31: Data Exposure Verification Report

**Phase Goal:** Tool responses surface all available metadata that agents need for informed decisions
**Verified:** 2026-04-15T18:26:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `get_project_info` response includes `jdtlsAvailable` boolean and `jdtlsFailureReason` for each project | VERIFIED | `src/tools/get-project-info.ts` lines 48-49 emit both fields; 3 dedicated tests covering no-session, available, and failed states all pass |
| 2 | `get_member_info` response includes `declaredDependencies` array with configuration, group, artifact, version | VERIFIED | `src/tools/get-member-info.ts` lines 49-54 map `gradleConfig.dependencies`; 2 dedicated tests verify shape and confirm `raw` is absent |
| 3 | `type_hierarchy` ClassReference entries include `jar` field when URI maps to a known jar | VERIFIED | `src/tools/type-hierarchy.ts` `toClassReference()` calls `uriMapper.fromFileUri()` and sets `ref.jar`; test asserts `jar: 'testmod/minecraft'` for file:// URIs and `jar: undefined` for jdt:// URIs |
| 4 | `list_members` compact output includes `fqn` for inner class symbols | VERIFIED | `src/browsing/member-enrichment.ts` sets `fqn: classFqn` on all class-kind results; `src/tools/tool-helpers.ts` emits it via `if ('fqn' in sym) base.fqn = sym.fqn`; dedicated test at line 505 of list-members.test.ts passes |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/get-project-info.ts` | JDT LS status fields in response envelope | VERIFIED | Contains `jdtlsAvailable` and `jdtlsFailureReason` at lines 48-49; substantive implementation with correct null/false logic |
| `src/tools/get-member-info.ts` | `declaredDependencies` in projectInfo block | VERIFIED | Contains `declaredDependencies` mapping at lines 49-54; omits `raw` field per decision |
| `src/browsing/types.ts` | Optional `jar?` on ClassReference, optional `fqn?` on EnrichedClassSymbol | VERIFIED | `ClassReference.jar?: string` at line 15; `EnrichedClassSymbol.fqn?: string` at line 83 |
| `src/tools/type-hierarchy.ts` | `toClassReference` passes URI through `uriMapper.fromFileUri` | VERIFIED | `uriMapper.fromFileUri(item.uri)` called at line 19; `UriMapper` type imported at line 10 |
| `src/browsing/member-enrichment.ts` | Inner class FQN computation in `enrichOne` | VERIFIED | `fqn: classFqn` set at line 66 in the class/interface/enum branch |
| `src/tools/tool-helpers.ts` | `stripEnrichedSymbol` includes `fqn` for class-kind symbols | VERIFIED | `if ('fqn' in sym) base.fqn = sym.fqn` at line 474 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tools/type-hierarchy.ts` | `src/jdtls/uri-mapper.ts` | `uriMapper.fromFileUri()` in `toClassReference` | WIRED | Line 19: `const mapping = uriMapper.fromFileUri(item.uri)`; result's `.jar` field set on `ref.jar` |
| `src/browsing/member-enrichment.ts` | `src/browsing/types.ts` | `EnrichedClassSymbol.fqn` set during `enrichOne` | WIRED | Line 66: `fqn: classFqn` in the return object for class-kind branch |
| `src/tools/tool-helpers.ts` | `src/browsing/types.ts` | `stripEnrichedSymbol` reads `fqn` from `EnrichedClassSymbol` | WIRED | Line 474: `if ('fqn' in sym) base.fqn = sym.fqn`; pattern mirrors existing `memberFqn` handling |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DATA-01 | 31-01-PLAN.md | `get_project_info` includes JDT LS availability status and failure reason | SATISFIED | Fields emitted in get-project-info.ts lines 48-49; 3 passing tests in get-project-info.test.ts |
| DATA-02 | 31-01-PLAN.md | `get_member_info` exposes GradleConfig.dependencies | SATISFIED | `declaredDependencies` mapped in get-member-info.ts lines 49-54; 2 passing tests including shape + raw-absent check |
| DATA-03 | 31-01-PLAN.md | `type_hierarchy` ClassReference output includes jar ID | SATISFIED | `jar?` field on ClassReference interface; toClassReference populates via uriMapper; test asserts jar resolves for file:// and is undefined for jdt:// |
| DATA-04 | 31-01-PLAN.md | `list_members` compact output includes FQN for inner class entries | SATISFIED | fqn set in member-enrichment.ts; stripped in tool-helpers.ts; test at list-members.test.ts line 505 asserts outer and inner class FQN values |

All four requirements mapped to Phase 31 in REQUIREMENTS.md are marked Complete and are fully satisfied by the implementation.

### Anti-Patterns Found

No anti-patterns found in the modified source files. The `return null` and `return []` patterns found in tool-helpers.ts are legitimate guard clauses in unrelated helper functions (`normalizeLocations`, `resolveClassSource`), not stubs.

### Human Verification Required

None. All four changes are purely additive data fields on existing response shapes with deterministic logic. No visual, real-time, or external service behavior to verify.

### Test Suite Results

All 41 tests in the 5 directly relevant test files pass with no failures:

- `tests/browsing/member-enrichment.test.ts` — 9 tests, all pass (includes "sets fqn on class-kind symbols including inner classes")
- `tests/tools/get-project-info.test.ts` — 7 tests, all pass (includes 3 JDT LS status scenario tests)
- `tests/tools/get-member-info.test.ts` — 7 tests, all pass (includes 2 declaredDependencies tests)
- `tests/tools/type-hierarchy.test.ts` — 7 tests, all pass (includes jar field assertions on ClassReference)
- `tests/tools/list-members.test.ts` — 11 tests, all pass (includes "compact output includes fqn on class-kind symbols including inner classes")

### Gaps Summary

No gaps. All four DATA requirements are implemented with substantive, wired code and covered by passing tests.

---

_Verified: 2026-04-15T18:26:00Z_
_Verifier: Claude (gsd-verifier)_
