# Phase 30: API Consistency - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Unify pagination envelopes, rename inconsistent parameters, validate enums, and remove dead fields across all tools. All changes are API-surface only — no behavioral logic changes.

</domain>

<decisions>
## Implementation Decisions

### API-01: Unified pagination envelopes
- Navigation tools (find_definition, find_references, find_implementations) already return `hasMore` via `applyPagination` — add `limit` to their response envelopes
- Search tools (search_classes, search_symbols) already return `limit` — add `hasMore` to their response envelopes
- `SearchResponse` interface in `src/browsing/search.ts` needs `hasMore: boolean` added
- `search_symbols` needs `hasMore` computed manually (it does its own slicing)
- After this, ALL paginated responses have: `{ results, total, offset, limit, hasMore }`

### API-02: Rename search_classes `pattern` → `query`
- Rename in tool schema: `pattern` → `query` in `search-classes.ts`
- Rename in domain: `SearchOptions.pattern` → `SearchOptions.query` in `search.ts`
- Rename in `searchClasses()` function body
- Update all test files referencing `pattern`

### API-03: Rename remove_project_member `members` → `names`
- Single line change in `remove-project-member.ts` line 24
- Update handler destructuring
- Update all test files

### API-04: Remove search_symbols default limit
- Remove `.default(50)` from limit schema in `search-symbols.ts` line 33
- Keep `.max(200)` — actually, remove the max too since other tools have no max. Let the agent manage response size.
- Behavior when limit is undefined: return all results (match other tools)

### API-05: search_classes kind enum validation
- Replace `z.array(z.string())` with `z.array(z.enum(['class', 'interface', 'enum', 'record', '@interface']))` 
- These match the values returned by `parseClassDeclaration()` in `class-parser.ts`

### API-06: Remove `field` from search_symbols kind enum
- Remove `'field': 8` from `KIND_NAME_TO_NUMBER` map
- Remove `'field'` from the z.enum in the schema
- Add note in TOOL_DESCRIPTIONS that field search is not supported (use list_members)

### API-07: Remove `javadoc` field from get_symbol_info
- Remove `javadoc: ''` from response at line 144 of `get-symbol-info.ts`
- Also remove from the import/package early-return response at line ~125
- Add TODO comment: `// TODO: Extract Javadoc from hover markdown or source text when Javadoc support is implemented`

### Claude's Discretion
- Order of changes within tasks
- Test update patterns
- Whether to combine small changes into fewer commits or keep them separate

</decisions>

<specifics>
## Specific Ideas

No specific requirements — all fixes have clear correct behavior defined by the audit.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pagination (API-01)
- `src/tools/pagination.ts` — `applyPagination` returns `{ results, total, offset, hasMore }`
- `src/browsing/search.ts` — `SearchResponse` interface (has `limit`, missing `hasMore`)
- `src/tools/search-classes.ts` — passes `SearchResponse` through to envelope
- `src/tools/search-symbols.ts` — does its own slicing, needs manual `hasMore` computation
- `src/tools/find-definition.ts`, `find-references.ts`, `find-implementations.ts` — use `applyPagination`, need `limit` added to envelope

### Parameter renames (API-02, API-03)
- `src/tools/search-classes.ts` — `pattern` param
- `src/browsing/search.ts` — `SearchOptions.pattern` field
- `src/tools/remove-project-member.ts` — `members` param

### Schema fixes (API-04, API-05, API-06)
- `src/tools/search-symbols.ts` — limit default, kind enum with `field`
- `src/tools/search-classes.ts` — unvalidated kind string array
- `src/browsing/class-parser.ts` — `parseClassDeclaration()` returns kind values: class, interface, enum, record, @interface

### Dead field (API-07)
- `src/tools/get-symbol-info.ts` — `javadoc: ''` at lines ~125 and ~144

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `applyPagination()` in pagination.ts already computes `hasMore` — search tools can use the same formula
- `CATEGORY_PRIORITY` and `sortByPriority` already handle result ordering

### Established Patterns
- `SearchResponse` is the canonical return type for `searchClasses()` — all changes flow through it
- `applyPagination` returns `PaginatedResult<T>` with `hasMore` — navigation tools already use this

### Integration Points
- `search-classes.ts` references `pattern` in: schema, handler destructuring, `searchClasses()` call, text output
- `search.ts` references `pattern` in: `SearchOptions` interface, function body
- Test files reference `pattern` in tool call arguments
- `remove-project-member.ts` references `members` in: schema, handler destructuring
- Test files reference `members` in tool call arguments

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 30-api-consistency*
*Context gathered: 2026-04-16*
