# Pitfalls Research

**Domain:** Adding response size controls and progressive disclosure to an existing MCP server (22 tools, 526 tests)
**Researched:** 2026-04-14
**Confidence:** HIGH (based on codebase analysis of current tool implementations, response envelope patterns, and line-number conventions)

## Critical Pitfalls

### Pitfall 1: Breaking structuredContent Contracts When Reducing Verbosity

**What goes wrong:**
Existing agent workflows parse `structuredContent` envelopes expecting specific fields. Every tool returns `{ content: [...], structuredContent: makeSuccess({...}) }`. If you remove or rename fields from the structured response (e.g., dropping `context` from `NavigationResult` in find_references, or changing `source` to `lines` in `SourceResult`), agents that depended on those fields break silently -- they get `undefined` where they expected data, and their reasoning degrades without any error.

**Why it happens:**
The codebase has a dual-response pattern. Developers focus on making the human-readable `content[].text` look right and forget that `structuredContent` is the actual machine API. The types in `browsing/types.ts` (`SourceResult`, `MemberResult`, `LocateResult`, `NavigationResult`) and `jdtls/types.ts` (`ContextSnippet`) define the contract. Any field removal is a breaking change even though there is no formal schema versioning.

**How to avoid:**
- Never remove fields from existing `structuredContent` shapes. New parameters should be ADDITIVE: add optional params that cause the response to include LESS, but omitting those params must produce the identical response as before.
- For `read_source`: adding `startLine`/`lineCount` params is safe because omitting them returns full source. The response should ADD new metadata fields (`startLine`, `endLine`, `totalLines`) alongside the existing `source` and `lineCount`.
- For verbosity reduction: add a `verbosity` or `includeContext` param that defaults to the current (verbose) behavior. Agents opt into compact mode.
- Test: call every modified tool with NO new parameters and assert the structuredContent is byte-identical to pre-change output.

**Warning signs:**
- Any test asserting on structuredContent field presence starts failing
- Agent workflows produce "unexpected undefined" on fields that used to exist
- A PR removes a field rather than adding an optional parameter

**Phase to address:**
All phases -- this is a cross-cutting constraint. Establish the backward-compatibility rule in Phase 1 and enforce via tests throughout.

---

### Pitfall 2: Off-by-One Errors in Line-Range Extraction

**What goes wrong:**
Line-range slicing returns wrong content -- missing the first or last line, or including an extra line. This is insidious because the codebase already uses THREE different line-number conventions simultaneously.

**Why it happens:**
The existing code mixes conventions:

1. **LSP positions:** 0-based lines and characters (`loc.range.start.line`, converted at `search-symbols.ts:103`)
2. **User-facing line numbers:** 1-based (`cascadeResult.line`, `MemberResult.startLine`, `LocateResult.line`)
3. **Array indices:** 0-based (`lines[targetIdx]`, `Array.slice(start, end)` where end is exclusive)

The existing `extractContext` in `locate-in-source.ts` converts correctly:
```typescript
const startLine = Math.max(1, line - linesBefore);  // 1-based
const endLine = Math.min(totalLines, line + linesAfter);  // 1-based
const text = lines.slice(startLine - 1, endLine).join('\n');  // 0-based for slice
```

But `member-extractor.ts` uses a different approach:
```typescript
const rangeStartIdx = sym.range.start.line - 1;  // 1-based to 0-based
const rangeEndIdx = sym.range.end.line;  // "1-based end line = exclusive 0-based slice end"
```

New line-range code must be unambiguous about which convention it uses at every step.

**How to avoid:**
- Define the API clearly: `startLine` is 1-based (first line of file is 1), `lineCount` is the number of lines to return. This matches editor conventions and avoids "is the end inclusive or exclusive?" ambiguity.
- Document the conversion at the slicing site: `// startLine is 1-based, lineCount is count. slice(startLine-1, startLine-1+lineCount)`
- Add explicit boundary tests: `startLine=1, lineCount=1` returns exactly line 1; `startLine=totalLines, lineCount=1` returns last line; `startLine` past end returns empty with correct metadata; `startLine=0` returns an error.
- Add a reassembly test: reading the file in N-line chunks and concatenating must produce identical output to reading without range params.

