# Phase 10: Advanced LSP Browsing - Research

**Researched:** 2026-04-13
**Domain:** LSP protocol methods (documentSymbol, hover, typeHierarchy, implementation, workspace/symbol) via ts-lsp-client + JDT LS
**Confidence:** HIGH

## Summary

Phase 10 adds five new MCP tools that expose JDT LS capabilities for structured class browsing: `list_members` (documentSymbol), `get_symbol_info` (hover), `type_hierarchy` (prepareTypeHierarchy + supertypes/subtypes), `find_implementations` (implementation), and `search_symbols` (workspace/symbol). The existing Phase 9 infrastructure -- JDT LS client lifecycle, URI mapper, context extractor, source extraction, and the didOpen/request/didClose pattern -- provides a solid foundation.

Of the five LSP methods needed, two are built into ts-lsp-client's LspClient class (`documentSymbol()`, `hover()`) and three require raw `endpoint.send()` calls (`textDocument/implementation`, `textDocument/prepareTypeHierarchy` + `typeHierarchy/supertypes` + `typeHierarchy/subtypes`, `workspace/symbol`). The CONTEXT.md decision to add wrapper methods in the client module is the right approach -- it keeps tools DRY and centralizes LSP protocol handling.

The biggest implementation complexity is in `type_hierarchy`, which requires a three-step LSP protocol (prepare, then walk supertypes to root, then walk subtypes to `depth`). All other tools are single-request patterns. The find_definition/find_references tools provide a proven template for cascading-regex-to-LSP tools.

**Primary recommendation:** Build wrapper methods for the three missing LSP methods first, then implement tools in order of increasing complexity: list_members, get_symbol_info, search_symbols, find_implementations, type_hierarchy.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- list_members: Tree structure (not flat), maximum detail per member, no filtering, uses textDocument/documentSymbol, input is class FQN + optional jar/project
- get_symbol_info: Returns raw markdown from JDT LS, always include javadoc field, return all hover results if ambiguous, filter out import/package declarations, input uses cascading regex pattern
- type_hierarchy: Full supertype depth, subtypes controlled by depth param (default 1), JDK types included with "java" provenance, separate extends from implements, uses prepare + supertypes + subtypes protocol
- find_implementations: Same input as find_definition (cascading regex), returns NavigationResult array, uses textDocument/implementation
- search_symbols: Pass through JDT LS results, input is query + optional kind filter, paginated with limit/offset, uses workspace/symbol
- Graceful degradation: Empty results when JDT LS returns nothing, no "still indexing" hints, no retry on empty subtypes

### Claude's Discretion
- LSP SymbolKind numeric to human-readable string mapping
- Timeout handling for slow type hierarchy on large class trees
- Whether to batch didOpen/didClose or open-per-request
- Exact structure of "java" provenance for JDK types in hierarchy results

### Deferred Ideas (OUT OF SCOPE)
- Call hierarchy (incoming/outgoing calls)
- textDocument/typeDefinition
- signatureHelp
- DRY refactor of shared tool patterns
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ALSB-01 | List all members of a class with signatures, visibility, types, kinds | `textDocument/documentSymbol` returns hierarchical DocumentSymbol[] with name, detail (signature), kind, range, selectionRange, children. Built into ts-lsp-client. |
| ALSB-02 | Get full type signature and Javadoc for any symbol via cascading regex | `textDocument/hover` returns Hover with MarkupContent (markdown). Built into ts-lsp-client. Reuses cascading regex pattern from find_definition. |
| ALSB-03 | Query type hierarchy (superclass chain, interfaces) for any class | `textDocument/prepareTypeHierarchy` + `typeHierarchy/supertypes` (walk to root). Needs raw endpoint.send(). Three-step protocol. |
| ALSB-04 | Find all implementations/subtypes of a class/interface | `textDocument/implementation` returns Location[]. Needs raw endpoint.send(). Same result processing as find_references. |
| ALSB-05 | Search for symbols by name across entire workspace | `workspace/symbol` returns SymbolInformation[]. Needs raw endpoint.send(). Pagination via limit/offset on results array. |
</phase_requirements>

## Standard Stack

### Core (already installed, no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ts-lsp-client | 2.x | LSP communication | Already in use. Built-in documentSymbol() and hover(). Raw endpoint.send() for the rest. |
| @modelcontextprotocol/sdk | 1.29.x | MCP server | Already in use. Tool registration pattern established. |
| Zod | 4.x | Schema validation | Already in use. Tool input schemas. |

