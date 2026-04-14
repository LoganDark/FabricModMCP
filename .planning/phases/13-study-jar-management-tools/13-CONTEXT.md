# Phase 13: Study Jar Management Tools - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Four new MCP tools for managing study jars on loaded projects: add, remove, list, and configure. Users can add source jars by path, remove them by name, list all study jars with status, and toggle auto-include behavior. Requirements: STUDY-01, STUDY-02, STUDY-03, STUDY-04.

</domain>

<decisions>
## Implementation Decisions

### Tool granularity
- Four separate tools: `add_study_jar`, `remove_study_jar`, `list_study_jars`, `configure_study_jar`
- Each tool has a single responsibility — no combined management tool with mode switching
- Follows the existing pattern of one registration function per tool file

### Add tool response
- Text content: human-readable confirmation message
- Structured content: rich detail including jar name, resolved path, auto-include status, and stats (package count, class count, total entries)
- Consistent with the dual text+structured envelope pattern used across all existing tools

### Batch operations
- `remove_study_jar` accepts multiple names in a single call
- `configure_study_jar` accepts multiple names in a single call
- `add_study_jar` is single-jar (each add needs its own path and optional name)

### Error on missing jar
- `remove_study_jar` and `configure_study_jar` produce a hard error when given a name that doesn't exist
- No silent no-ops, no warnings — fail clearly so the caller knows the operation didn't happen
- When batch: fail on the first nonexistent name (no partial application)

### Claude's Discretion
- Exact parameter names and Zod schemas
- Tool description text for `TOOL_DESCRIPTIONS`
- Whether `configure_study_jar` only handles auto-include or is designed for future config fields
- Error message wording and DomainError codes

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Study jar domain service
- `src/project/study-jar.ts` — `createStudyJar()`, `validateStudyJarName()`, `deriveStudyJarName()`, `checkAndReopenIfStale()`, `studyJarToDependencyEntry()` — all domain logic for study jar lifecycle
- `src/project/types.ts` — `StudyJar`, `StudyJarStats`, `LoadedProject.studyJars` map definition

### Jar handle management
- `src/project/jar-reader.ts` — `addProjectJar()`, `removeProjectJar()` — ref-counted jar handle registration
- `src/tools/shared-jar-reader.ts` — singleton `jarReader` instance used by tools

### Entry index cache
- `src/browsing/entry-index-cache.ts` — `evictEntryIndex()` — must be called when removing a study jar

### Tool registration patterns
- `src/tools/configure-filters.ts` — exemplar for tool structure: Zod schema, `resolveProjectSafely()`, `makeSuccess()`, dual text+structured response
- `src/tools/descriptions.ts` — `TOOL_DESCRIPTIONS` and `PARAMS` — centralized descriptions and shared parameter schemas
- `src/tools/tool-helpers.ts` — `resolveProjectSafely()`, `returnError()` — shared tool utilities
- `src/tools/index.ts` — `registerAllTools()` — tool registration index

### Error handling
- `src/errors/domain-error.ts` — `DomainError` class with code, message, args, and suggestions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createStudyJar()`: Complete add flow — validates, resolves path, opens ZIP, computes stats, returns `StudyJar`
- `validateStudyJarName()`: Name validation with `DomainError` on failure
- `deriveStudyJarName()`: Auto-name derivation from jar filename
- `resolveProjectSafely()`: Standard project resolution with error envelope — used by all tools
- `makeSuccess()`: Structured response envelope factory
- `PARAMS.project`: Shared optional project parameter schema
- `returnError()`: Error response formatting

### Established Patterns
- One file per tool: `src/tools/{tool-name}.ts` exports `register{ToolName}Tool(server: McpServer)`
- Tool descriptions in `TOOL_DESCRIPTIONS`, shared params in `PARAMS`
- All tools registered in `src/tools/index.ts`
- Dual response: `content` (text array) + `structuredContent` (typed envelope)
- `resolveProjectSafely()` at the top of every handler that needs a project

### Integration Points
- `loadedProject.studyJars` — `Map<string, StudyJar>` — add/remove/list/configure all operate on this
- `jarReader.addProjectJar()` — called after `createStudyJar()` to register the handle
- `jarReader.removeProjectJar()` — called on removal to deregister
- `evictEntryIndex()` — called on removal to clear cached index data

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-study-jar-management-tools*
*Context gathered: 2026-04-13*