**Warning signs:**
- Tests pass for mid-file ranges but fail for first or last line
- `startLine=1, lineCount=10` returns 9 or 11 lines
- Full-read `lineCount` differs from range-reassembled line count

**Phase to address:**
Phase 1 (read_source line-range). Boundary condition tests are acceptance criteria.

---

### Pitfall 3: `offset` Parameter Name Collision Across Tools

**What goes wrong:**
`search_classes` and `search_symbols` already use `offset` to mean "pagination offset: skip this many results." If `read_source` also uses `offset` to mean "start at this line number," agents will confuse the two. An agent that learned "`offset` skips results" from search_classes will pass `offset: 50` to read_source expecting to skip 50 results, but instead gets source starting at line 50.

**Why it happens:**
`offset` is a generic, overloaded term. In pagination contexts (search_classes, search_symbols) it means "result index." In line-range contexts it means "line number." The milestone description even says "offset + limit" for read_source, matching the pagination terminology exactly.

**How to avoid:**
- Use DISTINCT parameter names: `startLine` and `lineCount` for line-range reading. Keep `offset` and `limit` exclusively for pagination.
- This naming also makes the API self-documenting: `startLine: 50, lineCount: 20` is unambiguous. `offset: 50, limit: 20` on a source-reading tool is not.
- Audit all tools before implementation to ensure no parameter name means different things on different tools.

**Warning signs:**
- Tool description for read_source says "offset" without clarifying it means line number
- Agent passes pagination-style offset to a line-range tool or vice versa
- Test names use "offset" ambiguously

**Phase to address:**
Phase 1 (first phase that adds parameters). Naming convention must be decided before any implementation.

---

### Pitfall 4: Changing Default Verbosity Breaks Agent Reasoning Without Visible Errors

**What goes wrong:**
You reduce the default response of `find_references` by removing `context: ContextSnippet` from each `NavigationResult`. Responses are smaller and faster. But the agent was using those snippets to understand WHAT each reference does -- without them, it cannot distinguish a meaningful reference from a trivial one. Analysis quality degrades silently. No error, no test failure, just worse answers.

**Why it happens:**
The `context` field in `NavigationResult` (defined in `jdtls/types.ts`) is populated by `extractEnclosingContext()` in `context-extractor.ts`, which finds the enclosing method/field/class for each reference location. This is expensive (reads the source file, parses structure) but provides critical semantic context. Removing it saves tokens but removes the information the agent needs to reason about references.

**How to avoid:**
- NEVER reduce default verbosity. Only add optional parameters that let the agent request LESS when it knows it wants less.
- Add `includeContext: boolean` (default: `true`) to find_references/find_definition/find_implementations. When `false`, the `context` field is omitted from results.
- Document the tradeoff in tool descriptions: "Set includeContext=false for large result sets where you only need locations, then use read_source to inspect specific results."
- The right pattern is progressive disclosure: full details by default, opt-in to compact mode.

**Warning signs:**
- Agent starts making more follow-up tool calls after the change (compensating for lost context)
- Agent analysis of references becomes shallower ("found 47 references" without explaining what they do)
- No test failures despite meaningful behavior change

**Phase to address:**
The verbosity audit phase. This is the most dangerous phase because "improvements" can be invisible regressions.

---

### Pitfall 5: Line-Range Without Single-Jar Requirement Creates Ambiguity

**What goes wrong:**
`read_source` currently searches ALL jars when `jar` is omitted, returning the class from every jar that contains it (see `read-source.ts:63-110`). If line-range params are allowed without requiring a specific jar, you get nonsensical results: line 50-60 from the Minecraft jar is different content than line 50-60 from a mod source jar. The agent gets multiple incompatible line ranges.

**Why it happens:**
The multi-jar search is useful for "find me this class" but meaningless for "read lines 50-60." Different jars may have different versions of the same class with different line counts.

