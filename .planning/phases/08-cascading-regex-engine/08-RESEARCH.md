# Phase 8: Cascading Regex Engine - Research

**Researched:** 2026-04-13
**Domain:** Regex cascading / text position resolution / MCP tool patterns
**Confidence:** HIGH

## Summary

The cascading regex engine is a pure algorithmic module that takes source text plus an array of regex patterns, executes them sequentially (each narrowing within the previous match), and resolves to a precise character offset with line/column. No external libraries are needed -- JavaScript's built-in `RegExp` is sufficient.

The critical finding is that **JavaScript (Node 22 / V8 12.4) does NOT support inline flag syntax like `(?i)pattern`**. ES2025 introduced scoped modifiers `(?i:...)` but they are not yet available in Node 22 LTS. The CONTEXT.md mentions "inline flag syntax (e.g., `(?i)class minecraft`)" -- this must be implemented as a custom prefix convention parsed by the engine, not native regex syntax.

**Primary recommendation:** Implement a simple prefix convention (e.g., `(?flags)pattern` parsed by the engine into `new RegExp(pattern, flags)`) for per-pattern flag control. The domain module is pure (text in, results out), following the established `search.ts` pattern. The tool wrapper follows the `search-classes.ts` pattern exactly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Cascading regex is a **domain module** (like `search.ts`), not just tool-level code
- The domain function takes source text + pattern array, returns step results + final offset
- `locate_in_source` is the first MCP tool wrapping this engine; Phase 10's tools will reuse it
- Domain module has no I/O -- it operates on text strings
- Dedicated MCP tool: `locate_in_source`
- Same project/jar/class parameters as `read_source` for source targeting
- Additional required parameter: `patterns` -- array of regex strings
- Uses standard `resolveProject(name?)` for project resolution
- Uses standard response envelope with provenance
- Array of regex strings with support for inline flag syntax (e.g., `(?i)class minecraft`)
- No per-pattern object wrapper -- strings only, inline flags for per-pattern control
- Each pattern searches within the text matched by the previous pattern
- First pattern searches the entire source file contents
- When no specific jar is given, search ALL jars that contain the class (like `read_source`)
- Return results from every jar -- array of per-jar results, each with its own step trace and final offset
- Jar priority ordering for result sort: minecraft -> mod-source -> fabric-api -> library
- If cascade succeeds in some jars but fails in others: return successes in `results` array, failures in separate `failures` array
- Response shape as specified in CONTEXT.md (step trace with step/pattern/status/matched/offset/length, final offset/line/column)
- Error reporting: step number that failed, pattern used, trace of steps that succeeded before it

### Claude's Discretion
- Exact domain module API surface (function signature, type names)
- How to compute line/column from character offset efficiently
- Whether to compile regex patterns once or per-invocation
- Internal step trace data structure
- How to handle regex compilation errors (invalid pattern syntax)
- Performance considerations for very large source files or many patterns

### Deferred Ideas (OUT OF SCOPE)
- Method/field-level search with semicolon separator syntax (`FQN;memberName`) -- Phase 10
- Find-definition and find-references tools that consume cascading regex positions -- Phase 10
- Batch mode (multiple cascading regex queries in one call) -- not needed until proven slow
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CREG-01 | User can provide an array of regex patterns where each pattern searches within the text matched by the previous pattern | Core cascading algorithm; sequential `RegExp.exec()` with substring narrowing |
| CREG-02 | The cascading regex resolves to a precise character position (offset) in a source file | Offset tracking through cascading steps; line/column computation from final offset |
| CREG-03 | Cascading regex works across any source (jar or mod source) in any loaded project | Tool wrapper uses `createSourceAdapter()` + `readEntry()` -- same as `read_source` |
| CREG-04 | Error reporting is clear when a pattern in the chain fails to match (which step failed, what text was being searched) | Step trace format with success/failed status; previous step's matched text serves as context |
</phase_requirements>

## Standard Stack

### Core
No new dependencies required. This phase uses only existing project dependencies.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| JavaScript RegExp (built-in) | ES2022 | Pattern matching | Native, zero-dependency, sufficient for all cascading regex needs |
| Zod | 4.x (already installed) | Tool parameter validation | Project standard for MCP tool schemas |