### No New Dependencies
This phase requires zero new packages. All five tools build on existing ts-lsp-client + JDT LS infrastructure from Phase 9.

## Architecture Patterns

### Recommended Project Structure (additions only)
```
src/
  jdtls/
    client.ts            # ADD: wrapper methods for implementation, typeHierarchy, workspace/symbol
    types.ts             # ADD: TypeHierarchyResult, MemberInfo, SymbolSearchResult types
    symbol-kind.ts       # NEW: SymbolKind numeric -> string mapping utility
  tools/
    list-members.ts      # NEW: ALSB-01
    get-symbol-info.ts   # NEW: ALSB-02
    type-hierarchy.ts    # NEW: ALSB-03
    find-implementations.ts  # NEW: ALSB-04
    search-symbols.ts    # NEW: ALSB-05
    index.ts             # MODIFY: register 5 new tools
```

### Pattern 1: Built-in LspClient Method (list_members, get_symbol_info)

These tools use methods already on LspClient. Follow the existing didOpen/request/didClose pattern from find_definition.ts.

**list_members flow:**
```typescript
// 1. Resolve project, check JDT LS availability (same boilerplate as find_definition)
// 2. Convert FQN to entry path, build file URI via uriMapper
// 3. Read source text from jar via SourceAdapter
// 4. didOpen with source text
// 5. lspClient.documentSymbol({ textDocument: { uri: fileUri } })
// 6. didClose
// 7. Transform DocumentSymbol[] tree into structured response
```

**get_symbol_info flow:**
```typescript
// 1-4. Same as find_definition (resolve, cascade regex, didOpen)
// 5. lspClient.hover({ textDocument: { uri: fileUri }, position: lspPosition })
// 6. didClose
// 7. Extract markdown from Hover.contents, filter import/package
```

### Pattern 2: Raw endpoint.send() Wrapper (implementation, typeHierarchy, workspace/symbol)

For LSP methods not on LspClient, add thin wrappers that call `endpoint.send()`:

```typescript
// In src/jdtls/client.ts or a new lsp-extensions.ts module

import type { JSONRPCEndpoint } from 'ts-lsp-client';

export async function sendImplementation(
	endpoint: JSONRPCEndpoint,
	params: { textDocument: { uri: string }; position: { line: number; character: number } },
): Promise<any[]> {
	const result = await endpoint.send('textDocument/implementation', params);
	return result ?? [];
}

export async function prepareTypeHierarchy(
	endpoint: JSONRPCEndpoint,
	params: { textDocument: { uri: string }; position: { line: number; character: number } },
): Promise<any[]> {
	const result = await endpoint.send('textDocument/prepareTypeHierarchy', params);
	return result ?? [];
}

export async function getSupertypes(
	endpoint: JSONRPCEndpoint,
	item: any,  // TypeHierarchyItem
): Promise<any[]> {
	const result = await endpoint.send('typeHierarchy/supertypes', { item });
	return result ?? [];
}

export async function getSubtypes(
	endpoint: JSONRPCEndpoint,
	item: any,  // TypeHierarchyItem
): Promise<any[]> {
	const result = await endpoint.send('typeHierarchy/subtypes', { item });
	return result ?? [];
}

export async function workspaceSymbol(
	endpoint: JSONRPCEndpoint,
	query: string,
): Promise<any[]> {
	const result = await endpoint.send('workspace/symbol', { query });
	return result ?? [];
}
```

**Critical:** The `endpoint` is accessible from `JdtLsStartResult.endpoint` and needs to be stored on `JdtLsSession`. Currently `JdtLsSession` in types.ts does NOT have an `endpoint` field. It must be added.

### Pattern 3: Type Hierarchy Walking

The type hierarchy requires iterative walking:

