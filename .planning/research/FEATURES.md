# Feature Landscape: v1.3 Context Management

**Domain:** MCP server response size control for code navigation tools
**Researched:** 2026-04-14

## Table Stakes

Features agents expect from code navigation tools with context management. Missing = agents waste context window or fail on large results.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| Line-range reading on `read_source` | Minecraft classes are 500-5000+ lines. Agents often need only a specific region (e.g., lines 200-250 around a method found via `list_members`). Returning the full file wastes context budget. Every IDE and code browsing tool supports this. | Low | Requires `jar` parameter (single jar only -- offset/limit is meaningless across multiple jars with different content) | Add `offset` (1-based line) and `limit` (line count) params. When omitted, return full source (backward compatible). Return metadata: `totalLines`, `startLine`, `endLine` so agents know where they are in the file. |
| Pagination on `find_references` | References can return 50-200+ results for commonly-used symbols (e.g., `World.getBlockState`). Currently returns ALL results with full context snippets via `processNavigationLocations`. This is the single biggest source of context overflow. | Medium | Existing `find_references` tool, existing `processNavigationLocations` helper | Add `limit` (default: 20) and `offset` (default: 0). Return `total` count so agents know how many exist. Sort results by category priority (minecraft > mod-source > fabric-api > library) so most relevant results appear first. |
| Pagination on `find_implementations` | Same problem as references -- popular interfaces like `Inventory`, `BlockEntity` can have dozens of implementations, each with a full context snippet. | Medium | Existing `find_implementations` tool, same `processNavigationLocations` helper | Same pattern as references: `limit`/`offset`/`total`. Lower default limit (10) since implementations are usually fewer but each is more significant. |
| Snippet verbosity control on navigation tools | Each `NavigationResult` includes a `ContextSnippet` from `extractEnclosingContext` which can be an entire method body. For a 100-line method, that is 100 lines per reference. With 30 references that is 3000 lines of snippets. The current context extractor is aggressive -- it returns the full enclosing method, not just a useful preview. | Low | Existing `extractEnclosingContext` in `context-extractor.ts`, existing `NavigationResult` type | Add a `snippetMode` parameter: `"signature"` (just the declaration line + a few lines), `"context"` (current behavior, full enclosing unit), `"none"` (location only, no source text). Default to `"context"` for backward compatibility. Agents doing bulk reference scans should pass `"signature"`. |

## Differentiators

Features that would make the tool notably better than typical code navigation MCP servers. Not expected, but high value.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| Context lines on `read_member` | When reading a method body, agents sometimes need surrounding context (preceding field, following method, nearby imports). `locate_in_source` already has this exact pattern with its `context: { linesBefore, linesAfter }` parameter. | Low | Existing `read_member` tool, existing `extractMemberSource` in `member-extractor.ts` | Add optional `contextLinesBefore` / `contextLinesAfter` params. Extend the extracted source region by N lines in each direction. Return adjusted `startLine`/`endLine`. Follows established pattern from `locate_in_source`. |
| Compact mode for search results | `search_classes` returns full `ClassInfo` objects with inner classes, access modifiers, jars list, etc. For broad searches agents often just need the FQN list to decide which class to investigate. | Low | Existing `search_classes` tool | Add `compact: boolean` param. When true, return only `{ fqn, kind, jar }` per result instead of full `ClassInfo`. Reduces per-result size by ~60-80%. |
| Grouped reference counts | Instead of only paginated results, also return a package-level distribution: "30 references: 12 in net.minecraft.client.*, 8 in net.minecraft.world.*, 10 in fabric-api". Agent sees the distribution at a glance and can target specific groups. | Medium | Pagination on `find_references` (build on top of it) | Add `groupedCounts` to the response envelope -- a map of package prefix to count. Computed from the full LSP result set before pagination. Zero extra tool calls needed; agent gets distribution metadata with the first page. |
| `search_symbols` result deduplication | JDT LS workspace/symbol can return the same symbol from multiple workspace copies (extracted jars). Results should be deduplicated by FQN, keeping highest-priority source. | Low | Existing `search_symbols` tool, existing `CATEGORY_PRIORITY` from `tool-helpers.ts` | Currently results may include duplicates from the workspace extraction. Dedup by FQN, preferring minecraft > mod-source > fabric-api > library priority. Quick quality win. |

## Anti-Features

