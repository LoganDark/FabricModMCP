# Phase 18: Member Inspection & Context Lines - Research

**Researched:** 2026-04-14
**Domain:** Java source extraction, MCP tool implementation, text line manipulation
**Confidence:** HIGH

## Summary

This phase adds two capabilities: (1) a new `read_member` tool that reads individual method/field source by FQN, and (2) an optional context lines parameter to `locate_in_source` that extends matches to whole line boundaries with surrounding lines. Both features are well-constrained extensions of existing infrastructure.

The `read_member` tool follows the established pattern of `read_source` but extracts a specific member rather than the full class. The key technical challenge is finding member boundaries in source text -- the codebase already has two mechanisms: LSP `documentSymbol` ranges (used by `list_members`) and regex-based scanning (`context-extractor.ts`). The LSP approach is more reliable because JDT LS provides precise line ranges for every member. The context lines feature for `locate_in_source` is straightforward text manipulation on top of the existing cascadeRegex offset/line/column result.

**Primary recommendation:** Use LSP `documentSymbol` ranges as the primary mechanism for finding member boundaries in `read_member`, with upward scanning for leading Javadoc/annotations. The `locate_in_source` context parameter is pure string manipulation -- no LSP needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **read_member input:** Single `memberFqn` string parameter (full FQN like `net.minecraft.client.MinecraftClient#tick()`), standard `project` param, optional `jar` param
- **Overload handling:** Return all overloads when multiple methods share the same FQN; each overload is a separate result entry; no disambiguation parameter
- **Output scope:** Methods/constructors include Javadoc + annotations + signature + body; fields include Javadoc + annotations + declaration line; always include full declaration with all leading decorations
- **locate_in_source context parameter:** Optional `context?: { linesBefore: number, linesAfter: number }`; null/omitted = no change; non-null (even `{0, 0}`) extends to whole line boundaries
- **locate_in_source context result shape:** Existing fields unchanged; new nested `context` object with `text`, `startLine`, `endLine`; absent when parameter is null/omitted

### Claude's Discretion
- How to extract method/field boundaries from source (LSP range data, regex, context-extractor, or combination)
- How to detect leading Javadoc and annotations (scan upward from declaration line)
- Error handling for malformed FQNs or members not found
- Test fixture design

### Deferred Ideas (OUT OF SCOPE)
- FQN-based tool input for find_references, find_definition, etc. (deferred to v1.3)
- Parameter types in FQN for overload disambiguation (decided against)
</user_constraints>

## Standard Stack

### Core
No new dependencies needed. This phase uses only existing libraries and infrastructure.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.29.x | MCP tool registration | Already in project, all tools use it |
| Zod | 4.x | Parameter validation | Already in project for all tool schemas |
| ts-lsp-client | 2.x | LSP documentSymbol requests | Already used by list_members |

### Supporting
No new supporting libraries needed.

## Architecture Patterns

### Recommended Project Structure (new/modified files)
```
src/
  tools/
    read-member.ts           # NEW: read_member tool registration
    locate-in-source.ts      # MODIFIED: add context parameter
  browsing/
    member-extractor.ts      # NEW: extract member source text from class source
    types.ts                 # MODIFIED: add LocateResultContext type
  tools/
    descriptions.ts          # MODIFIED: add read_member description, update locate_in_source description
    index.ts                 # MODIFIED: register read_member tool
tests/
  tools/
    read-member.test.ts      # NEW
    locate-in-source.test.ts # MODIFIED: add context parameter tests
  browsing/
    member-extractor.test.ts # NEW
```

### Pattern 1: FQN Parsing for read_member
**What:** Parse the memberFqn input string to extract class name and member identifier.
**When to use:** At the start of every read_member invocation.
**Example:**
```typescript
// FQN format: "net.minecraft.client.MinecraftClient#tick()"
// Split on '#' -> class = "net.minecraft.client.MinecraftClient", member = "tick()"
// Field FQN: "net.minecraft.client.MinecraftClient#instance:" -> member = "instance:"
// Constructor: "net.minecraft.client.MinecraftClient#MinecraftClient()" -> member = "MinecraftClient()"

interface ParsedFqn {
  className: string;     // "net.minecraft.client.MinecraftClient"
  memberName: string;    // "tick" (stripped of () or :)
  isMethod: boolean;     // true if FQN ends with ()
  isField: boolean;      // true if FQN ends with :
}

function parseMemberFqn(fqn: string): ParsedFqn | null {
  const hashIdx = fqn.indexOf('#');
  if (hashIdx === -1) return null;
  const className = fqn.substring(0, hashIdx);
  const member = fqn.substring(hashIdx + 1);
  if (member.endsWith('()')) {
    return { className, memberName: member.slice(0, -2), isMethod: true, isField: false };
  }
  if (member.endsWith(':')) {
    return { className, memberName: member.slice(0, -1), isMethod: false, isField: true };
  }
  return null; // malformed
}
```