### Supporting
All supporting libraries are already in the project -- no new installs needed.

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node-stream-zip | 1.15.x (installed) | Read source from jars | Tool wrapper reads source via SourceAdapter |
| picomatch | 4.x (installed) | N/A for this phase | Not needed -- regex, not glob |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Built-in RegExp | XRegExp library | Adds inline flag support natively, but 50KB+ dependency for a feature easily shimmed with a prefix convention |
| Custom flag prefix parsing | Upgrading to Node 23+ | ES2025 scoped modifiers would work, but project requires Node 22 LTS |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  browsing/
    cascading-regex.ts      # Pure domain module (no I/O)
  tools/
    locate-in-source.ts     # MCP tool wrapper
    index.ts                # Add registration
tests/
  browsing/
    cascading-regex.test.ts # Domain module tests
  tools/
    locate-in-source.test.ts # Tool integration tests
```

### Pattern 1: Pure Domain Module (established pattern)
**What:** Domain logic separated from I/O, following `search.ts` pattern
**When to use:** Always for this phase -- the engine takes text + patterns, returns results
**Example:**
```typescript
// src/browsing/cascading-regex.ts
export interface CascadeStep {
	step: number;
	pattern: string;
	status: 'success' | 'failed';
	matched?: string;
	offset?: number;
	length?: number;
}

export interface CascadeSuccess {
	success: true;
	steps: CascadeStep[];
	offset: number;
	line: number;
	column: number;
}

export interface CascadeFailure {
	success: false;
	steps: CascadeStep[];
	failedStep: number;
}

export type CascadeResult = CascadeSuccess | CascadeFailure;

