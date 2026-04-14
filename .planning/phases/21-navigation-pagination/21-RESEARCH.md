# Phase 21: Navigation Pagination - Research

**Researched:** 2026-04-14
**Domain:** MCP tool parameter extension / array pagination
**Confidence:** HIGH

## Summary

Phase 21 adds `limit` and `offset` parameters to three existing navigation tools (`find_references`, `find_implementations`, `find_definition`) so agents can paginate large result sets. The project already has an established pagination pattern in `search_classes` (via `src/browsing/search.ts`) that returns `{ results, offset, limit, total }`. The CONTEXT.md decisions specify a slightly different response shape: `{ results, total, offset, hasMore }` -- dropping `limit` from the response and adding `hasMore`.

All three navigation tools follow an identical structure: resolve symbol position -> LSP call -> `normalizeLocations` -> `processNavigationLocations` -> build envelope. Pagination slots in as a simple `Array.slice()` after `processNavigationLocations` returns the full result array, right before envelope construction. This is a mechanical change with zero architectural risk.

**Primary recommendation:** Create a shared `applyPagination<T>(items: T[], offset?: number, limit?: number)` utility function that returns `{ results: T[], total: number, offset: number, hasMore: boolean }`, add `PARAMS.limit` and `PARAMS.offset` to `descriptions.ts`, and wire them into each of the three tool handlers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Response shape: `{ results, total, offset, hasMore }` alongside existing `sourcePosition`
- Create a shared pagination utility (not inline in each tool handler)
- Standardize pagination input type: `{ limit?: number, offset?: number }`
- Standardize pagination output type: `{ results: T[], total: number, offset: number, hasMore: boolean }`
- All three navigation tools use this utility after `processNavigationLocations`
- search_classes keeps its own pagination in search.ts; no retrofit needed
- When `limit` is omitted, return ALL results (no cap) -- different from search_classes which defaults to 250
- `offset` without `limit` returns all results starting from offset
- `hasMore` must be present in response even when pagination is not used (set to false)

### Claude's Discretion
- Exact file placement for the pagination utility
- Whether to add pagination params to PARAMS in descriptions.ts or define inline
- Error handling for invalid values (negative offset, zero limit)
- Whether the shared utility is a function or a type + function pair

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | find_references accepts limit and offset parameters with total count in response | Shared pagination utility + PARAMS schema additions + handler wiring |
| NAV-02 | find_implementations accepts limit and offset parameters with total count in response | Same utility, same pattern |
| NAV-03 | find_definition accepts limit and offset parameters with total count in response | Same utility, same pattern |
| NAV-04 | All pagination defaults to returning all results (backward compatible) when limit is omitted | Utility returns all items when limit is undefined; hasMore = false |
</phase_requirements>

## Standard Stack

No new dependencies. This phase uses only existing project infrastructure:

| Library | Version | Purpose | Role in Phase |
|---------|---------|---------|---------------|
| Zod | 4.x | Schema validation | Define `limit` and `offset` parameter schemas |
| @modelcontextprotocol/sdk | 1.29.x | MCP server | Tool registration (already in use) |
| vitest | 3.x | Testing | Unit tests for pagination utility + integration tests |

No `npm install` needed.

## Architecture Patterns

### Pagination Utility Placement

**Recommendation:** Place in `src/tools/pagination.ts` as a standalone module.

Rationale: The utility is consumed only by tool handlers in `src/tools/`. It does not belong in `src/browsing/` (that's jar-reading domain) or `src/jdtls/` (that's LSP domain). A dedicated file keeps it testable in isolation.

### Pattern: Shared Pagination Function

**What:** A single generic function that takes an array and optional pagination params, returns a paginated envelope.

**When to use:** After `processNavigationLocations` returns the full `NavigationResult[]` array, before `makeSuccess` envelope construction.

**Example:**