### Pattern 2: LSP-Based Member Boundary Detection
**What:** Use LSP `documentSymbol` to get precise member ranges, then extend upward for Javadoc/annotations.
**When to use:** In `read_member` after resolving class source.
**Why LSP over regex:** The codebase already does this in `list_members` -- the `TransformedSymbol.range` field contains the exact start/end lines for each member as reported by JDT LS. This is far more reliable than regex for complex Java syntax (generics, annotations, lambda bodies, etc.).

**Algorithm:**
1. Parse FQN to get class name + member identifier
2. Resolve class source via `resolveClassSource()`
3. Request `documentSymbol` from JDT LS (same as `list_members`)
4. Run through `enrichSymbols()` to get `memberFqn` on each symbol
5. Filter symbols where `memberFqn` matches the input FQN
6. For each matching symbol, extract source lines using `range.start.line` to `range.end.line`
7. Scan upward from `range.start.line` for Javadoc (`/** ... */`) and annotations (`@...`)
8. Return the extracted text for each match

### Pattern 3: Upward Scanning for Javadoc and Annotations
**What:** From a known declaration start line, scan backward to include leading Javadoc and annotations.
**When to use:** After getting the LSP range for a member.
**Critical detail:** JDT LS `documentSymbol` `range` already includes annotations but typically does NOT include the Javadoc comment. The `selectionRange` is just the name. So we need to scan upward from `range.start.line` for Javadoc only.

```typescript
function findDecorationsStart(lines: string[], rangeStartIdx: number): number {
  // range already includes annotations per JDT LS behavior
  // Scan upward for Javadoc block comment
  let idx = rangeStartIdx - 1; // 0-based, line before range start
  
  // Skip blank lines
  while (idx >= 0 && lines[idx].trim() === '') idx--;
  
  // Check if we're at a Javadoc closing */
  if (idx >= 0 && lines[idx].trim().endsWith('*/')) {
    // Scan upward to find opening /**
    while (idx >= 0) {
      if (lines[idx].trimStart().startsWith('/**')) {
        return idx;
      }
      idx--;
    }
  }
  
  return rangeStartIdx; // no Javadoc found
}
```

### Pattern 4: Context Line Extraction for locate_in_source
**What:** Given a character offset and source text, extend to whole line boundaries and add surrounding lines.
**When to use:** In locate_in_source when context parameter is provided.

```typescript
interface LocateResultContext {
  text: string;        // the extracted lines
  startLine: number;   // 1-based
  endLine: number;     // 1-based
}

function extractContext(
  source: string,
  line: number,       // 1-based line of the match
  linesBefore: number,
  linesAfter: number,
): LocateResultContext {
  const lines = source.split('\n');
  const totalLines = lines.length;
  const startLine = Math.max(1, line - linesBefore);
  const endLine = Math.min(totalLines, line + linesAfter);
  const text = lines.slice(startLine - 1, endLine).join('\n');
  return { text, startLine, endLine };
}
```

### Pattern 5: read_member Output Structure
**What:** Multiple result entries (one per overload or per jar match), following the same pattern as `read_source`.
**Structure:**
```typescript
interface MemberResult {
  jar: string;
  category: JarCategory;
  provenanceChains: string[][];
  memberFqn: string;
  kind: string;           // "method" | "constructor" | "field" | "constant" | "enumMember"
  source: string;         // extracted source text (Javadoc + annotations + declaration + body)
  startLine: number;      // 1-based in original file
  endLine: number;        // 1-based in original file
  lineCount: number;
}
```

