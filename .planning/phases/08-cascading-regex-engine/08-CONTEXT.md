# Phase 8: Cascading Regex Engine - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can provide an array of regex patterns that progressively narrow within matched text to resolve a precise character position in any source file. The cascading regex engine is a reusable domain module; this phase exposes it via a `locate_in_source` MCP tool. Phase 10 (Semantic Navigation) will reuse the same engine for find-definition and find-references.

</domain>

<decisions>
## Implementation Decisions

### Architecture
- Cascading regex is a **domain module** (like `search.ts`), not just tool-level code
- The domain function takes source text + pattern array, returns step results + final offset
- `locate_in_source` is the first MCP tool wrapping this engine; Phase 10's tools will reuse it
- This separation means the domain module has no I/O — it operates on text strings

### Tool design
- Dedicated MCP tool: `locate_in_source`
- Same project/jar/class parameters as `read_source` for source targeting
- Additional required parameter: `patterns` — array of regex strings
- Uses standard `resolveProject(name?)` for project resolution
- Uses standard response envelope with provenance

### Pattern format
- Array of regex strings with support for inline flag syntax (e.g., `(?i)class minecraft`)
- No per-pattern object wrapper — strings only, inline flags for per-pattern control
- Each pattern searches within the text matched by the previous pattern
- First pattern searches the entire source file contents

### Multi-jar behavior
- When no specific jar is given, search ALL jars that contain the class (like `read_source`)
- Return results from every jar — array of per-jar results, each with its own step trace and final offset
- Jar priority ordering for result sort: minecraft -> mod-source -> fabric-api -> library
- If cascade succeeds in some jars but fails in others: return successes in `results` array, failures in separate `failures` array

### Response shape (success)
- Array of results, one per jar where the class was found and cascade succeeded
- Each result includes: jar ID, category, provenance, final character offset, line/column, and **full step trace**
- Step trace: array of step results, each with step number, pattern used, matched text, and character range (start offset + length within source)
- Full trace lets Claude verify the cascade landed correctly and debug complex patterns

### Response shape (failure / partial)
- Step trace format is the same for both success and failure
- Each step shows: step number, pattern, matched text (if succeeded), status (success/failed)
- On failure: trace shows all succeeded steps, then the step that failed with its pattern
- The previous step's matched text IS the error context — no separate "searched text" blob needed
- For multi-jar failures: full step trace included for failed jars too (same format as success trace, ending with the failed step)

### Error reporting (CREG-04)
- When a pattern fails to match: report which step number failed, which pattern was used, and the trace of steps that succeeded before it
- Claude can look at the last successful step's matched text to understand why the next pattern didn't hit
- Standard DomainError for class-not-found, jar-not-found errors (same as read_source)

### Claude's Discretion
- Exact domain module API surface (function signature, type names)
- How to compute line/column from character offset efficiently
- Whether to compile regex patterns once or per-invocation
- Internal step trace data structure
- How to handle regex compilation errors (invalid pattern syntax)
- Performance considerations for very large source files or many patterns

</decisions>

<specifics>
## Specific Ideas

- The domain module should be pure — takes text + patterns, returns results. No I/O, no jar reading. This makes it trivially testable and reusable by Phase 10.
- Step trace example for a successful 3-step cascade:
  ```json
  {
    "steps": [
      { "step": 1, "pattern": "class MinecraftClient \\{[\\s\\S]*?\\}", "status": "success", "matched": "class MinecraftClient {\n  ...", "offset": 1247, "length": 8934 },
      { "step": 2, "pattern": "public void tick\\(\\)", "status": "success", "matched": "public void tick()", "offset": 3891, "length": 18 },
      { "step": 3, "pattern": "this\\.world", "status": "success", "matched": "this.world", "offset": 4102, "length": 10 }
    ],
    "offset": 4102,
    "line": 142,
    "column": 12
  }
  ```
- Step trace for a failure at step 3:
  ```json
  {
    "steps": [
      { "step": 1, "pattern": "class MinecraftClient \\{[\\s\\S]*?\\}", "status": "success", "matched": "class MinecraftClient {\n  ...", "offset": 1247, "length": 8934 },
      { "step": 2, "pattern": "public void tick\\(\\)", "status": "success", "matched": "public void tick()", "offset": 3891, "length": 18 },
      { "step": 3, "pattern": "this\\.nonexistent", "status": "failed" }
    ]
  }
  ```

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` -- CREG-01 (cascading pattern array), CREG-02 (precise character offset), CREG-03 (works on any source), CREG-04 (clear error reporting on pattern failure)

### Existing code -- source reading infrastructure
- `src/browsing/source-adapter.ts` -- `SourceAdapter` interface, `createSourceAdapter()` factory for jar/filesystem unified access
- `src/tools/read-source.ts` -- Reference for FQN-to-entry-path conversion, multi-jar search with priority sorting, `CATEGORY_PRIORITY`, `getFilteredDependencies()` usage
- `src/project/jar-reader.ts` -- `JarReader` with `readEntry()` for reading source from jars
- `src/tools/shared-jar-reader.ts` -- Global JarReader singleton

### Existing code -- tool patterns
- `src/state/project-store.ts` -- `resolveProject(name?)` for project resolution
- `src/types/envelope.ts` -- `makeSuccess`/`makeError` response envelope builders
- `src/errors/domain-error.ts` -- DomainError with tried paths and suggestions
- `src/tools/index.ts` -- Tool registration point

### Existing code -- domain module pattern
- `src/browsing/search.ts` -- Reference for domain module structure (pure function, no I/O in core logic, tool wrapper handles project/jar resolution)
- `src/browsing/entry-index.ts` -- Reference for domain module with types and core logic

### Prior phase decisions
- `.planning/phases/06-source-browsing/06-CONTEXT.md` -- read_source tool design, FQN dot notation, multi-jar result shape
- `.planning/phases/07-search/07-CONTEXT.md` -- Domain module pattern (search.ts), tool wrapping pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `read_source` tool: FQN-to-entry-path conversion logic, multi-jar search loop with priority sorting — `locate_in_source` tool will follow the same pattern for source retrieval
- `createSourceAdapter()`: Unified jar/filesystem source reading — engine gets source text through this
- `CATEGORY_PRIORITY`: Jar priority ordering for result sorting — reuse directly
- `getFilteredDependencies()`: Apply project-level include/exclude filters before searching
- `makeSuccess`/`makeError`: Standard response envelope

### Established Patterns
- Domain module + tool wrapper: `search.ts` (pure logic) + `search-classes.ts` (MCP tool) — follow same split
- Tool registration: Zod schema + handler + `register*Tool(server)` export
- Response: dual `content` (text JSON) + `structuredContent`
- DomainError catch pattern for resolveProject/jar errors

### Integration Points
- `src/tools/index.ts` -- Register `locate_in_source` tool
- New domain module: `src/browsing/cascading-regex.ts` (or similar) -- pure function, no I/O
- Tool wrapper: `src/tools/locate-in-source.ts` -- handles project/jar resolution, calls domain module
- Phase 10 will import the domain module directly for find-definition/find-references tools

</code_context>

<deferred>
## Deferred Ideas

- Method/field-level search with semicolon separator syntax (`FQN;memberName`) -- captured in Phase 7 context, needs language server (Phase 10)
- Find-definition and find-references tools that consume cascading regex positions -- Phase 10
- Batch mode (multiple cascading regex queries in one call) -- not needed until proven slow

</deferred>

---

*Phase: 08-cascading-regex-engine*
*Context gathered: 2026-04-13*
