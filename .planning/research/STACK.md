# Technology Stack: v1.3 Context Management

**Project:** MinecraftDevMCP v1.3
**Researched:** 2026-04-14
**Scope:** Stack additions/changes for line-range reading, response truncation, pagination controls, output size estimation

## Executive Summary

This milestone requires **zero new dependencies and zero stack changes**. Every v1.3 feature is achievable with existing code patterns already proven in the codebase:

1. **Line-range reading** -- string splitting + slicing, same pattern as `extractContext()` in `locate-in-source.ts`
2. **Context lines on read_member** -- identical pattern, already proven
3. **Pagination/limits on tools that lack them** -- same `offset`/`limit` pattern used by `search_classes` and `search_symbols`
4. **Verbosity reduction** -- removing or condensing fields in existing structured responses
5. **Output size estimation** -- `Buffer.byteLength()` or string `.length`, built into Node.js

The existing stack (TypeScript 6.0.2, MCP SDK ^1.29.0, Zod ^4.3.6, node-stream-zip ^1.15.0) is fully sufficient. No `package.json` changes needed.

## Required Changes to Existing Stack

None. The entire v1.3 feature set is internal refactoring of tool parameters and response shaping.

## Feature-by-Feature Stack Analysis

### 1. Line-Range Reading on read_source (offset + limit)

**What's needed:** Add `offset` (line number to start from, 0-based or 1-based) and `limit` (max lines to return) parameters to `read_source` when a single `jar` is specified.

**Implementation approach:** Pure string manipulation already proven in the codebase.

```typescript
// Pattern from locate-in-source.ts extractContext(), adapted:
const lines = sourceText.split('\n');
const totalLines = lines.length;
const startLine = Math.max(0, offset ?? 0);
const endLine = limit !== undefined ? Math.min(totalLines, startLine + limit) : totalLines;
const sliced = lines.slice(startLine, endLine).join('\n');
```

**Why no library:** `String.split()` + `Array.slice()` is O(n) on first call, but the source text is already fully loaded from the jar via `node-stream-zip`. There is no streaming alternative that would help -- `node-stream-zip`'s `entryData()` returns the entire entry as a Buffer. A line-indexing library would add complexity for no benefit given file sizes (largest Minecraft source files are ~5,000 lines, typically under 500).

**Zod schema addition:**
```typescript
offset: z.number().int().min(0).optional().describe('Start reading from this line (0-based, default: 0)'),
limit: z.number().int().min(1).optional().describe('Maximum number of lines to return'),
```

**Constraint:** Line-range reading should require `jar` to be specified (single jar mode). Multi-jar mode returns the class from all jars -- adding line ranges to that would be confusing since the same class has different line counts in different jars.

### 2. Context Lines on read_member

**What's needed:** Optional `contextLines` parameter (or `context` object matching `locate_in_source`'s pattern) to include lines before/after the extracted member.

**Implementation approach:** The `extractMemberSource()` in `member-extractor.ts` already returns `startLine` and `endLine`. Adding context is the same `extractContext()` pattern from `locate-in-source.ts` -- clamp line range and slice.

**Why no library:** Same rationale as above. The source text is already in memory from the JDT LS `withLspDocument` call.

### 3. Pagination/Limits on Tools That Lack Them

**Current state:**

| Tool | Has offset/limit? | Needs it? |
|------|--------------------|-----------|
| `search_classes` | Yes (offset + limit, default 250) | No change needed |
| `search_symbols` | Yes (offset + limit, default 50) | No change needed |
| `list_members` | No | Maybe -- classes rarely exceed 200 members, but `MinecraftClient` has ~300. A `kind` filter is more useful than pagination. |
| `find_references` | No | Yes -- popular symbols (e.g., `World.getBlockState`) can have 500+ references |
| `find_implementations` | No | Yes -- interfaces like `Block` can have hundreds of implementations |
| `find_definition` | No | No -- returns 0-3 results by nature |
| `list_packages` | No | Maybe -- Minecraft has ~300 packages, manageable but could benefit from a limit |
| `list_classes` | No | Maybe -- largest package (net.minecraft.block) has ~200 classes |
| `type_hierarchy` | No | No -- hierarchy trees are bounded by class depth |