```typescript
// Supertypes: walk from item to root
async function walkSupertypes(endpoint: JSONRPCEndpoint, item: TypeHierarchyItem): Promise<TypeHierarchyItem[]> {
	const chain: TypeHierarchyItem[] = [];
	let current = item;
	while (true) {
		const supers = await getSupertypes(endpoint, current);
		if (supers.length === 0) break;
		// For single inheritance (classes), take first; for interfaces, recurse all
		for (const s of supers) {
			chain.push(s);
		}
		// Continue walking up from the first superclass (not interfaces)
		current = supers[0];
	}
	return chain;
}

// Subtypes: BFS to depth limit
async function walkSubtypes(
	endpoint: JSONRPCEndpoint,
	item: TypeHierarchyItem,
	maxDepth: number,
): Promise<TypeHierarchyItem[]> {
	const result: TypeHierarchyItem[] = [];
	let frontier = [item];
	for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
		const next: TypeHierarchyItem[] = [];
		for (const f of frontier) {
			const subs = await getSubtypes(endpoint, f);
			result.push(...subs);
			next.push(...subs);
		}
		frontier = next;
	}
	return result;
}
```

### Pattern 4: SymbolKind Mapping (Claude's discretion)

**Recommendation:** Static lookup object, not a function call.

```typescript
// src/jdtls/symbol-kind.ts
export const SYMBOL_KIND_NAME: Record<number, string> = {
	1: 'file', 2: 'module', 3: 'namespace', 4: 'package',
	5: 'class', 6: 'method', 7: 'property', 8: 'field',
	9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function',
	13: 'variable', 14: 'constant', 15: 'string', 16: 'number',
	17: 'boolean', 18: 'array', 19: 'object', 20: 'key',
	21: 'null', 22: 'enumMember', 23: 'struct', 24: 'event',
	25: 'operator', 26: 'typeParameter',
};
```

These values are from the LSP 3.17 SymbolKind enum, also present in ts-lsp-client's models as `SymbolKind` enum. The mapping is stable across LSP versions.

### Anti-Patterns to Avoid
- **Parsing hover markdown into structured fields:** CONTEXT.md explicitly says return raw markdown. JDT LS hover output format is not stable across versions.
- **Adding query length minimums to search_symbols:** CONTEXT.md explicitly says pass through whatever JDT LS returns.
- **Flattening DocumentSymbol tree:** CONTEXT.md explicitly says tree structure, not flat.
- **Duplicating cascading-regex-to-position boilerplate:** Extract a shared helper from find_definition.ts for tools that need it (get_symbol_info, find_implementations).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SymbolKind enum | Custom enum parsing | ts-lsp-client SymbolKind enum + static name map | Standard LSP values, already typed |
| Type hierarchy walking | Recursive raw send calls in tool | Wrapper functions in client module | DRY, testable, reusable |
| Location normalization | Per-tool Location handling | Existing normalizeLocations() from find-definition.ts | Already handles Location/Location[]/LocationLink[] |
| Cascading regex to LSP position | Copy-paste from find_definition | Extract shared resolveSymbolPosition() helper | find_definition, find_references, get_symbol_info, find_implementations all need it |

**Key insight:** The cascading-regex-to-LSP-position resolution logic is duplicated between find_definition.ts and find_references.ts (nearly identical ~120 lines). This phase adds two more tools needing it (get_symbol_info, find_implementations). Extracting a shared helper is not "DRY refactoring" (deferred) -- it is practical reuse to avoid quadruple duplication.

## Common Pitfalls

### Pitfall 1: Missing endpoint on JdtLsSession
**What goes wrong:** Raw endpoint.send() calls need the JSONRPCEndpoint, but JdtLsSession only stores `client` (LspClient), not `endpoint`.
**Why it happens:** Phase 9 only needed LspClient built-in methods.
**How to avoid:** Add `endpoint?: JSONRPCEndpoint` to JdtLsSession interface in types.ts. Store it during JDT LS initialization in the project loading code.
**Warning signs:** TypeScript error when trying to access session.endpoint.

### Pitfall 2: TypeHierarchyItem data field
**What goes wrong:** The `data` field on TypeHierarchyItem is opaque server state. It MUST be passed back unchanged to supertypes/subtypes requests.
**Why it happens:** LSP spec says the item returned by prepareTypeHierarchy includes a `data` property that the server uses to identify the item in subsequent requests.
**How to avoid:** Never modify or reconstruct TypeHierarchyItem objects. Pass them through as-is.
**Warning signs:** Subtypes/supertypes return empty results or errors even for types that clearly have hierarchy.

### Pitfall 3: JDK types in type hierarchy have no source
**What goes wrong:** TypeHierarchyItem for java.lang.Object, java.io.Serializable, etc. have URIs pointing to JDT LS internal jdt:// scheme, not file:// URIs.
**Why it happens:** JDK classes are loaded from the JRE, not from extracted source jars.
**How to avoid:** Detect non-file:// URIs in hierarchy results. For jdt:// URIs, extract the class name from the item's `name` and `detail` fields and label with "java" provenance.
**Warning signs:** URI mapper returns null for JDK type URIs.