Features to explicitly NOT build for v1.3.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automatic truncation / server-side hard limits | The agent should control what it gets, not be surprised by silently truncated data. Hard limits (e.g., "never return more than 100 lines") break trust -- the agent cannot distinguish complete data from truncated data. The MCP community discussion (#2211) explicitly warns against silent truncation. | Provide explicit `limit`/`offset` params and always report `total` so the agent makes informed choices. |
| Token-based response sizing | Counting tokens server-side requires a tokenizer dependency, adds complexity, and couples the server to specific model tokenization. Token limits are the client/host's concern per the MCP architecture. | Use line counts and result counts as the sizing primitive. Lines are universal, predictable, and cheap to compute. |
| Streaming / chunked tool results | MCP tool results are atomic in the SDK -- the `CallToolResult` type does not support incremental delivery. Streamable HTTP is a transport-level concern, not a tool result concern. | Pagination (multiple sequential tool calls) achieves the same progressive loading within MCP's design. |
| Cursor-based pagination for tool results | MCP's cursor-based pagination spec is for protocol-level listing operations (`resources/list`, `tools/list`). Tool results in this codebase already use offset/limit (established in `search_classes` and `search_symbols`). Switching to cursors would be inconsistent and add statefulness. | Keep offset/limit pagination. Stateless, predictable, already the pattern in this codebase. |
| Separate summary tools (`find_references_summary`, etc.) | Each tool definition costs 550-1400 tokens in the agent's system prompt. Adding parallel summary variants doubles tool surface area. With 22 tools already, this is a real concern. | Add summary/compact modes as parameters on existing tools. One tool, multiple verbosity levels. |
| Per-project response size configuration | Adds state management complexity for marginal benefit. The agent can pass smaller limits per call. | Let agents control verbosity per-call via parameters. Stateless is simpler. |

## Feature Dependencies

```
Line-range read_source requires jar parameter (single jar constraint)
    read_source [jar + offset + limit] --> slice with totalLines/startLine/endLine metadata

Pagination on find_references/find_implementations
    find_references [limit + offset] --> { results[], total, limit, offset }
    find_implementations [limit + offset] --> same shape

Snippet mode is independent of pagination (but composes well)
    find_references [snippetMode] --> controls extractEnclosingContext behavior
    find_implementations [snippetMode] --> same
    find_definition [snippetMode] --> same

Context lines on read_member follows locate_in_source pattern
    locate_in_source [context: {linesBefore, linesAfter}] --> existing pattern
    read_member [contextLinesBefore, contextLinesAfter] --> same approach

Grouped reference counts builds on pagination
    find_references [limit + offset] --> prerequisite
    find_references [groupedCounts] --> computed from full result set, returned alongside page

Compact search_classes is independent
    search_classes [compact] --> reduced ClassInfo output
```

No circular dependencies. All features are additive (new optional params on existing tools).

## MVP Recommendation

Prioritize for v1.3 in this order:

1. **Pagination on `find_references` + `find_implementations`** -- Highest impact. These tools produce the largest responses because they return unbounded result arrays with full context snippets. Add `limit`/`offset`/`total`. Default limits: 20 for references, 10 for implementations. This alone addresses the majority of context overflow incidents.

2. **Snippet verbosity control** -- Pairs with pagination. Add `snippetMode` parameter (`"signature"` | `"context"` | `"none"`) to `find_references`, `find_implementations`, and `find_definition`. When doing bulk reference scanning, agents pass `"signature"` to get compact results. Default `"context"` preserves backward compatibility.

3. **Line-range reading on `read_source`** -- Second highest impact for daily use. Large Minecraft classes are 2000-5000 lines. Add `offset` (1-based line number) and `limit` (number of lines). Require `jar` parameter when offset/limit are used. Return `totalLines`/`startLine`/`endLine` metadata.

4. **Context lines on `read_member`** -- Low effort, follows existing `locate_in_source` pattern. Add optional `contextLinesBefore`/`contextLinesAfter` params.

**Defer to follow-up or bundle as quick wins:**
- **Compact `search_classes`**: Low priority -- search results are already paginated and individual results are not huge.
- **Grouped reference counts**: Medium value but adds complexity to the find_references response shape. Add after pagination is proven useful.
- **`search_symbols` deduplication**: Quality fix, not a context management feature. Could be a quick win bundled in if time permits.

## Sources

- [MCP Pagination Specification](https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/pagination) -- Opaque cursor pagination for protocol-level listing; offset/limit is the correct pattern for tool results
- [MCP Response Size Limit Discussion #2211](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2211) -- Community consensus: servers should provide explicit controls, not silently truncate; capability negotiation discussed but not specced
- [15 Best Practices for Building MCP Servers in Production](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/) -- Cap data at reasonable thresholds, always report total_count
- [MCP and Context Overload](https://eclipsesource.com/blogs/2026/01/22/mcp-context-overload/) -- Each tool definition costs 550-1400 tokens; minimize tool count, maximize parameter flexibility
- [Solving Context Window Overflow in AI Agents](https://arxiv.org/html/2511.22729v1) -- Progressive disclosure and chunking approaches
- [LSP Skill for Code Analysis](https://github.com/lsp-client/lsp-skill/blob/main/skills/lsp-code-analysis/SKILL.md) -- Outline-first progressive disclosure pattern, `--max-items` for pagination
- [Context Mode MCP Server](https://github.com/mksglu/context-mode) -- Sandbox approach achieving 98% context reduction (reference for scale of problem)
- [Truncated MCP Tool Responses - Claude Code #2638](https://github.com/anthropics/claude-code/issues/2638) -- Real-world truncation causing agent workflow failures
- [MCP Tool Response Fills Context Window - Open WebUI #15884](https://github.com/open-webui/open-webui/discussions/15884) -- Another host experiencing the same context overflow problem
