# Phase 9: Semantic Navigation - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Find definition and find references of symbols across all sources using cascading regex for position identification and JDT LS for semantic analysis. Two new MCP tools: `find_definition` and `find_references`. Cascading regex engine (Phase 8) provides positions; JDT LS resolves semantic relationships.

</domain>

<decisions>
## Implementation Decisions

### Tool call flow
- One-shot: `find_definition` and `find_references` accept cascading regex patterns directly (no two-step locate-then-navigate)
- Standardize cascading regex input format across all tools that use it (`locate_in_source`, `find_definition`, `find_references`) — same parameter shape for the pattern array, class, jar, project params
- User does NOT need to call `locate_in_source` first; the semantic tools handle position resolution internally

### Navigation result content
- Context-aware surrounding code, not fixed N-lines:
  - Reference inside a method body: include the full enclosing method
  - Reference in a method signature: include just the method signature
  - Reference in a class declaration: include just the class declaration
  - General rule: include the smallest enclosing semantic unit that makes the reference understandable
- Each result includes source provenance (jar ID, category, provenance chains) per established pattern
- Each result includes file path, position (line/column), and the context-aware source snippet

### JDT LS initialization
- Eager: initialize JDT LS when the project is loaded (not lazy on first semantic tool call)
- If JDT LS initialization fails (no Java 21, JDT LS binary missing, workspace setup error), make semantic tools unavailable for that project
- Semantic tools hard-error when JDT LS is not available — no regex-based fallback heuristics
- Failure reason should be clear: "JDT LS not available for project 'X': Java 21+ not found" or similar

### Claude's Discretion
- JDT LS workspace configuration (how to set up classpath from LoadedProject data)
- LSP client implementation (ts-lsp-client vs custom lightweight client)
- JDT LS process lifecycle details (one per project vs shared, shutdown timing)
- How to expose source jars to JDT LS (extract to temp dir vs configure jar reading)
- Exact error codes and DomainError structure for JDT LS failures
- How to determine the "enclosing semantic unit" for context snippets (AST parsing, regex heuristics, or LSP capabilities)

</decisions>

<specifics>
## Specific Ideas

- Cascading regex input should be identical across `locate_in_source`, `find_definition`, and `find_references` — same Zod schema shape, same parameter names, same behavior for the pattern array
- The enclosing-context approach for results should feel like what an IDE shows: if you're looking at a reference in a method, you see the method; if it's a field declaration, you see the field

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Cascading regex (input to semantic navigation)
- `src/browsing/cascading-regex.ts` — Pure domain module: `cascadeRegex()` returns offset/line/column from pattern array
- `src/tools/locate-in-source.ts` — Existing tool that orchestrates cascading regex across jars; pattern for the new tools to follow

### Project infrastructure
- `src/project/types.ts` — `LoadedProject`, `DependencyEntry`, `GradleConfig` types that JDT LS will need
- `src/state/project-store.ts` — Project resolution pattern (`resolveProject()`)
- `src/tools/shared-jar-reader.ts` — Shared JarReader singleton for cross-tool handle reuse

### Tool patterns
- `src/tools/index.ts` — Tool registration pattern
- `src/types/envelope.ts` — `makeSuccess`/`makeError` response envelope

### Technology
- CLAUDE.md "Java Language Server Integration" section — JDT LS, vscode-languageserver-protocol, ts-lsp-client recommendations

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cascadeRegex()`: Pure function returning offset/line/column — reuse directly in find_definition/find_references
- `createSourceAdapter()`: Reads entries from any jar type — reuse for feeding source to JDT LS
- `getFilteredDependencies()` + `sortByPriority()`: Jar filtering and ordering — reuse for multi-jar navigation
- FQN-to-entry-path conversion in `read-source.ts`: Reuse for resolving class paths
- `DomainError` pattern: Established error handling for tool failures

### Established Patterns
- All tools use `server.registerTool()` with Zod schemas and `makeSuccess`/`makeError` envelopes
- All tools that accept a project parameter use `projectStore.resolveProject(project)` with DomainError catch
- Multi-jar operations return `{ results[], failures[] }` split (see locate-in-source)
- Jar priority ordering: minecraft -> mod-source -> fabric-api -> library

### Integration Points
- `LoadedProject` needs to be extended or augmented with JDT LS state (client instance, availability flag)
- Project loading pipeline (`src/project/loader.ts`) needs JDT LS initialization step
- Project unloading needs JDT LS shutdown step
- Tool registration in `src/tools/index.ts` for the two new tools

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-semantic-navigation*
*Context gathered: 2026-04-13*