```typescript
// src/tools/pagination.ts

export interface PaginationInput {
	limit?: number;
	offset?: number;
}

export interface PaginatedResult<T> {
	results: T[];
	total: number;
	offset: number;
	hasMore: boolean;
}

export function applyPagination<T>(
	items: T[],
	input: PaginationInput,
): PaginatedResult<T> {
	const offset = input.offset ?? 0;
	const sliced = input.limit !== undefined
		? items.slice(offset, offset + input.limit)
		: items.slice(offset);
	return {
		results: sliced,
		total: items.length,
		offset,
		hasMore: offset + sliced.length < items.length,
	};
}
```

### Pattern: Tool Handler Integration

Each navigation tool handler changes minimally:

```typescript
// Before (find-references.ts, line ~68-82):
const results = await processNavigationLocations(locations, loadedProject, uriMapper);
const envelope = makeSuccess({ results, sourcePosition: { ... } }, { provenance });

// After:
const allResults = await processNavigationLocations(locations, loadedProject, uriMapper);
const paginated = applyPagination(allResults, { limit, offset });
const envelope = makeSuccess({
	...paginated,        // results, total, offset, hasMore
	sourcePosition: { ... },
}, { provenance });
```

The text summary should reflect paginated counts: `Found ${paginated.results.length} of ${paginated.total} references`.

### Pattern: PARAMS Schema Additions

Add to `descriptions.ts`:

```typescript
export const PARAMS = {
	// ... existing params ...
	limit: z.number().int().min(1).optional()
		.describe('Maximum number of results to return. Omit for all results.'),
	offset: z.number().int().min(0).optional()
		.describe('Number of results to skip (0-based). Default: 0.'),
} as const;
```

Using `min(1)` for limit (zero limit is nonsensical) and `min(0)` for offset (negative offset is nonsensical). Zod handles validation errors automatically -- the MCP SDK returns a validation error to the agent without custom error handling code.

### Anti-Patterns to Avoid

- **Retrofitting search_classes pagination:** CONTEXT.md explicitly says search_classes keeps its own pagination. Don't touch it.
- **Defaulting limit to a number:** Navigation results should return all by default (unlike search_classes which defaults to 250). The utility must treat `undefined` limit as "no limit".
- **Omitting hasMore when not paginating:** The success criteria explicitly require `hasMore` in every response, even when it's `false`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parameter validation | Custom min/max checks | Zod `z.number().int().min(N)` | Zod returns structured validation errors through MCP SDK automatically |
| Array slicing edge cases | Manual bounds checking | `Array.slice()` with computed indices | `slice()` handles out-of-bounds gracefully (returns empty array, not error) |

**Key insight:** `Array.slice(offset, offset + limit)` already handles all edge cases: offset beyond array length returns `[]`, missing end index returns rest of array. No bounds clamping needed in the utility.

## Common Pitfalls

### Pitfall 1: hasMore Calculation Off-by-One
**What goes wrong:** `hasMore` reports `true` when exactly at the last page.
**Why it happens:** Comparing `offset + limit` instead of `offset + sliced.length` against `total`.
**How to avoid:** Use `offset + sliced.length < items.length` -- this accounts for the actual number of items returned, not the requested limit.
**Warning signs:** `hasMore: true` but next page returns empty results.

### Pitfall 2: Changing Envelope Shape for Non-Paginated Calls
**What goes wrong:** Backward compatibility breaks because existing envelope shape changes.
**Why it happens:** Adding `total`, `offset`, `hasMore` to the envelope adds new fields that didn't exist before.
**How to avoid:** Adding fields is backward compatible -- consumers that don't expect them will ignore them. The `results` key keeps working. The key concern is NOT renaming or removing existing fields. The `results` field name is currently used directly (not wrapped in a pagination object), so it stays at the same level.
**Warning signs:** Existing tests fail on envelope shape assertions.

### Pitfall 3: Text Summary Not Reflecting Pagination
**What goes wrong:** Agent sees "Found 50 references" but the results array only has 10 items because of pagination.
**Why it happens:** The text summary uses the full count instead of reflecting the paginated view.
**How to avoid:** Update text summaries to show both: "Found 10 of 50 references (offset 20)" or similar. Only show pagination detail when pagination is active.

