---
phase: 17-structured-member-output
verified: 2026-04-14T05:05:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 17: Structured Member Output Verification Report

**Phase Goal:** Enrich list_members and search_symbols output with structured member metadata — fully-qualified names, kind labels, parameter signatures — so Claude can reference members precisely without re-reading source.
**Verified:** 2026-04-14T05:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | buildMemberFqn returns correct FQN format for methods, constructors, fields, constants, enum members | VERIFIED | `member-fqn.ts` lines 4-19; all 9 unit tests pass |
| 2 | buildMemberFqn strips trailing () from member names to prevent double-parens | VERIFIED | `.replace(/\(\)$/, '')` at line 10; dedicated test passes |
| 3 | buildMemberFqn returns null for class/interface/enum kinds | VERIFIED | `return null` branch at line 17; 3 tests pass |
| 4 | enrichSymbols transforms TransformedSymbol[] into EnrichedSymbol[] with structured types and FQNs | VERIFIED | `member-enrichment.ts` lines 11-68; 8 unit tests pass |
| 5 | enrichSymbols handles nested inner classes with $ separator in FQN | VERIFIED | `` `${classFqn}$${child.name}` `` at line 32; dedicated test passes |
| 6 | createResolvePackage bridges EntryIndex.getClasses to the resolver callback signature | VERIFIED | `import-resolver.ts` lines 123-130; 2 tests pass |
| 7 | list_members output includes parameters, returnType on method symbols | VERIFIED | `list-members.test.ts` test at line 188 passes; `method.parameters`, `method.returnType` assertions pass |
| 8 | list_members output includes fieldType on field symbols | VERIFIED | `list-members.test.ts` test at line 240 passes; `field.fieldType` assertion passes |
| 9 | list_members output includes memberFqn on every method, constructor, field, constant, and enum member | VERIFIED | Tests at lines 188, 240, 291, 338 all pass with memberFqn assertions |
| 10 | list_members output preserves existing detail string for backward compatibility | VERIFIED | `method.detail` and `field.detail` assertions at lines 233, 284 pass |
| 11 | search_symbols output includes memberFqn on method/constructor results | VERIFIED | `search-symbols.test.ts` tests at lines 248, 320 pass; `#run()`, `#MinecraftClient()` assertions pass |
| 12 | search_symbols output includes memberFqn: null on class/interface/enum results | VERIFIED | Tests at lines 284, 356 pass; null assertions for class/interface pass |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/browsing/member-fqn.ts` | buildMemberFqn pure function | VERIFIED | 19 lines; exports `buildMemberFqn`; METHOD_KINDS/FIELD_KINDS sets; parens stripping |
| `src/browsing/member-enrichment.ts` | enrichSymbols pipeline function | VERIFIED | 68 lines; exports `enrichSymbols`; imports parseDetail, extractImports, createTypeResolver, buildMemberFqn; CLASS_KINDS/METHOD_KINDS/FIELD_KINDS sets; inner class $ separator |
| `src/browsing/types.ts` | EnrichedSymbol discriminated union types | VERIFIED | Exports `EnrichedMethodSymbol`, `EnrichedFieldSymbol`, `EnrichedClassSymbol`, `EnrichedSymbol`; imports from `./member-types.js`; EnrichedClassSymbol has no memberFqn |
| `src/browsing/import-resolver.ts` | createResolvePackage bridge function | VERIFIED | Exports `createResolvePackage`; imports `EntryIndex`; maps `getClasses(pkg)` entries to `className` strings |
| `src/tools/list-members.ts` | Enriched member output with structured types and FQNs | VERIFIED | Imports `enrichSymbols`; builds multi-jar `resolvePackage`; derives `classFqn` from `entryPath`; passes `enriched` to `makeSuccess` |
| `src/tools/search-symbols.ts` | memberFqn on search results | VERIFIED | Imports `buildMemberFqn`; computes `memberFqn` from `sym.containerName + sym.name + kindName`; null when no containerName |
| `tests/browsing/member-fqn.test.ts` | 9 tests for FQN generation | VERIFIED | All 9 tests pass |
| `tests/browsing/member-enrichment.test.ts` | 8 tests for enrichment pipeline | VERIFIED | All 8 tests pass |
| `tests/browsing/import-resolver.test.ts` | 2 new tests for createResolvePackage | VERIFIED | Both tests pass (lines 224-226 in test file) |
| `tests/tools/list-members.test.ts` | 4 new enrichment tests | VERIFIED | All 4 new tests pass (lines 188-383) |
| `tests/tools/search-symbols.test.ts` | 5 new memberFqn tests | VERIFIED | All 5 new tests pass (lines 248-426) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/browsing/member-enrichment.ts` | `src/browsing/detail-parser.ts` | parseDetail import | WIRED | `import { parseDetail } from './detail-parser.js'` at line 3; called at line 39 |
| `src/browsing/member-enrichment.ts` | `src/browsing/import-resolver.ts` | extractImports and createTypeResolver imports | WIRED | `import { extractImports, createTypeResolver } from './import-resolver.js'` at line 4; both called in enrichSymbols body |
| `src/browsing/member-enrichment.ts` | `src/browsing/member-fqn.ts` | buildMemberFqn import | WIRED | `import { buildMemberFqn } from './member-fqn.js'` at line 5; called at line 42 |
| `src/tools/list-members.ts` | `src/browsing/member-enrichment.ts` | enrichSymbols import and call | WIRED | `import { enrichSymbols } from '../browsing/member-enrichment.js'` at line 9; `await enrichSymbols(members, sourceText, classFqn, resolvePackage)` at line 152 |
| `src/tools/list-members.ts` | `src/browsing/import-resolver.ts` | createResolvePackage import and call | NOT WIRED | `createResolvePackage` is NOT imported in list-members.ts — the multi-jar `resolvePackage` is built inline instead (this is a documented intentional design decision, not a defect) |
| `src/tools/search-symbols.ts` | `src/browsing/member-fqn.ts` | buildMemberFqn import and call | WIRED | `import { buildMemberFqn } from '../browsing/member-fqn.js'` at line 9; `buildMemberFqn(sym.containerName, sym.name, kindName)` at line 98 |

