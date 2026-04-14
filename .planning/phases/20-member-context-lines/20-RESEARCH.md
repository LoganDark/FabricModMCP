# Phase 20: Member Context Lines - Research

**Researched:** 2026-04-14
**Domain:** Extending read_member with surrounding source context (linesBefore/linesAfter)
**Confidence:** HIGH

## Summary

Phase 20 adds optional `linesBefore` and `linesAfter` parameters to the `read_member` tool so agents can see surrounding source context without a separate `read_source` call. The implementation is entirely within existing code -- no new dependencies, no new files, no architectural changes. It extends `MemberExtraction` and `MemberResult` with `memberStartLine`/`memberEndLine` fields and expands the extracted source range outward from the member boundaries.

The pattern is nearly identical to Phase 19's `sliceLines` utility, but applied at the member extraction level rather than the tool handler level. The source text is already split into lines in `extractMemberSource()`, so context expansion is a matter of widening the slice bounds with clamping.

**Primary recommendation:** Add context expansion logic directly in `extractMemberSource()` (not the tool handler), mirroring the self-contained pure-function pattern established in Phase 19. Extend both `MemberExtraction` and `MemberResult` interfaces with `memberStartLine`/`memberEndLine` fields that always equal `startLine`/`endLine` when no context is requested.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Merged source: `source` field contains context lines + member source as one continuous block
- Member boundary metadata: `memberStartLine` and `memberEndLine` fields mark the original member range within the expanded block
- Expanded range metadata: `startLine` and `endLine` reflect the full range including context
- When context is not requested, `memberStartLine === startLine` and `memberEndLine === endLine`
- `linesBefore` and `linesAfter` are both optional and independent
- `linesBefore` alone: expand upward from member start
- `linesAfter` alone: expand downward from member end
- Both together: expand in both directions
- Omitting both produces identical output to pre-v1.3 behavior (backward compatible)
- Each overload extraction gets its own independent context expansion
- No deduplication -- if adjacent overloads' context ranges overlap, repeated lines appear in both results
- Each result is self-contained
- Silent clamp when context extends past file boundaries (same as Phase 19 read_source)
- Agent infers clamping from metadata (actual startLine vs theoretical requested range)
- No separate clamped/truncated flag

### Claude's Discretion
- Whether to add `memberLineCount` alongside `memberStartLine`/`memberEndLine` or let agent compute it
- Error handling for invalid values (linesBefore < 0, linesAfter < 0)
- Whether context expansion happens in member-extractor.ts or in the tool handler

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| READ-03 | read_member accepts optional linesBefore and linesAfter to include surrounding context around the member | Full implementation path identified: add params to tool schema, pass through to extractMemberSource, expand slice range with clamping, add memberStartLine/memberEndLine metadata |
</phase_requirements>

## Standard Stack

No new dependencies. This phase modifies only existing files:

| File | Purpose | Change Type |
|------|---------|-------------|
| `src/browsing/member-extractor.ts` | Core extraction logic | Add linesBefore/linesAfter params, expand slice, add memberStartLine/memberEndLine |
| `src/browsing/types.ts` | `MemberResult` interface | Add memberStartLine, memberEndLine fields |
| `src/tools/read-member.ts` | Tool schema and handler | Add linesBefore/linesAfter to inputSchema, pass to extraction |
| `src/tools/descriptions.ts` | Parameter schemas | Add PARAMS.linesBefore, PARAMS.linesAfter |

## Architecture Patterns

### Pattern 1: Context Expansion in extractMemberSource

**What:** Add optional `linesBefore`/`linesAfter` parameters to `extractMemberSource()`. After computing the member range (including Javadoc via `findDecorationsStart`), widen the slice bounds outward with clamping at file boundaries.

**When to use:** Always -- this keeps the pure-function pattern. The tool handler just passes parameters through.