### Pitfall 4: DocumentSymbol vs SymbolInformation response
**What goes wrong:** documentSymbol can return either DocumentSymbol[] (hierarchical) or SymbolInformation[] (flat) depending on client capability negotiation.
**Why it happens:** LSP spec allows both response types. JDT LS returns DocumentSymbol[] (hierarchical) when the client supports it.
**How to avoid:** The current initialize call does not declare hierarchicalDocumentSymbolSupport capability. Add it to get DocumentSymbol[] guaranteed. Handle both types defensively.
**Warning signs:** Getting flat SymbolInformation[] instead of tree DocumentSymbol[].

### Pitfall 5: workspace/symbol returns limited results
**What goes wrong:** JDT LS limits workspace/symbol results (typically to 200-500 items). Short queries may hit this limit silently.
**Why it happens:** JDT LS performance optimization. No pagination in LSP spec for workspace/symbol.
**How to avoid:** Implement pagination at the tool level by slicing the results array with offset/limit. Note in tool description that results may be truncated by the language server for very broad queries.
**Warning signs:** Always getting exactly the same count regardless of query broadness.

### Pitfall 6: didOpen race with workspace/symbol
**What goes wrong:** workspace/symbol does NOT require a document to be open -- it searches the entire workspace index. Calling didOpen before workspace/symbol is unnecessary overhead.
**Why it happens:** Other tools follow the didOpen/request/didClose pattern.
**How to avoid:** workspace/symbol and (to some extent) type_hierarchy do not need didOpen. Only use didOpen for tools that operate on a specific document position.
**Warning signs:** Unnecessary file I/O and LSP notifications.

## Code Examples

### DocumentSymbol Response Shape (from JDT LS)
```typescript
// JDT LS returns DocumentSymbol[] (hierarchical) for textDocument/documentSymbol
// Source: LSP 3.17 spec + ts-lsp-client types
interface DocumentSymbol {
	name: string;           // "MinecraftClient"
	detail?: string;        // "extends Object implements Runnable" or method signature
	kind: SymbolKind;       // 5 (Class), 6 (Method), 8 (Field), etc.
	tags?: SymbolTag[];     // 1 = Deprecated
	range: Range;           // Full range of the symbol definition
	selectionRange: Range;  // Range of the symbol name
	children?: DocumentSymbol[];  // Nested symbols (methods, fields, inner classes)
}
```

### Hover Response Shape (from JDT LS)
```typescript
// JDT LS returns Hover for textDocument/hover
// Source: ts-lsp-client types
interface Hover {
	contents: MarkedString | MarkedString[] | MarkupContent;
	range?: Range;
}
// JDT LS typically returns MarkupContent with kind: 'markdown'
// containing the type signature and Javadoc in markdown format
```

### TypeHierarchyItem Shape (from LSP 3.17 spec)
```typescript
// Source: LSP 3.17 specification
interface TypeHierarchyItem {
	name: string;            // "MinecraftClient"
	kind: SymbolKind;        // 5 (Class), 11 (Interface), etc.
	tags?: SymbolTag[];
	detail?: string;         // e.g., "net.minecraft.client"
	uri: string;             // file:// URI or jdt:// for JDK types
	range: Range;            // Full range
	selectionRange: Range;   // Name range
	data?: unknown;          // Server-specific data, MUST pass through unchanged
}
```

### SymbolInformation Shape (workspace/symbol response)
```typescript
// Source: LSP 3.17 spec + ts-lsp-client types
interface SymbolInformation {
	name: string;            // "run"
	kind: SymbolKind;        // 6 (Method)
	tags?: SymbolTag[];
	location: Location;      // { uri, range }
	containerName?: string;  // "MinecraftClient"
}
```

### Extracting endpoint from JDT LS session
```typescript
// The endpoint must be stored during JDT LS initialization
// In the project loading code where startJdtLs() is called:
const { process, client, endpoint, dataDir } = await startJdtLs(javaPath, jdtlsHome, workspaceDir);

// Store endpoint on session alongside client
session.endpoint = endpoint;  // Requires adding field to JdtLsSession
```

