# Phase 10: Advanced LSP Browsing - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose JDT LS document symbols, hover info, type hierarchy, and workspace symbol search as MCP tools. This builds on Phase 9's JDT LS infrastructure (client lifecycle, URI mapper, context extractor) to provide structured class browsing without reading raw source. Five new tools: `list_members`, `get_symbol_info`, `type_hierarchy`, `find_implementations`, `search_symbols`.

</domain>

<decisions>
## Implementation Decisions

### Tool design — list_members (documentSymbol)
- Uses `textDocument/documentSymbol` to get all symbols in a class
- Returns structured array of members with: name, kind (method/field/constructor/enum/interface/class), visibility (public/private/protected/package), signature (full type signature), range (start/end lines), and children (for inner classes)
- Accepts `class` (FQN) and optional `jar` parameter — same pattern as find_definition/find_references
- Does NOT require cascading regex — operates on the whole class
- Filters to direct members only by default (not inherited) — JDT LS documentSymbol returns document-level symbols which are already scoped to the file

### Tool design — get_symbol_info (hover)
- Uses `textDocument/hover` at a cascading-regex-identified position
- Returns: type signature, Javadoc/documentation (if available from source comments), and the symbol kind
- Same input pattern as find_definition: `class`, `patterns`, optional `jar`
- Returns markdown-formatted hover content (what JDT LS provides) plus structured fields extracted from it

### Tool design — type_hierarchy (typeHierarchy)
- Uses `textDocument/prepareTypeHierarchy` then `typeHierarchy/supertypes` and `typeHierarchy/subtypes`
- Accepts `class` (FQN) and optional `jar` — identifies the class, opens the file, sends hierarchy request
- Returns both supertypes (superclass chain + interfaces) and subtypes (direct implementors/subclasses)
- Each entry includes: class name, jar ID, category, entry path — same NavigationResult shape as find_definition
- Direction parameter: `"supertypes"`, `"subtypes"`, or `"both"` (default: `"both"`)

### Tool design — find_implementations (implementation)
- Uses `textDocument/implementation` at a cascading-regex-identified position
- Same input pattern as find_definition: `class`, `patterns`, optional `jar`
- Returns array of NavigationResult with provenance and context — same shape as find_references
- Useful for "who implements this interface method?" or "which classes extend this?"

### Tool design — search_symbols (workspace/symbol)
- Uses `workspace/symbol` with a query string
- Accepts `query` (symbol name pattern) and optional `kind` filter (class/method/field/interface/enum)
- Returns array of results with: name, kind, container (enclosing class), jar ID, location
- No cascading regex needed — this is a workspace-wide name search
- Paginated with `limit` and `offset` parameters — same pattern as search_classes

### Claude's Discretion
- Exact hover content parsing strategy (regex vs structured)
- Whether to batch multiple didOpen/didClose calls or open-per-request
- Timeout handling for slow type hierarchy resolution on large class trees
- SymbolKind mapping from LSP numeric kinds to human-readable strings

</decisions>

<specifics>
## Specific Ideas

- list_members should be the go-to "understand this class" tool — more useful than reading 2000 lines of raw source
- type_hierarchy is critical for Mixin development where you need to know the class hierarchy to pick injection targets
- search_symbols across the entire workspace replaces the need for reading source to find method names
- All tools should reuse the existing JDT LS session from project load — no additional startup cost

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and REQUIREMENTS.md (ALSB-01 through ALSB-05).

### LSP Protocol References
- LSP spec for `textDocument/documentSymbol` — returns SymbolInformation[] or DocumentSymbol[]
- LSP spec for `textDocument/hover` — returns Hover with MarkupContent
- LSP spec for `textDocument/prepareTypeHierarchy` + `typeHierarchy/supertypes` + `typeHierarchy/subtypes`
- LSP spec for `textDocument/implementation` — returns Location[] (same as definition)
- LSP spec for `workspace/symbol` — returns SymbolInformation[]

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/jdtls/client.ts`: JDT LS lifecycle (detect, spawn, init, shutdown) — already integrated into project load
- `src/jdtls/uri-mapper.ts`: Bidirectional file:// URI <-> jar ID + entry path mapping with symlink resolution
- `src/jdtls/context-extractor.ts`: Extracts enclosing semantic unit at a position — useful for hover context
- `src/jdtls/types.ts`: JdtLsSession, NavigationResult, ContextSnippet types
- `src/browsing/cascading-regex.ts`: Position identification for hover/implementation tools
- `src/tools/find-definition.ts`: Template for cascading-regex-to-LSP tool pattern (didOpen → request → didClose)

### Established Patterns
- Tool input: `class` (FQN), `patterns` (cascading regex), optional `jar` and `project` — used by find_definition, find_references, locate_in_source
- Tool output: `makeSuccess`/`makeError` envelope with human-readable `text` + `structuredContent`
- LSP lifecycle: didOpen → request → didClose with try/finally for cleanup
- NavigationResult shape: jar, category, provenanceChains, entryPath, className, line, column, context
- All tools registered via `registerXTool(server)` pattern in `src/tools/index.ts`

### Integration Points
- `src/tools/index.ts`: Tool registration — add 5 new register calls
- `src/project/types.ts`: LoadedProject.jdtls — session with client, already has LspClient
- `ts-lsp-client` LspClient: Already has `definition()`, `references()` — check if it has `hover()`, `documentSymbol()`, `typeHierarchy()`, `implementation()`, `symbol()` methods
- If ts-lsp-client doesn't support some LSP methods: use `endpoint.send(method, params)` directly on the JSONRPCEndpoint

</code_context>

<deferred>
## Deferred Ideas

- Call hierarchy (incoming/outgoing calls) — valuable but lower priority, could be Phase 11
- textDocument/typeDefinition — "what type is this variable?" — nice to have, could add later
- signatureHelp — more useful for code completion than browsing, skip for now

</deferred>

---

*Phase: 10-advanced-lsp-browsing*
*Context gathered: 2026-04-13*