**Example:**
```typescript
// In extractMemberSource, after computing decorationStart and rangeEndIdx:
const memberStartLine = decorationStart + 1; // 1-based, includes Javadoc
const memberEndLine = sym.range.end.line;     // 1-based

// Expand with context, clamping at boundaries
const contextStart = Math.max(0, decorationStart - (linesBefore ?? 0));
const contextEnd = Math.min(lines.length, rangeEndIdx + (linesAfter ?? 0));

const source = lines.slice(contextStart, contextEnd).join('\n');

return {
	source,
	startLine: contextStart + 1,          // 1-based, expanded range
	endLine: contextEnd,                   // 1-based, expanded range
	lineCount: contextEnd - contextStart,
	memberStartLine,                       // 1-based, original member range
	memberEndLine,                         // 1-based, original member range
	memberFqn: ...,
	kind: ...,
};
```

### Pattern 2: Backward-Compatible Interface Extension

**What:** Add `memberStartLine` and `memberEndLine` to both `MemberExtraction` and `MemberResult`. When no context is requested, these equal `startLine` and `endLine` respectively.

**Why:** Success criteria #2 requires byte-identical output when linesBefore/linesAfter are omitted. Adding new fields (not changing existing ones) preserves backward compatibility. The `source`, `startLine`, `endLine`, and `lineCount` fields retain their current meaning when no context params are provided.

**Important nuance:** "Byte-identical output" means the MemberResult shape must be a superset. New fields (`memberStartLine`, `memberEndLine`) will always be present, but their values will match `startLine`/`endLine` when no context is requested. The `source` content will be identical. This is backward compatible because agents consuming the existing fields see the same values.

### Pattern 3: Parameter Schema in descriptions.ts

**What:** Add shared parameter definitions for `linesBefore` and `linesAfter` in the `PARAMS` object.

**Example:**
```typescript
export const PARAMS = {
	// ... existing params ...
	linesBefore: z.number().int().min(0).optional()
		.describe('Number of source lines to include before the member'),
	linesAfter: z.number().int().min(0).optional()
		.describe('Number of source lines to include after the member'),
} as const;
```

**Note on validation:** Use `z.number().int().min(0)` -- this rejects negative values at the schema level (Zod validation), so no separate error handling code is needed. Zero is valid and produces no expansion (equivalent to omitting the param).

### Anti-Patterns to Avoid
- **Expanding in the tool handler:** Would duplicate the lines-splitting logic already present in extractMemberSource. Keep extraction self-contained.
- **Modifying existing field semantics:** Don't change what `startLine`/`endLine` mean on `MemberResult` -- extend with new fields instead.
- **Adding a totalLineCount field to MemberResult:** This wasn't part of the user's decisions and isn't needed (the agent can use read_source if it needs total file line count).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Line clamping | Custom boundary checking | `Math.max(0, ...)` / `Math.min(lines.length, ...)` | Two-line pattern, same as Phase 19's approach in sliceLines |
| Parameter validation | Custom validation logic | Zod `.int().min(0)` | Schema-level validation, consistent with all other tool params |

## Common Pitfalls

### Pitfall 1: Off-by-one in 1-based/0-based conversion
**What goes wrong:** Context lines are off by one, or member boundary metadata doesn't match actual source.
**Why it happens:** The codebase uses 1-based line numbers everywhere, but `Array.slice()` is 0-based. `extractMemberSource` already does this conversion -- extending it requires keeping the same convention.
**How to avoid:** The existing pattern is: `decorationStart` is 0-based index, `startLine` = `decorationStart + 1` (1-based). `sym.range.end.line` is 1-based. Follow this exactly when adding context expansion.
**Warning signs:** Test with memberStartLine/memberEndLine and verify they match the pre-expansion startLine/endLine values.