### Anti-Patterns to Avoid
- **Regex-only member extraction:** The `context-extractor.ts` regex approach works for context snippets but is fragile for precise extraction (misses edge cases with nested braces in lambdas, multi-line generics, etc.). Use LSP ranges as the source of truth.
- **Re-implementing enrichment logic:** Don't duplicate the FQN matching -- reuse `enrichSymbols()` and `buildMemberFqn()` from Phase 17.
- **Modifying cascadeRegex internals:** The context parameter for `locate_in_source` should be handled at the tool level, not inside `cascading-regex.ts`. Keep the domain module pure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Member boundary detection | Custom regex parser for Java methods/fields | LSP `documentSymbol` ranges via JDT LS | JDT LS handles all Java syntax edge cases (generics, lambdas, annotations, nested classes) |
| FQN matching | String comparison against raw symbol names | `enrichSymbols()` pipeline from Phase 17 | Already handles inner classes ($), constructors, method/field disambiguation |
| Class source resolution | Custom jar reading logic | `resolveClassSource()` from tool-helpers | Handles jar lookup, priority, multi-jar, error cases |
| LSP document lifecycle | Manual didOpen/didClose | `withLspDocument()` from tool-helpers | Ensures cleanup in finally block |

## Common Pitfalls

### Pitfall 1: JDT LS Range vs Javadoc Inclusion
**What goes wrong:** JDT LS `documentSymbol` `range` field includes annotations and the declaration but may or may not include the preceding Javadoc comment depending on the JDT LS version/configuration.
**Why it happens:** The LSP spec defines `range` as the "range enclosing this symbol" which is implementation-defined.
**How to avoid:** Always scan upward from `range.start.line` for Javadoc (`/** ... */`) blocks. If the range already includes Javadoc, the upward scan will find nothing and return the original range start -- safe either way.
**Warning signs:** Missing Javadoc in output for methods that clearly have it in source.

### Pitfall 2: Inner Class Member FQNs Use $ Separator
**What goes wrong:** A FQN like `MinecraftClient$Options#fullscreen:` requires splitting the class name on `$` to resolve the outer class source file.
**Why it happens:** Inner classes share the same source file as their outer class but have `$` in their FQN.
**How to avoid:** When parsing the FQN's class portion, use the part before any `$` for `classNameToEntryPath()`, then match the member within the inner class's symbol children.
**Warning signs:** "class not found" errors when the FQN contains `$`.

### Pitfall 3: 0-Based vs 1-Based Line Numbers
**What goes wrong:** JDT LS returns 0-based line numbers; the codebase converts to 1-based in `transformSymbol()`. Mixing conventions causes off-by-one errors.
**Why it happens:** LSP spec uses 0-based; the project convention is 1-based throughout the public API.
**How to avoid:** The `list_members` pipeline already converts to 1-based. When extracting from `TransformedSymbol.range`, values are already 1-based. When slicing arrays, convert: `lines.slice(startLine - 1, endLine)`.
**Warning signs:** Wrong line numbers, off-by-one in extracted source.

### Pitfall 4: Overloaded Methods Return Multiple Results
**What goes wrong:** Methods with different parameter lists share the same FQN (e.g., `tick()` appearing twice with different signatures).
**Why it happens:** The FQN scheme deliberately omits parameter types for simplicity.
**How to avoid:** Collect ALL matching symbols, not just the first. Return each as a separate result entry. This is the locked decision from CONTEXT.md.
**Warning signs:** Only one overload returned when source clearly has multiple.

### Pitfall 5: Context Lines Must Handle Edge Cases
**What goes wrong:** `linesBefore: 10` on line 3 should not go below line 1; `linesAfter: 10` near end of file should not exceed total lines.
**Why it happens:** Simple arithmetic without clamping.
**How to avoid:** `Math.max(1, line - linesBefore)` and `Math.min(totalLines, line + linesAfter)`.
**Warning signs:** Array index out of bounds, undefined lines in output.

## Code Examples

### read_member Tool Registration (following read_source pattern)
```typescript
// Source: existing read_source.ts pattern + CONTEXT.md decisions
import { z } from 'zod';

server.registerTool(
  'read_member',
  {
    title: 'Read Member',
    description: TOOL_DESCRIPTIONS.read_member,
    inputSchema: {
      project: PARAMS.project,
      jar: PARAMS.jar,
      memberFqn: z.string().describe('Member FQN (e.g., net.minecraft.client.MinecraftClient#tick())'),
    },
  },
  async ({ project, jar, memberFqn }) => {
    // 1. Parse FQN
    // 2. Resolve class source
    // 3. LSP documentSymbol + enrichSymbols
    // 4. Match memberFqn, extract source with decorations
    // 5. Return results array
  },
);
```