### Initialize capabilities for hierarchical document symbols
```typescript
// In startJdtLs, add to capabilities:
capabilities: {
	textDocument: {
		definition: { dynamicRegistration: false },
		references: { dynamicRegistration: false },
		documentSymbol: {
			hierarchicalDocumentSymbolSupport: true,
		},
		hover: {
			contentFormat: ['markdown', 'plaintext'],
		},
		implementation: { dynamicRegistration: false },
		typeHierarchy: { dynamicRegistration: false },
	},
	workspace: {
		symbol: { dynamicRegistration: false },
	},
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| typeHierarchy as single request | Three-step prepare + supertypes/subtypes | LSP 3.17 | Must implement full protocol, not a single call |
| workspace/symbol returning flat results only | workspace/symbol with optional resolve | LSP 3.17 | JDT LS supports the basic form; resolve is optional |

## Open Questions

1. **Does JDT LS return DocumentSymbol[] or SymbolInformation[] with current capabilities?**
   - What we know: ts-lsp-client types indicate both are possible. JDT LS supports hierarchical when `hierarchicalDocumentSymbolSupport: true` is set.
   - What's unclear: Current Phase 9 initialize call does not set this capability.
   - Recommendation: Add capability in initialize call. Handle both defensively in tool code. HIGH confidence this will work -- JDT LS is well-known to support hierarchical symbols.

2. **How does JDT LS format hover content for decompiled source?**
   - What we know: JDT LS returns MarkupContent with kind: 'markdown' for hover.
   - What's unclear: How much Javadoc is available for decompiled Minecraft source (likely minimal).
   - Recommendation: Always include the javadoc field as per CONTEXT.md decision. Empty string when no Javadoc.

3. **What URI scheme does JDT LS use for JDK types in type hierarchy?**
   - What we know: JDK classes are loaded from JRE, not source jars. JDT LS uses `jdt://` protocol for JDK content.
   - What's unclear: Exact format of jdt:// URIs for hierarchy items.
   - Recommendation: Detect any non-file:// URI and produce a simplified result with name + "java" provenance. Test with a concrete class like MinecraftClient to verify.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ALSB-01 | list_members returns tree of class members | unit | `npx vitest run tests/tools/list-members.test.ts -x` | Wave 0 |
| ALSB-02 | get_symbol_info returns hover markdown | unit | `npx vitest run tests/tools/get-symbol-info.test.ts -x` | Wave 0 |
| ALSB-03 | type_hierarchy returns supertypes and subtypes | unit | `npx vitest run tests/tools/type-hierarchy.test.ts -x` | Wave 0 |
| ALSB-04 | find_implementations returns NavigationResult[] | unit | `npx vitest run tests/tools/find-implementations.test.ts -x` | Wave 0 |
| ALSB-05 | search_symbols returns paginated results | unit | `npx vitest run tests/tools/search-symbols.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/tools/list-members.test.ts` -- covers ALSB-01
- [ ] `tests/tools/get-symbol-info.test.ts` -- covers ALSB-02
- [ ] `tests/tools/type-hierarchy.test.ts` -- covers ALSB-03
- [ ] `tests/tools/find-implementations.test.ts` -- covers ALSB-04
- [ ] `tests/tools/search-symbols.test.ts` -- covers ALSB-05

Tests should follow the established pattern from find-definition.test.ts: mock jarReader, mock readFile, mock LspClient methods and endpoint.send(), use createTestPair for MCP server testing.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: src/jdtls/client.ts, src/jdtls/types.ts, src/jdtls/uri-mapper.ts, src/jdtls/context-extractor.ts
- Codebase analysis: src/tools/find-definition.ts, src/tools/find-references.ts (tool patterns)
- ts-lsp-client types: node_modules/ts-lsp-client/build/esm/types/lspClient.d.ts, models.d.ts
- [LSP 3.17 Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) - TypeHierarchy, Implementation, workspace/symbol

### Secondary (MEDIUM confidence)
- [LSP TypeHierarchy protocol discussion](https://github.com/microsoft/language-server-protocol/issues/1984) - Clarifications on intended behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing libraries verified in codebase
- Architecture: HIGH - patterns directly extend proven Phase 9 patterns with minimal novelty
- Pitfalls: HIGH - identified from direct code analysis (endpoint missing from session, capability negotiation) and LSP spec knowledge (TypeHierarchyItem.data passthrough, jdt:// URIs)

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- LSP spec and JDT LS are mature)