### Pitfall 2: Breaking backward compatibility with new fields
**What goes wrong:** Existing consumers see unexpected fields or changed field values.
**Why it happens:** Changing the meaning of `startLine`/`endLine` when context is not requested.
**How to avoid:** When linesBefore and linesAfter are both undefined/omitted, `startLine === memberStartLine` and `endLine === memberEndLine`. The `source` field content is identical. Only new fields are added.
**Warning signs:** Run existing `read-member.test.ts` tests -- they must pass without modification (except to verify new fields exist).

### Pitfall 3: Context expansion not accounting for Javadoc
**What goes wrong:** `linesBefore` expands from the declaration line, not from the Javadoc start, showing lines between Javadoc and the requested context start.
**Why it happens:** Forgetting that the member range already includes Javadoc (via `findDecorationsStart`).
**How to avoid:** `linesBefore` expands from `decorationStart` (the already-computed Javadoc start), not from `sym.range.start.line`.
**Warning signs:** A method with 3-line Javadoc requested with `linesBefore: 1` should show 1 line above the Javadoc, not 1 line above the method signature.

### Pitfall 4: Inconsistent handling when linesBefore=0 vs omitted
**What goes wrong:** `linesBefore: 0` and omitting `linesBefore` produce different results.
**Why it happens:** Treating `0` as falsy and falling into a different code path.
**How to avoid:** Use `linesBefore ?? 0` defaulting. Both `undefined` and `0` produce zero expansion.
**Warning signs:** Test explicitly with `linesBefore: 0` and verify it matches the omitted case.

## Code Examples

### Current extractMemberSource flow (from src/browsing/member-extractor.ts)
```typescript
// Current: lines 119-138
export function extractMemberSource(
	sourceText: string,
	enrichedSymbols: EnrichedSymbol[],
	targetFqn: string,
): MemberExtraction[] {
	const lines = sourceText.split('\n');
	const matches = collectMatchingSymbols(enrichedSymbols, targetFqn);

	return matches.map(sym => {
		const rangeStartIdx = sym.range.start.line - 1;
		const rangeEndIdx = sym.range.end.line;
		const decorationStart = findDecorationsStart(lines, rangeStartIdx);
		const source = lines.slice(decorationStart, rangeEndIdx).join('\n');

		return {
			source,
			startLine: decorationStart + 1,
			endLine: sym.range.end.line,
			lineCount: rangeEndIdx - decorationStart,
			memberFqn: (sym as EnrichedMethodSymbol | EnrichedFieldSymbol).memberFqn,
			kind: sym.kind,
		};
	});
}
```

### Target extractMemberSource flow (with context expansion)
```typescript
export function extractMemberSource(
	sourceText: string,
	enrichedSymbols: EnrichedSymbol[],
	targetFqn: string,
	linesBefore?: number,
	linesAfter?: number,
): MemberExtraction[] {
	const lines = sourceText.split('\n');
	const matches = collectMatchingSymbols(enrichedSymbols, targetFqn);
	const before = linesBefore ?? 0;
	const after = linesAfter ?? 0;

	return matches.map(sym => {
		const rangeStartIdx = sym.range.start.line - 1;
		const rangeEndIdx = sym.range.end.line;
		const decorationStart = findDecorationsStart(lines, rangeStartIdx);

		// Member boundaries (without context)
		const memberStartLine = decorationStart + 1;
		const memberEndLine = sym.range.end.line;

		// Expanded boundaries (with context, clamped)
		const contextStartIdx = Math.max(0, decorationStart - before);
		const contextEndIdx = Math.min(lines.length, rangeEndIdx + after);
		const source = lines.slice(contextStartIdx, contextEndIdx).join('\n');

		return {
			source,
			startLine: contextStartIdx + 1,
			endLine: contextEndIdx,
			lineCount: contextEndIdx - contextStartIdx,
			memberStartLine,
			memberEndLine,
			memberFqn: (sym as EnrichedMethodSymbol | EnrichedFieldSymbol).memberFqn,
			kind: sym.kind,
		};
	});
}
```