**Note on createResolvePackage in list-members.ts:** The 17-02-PLAN specified importing `createResolvePackage` as a key link, but the SUMMARY documents a deliberate design decision to build `resolvePackage` inline to support the multi-jar case. The `createResolvePackage` function only handles a single `EntryIndex`, whereas list-members needs to aggregate across all project jars. The inline approach satisfies the requirement; `createResolvePackage` remains available for single-index use cases. Goal achievement is unaffected.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TYPE-03 | 17-01-PLAN, 17-02-PLAN | list_members output enriched with structured MemberReference types | SATISFIED | `list-members.ts` wires `enrichSymbols`; method symbols have `memberFqn`, `parameters`, `returnType`; field symbols have `memberFqn`, `fieldType`; detail string preserved. 4 new tool tests pass. |
| SRCH-03 | 17-02-PLAN | search_symbols results include member FQN | SATISFIED | `search-symbols.ts` computes `memberFqn` via `buildMemberFqn` from containerName; methods/fields/constructors get FQN; classes/interfaces/enums get null. 5 new tool tests pass. |

Both phase requirements satisfied. No orphaned requirements found (REQUIREMENTS.md traceability table confirms SRCH-03 and TYPE-03 both map to Phase 17).

---

### Anti-Patterns Found

None. Scanned `src/browsing/member-fqn.ts`, `src/browsing/member-enrichment.ts`, `src/tools/list-members.ts`, `src/tools/search-symbols.ts` for TODO/FIXME, placeholder comments, stub implementations, and empty handlers. All clear.

---

### Human Verification Required

None. All behavioral claims are covered by automated tests with explicit assertions. The enrichment pipeline is pure-function-based and fully testable without a live JDT LS session.

---

### Test Suite Results

| Suite | Tests | Result |
|-------|-------|--------|
| tests/browsing/member-fqn.test.ts | 9 | PASSED |
| tests/browsing/member-enrichment.test.ts | 8 | PASSED |
| tests/browsing/import-resolver.test.ts | 26 (incl. 2 new) | PASSED |
| tests/tools/list-members.test.ts | 9 (incl. 4 new) | PASSED |
| tests/tools/search-symbols.test.ts | 12 (incl. 5 new) | PASSED |
| **Full suite** | **496** | **PASSED — no regressions** |

---

### Summary

Phase 17 fully achieves its goal. The domain layer (Plan 01) correctly implements `buildMemberFqn`, `enrichSymbols`, `EnrichedSymbol` types, and `createResolvePackage`. The tool layer (Plan 02) correctly wires enrichment into `list_members` and adds `memberFqn` to `search_symbols`. Both SRCH-03 and TYPE-03 are satisfied. All 496 tests pass with no regressions. The one key link that differs from the plan (`createResolvePackage` not imported in list-members) is a documented design decision that preserves correctness for the multi-jar case — not a defect.

---

_Verified: 2026-04-14T05:05:00Z_
_Verifier: Claude (gsd-verifier)_