**Implementation approach:** Same Zod `offset`/`limit` pattern already used in `search_classes` and `search_symbols`. Apply to `find_references`, `find_implementations`, and optionally `list_members`.

```typescript
// Already-proven pattern from search-symbols.ts:
const effectiveLimit = limit ?? 50;
const effectiveOffset = offset ?? 0;
const total = filtered.length;
const page = filtered.slice(effectiveOffset, effectiveOffset + effectiveLimit);
```

**Why no library:** Array slicing is trivial. A pagination library would be absurd overhead for `slice()`.

### 4. Verbosity Reduction

**What's needed:** Audit structured responses and remove/condense fields that waste context tokens without adding value.

**Candidates for reduction (based on codebase review):**

| Field | Currently in | Assessment |
|-------|-------------|------------|
| `provenanceChains` | Every result with jar metadata | Often 2-3 levels deep, mostly noise for context management. Consider omitting by default, adding `verbose` flag. |
| `steps` in locate results | `locate_in_source` | Cascade step details are debugging info. Omit by default. |
| Full `location.uri` | `search_symbols`, navigation results | File URIs are long temp paths. The `jar` + `line` fields are sufficient. |
| `category` | Every jar-sourced result | Useful for disambiguation but repetitive when results come from the same jar. |

**Implementation approach:** This is purely restructuring return objects. Options:
1. **Remove fields from default output** -- simplest, may break consumers
2. **Add `verbose: boolean` parameter** -- backwards-compatible, agent can request detail when needed
3. **Add `fields: string[]` parameter** -- too complex, GraphQL-style field selection is overkill

**Recommendation:** Option 2 (`verbose` flag) because it preserves backwards compatibility while giving agents the choice. Default to concise output for v1.3.

**Why no library:** Restructuring TypeScript object literals needs no tooling.

### 5. Output Size Estimation

**What's needed:** Optionally report estimated response size so agents can decide whether to paginate further.

**Implementation approach:** Add a `metadata.responseSize` field to the envelope:

```typescript
// Already available in Node.js, no library needed:
const json = JSON.stringify(envelope);
const byteSize = Buffer.byteLength(json, 'utf-8');
const estimatedTokens = Math.ceil(json.length / 4); // rough heuristic: ~4 chars per token
```

**Where to add:** In the `makeSuccess()` helper or at the tool level before returning.

**Why no library:** Token estimation for Claude is roughly `characterCount / 4`. A tokenizer library (like `tiktoken` or `@anthropic-ai/tokenizer`) would add a dependency for marginal precision improvement. The heuristic is good enough for "is this response too big?" decisions.

**Why NOT to add a tokenizer:**
- `tiktoken` (OpenAI) uses a different tokenization than Claude
- No official Anthropic tokenizer package exists for JavaScript
- The purpose is estimation, not exact counting -- `length / 4` suffices
- Adding a WASM-based tokenizer would increase bundle size significantly

## No New Dependencies Required

| Need | Solution | Why No Library |
|------|----------|----------------|
| Line-range reading | `String.split().slice()` | Source text already in memory, files are small |
| Context lines | Same `extractContext` pattern from locate-in-source.ts | Already proven in codebase |
| Pagination | `Array.slice(offset, offset + limit)` | Trivial operation |
| Verbosity control | Conditional field inclusion in response objects | Object restructuring |
| Size estimation | `Buffer.byteLength()` + `string.length / 4` | Built into Node.js |
| Zod schemas for new params | Zod 4 (^4.3.6 installed) | Already in place |

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| Tokenizer library (tiktoken, etc.) | Wrong tokenization model for Claude, heavy WASM dependency, character-length heuristic is sufficient for estimation |
| Streaming response library | MCP SDK's stdio transport does not support streaming tool results. The response must be a complete JSON object. |
| Response compression (gzip, etc.) | MCP protocol uses JSON-RPC over stdio. Compression would need to be at the protocol level, not the tool level. Not supported. |
| LRU cache for line-split results | Source files are read from jars on demand (project constraint: no caching). Line splitting is fast enough (~1ms for largest files). |
| Pagination cursor library | Offset-based pagination with array slicing is the established pattern. Cursor-based pagination adds complexity for no benefit on in-memory result sets. |
| GraphQL-style field selection | Over-engineered for this use case. A simple `verbose` boolean covers the 80% case. |