### Tool handler changes (read-member.ts)
```typescript
// Schema addition:
inputSchema: {
	project: PARAMS.project,
	jar: PARAMS.jar,
	memberFqn: z.string().describe('...'),
	linesBefore: PARAMS.linesBefore,
	linesAfter: PARAMS.linesAfter,
},

// Handler: pass params through to extractMemberSource
const extractions = extractMemberSource(sourceText, enriched, memberFqn, linesBefore, linesAfter);

// Result mapping: include new fields
const results: MemberResult[] = extractions.map(ext => ({
	jar: sourceJarId,
	category: dep.category,
	provenanceChains: dep.provenanceChains,
	memberFqn: ext.memberFqn,
	kind: ext.kind,
	source: ext.source,
	startLine: ext.startLine,
	endLine: ext.endLine,
	lineCount: ext.lineCount,
	memberStartLine: ext.memberStartLine,
	memberEndLine: ext.memberEndLine,
}));
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test -- --reporter=verbose tests/browsing/member-extractor.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-03a | linesBefore expands source upward from member start | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "linesBefore"` | Wave 0 |
| READ-03b | linesAfter expands source downward from member end | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "linesAfter"` | Wave 0 |
| READ-03c | Both linesBefore and linesAfter together | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "both"` | Wave 0 |
| READ-03d | Omitting both produces identical output to pre-v1.3 (backward compat) | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "backward"` | Wave 0 |
| READ-03e | Silent clamp at file boundaries | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "clamp"` | Wave 0 |
| READ-03f | memberStartLine/memberEndLine metadata correct | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "memberStartLine"` | Wave 0 |
| READ-03g | Overloads get independent context expansion | unit | `pnpm test -- tests/browsing/member-extractor.test.ts -t "overload"` | Wave 0 |
| READ-03h | Integration: read_member tool with linesBefore/linesAfter | integration | `pnpm test -- tests/tools/read-member.test.ts -t "context"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test -- tests/browsing/member-extractor.test.ts tests/tools/read-member.test.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `tests/browsing/member-extractor.test.ts` -- covers READ-03a through READ-03g
- [ ] New test cases in `tests/tools/read-member.test.ts` -- covers READ-03h (integration)
- [ ] No new test files needed -- extend existing test files

## Open Questions

1. **Whether to include `memberLineCount`**
   - What we know: User left this to Claude's discretion. The agent can compute it as `memberEndLine - memberStartLine + 1`.
   - Recommendation: Include it. The existing `MemberExtraction` already has `lineCount` -- adding `memberLineCount` costs nothing and keeps the interface self-documenting. Alternatively, keep the existing `lineCount` field as the member line count and rename nothing, since the expanded range line count is computable from `endLine - startLine + 1`.
   - **Preferred approach:** Do NOT add `memberLineCount`. The existing `lineCount` field already represents the member's line count. When context is requested, `lineCount` should continue to mean the total returned lines (consistent with its current meaning of `endLine - startLine + 1`). The agent can compute member line count from `memberEndLine - memberStartLine + 1`.

2. **Tool description update**
   - What we know: The `read_member` description in descriptions.ts needs to mention the new context parameters.
   - Recommendation: Append a sentence about linesBefore/linesAfter to the existing description. Keep it brief.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of `src/browsing/member-extractor.ts` (lines 115-138) -- current extraction logic
- Direct codebase analysis of `src/browsing/types.ts` (lines 98-108) -- current MemberResult interface
- Direct codebase analysis of `src/tools/read-member.ts` (lines 17-153) -- current tool handler
- Direct codebase analysis of `src/browsing/line-slicer.ts` -- Phase 19 pattern for line slicing with clamping
- Phase 19 CONTEXT.md -- established patterns for line-range behavior, clamping, metadata
- Phase 20 CONTEXT.md -- locked user decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all changes in existing files
- Architecture: HIGH - pattern directly mirrors Phase 19, code paths fully understood
- Pitfalls: HIGH - identified from direct code analysis, off-by-one risks well-documented

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- internal codebase patterns, no external dependencies)