export function cascadeRegex(source: string, patterns: string[]): CascadeResult {
	// Pure function -- no I/O, no jar reading
	// ...
}
```

### Pattern 2: Flag Prefix Convention for Inline Flags
**What:** Parse `(?flags)pattern` prefix from pattern strings into RegExp constructor flags
**When to use:** To honor the CONTEXT.md decision of "inline flag syntax (e.g., `(?i)class minecraft`)"
**Rationale:** JavaScript's `RegExp` does NOT support `(?i)` as an inline modifier (this is a PCRE/Java syntax). Node 22 does not support ES2025 scoped modifiers `(?i:...)` either. The engine must parse the prefix and extract flags.
**Example:**
```typescript
function parsePattern(pattern: string): { regex: RegExp; original: string } {
	// Match leading (?flags) prefix -- e.g., (?i), (?im), (?s)
	const prefixMatch = pattern.match(/^\(\?([ims]+)\)/);
	if (prefixMatch) {
		const flags = prefixMatch[1]
			.replace('s', 's')  // dotAll
			.replace('i', 'i')  // case insensitive
			.replace('m', 'm'); // multiline
		const body = pattern.slice(prefixMatch[0].length);
		return { regex: new RegExp(body, flags), original: pattern };
	}
	return { regex: new RegExp(pattern), original: pattern };
}
```

### Pattern 3: Tool Wrapper with Multi-Jar Search (established pattern)
**What:** Tool resolves project/jar, reads source, delegates to domain module
**When to use:** The `locate_in_source` tool follows `read_source` pattern for source retrieval, then calls `cascadeRegex()`
**Example:**
```typescript
// Tool handler structure (follows read_source.ts pattern)
// 1. resolveProject(project)
// 2. Convert FQN to entry path
// 3. If specific jar: read source, run cascade, return
// 4. If all jars: iterate sorted deps, run cascade on each, collect results/failures
// 5. Return { results: [...], failures: [...] } envelope
```

### Pattern 4: Line/Column from Character Offset
**What:** Compute 1-based line and column from a character offset in source text
**When to use:** Final step of cascade to produce line/column for CREG-02
**Example:**
```typescript
function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
	let line = 1;
	let lastNewline = -1;
	for (let i = 0; i < offset; i++) {
		if (source[i] === '\n') {
			line++;
			lastNewline = i;
		}
	}
	return { line, column: offset - lastNewline };
}
```

### Anti-Patterns to Avoid
- **Putting cascade logic in the tool handler:** Domain module must be pure and reusable by Phase 10
- **Using string.match() instead of RegExp.exec():** `exec()` gives index position; `match()` does not when used without the `d` flag
- **Searching the entire source for each step:** Each step must search within the previous match's text only, but track absolute offsets
- **Forgetting to handle the `s` (dotAll) flag:** Java source files are multiline; patterns like `class Foo \{[\s\S]*?\}` need dotAll or `[\s\S]` workaround

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regex execution | Custom regex engine | JavaScript `RegExp` | Battle-tested, handles Unicode, has index tracking via `exec()` |
| Source reading from jars | New jar reading code | `createSourceAdapter()` + `readEntry()` | Already built in Phase 6, handles both jar and filesystem sources |
| FQN-to-path conversion | New converter | Copy pattern from `read_source.ts` lines 67-75 | Exact same logic needed |
| Jar priority sorting | New sorter | Import/copy `CATEGORY_PRIORITY` from existing code | Already defined in `read_source.ts` and `search.ts` |

**Key insight:** This phase adds exactly one new algorithm (cascading regex). Everything else (source reading, project resolution, jar sorting, response envelope, tool registration) reuses established infrastructure verbatim.

## Common Pitfalls

### Pitfall 1: Inline Flag Syntax Not Supported in JavaScript
**What goes wrong:** User provides `(?i)class minecraft` and RegExp throws SyntaxError
**Why it happens:** JavaScript does not support PCRE-style inline flags. ES2025 scoped modifiers `(?i:...)` exist but are not in Node 22 LTS (V8 12.4).
**How to avoid:** Parse `(?flags)` prefix from pattern string before constructing RegExp. Map `i`->case-insensitive, `m`->multiline, `s`->dotAll. Strip the prefix, pass flags to `new RegExp(body, flags)`.
**Warning signs:** SyntaxError from `new RegExp()` mentioning "Invalid group"

### Pitfall 2: Offset Tracking Across Cascade Steps
**What goes wrong:** Final offset is relative to the last matched substring, not the original source
**Why it happens:** Each step operates on a substring of the previous match. If you just use `exec().index`, you get the offset within the substring.
**How to avoid:** Track a cumulative `baseOffset` that adds the start position of each step's match within the source. Final offset = step1.offset + step2.offsetWithinStep1 + step3.offsetWithinStep2...
**Warning signs:** Line/column numbers that don't match the actual source position

### Pitfall 3: RegExp Stateful `lastIndex` with `g` Flag
**What goes wrong:** If patterns use the `g` flag, `RegExp.exec()` maintains state via `lastIndex`, causing unexpected behavior on repeated calls
**Why it happens:** JavaScript RegExp with `g` flag is stateful
**How to avoid:** Do NOT add the `g` flag by default. Each step creates a fresh RegExp or uses a pattern without `g`. If the user explicitly includes `g` in their flags, it should still work because each step gets a fresh regex from the pattern string.
**Warning signs:** Patterns that work on first call but fail on subsequent calls

### Pitfall 4: Invalid Regex Patterns from User Input
**What goes wrong:** User provides malformed regex, `new RegExp()` throws SyntaxError
**Why it happens:** Patterns come from MCP tool input -- they are user-provided strings
**How to avoid:** Wrap `new RegExp()` construction in try/catch. Return a clear error identifying which pattern (by step number) has invalid syntax, and include the error message from the SyntaxError.
**Warning signs:** Uncaught SyntaxError crashing the tool handler

### Pitfall 5: Empty Matches Causing Infinite Narrowing
**What goes wrong:** A pattern like `.*` matches an empty string, next step searches empty string
**Why it happens:** `.*` and similar patterns can match zero-length strings
**How to avoid:** After a match, if `matched.length === 0`, the cascade can still proceed (the offset is valid). But the next step will search an empty string and likely fail. This is correct behavior -- just ensure the step trace accurately reflects what happened.
**Warning signs:** Steps succeeding with empty matched text followed by immediate failure

## Code Examples

Verified patterns from the existing codebase:

### FQN to Entry Path Conversion (from read_source.ts)
```typescript
// Source: src/tools/read-source.ts lines 67-75
const lastDot = className.lastIndexOf('.');
let entryPath: string;
if (lastDot === -1) {
	entryPath = `${className}.java`;
} else {
	const packagePath = className.substring(0, lastDot).replaceAll('.', '/');
	const simpleNameWithInner = className.substring(lastDot + 1);
	entryPath = `${packagePath}/${simpleNameWithInner}.java`;
}
```

### DomainError Catch Pattern (from search-classes.ts)
```typescript
// Source: src/tools/search-classes.ts lines 30-38
let loadedProject;
try {
	loadedProject = projectStore.resolveProject(project);
} catch (error) {
	if (error instanceof Error && 'code' in error) {
		const de = error as any;
		const envelope = makeError(de.code, de.message, de.tried ?? [], de.suggestions);
		return {
			content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
			structuredContent: envelope,
		};
	}
	throw error;
}
```

### Tool Registration Pattern (from search-classes.ts)
```typescript
// Source: src/tools/search-classes.ts
export function registerLocateInSourceTool(server: McpServer): void {
	server.registerTool(
		'locate_in_source',
		{
			title: 'Locate in Source',
			description: '...',
			inputSchema: {
				project: z.string().optional().describe('...'),
				jar: z.string().optional().describe('...'),
				class: z.string().describe('...'),
				patterns: z.array(z.string()).describe('Array of regex patterns...'),
			},
		},
		async ({ project, jar, class: className, patterns }) => {
			// ... handler
		},
	);
}
```

### Response Envelope Pattern (from read_source.ts)
```typescript
// Source: src/tools/read-source.ts
const envelope = makeSuccess({ results, failures }, {
	provenance: {
		tool: 'locate_in_source',
		project: loadedProject.name,
		class: className,
	},
});