**How to avoid:**
- When `startLine` or `lineCount` is provided, REQUIRE the `jar` parameter. Return a clear error if line-range params are given without a single jar.
- Validate early: check for the invalid combination BEFORE any jar I/O, in the input validation section of the handler.
- The error message should explain why: "Line-range reading requires a specific jar because different jars may contain different versions of this class."

**Warning signs:**
- Multi-jar + line-range silently returns results from multiple jars with conflicting content
- Agent gets confused about which jar's line numbers to use in follow-up calls

**Phase to address:**
Phase 1 (read_source line-range). Input validation is the first thing to implement.

---

### Pitfall 6: Trailing Newline Produces Phantom Empty Last Line

**What goes wrong:**
Java source files end with a newline. `source.split('\n')` on `"line1\nline2\n"` produces `["line1", "line2", ""]` -- three elements for two lines of content. The existing `lineCount` field (computed as `source.split('\n').length` in `read-source.ts:39` and `read-source.ts:76`) counts this phantom empty element. When the agent requests the last "line" via range, it gets an empty string. When `totalLines` reports 3 but the file has 2 meaningful lines, pagination logic breaks.

**Why it happens:**
This has been invisible because nobody was paginating by line number before -- agents read the full source. Line-range reading exposes the inconsistency.

**How to avoid:**
- Do NOT change the existing `lineCount` semantics (that would break backward compatibility per Pitfall 1).
- In the line-range response, use `totalLines` that matches `lineCount` exactly. Be consistent, not clever.
- If the agent requests beyond end-of-file, clamp and return what exists. Include `startLine` and `endLine` in the response so the agent knows exactly what it received.
- Add a test: full read vs reading the entire file via `startLine=1, lineCount=totalLines` must produce identical `source` content.

**Warning signs:**
- Full-read `lineCount` differs from `totalLines` in line-range response for the same file
- Chunk-reassembly test fails due to extra empty line at boundary

**Phase to address:**
Phase 1 (read_source line-range). The reassembly test catches this.

---

### Pitfall 7: Context Lines on read_member Overlapping Adjacent Members

**What goes wrong:**
Adding context lines to `read_member` (e.g., 5 lines before/after) includes raw lines that may contain the end of the previous method or start of the next method. Java classes pack members tightly. The agent gets fragments of unrelated members and may misattribute them to the target member.

**Why it happens:**
Context lines are dumb -- they do not respect semantic boundaries. `locate_in_source` already has this exact pattern (`context.linesBefore`, `context.linesAfter`) and it works there because locate finds a POINT in source, not a complete semantic unit. But `read_member` already returns a complete unit (Javadoc + annotations + signature + body via `extractMemberSource` in `member-extractor.ts`). Adding raw line context around a complete unit creates a mixed response.

**How to avoid:**
- Consider whether this feature is necessary at all. The agent can already get surrounding context via `read_source` with a line range around the member's `startLine`/`endLine`.
- If context IS added, clearly separate the member source from context in the response: `{ memberSource: "...", contextBefore: "...", contextAfter: "..." }`. Do NOT concatenate them into the existing `source` field.
- Alternatively, use semantic boundaries: extend to the nearest blank line or class-level declaration rather than a fixed line count.

**Warning signs:**
- Context includes partial method signatures from adjacent members
- Agent references code from context as if it belongs to the target member
- Tests check line count of context but not content coherence

**Phase to address:**
The read_member context phase. Evaluate whether read_source line-range makes this redundant.

---

### Pitfall 8: Pagination on find_references Without Clear "More Results" Signal

**What goes wrong:**
`find_references` currently returns ALL results (no pagination). If you add a `limit` parameter, the agent might get 50 of 312 results and treat them as the complete set because the response does not clearly signal truncation.

**Why it happens:**
MCP tools are stateless -- no cursors. The agent must be told there are more results and how to get them. The existing `search_classes` and `search_symbols` tools handle this with `total`/`offset`/`limit` fields. But `find_references` processes results through `processNavigationLocations()` in `tool-helpers.ts`, which returns a flat array with no pagination metadata.