### Pitfall 4: Forgetting to Destructure limit/offset from Tool Arguments
**What goes wrong:** TypeScript compiles but limit/offset are always undefined.
**Why it happens:** The params are added to `inputSchema` but not destructured in the handler's argument list.
**How to avoid:** Add `limit` and `offset` to the destructuring pattern: `async ({ project, jar, class: className, patterns, limit, offset })`.

## Code Examples

### Current Envelope Shape (find_references)

```typescript
// Current data payload:
{
	results: NavigationResult[],
	sourcePosition: { jar, class, line, column }
}

// After pagination:
{
	results: NavigationResult[],  // paginated subset (or all if no limit)
	total: number,                // NEW: total result count before pagination
	offset: number,               // NEW: 0-based offset applied
	hasMore: boolean,             // NEW: whether more results exist
	sourcePosition: { jar, class, line, column }  // unchanged
}
```

### Text Summary Updates

```typescript
// Current (find_references):
`Found ${results.length} reference${results.length === 1 ? '' : 's'} across ${uniqueFiles} file${uniqueFiles === 1 ? '' : 's'}`

// After (when paginated):
`Found ${paginated.total} reference${paginated.total === 1 ? '' : 's'} across ${uniqueFiles} file${uniqueFiles === 1 ? '' : 's'} (showing ${paginated.results.length} from offset ${paginated.offset})`

// After (when NOT paginated -- limit omitted):
// Same as current, since paginated.results.length === paginated.total
```

### search_classes Pagination Reference (existing)

```typescript
// src/browsing/search.ts lines 141-145
const total = sorted.length;
const sliced = sorted.slice(offset, offset + limit);
return { results: sliced, offset, limit, total };
```

Note: search_classes always has a limit (defaults to 250). Navigation tools differ -- undefined limit means no slicing.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/tools/find-references.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | find_references accepts limit/offset, returns total/hasMore | unit | `npx vitest run tests/tools/find-references.test.ts -t "pagination"` | Partial (file exists, pagination tests needed) |
| NAV-02 | find_implementations accepts limit/offset, returns total/hasMore | unit | `npx vitest run tests/tools/find-implementations.test.ts -t "pagination"` | Partial (file exists, pagination tests needed) |
| NAV-03 | find_definition accepts limit/offset, returns total/hasMore | unit | `npx vitest run tests/tools/find-definition.test.ts -t "pagination"` | Partial (file exists, pagination tests needed) |
| NAV-04 | Omitting limit returns all results, hasMore=false | unit | `npx vitest run tests/tools/find-references.test.ts -t "backward"` | Partial (existing tests cover no-pagination case implicitly) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/tools/find-references.test.ts tests/tools/find-implementations.test.ts tests/tools/find-definition.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/pagination.test.ts` -- unit tests for `applyPagination` utility (pure function, easy to test)
- [ ] Pagination test cases in existing tool test files -- add `describe('pagination', ...)` blocks

## Open Questions

1. **Text summary format when paginated**
   - What we know: Current summaries show total count. Paginated responses need to communicate both total and shown count.
   - What's unclear: Exact wording preferences. "Showing 10 of 50" vs "Found 50 (returning 10 from offset 20)".
   - Recommendation: Use conditional logic -- when `total === results.length`, use current format unchanged. When paginated, append "(showing N from offset M)". This preserves backward compatibility in the text content too.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/tools/find-references.ts`, `find-implementations.ts`, `find-definition.ts` -- current tool structure
- Existing codebase: `src/browsing/search.ts` -- established pagination pattern (lines 141-162)
- Existing codebase: `src/tools/descriptions.ts` -- shared PARAMS pattern
- Existing codebase: `src/tools/tool-helpers.ts` -- `processNavigationLocations` return type
- Existing codebase: `tests/tools/find-references.test.ts` -- test patterns and mocking approach

### Secondary (MEDIUM confidence)
- None needed -- this is purely internal refactoring with no external dependencies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, existing patterns
- Architecture: HIGH -- simple array slicing utility, clear insertion point in existing code
- Pitfalls: HIGH -- well-understood pagination domain, prior art in search_classes

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- no external dependencies involved)