return {
	content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
	structuredContent: envelope,
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PCRE-style `(?i)` inline flags | ES2025 scoped `(?i:...)` modifiers | ES2025 spec (June 2025) | NOT available in Node 22 LTS; requires custom prefix parsing |
| RegExp without `d` flag | RegExp `d` flag for match indices | ES2022 | Available in Node 22; provides `exec().indices` for start/end positions |

**Deprecated/outdated:**
- `(?i)` global inline flags: Never existed in JavaScript. PCRE/Java syntax only. Must be shimmed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | vitest.config.ts |
| Quick run command | `pnpm vitest run tests/browsing/cascading-regex.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CREG-01 | Array of patterns, each narrows within previous match | unit | `pnpm vitest run tests/browsing/cascading-regex.test.ts -t "cascading"` | Wave 0 |
| CREG-02 | Resolves to precise character offset with line/column | unit | `pnpm vitest run tests/browsing/cascading-regex.test.ts -t "offset"` | Wave 0 |
| CREG-03 | Works on any source (jar + filesystem) | unit | `pnpm vitest run tests/tools/locate-in-source.test.ts` | Wave 0 |
| CREG-04 | Clear error reporting on pattern failure | unit | `pnpm vitest run tests/browsing/cascading-regex.test.ts -t "fail"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tests/browsing/cascading-regex.test.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/browsing/cascading-regex.test.ts` -- covers CREG-01, CREG-02, CREG-04 (domain module unit tests)
- [ ] `tests/tools/locate-in-source.test.ts` -- covers CREG-03 (tool wrapper with mock jar/fs adapters)

## Open Questions

1. **Line/column numbering: 0-based or 1-based?**
   - What we know: CONTEXT.md example shows `"line": 142, "column": 12` which looks 1-based. Most editors and LSP use 0-based lines, 1-based columns, or 0-based both.
   - What's unclear: The exact convention isn't specified.
   - Recommendation: Use 1-based for both line and column (human-readable, matches what users see in editors). Document the convention in the tool description. Phase 10 can convert to 0-based for LSP if needed.

2. **Maximum pattern array length?**
   - What we know: No limit specified in CONTEXT.md.
   - What's unclear: Whether to cap at some reasonable limit to prevent abuse.
   - Recommendation: No hard limit. If the array is empty, return an error. Patterns are cheap to execute.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/browsing/search.ts`, `src/tools/read-source.ts`, `src/tools/search-classes.ts` -- established patterns
- Node.js 22 runtime testing: Verified `(?i)` inline flags throw SyntaxError, `d` flag for indices works
- MDN RegExp documentation -- JavaScript RegExp behavior and available flags

### Secondary (MEDIUM confidence)
- [ES2025 regex modifiers](https://2ality.com/2025/01/regexp-modifiers.html) -- `(?i:...)` scoped modifiers spec'd but not in Node 22 V8 12.4

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; pure JavaScript RegExp + existing project infrastructure
- Architecture: HIGH - Follows established domain module + tool wrapper pattern exactly
- Pitfalls: HIGH - Verified JavaScript RegExp behavior directly in Node 22 runtime

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- no moving dependencies)
