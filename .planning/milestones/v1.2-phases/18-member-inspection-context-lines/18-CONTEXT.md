# Phase 18: Member Inspection & Context Lines - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `read_member` tool for reading individual method/field source by FQN, and add optional context lines parameter to `locate_in_source` for extending matches to whole line boundaries with surrounding context.

</domain>

<decisions>
## Implementation Decisions

### read_member input format
- Single `memberFqn` string parameter (full FQN like `net.minecraft.client.MinecraftClient#tick()`)
- Users get FQNs from `list_members` or `search_symbols` output — no need to construct them manually
- Standard `project` param, optional `jar` param (same pattern as other tools)

### read_member overload handling
- Return all overloads when multiple methods share the same FQN
- Each overload is a separate result entry (like how `read_source` returns multiple jar matches)
- No disambiguation parameter needed — Claude picks the right one from context

### read_member output scope
- **Methods/constructors:** Include Javadoc + annotations + signature + body (start from `/** ... */` or first `@Annotation` above the declaration, end at closing `}`)
- **Fields:** Same treatment — include Javadoc + annotations + declaration line
- Consistent rule: always include the full declaration with all leading decorations

### locate_in_source context parameter
- Optional parameter: `context?: { linesBefore: number, linesAfter: number }`
- `null`/omitted: no change to current behavior
- Non-null (even `{ linesBefore: 0, linesAfter: 0 }`): extend match boundaries to whole line boundaries
- `linesBefore`/`linesAfter`: additional whole lines above/below the match line

### locate_in_source context result shape
- Existing `offset`, `line`, `column` fields unchanged (precise match position)
- New nested `context` object added to each result when context parameter is non-null:
  ```
  context: {
    text: string;        // the extracted lines
    startLine: number;   // 1-based start of context window
    endLine: number;     // 1-based end of context window
  }
  ```
- `context` field absent from result when parameter is null/omitted

### Claude's Discretion
- How to extract method/field boundaries from source (LSP range data, regex, context-extractor, or combination)
- How to detect leading Javadoc and annotations (scan upward from declaration line)
- Error handling for malformed FQNs or members not found
- Test fixture design

</decisions>

<specifics>
## Specific Ideas

No specific requirements beyond what's captured in decisions above.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 17 artifacts (FQN foundation)
- `src/browsing/member-fqn.ts` — `buildMemberFqn()` function, METHOD_KINDS/FIELD_KINDS sets
- `src/browsing/member-enrichment.ts` — `enrichSymbols()` pipeline, inner class `$` separator
- `src/browsing/types.ts` — EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol, TransformedSymbol

### Tools being modified or referenced
- `src/tools/locate-in-source.ts` — current locate_in_source tool, returns CascadeStep[]/offset/line/column
- `src/tools/list-members.ts` — list_members with enrichment pipeline (source of memberFqn data)
- `src/tools/read-source.ts` — read_source pattern for reading from jars (model for read_member)
- `src/tools/tool-helpers.ts` — resolveClassSource(), classNameToEntryPath(), withLspDocument(), getDependenciesForTool()

### Domain modules
- `src/browsing/cascading-regex.ts` — cascadeRegex(), offsetToLineColumn() — locate_in_source core
- `src/jdtls/context-extractor.ts` — extractEnclosingContext() finds method/field/class boundaries by line
- `src/browsing/source-adapter.ts` — SourceAdapter interface for reading from jars/filesystem

### Registration infrastructure
- `src/tools/index.ts` — registerAllTools() where new tool gets added
- `src/tools/descriptions.ts` — TOOL_DESCRIPTIONS and shared PARAMS

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extractEnclosingContext()` in `context-extractor.ts`: already finds method/field boundaries given a target line — could be extended or used to locate the member body
- `resolveClassSource()` in `tool-helpers.ts`: reads class source from jars, returns source text + entry path — reuse for read_member
- `enrichSymbols()` in `member-enrichment.ts`: provides member FQNs for a class — can match input FQN against enriched results to find the right member(s)
- `offsetToLineColumn()` in `cascading-regex.ts`: converts character offset to 1-based line/column — reuse for context line extraction
- `withLspDocument()` in `tool-helpers.ts`: LSP document lifecycle — needed if using LSP range data for member boundaries

### Established Patterns
- Tools return `{ content: [text], structuredContent: envelope }` via `makeSuccess()`
- Shared params (`PARAMS.project`, `PARAMS.class`, `PARAMS.jar`) in `descriptions.ts`
- Multi-jar results: each jar match is a separate entry in the results array
- `classNameToEntryPath()` converts dotted class names to `path/to/Class.java` entry paths

### Integration Points
- read_member needs to: parse FQN → split on `#` → resolve class source → find member in source → extract with decorations
- locate_in_source context: after cascadeRegex returns offset/line/column, extend to line boundaries using source text and linesBefore/linesAfter
- LSP `textDocument/documentSymbol` returns ranges for each member — alternative to regex for finding member boundaries
- `list_members` enrichment pipeline produces memberFqn per symbol — can match against input FQN to get LSP range

</code_context>

<deferred>
## Deferred Ideas

- FQN-based tool input for find_references, find_definition, etc. — deferred to v1.3 per REQUIREMENTS.md (NAV-01, NAV-02)
- Parameter types in FQN for overload disambiguation — decided against, return all overloads instead

</deferred>

---

*Phase: 18-member-inspection-context-lines*
*Context gathered: 2026-04-14*
