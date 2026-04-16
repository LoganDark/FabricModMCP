# Phase 31: Data Exposure - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface metadata that agents need in tool responses: JDT LS status, build dependencies, jar locations in type hierarchy, and inner class FQNs in list_members compact output.

</domain>

<decisions>
## Implementation Decisions

### DATA-01: JDT LS status in get_project_info
- Add `jdtlsAvailable: boolean` and `jdtlsFailureReason: string | null` to the response
- Read from `loadedProject.jdtls?.available` and `loadedProject.jdtls?.failureReason`
- If `jdtls` is undefined (no session created), return `jdtlsAvailable: false, jdtlsFailureReason: 'not initialized'`

### DATA-02: GradleConfig.dependencies in get_member_info
- Add `declaredDependencies` array to `projectInfo` block in get_member_info response
- Map `GradleConfig.dependencies` (array of `DependencyCoordinate`) to `{ configuration, group, artifact, version }`
- Omit the `raw` field (it's just `group:artifact:version` concatenated — redundant)

### DATA-03: Jar locations in type_hierarchy ClassReference
- Add optional `jar?: string` field to `ClassReference` interface
- In `toClassReference()`, pass the item's `uri` through `uriMapper.fromFileUri()` to extract the jar ID
- If URI doesn't map to a known jar (e.g., JRE classes), leave `jar` undefined
- `uriMapper` is already created in the handler scope — pass it to `toClassReference()`

### DATA-04: Inner class FQN in list_members compact output
- `EnrichedClassSymbol` currently has no `fqn` field — add optional `fqn?: string`
- In `enrichSymbols()`, compute inner class FQN as `${classFqn}$${innerName}` and store on the symbol
- In `stripEnrichedSymbol()`, include `fqn` for class-kind symbols (same as `memberFqn` is included for method/field)
- This makes inner class entries immediately usable as inputs to `read_source`, `list_members`, etc.

### Claude's Discretion
- Task grouping and commit boundaries
- Test structure

</decisions>

<specifics>
## Specific Ideas

No specific requirements — all items have clear correct behavior.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### JDT LS status (DATA-01)
- `src/tools/get-project-info.ts` — add fields to response
- `src/jdtls/types.ts` — `JdtLsSession` interface (has `available`, `failureReason`)

### Build dependencies (DATA-02)
- `src/tools/get-member-info.ts` — add to `projectInfo` block (~line 43)
- `src/project/types.ts` — `GradleConfig.dependencies: DependencyCoordinate[]` and `DependencyCoordinate` interface

### Jar locations (DATA-03)
- `src/tools/type-hierarchy.ts` — `toClassReference()` function at line 11, `uriMapper` at line 63
- `src/browsing/types.ts` — `ClassReference` interface at line 10
- `src/jdtls/uri-mapper.ts` — `fromFileUri()` method

### Inner class FQN (DATA-04)
- `src/browsing/types.ts` — `EnrichedClassSymbol` at line 81 (no fqn field)
- `src/browsing/member-enrichment.ts` — `enrichSymbols()` where inner class FQN would be computed
- `src/tools/tool-helpers.ts` — `stripEnrichedSymbol()` which controls compact output

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `uriMapper.fromFileUri(uri)` already returns `{ jarId, entryPath } | null` — ready to use for DATA-03
- `GradleConfig.dependencies` already populated by the gradle parser — just needs exposure
- `stripEnrichedSymbol` already includes `memberFqn` for method/field — same pattern for inner class `fqn`

### Established Patterns
- get_project_info iterates `loadedProject.children` by kind — add jdtls info at project level (outside the member loop)
- get_member_info builds `data.projectInfo` object — add `declaredDependencies` alongside existing fields
- `toClassReference` returns `{ name, fqn, kind }` — adding optional `jar` is consistent

### Integration Points
- `ClassReference` is used in type_hierarchy response AND potentially by downstream tools — adding `jar` is purely additive
- `EnrichedClassSymbol` is emitted by `enrichSymbols` and consumed by `stripEnrichedSymbol` — both need updating

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 31-data-exposure*
*Context gathered: 2026-04-16*