## Stack Summary

| Component | Version | Status for v1.3 | Action |
|-----------|---------|-----------------|--------|
| TypeScript | 6.0.2 | Unchanged | None |
| Node.js | 22 LTS | Unchanged | None |
| @modelcontextprotocol/sdk | ^1.29.0 | Unchanged | None |
| Zod | ^4.3.6 | Unchanged | New optional params on existing tool schemas |
| node-stream-zip | ^1.15.0 | Unchanged | None |
| ts-lsp-client | ^1.1.1 | Unchanged | None |
| glob | ^13.0.6 | Unchanged | None |
| picomatch | ^4.0.4 | Unchanged | None |
| JDT LS | Latest milestone | Unchanged | None |

## Key Technical Details

### Line-Range Reading and node-stream-zip

`node-stream-zip`'s `entryData()` returns the entire ZIP entry as a `Buffer`. There is no way to read a byte range within a ZIP entry without decompressing the whole thing (ZIP entries use DEFLATE compression, which is not randomly accessible). Therefore, line-range reading must happen after full decompression:

1. `entryData()` returns full Buffer (already happening)
2. Convert to string: `buffer.toString('utf-8')` (already happening)
3. Split into lines and slice (new)

This means line-range reading does NOT save jar I/O -- it saves context window tokens by returning fewer lines. That is the entire point of v1.3.

### Response Size Budget

Typical response sizes from codebase analysis:

| Tool | Typical Response Size | Worst Case |
|------|----------------------|------------|
| `read_source` (full class) | 5-50 KB | ~200 KB (MinecraftClient.java) |
| `read_member` | 0.5-5 KB | ~20 KB (large method) |
| `find_references` | 2-20 KB | ~100 KB (500+ references) |
| `search_symbols` | 5-15 KB | ~50 KB (200 results at limit) |
| `list_members` | 5-30 KB | ~80 KB (MinecraftClient, 300+ members) |

Claude's context window is ~200K tokens (~800 KB of text). A single `read_source` on MinecraftClient.java consumes ~25% of that. This validates the need for line-range reading.

### Existing Patterns to Reuse

The codebase already has every pattern needed:

| Pattern | Where It Exists | Reuse For |
|---------|----------------|-----------|
| `extractContext(source, line, linesBefore, linesAfter)` | `locate-in-source.ts:15-27` | read_member context lines |
| `offset`/`limit` pagination with Zod schemas | `search-symbols.ts`, `search-classes.ts` | find_references, find_implementations |
| Structured envelope with metadata | `types/envelope.ts` | Adding responseSize metadata |
| `PARAMS` shared parameter definitions | `tools/descriptions.ts` | Shared offset/limit params |

## Sources

- Codebase analysis: `src/tools/read-source.ts`, `src/tools/read-member.ts`, `src/tools/locate-in-source.ts`, `src/tools/search-symbols.ts`, `src/tools/search-classes.ts`, `src/tools/find-references.ts`, `src/tools/find-implementations.ts`, `src/types/envelope.ts`, `src/browsing/types.ts` -- existing implementation review (HIGH confidence)
- [node-stream-zip API](https://github.com/antelle/node-stream-zip) -- confirmed `entryData()` returns full entry Buffer, no partial read support (HIGH confidence)
- [MCP SDK structured content](https://modelcontextprotocol.io/docs/concepts/tools) -- tool responses are complete JSON objects, no streaming (HIGH confidence)
- [ZIP file format](https://en.wikipedia.org/wiki/ZIP_(file_format)) -- DEFLATE compression is not randomly seekable, full decompression required (HIGH confidence)
