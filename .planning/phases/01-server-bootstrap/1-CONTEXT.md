# Phase 1: Server Bootstrap - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Working MCP server over stdio with typed tool framework and stderr-only logging. Executes via ts-node. Every tool has strongly-typed Zod schemas and returns rich, structured responses. This phase delivers the skeleton that all subsequent phases build on — no Minecraft-specific tools yet, just the framework.

</domain>

<decisions>
## Implementation Decisions

### Tool naming & conventions
- Flat descriptive names, no prefix or namespace (e.g., `read_class`, `list_packages`, `search_classes`)
- camelCase parameter names (e.g., `className`, `projectName`, `includeInnerClasses`)
- Many focused tools — each tool does one thing, not multipurpose tools with mode params
- `project` param: optional on every project-scoped tool. Auto-resolves when only one project is loaded. When multiple are loaded and param is omitted, returns a disambiguation response (not an error) listing loaded projects so Claude can retry with a specific choice
- Opt-in extra info: tools accept an `include` array param with categories like `"provenance"`, `"stats"`, `"hints"` — callers specify which extras they want rather than always getting everything

### Response envelope
- Rich envelope on every response: `{ success, data, metadata }` structure
- `metadata` carries provenance, timing, stats, hints — filtered by the `include` param
- Domain errors (class not found, jar missing) use `success: false` in the envelope with detailed error info
- Hard failures (server crash, invalid tool call) use the MCP protocol's `isError` flag

### Error behavior
- Validation errors: humanized domain message + Zod path for debugging (e.g., `"className: Expected a fully-qualified Java class name like net.minecraft.client.MinecraftClient (at className: Expected string)"`)
- Domain errors: suggestive — message + what was tried + suggestions (e.g., `"Class not found: net.minecraft.Foo. Searched: minecraft, fabric-api (3 jars). Did you mean net.minecraft.client.Foo?"`)
- All errors logged to stderr for diagnostic trail outside the MCP protocol
- Disambiguation: distinct response shape when ambiguity exists (e.g., multiple projects loaded, no `project` param) — not an error, but a "choose one" response with options

### Startup & configuration
- No args required — `pnpm start` or `ts-node src/index.ts` launches the server
- Optional `--project <path>` flag to auto-load cwd (or specified path) as a project on startup
- All runtime config happens via MCP tool calls after connection (load_project, etc.)
- Log level configurable via both env var (`LOG_LEVEL=debug|info|warn|error`) and CLI flag (`--verbose` / `--log-level=debug`). Default: `info`

### Runtime & tooling
- pnpm for package management
- TypeScript with ES modules (import/export)
- tsx for execution (no compile step) — originally ts-node, switched to tsx per research finding that ts-node has ESM compatibility issues with MCP SDK's .js imports. User approved 2026-04-12.
- Node.js 22 LTS minimum
- Zod for parameter validation — schemas auto-generate JSON Schema for MCP tool discovery

### Claude's Discretion
- Exact project structure and directory layout
- tsconfig.json specifics (beyond ESM target)
- Logger implementation (structured vs plain text to stderr)
- Test framework choice for Phase 1 validation
- Whether to include a health/ping tool in the initial skeleton

</decisions>

<specifics>
## Specific Ideas

- The `include` param pattern (opt-in extra info categories) should be established as a reusable pattern from Phase 1, since it'll be used across many tools in later phases
- Disambiguation responses should be a first-class concept in the response type system, not an afterthought — they'll come up for project selection but potentially for other ambiguous situations too
- The Zod schema example with `z.array(z.enum(["provenance", "stats", "hints"]))` was confirmed as the right shape during discussion

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above. The MCP SDK documentation and Zod documentation are the primary external references for implementation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project

### Established Patterns
- None yet — this phase establishes the patterns all subsequent phases follow

### Integration Points
- MCP SDK's `McpServer` class and `server.tool()` registration API
- Zod's `zodToJsonSchema()` used internally by the MCP SDK
- node-stream-zip will be integrated in Phase 3 but the tool framework must support async handlers from the start

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-server-bootstrap*
*Context gathered: 2026-04-12*