### locate_in_source Context Addition
```typescript
// Source: existing locate_in_source.ts + CONTEXT.md decisions
// Add to inputSchema:
context: z.object({
  linesBefore: z.number().int().min(0),
  linesAfter: z.number().int().min(0),
}).optional().describe('Add surrounding context lines. When present, extends match to whole line boundaries.'),

// After cascadeRegex succeeds, if context param is provided:
if (context !== undefined) {
  const lines = source.split('\n');
  const startLine = Math.max(1, result.line - context.linesBefore);
  const endLine = Math.min(lines.length, result.line + context.linesAfter);
  locateResult.context = {
    text: lines.slice(startLine - 1, endLine).join('\n'),
    startLine,
    endLine,
  };
}
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/browsing/member-extractor.test.ts tests/tools/read-member.test.ts tests/tools/locate-in-source.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P18-01 | Parse memberFqn string into class + member parts | unit | `npx vitest run tests/browsing/member-extractor.test.ts -t "parse"` | No - Wave 0 |
| P18-02 | Extract method source with Javadoc + annotations + body | unit | `npx vitest run tests/browsing/member-extractor.test.ts -t "method"` | No - Wave 0 |
| P18-03 | Extract field source with Javadoc + annotations + declaration | unit | `npx vitest run tests/browsing/member-extractor.test.ts -t "field"` | No - Wave 0 |
| P18-04 | Return all overloads for methods sharing same FQN | unit | `npx vitest run tests/browsing/member-extractor.test.ts -t "overload"` | No - Wave 0 |
| P18-05 | Inner class member FQN with $ separator resolves correctly | unit | `npx vitest run tests/browsing/member-extractor.test.ts -t "inner"` | No - Wave 0 |
| P18-06 | read_member tool returns error for malformed FQN | unit | `npx vitest run tests/tools/read-member.test.ts -t "malformed"` | No - Wave 0 |
| P18-07 | locate_in_source context extends to whole line boundaries | unit | `npx vitest run tests/tools/locate-in-source.test.ts -t "context"` | No - Wave 0 |
| P18-08 | locate_in_source context absent when parameter omitted | unit | `npx vitest run tests/tools/locate-in-source.test.ts -t "no context"` | No - Wave 0 |
| P18-09 | locate_in_source context clamps at file boundaries | unit | `npx vitest run tests/tools/locate-in-source.test.ts -t "clamp"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/browsing/member-extractor.test.ts tests/tools/read-member.test.ts tests/tools/locate-in-source.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/browsing/member-extractor.test.ts` -- covers P18-01 through P18-05 (FQN parsing, member extraction)
- [ ] `tests/tools/read-member.test.ts` -- covers P18-06 (tool-level error handling)
- [ ] `tests/tools/locate-in-source.test.ts` -- needs new test cases for P18-07 through P18-09 (file already exists)

## Open Questions

1. **JDT LS documentSymbol range and Javadoc**
   - What we know: JDT LS returns `range` for each symbol. The `list_members` pipeline already uses these ranges (converted to 1-based).
   - What's unclear: Whether JDT LS `range` consistently includes or excludes Javadoc comments across versions. Eclipse JDT.LS documentation is sparse on this detail.
   - Recommendation: Implement defensive upward scanning for Javadoc from `range.start.line` regardless. This is safe whether the range includes Javadoc or not -- if it's already included, the scan finds nothing extra.

2. **read_member without JDT LS**
   - What we know: `list_members` requires JDT LS. If JDT LS is unavailable, it returns an error.
   - What's unclear: Should `read_member` have a regex-based fallback when JDT LS is unavailable?
   - Recommendation: No fallback. Like `list_members`, return a `JDTLS_NOT_AVAILABLE` error. This keeps the implementation simple and the tool reliable. Users can fall back to `read_source` to get the full file.

## Sources

### Primary (HIGH confidence)
- Project source code: `src/tools/list-members.ts` -- LSP documentSymbol integration pattern
- Project source code: `src/browsing/member-fqn.ts` -- FQN format (`Class#method()`, `Class#field:`)
- Project source code: `src/browsing/member-enrichment.ts` -- enrichSymbols() pipeline
- Project source code: `src/tools/locate-in-source.ts` -- current tool structure to modify
- Project source code: `src/jdtls/context-extractor.ts` -- regex-based boundary detection (reference, not primary approach)
- Project source code: `src/tools/tool-helpers.ts` -- resolveClassSource(), withLspDocument()
- Project source code: `src/browsing/types.ts` -- TransformedSymbol with range field (1-based after transform)

### Secondary (MEDIUM confidence)
- LSP spec: documentSymbol `range` field semantics -- implementation-defined inclusion of decorations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns established in codebase
- Architecture: HIGH -- direct extension of existing tools using established patterns
- Pitfalls: HIGH -- identified from reading actual codebase code, not theoretical

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable -- internal codebase patterns, no external dependency changes)