**How to avoid:**
- Every paginated response must include: `total`, `offset`, `limit`, and ideally `hasMore: boolean` (redundant but explicit for agents).
- For `find_references`: the default `limit` should be undefined (meaning "all results") to preserve backward compatibility. Pagination only activates when the agent explicitly passes a `limit`.
- Add `truncated: true/false` when results are implicitly capped (e.g., by a maximum safeguard limit) without explicit agent pagination.
- Update `TOOL_DESCRIPTIONS.find_references` to mention pagination: "Use limit/offset to paginate large result sets. Response includes total count."

**Warning signs:**
- Agent says "found 50 references" when there are 312 (only got page 1, didn't notice hasMore)
- Tests verify result count but not pagination metadata

**Phase to address:**
The phase adding pagination to navigation tools. Follow the exact pattern from `search_classes`.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `offset`/`limit` names for line-range params | Matches milestone description terminology | Agents confuse line-range offset with pagination offset | Never. Use `startLine`/`lineCount` for line ranges. |
| Slicing results in the tool handler while JDT LS returns all | Quick pagination implementation | Full work still done server-side; pagination only saves response size | Acceptable -- JDT LS has no server-side pagination for workspace/symbol or references |
| Silently clamping invalid ranges | No error responses to handle | Agent doesn't know its request was modified | Only for boundary clamping (past-end-of-file). Invalid combos (line-range without jar) should be hard errors |
| Adding context param to read_member when read_source line-range exists | Convenience for agents | Two ways to get surrounding context; inconsistent patterns | Evaluate whether read_source line-range makes it redundant before building |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP SDK inputSchema | Adding new optional params and assuming old agents send `undefined` for them | Zod `.optional()` handles this correctly. Test that omitting the param calls the handler with `undefined` and produces backward-compatible output. |
| structuredContent envelope | Changing the `makeSuccess` data shape without updating `browsing/types.ts` | The existing TS errors (ToolError/ToolSuccess index signature) already show type drift. Adding new fields to response types must update types AND test factories. |
| TOOL_DESCRIPTIONS | Adding params without updating the tool description | Agents read descriptions to learn how to use tools. New params not mentioned in descriptions will not be used. Update `descriptions.ts` for every param addition. |
| processNavigationLocations | Adding pagination after this function returns all results | Pagination must wrap around the full results array, not inside processNavigationLocations. Keep the helper returning all results; the tool handler slices. |
| extractEnclosingContext | Assuming it's cheap to call for every result | It reads the source file and parses structure for each location. For 300 references, this means reading up to 300 files. The sourceCache in processNavigationLocations helps but semantic parsing still scales linearly. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reading full source then slicing for line-range | Latency same as full read for 5-line request | Acceptable: node-stream-zip reads entire entries from the jar. String splitting is negligible for Java files (largest MC classes ~5K lines). | Never at this project's scale |
| find_references with 500+ results including full context snippets | Large response payloads, context window overflow | This is the EXACT problem v1.3 aims to solve. Add optional `limit` param. | Already an issue for heavily-referenced symbols like `Identifier.of()` |
| enrichSymbols pipeline for read_member context | 100ms+ per call for full symbol enrichment | Context lines don't require enrichment -- they're raw source lines. If implementing context on read_member, don't re-enrich just to get line ranges. | Not expected to be a real issue |

## UX Pitfalls (Agent Experience)

| Pitfall | Agent Impact | Better Approach |
|---------|-------------|-----------------|
| Same param name (`offset`) meaning different things on different tools | Agent applies line-number offset to a pagination tool or vice versa | `startLine`/`lineCount` for line ranges, `offset`/`limit` for pagination. Distinct names. |
| Silent truncation without metadata | Agent treats truncated results as complete, misses references | Always include `total`, `returned`, `hasMore` in paginated responses |
| Compact mode removing context the agent needs | Analysis quality degrades silently | Default to full verbosity. Agent opts into compact. Document what compact removes. |
| Error message for line-range without jar doesn't explain why | Agent retries without jar, gets same error | Error: "Line-range requires a specific jar because different jars may have different versions of this class." |
| Adding `lineCount` param that collides with response field `lineCount` | Confusion between the request param and the response field | Use `lineCount` as the request param (how many lines to read), keep `lineCount` in response (how many lines returned). OR rename the request param to `maxLines` to disambiguate. |

## "Looks Done But Isn't" Checklist

- [ ] **read_source line-range:** Boundary tests -- `startLine=1, lineCount=1` returns first line; `startLine=totalLines, lineCount=1` returns last line; beyond-end returns empty with metadata; `startLine=0` errors
- [ ] **read_source line-range:** Reassembly test -- reading file in N-line chunks and concatenating produces identical output to full read
- [ ] **read_source line-range:** Input validation -- `startLine` or `lineCount` without `jar` returns clear error
- [ ] **read_source line-range:** Response metadata -- includes `startLine`, `endLine`, `totalLines` alongside `source`
- [ ] **Pagination on navigation tools:** Response includes `total` even when limit is applied, not just array length
- [ ] **Pagination on navigation tools:** TOOL_DESCRIPTIONS updated to mention pagination params and usage pattern
- [ ] **Verbosity controls:** Calling tool with NO new params produces structuredContent identical to pre-change version
- [ ] **read_member context:** Context output doesn't include partial fragments of adjacent members
- [ ] **Parameter naming:** All line-range params use same names across tools, all pagination params use same names, no collisions between the two

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Broke structuredContent contract | MEDIUM | Add back removed fields, release patch. Agents that cached broken schema need tool refresh. |
| Off-by-one in line range | LOW | Fix slicing math, update tests. Read-only server, no data corruption possible. |
| Pagination missing total count | LOW | Add `total` field. Additive change, backward compatible. |
| Changed default verbosity | HIGH | Reverting is easy but damage (degraded agent reasoning) already happened. Cannot undo bad analysis. |
| Parameter name collision | MEDIUM | Renaming params is breaking for agents that learned old names. Get it right first time. |
| Line-range without jar validation | LOW | Add validation check. No data corruption, just confusing results to fix. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Breaking structuredContent contracts | All phases (cross-cutting rule) | Test: omitting new params produces identical structuredContent |
| Off-by-one in line-range | read_source line-range phase | Boundary tests + reassembly test |
| Parameter name collision (offset) | First phase (naming convention decision) | Audit: no param name means different things on different tools |
| Silent verbosity degradation | Verbosity audit phase | Before/after structuredContent comparison with no new params |
| Line-range without jar | read_source line-range phase | Test: line-range params without jar returns clear error |
| Trailing newline inconsistency | read_source line-range phase | Test: full read vs range-reassembled content is identical |
| Context lines overlapping members | read_member context phase | Test: context doesn't contain partial adjacent member signatures |
| Pagination without hasMore signal | Navigation pagination phase | Test: response includes total/offset/limit/hasMore metadata |

## Sources

- Codebase: `src/tools/read-source.ts` -- current full-source response pattern, `lineCount` via `split('\n').length`
- Codebase: `src/tools/read-member.ts` -- member extraction pipeline, enrichSymbols dependency
- Codebase: `src/tools/find-references.ts` -- no pagination, full result return via processNavigationLocations
- Codebase: `src/tools/search-classes.ts` -- existing pagination pattern with offset/limit/total
- Codebase: `src/tools/search-symbols.ts` -- existing pagination pattern, client-side slicing of JDT LS results
- Codebase: `src/tools/locate-in-source.ts` -- existing `context` parameter pattern with linesBefore/linesAfter
- Codebase: `src/tools/tool-helpers.ts` -- processNavigationLocations, resolveClassSource, sourceCache pattern
- Codebase: `src/browsing/member-extractor.ts` -- line-number conventions (1-based to 0-based conversions)
- Codebase: `src/browsing/types.ts` -- SourceResult, MemberResult, LocateResult contracts
- Codebase: `src/jdtls/types.ts` -- NavigationResult, ContextSnippet contracts
- Codebase: `src/jdtls/context-extractor.ts` -- semantic context extraction, enclosing-unit detection

---
*Pitfalls research for: Adding context management controls to MinecraftDevMCP v1.3*
*Researched: 2026-04-14*
