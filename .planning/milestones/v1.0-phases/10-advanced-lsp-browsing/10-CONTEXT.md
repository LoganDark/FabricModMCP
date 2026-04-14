# Phase 10: Advanced LSP Browsing - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose JDT LS document symbols, hover info, type hierarchy, and workspace symbol search as MCP tools. This builds on Phase 9's JDT LS infrastructure (client lifecycle, URI mapper, context extractor) to provide structured class browsing without reading raw source. Five new tools: `list_members`, `get_symbol_info`, `type_hierarchy`, `find_implementations`, `search_symbols`.

</domain>

<decisions>
## Implementation Decisions

### list_members (documentSymbol)
- Tree structure, not flat — inner classes are nodes containing their own members as children
- Maximum detail per member: name, kind, visibility, type signature, line range (start/end), static/final/abstract flags, annotations
- Signatures only — no method bodies (read_source exists for that)
- No filtering — always return all members, caller filters
- Uses `textDocument/documentSymbol` — ts-lsp-client has this built in
- Input: `class` (FQN), optional `jar`, optional `project` — no cascading regex needed

### get_symbol_info (hover)
- Returns raw markdown from JDT LS — no parsing into structured fields
- Always include javadoc field even when empty (decompiled Minecraft source rarely has full docs)
- Return all hover results if position is ambiguous, not just the first
- If position lands on import/package declaration, treat as "no useful result" — don't pass through package-level info
- Input: same pattern as find_definition — `class`, `patterns`, optional `jar`

### type_hierarchy (typeHierarchy)
- Full supertype depth — walk all the way to java.lang.Object/Enum/etc
- Subtype depth controlled by `depth` parameter, default 1 (direct subtypes only)
- JDK types included in results with just a name and a "java" provenance (no jar/entry path since they're not in extracted sources)
- Separate "extends" (superclass chain) from "implements" (interfaces) in the response — not one flat list
- Input: `class` (FQN), optional `jar`, optional `depth`
- Uses `textDocument/prepareTypeHierarchy` + `typeHierarchy/supertypes` + `typeHierarchy/subtypes` — needs raw endpoint.send()

### find_implementations (implementation)
- Same input pattern as find_definition: `class`, `patterns`, optional `jar`
- Returns array of NavigationResult with provenance and context — same shape as find_references
- Uses `textDocument/implementation` — needs raw endpoint.send()

### search_symbols (workspace/symbol)
- Pass through whatever JDT LS returns — no minimum query length or "too broad" rejection
- Input: `query` (symbol name pattern), optional `kind` filter (class/method/field/interface/enum)
- Paginated with `limit` and `offset` — same pattern as search_classes
- Uses `workspace/symbol` — needs raw endpoint.send()

### Graceful degradation
- Return empty results when JDT LS returns nothing — no "may still be indexing" hints (indexing appears to happen on demand)
- If type hierarchy finds supertypes but empty subtypes, return what we have — no retry, no note (leave a source code comment about this for future reference)
- Add wrapper methods to our client module for implementation, typeHierarchy, and workspace/symbol — keeps tools DRY

### Claude's Discretion
- LSP SymbolKind numeric → human-readable string mapping
- Timeout handling for slow type hierarchy on large class trees
- Whether to batch didOpen/didClose or open-per-request
- Exact structure of the "java" provenance for JDK types in hierarchy results

</decisions>

<specifics>
## Specific Ideas

- list_members should be the go-to "understand this class" tool — more useful than reading 2000 lines of raw source
- type_hierarchy is critical for Mixin development where you need to know the class hierarchy to pick injection targets
- search_symbols across the entire workspace replaces the need for reading source to find method names
- All tools reuse the existing JDT LS session from project load — no additional startup cost
- User wants DRY opportunities — wrapper methods in client module, shared tool patterns

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md (ALSB-01 through ALSB-05).

### LSP Protocol References
- LSP spec for `textDocument/documentSymbol` — returns DocumentSymbol[] (hierarchical) or SymbolInformation[] (flat)
- LSP spec for `textDocument/hover` — returns Hover with MarkupContent
- LSP spec for `textDocument/prepareTypeHierarchy` + `typeHierarchy/supertypes` + `typeHierarchy/subtypes`
- LSP spec for `textDocument/implementation` — returns Location[] (same as definition)
- LSP spec for `workspace/symbol` — returns SymbolInformation[]

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/jdtls/client.ts`: JDT LS lifecycle — already has LspClient with `documentSymbol()`, `hover()`, `definition()`, `references()` built in
- `src/jdtls/uri-mapper.ts`: Bidirectional URI mapping with symlink resolution — reuse for all tools
- `src/jdtls/context-extractor.ts`: Enclosing semantic unit extraction — reuse for find_implementations results
- `src/jdtls/types.ts`: NavigationResult, ContextSnippet types — reuse for implementation and hierarchy results
- `src/browsing/cascading-regex.ts`: Position identification for hover/implementation tools
- `src/tools/find-definition.ts`: Template for cascading-regex-to-LSP tool pattern

### ts-lsp-client Coverage
- **Built-in:** `documentSymbol()`, `hover()`, `definition()`, `references()`, `typeDefinition()`, `signatureHelp()`
- **Missing (need wrapper):** `textDocument/implementation`, `textDocument/prepareTypeHierarchy`, `typeHierarchy/supertypes`, `typeHierarchy/subtypes`, `workspace/symbol`
- Raw calls via `endpoint.send(method, params)` work for any LSP method

### Established Patterns
- Tool input: `class` (FQN), `patterns` (cascading regex), optional `jar` and `project`
- Tool output: `makeSuccess`/`makeError` envelope with human-readable `text` + `structuredContent`
- LSP lifecycle: didOpen → request → didClose with try/finally for cleanup
- NavigationResult shape: jar, category, provenanceChains, entryPath, className, line, column, context
- Tool registration: `registerXTool(server)` in `src/tools/index.ts`

### Integration Points
- `src/tools/index.ts`: Add 5 new register calls
- `src/jdtls/client.ts`: Add wrapper methods for missing LSP methods
- `src/project/types.ts`: LoadedProject.jdtls — session already available

</code_context>

<deferred>
## Deferred Ideas

- Call hierarchy (incoming/outgoing calls) — valuable but lower priority, could be Phase 11
- textDocument/typeDefinition — "what type is this variable?" — nice to have, could add later
- signatureHelp — more useful for code completion than browsing, skip for now
- DRY refactor of shared tool patterns — user flagged interest, but out of scope for this phase

</deferred>

---

*Phase: 10-advanced-lsp-browsing*
*Context gathered: 2026-04-13*
