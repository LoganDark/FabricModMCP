# Phase 1: Server Bootstrap - Research

**Researched:** 2026-04-12
**Domain:** MCP server framework, TypeScript tooling, Zod validation, stdio transport
**Confidence:** HIGH

## Summary

Phase 1 establishes the MCP server skeleton: a TypeScript process that communicates over stdio using the official MCP SDK, validates tool parameters with Zod 4 schemas, and returns rich structured responses via a consistent envelope. This is a greenfield project with no existing code.

The MCP TypeScript SDK v1.x provides `McpServer` with `registerTool()` for tool registration, accepting Zod schema objects directly as `inputSchema`. The `StdioServerTransport` handles stdin/stdout JSON-RPC framing. Zod 4.x (currently 4.3.6) is a required peer dependency of the SDK and provides runtime validation with static type inference. The critical constraint is stdout purity -- any `console.log` or accidental stdout write breaks the JSON-RPC protocol.

**Primary recommendation:** Use the MCP SDK v1.29.x with `registerTool()`, Zod 4.3.x for schemas, tsx (not ts-node) for execution, and pnpm for package management. Establish the response envelope pattern, `include`-based metadata opt-in, and stderr-only logging from day one.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Flat descriptive tool names, no prefix/namespace (e.g., `read_class`, `list_packages`)
- camelCase parameter names (e.g., `className`, `projectName`)
- Many focused tools, each does one thing
- `project` param: optional, auto-resolves with one project, disambiguation response with multiple
- `include` array param with opt-in categories like `"provenance"`, `"stats"`, `"hints"`
- Rich envelope: `{ success, data, metadata }` on every response
- `metadata` filtered by `include` param
- Domain errors use `success: false`; hard failures use MCP `isError` flag
- Validation errors: humanized message + Zod path
- Domain errors: suggestive with suggestions
- All errors logged to stderr
- Disambiguation: distinct response shape, not an error
- No args required to start; optional `--project <path>` flag
- Runtime config via MCP tool calls after connection
- Log level via `LOG_LEVEL` env var or `--verbose`/`--log-level` CLI flag, default: `info`
- pnpm for package management
- TypeScript with ES modules
- ts-node for execution (NOTE: see pitfall below -- tsx recommended instead)
- Node.js 22 LTS minimum
- Zod for parameter validation

### Claude's Discretion
- Exact project structure and directory layout
- tsconfig.json specifics (beyond ESM target)
- Logger implementation (structured vs plain text to stderr)
- Test framework choice for Phase 1 validation
- Whether to include a health/ping tool in the initial skeleton

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SERV-01 | MCP server runs over stdio transport using the official TypeScript MCP SDK | McpServer + StdioServerTransport from SDK v1.29.x; exact import paths and usage pattern documented |
| SERV-02 | Server executes via ts-node (no compile step required for development) | tsx 4.x recommended over ts-node for ESM compatibility; runs .ts files directly via esbuild |
| SERV-03 | All logging goes to stderr only -- zero stdout output outside JSON-RPC protocol messages | console.error() or pino with fd 2 destination; StdioServerTransport owns stdout exclusively |
| SERV-04 | Every MCP tool has a strongly-typed Zod schema for parameters and returns rich, structured response types | registerTool() accepts Zod shapes as inputSchema; outputSchema optional for structuredContent |
| SERV-05 | Tool responses err on the side of providing more information rather than less | Response envelope with `include`-based metadata opt-in; structuredContent for machine-readable output |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.29.0 | MCP server framework | Official SDK. Provides McpServer, StdioServerTransport, registerTool() with Zod schema support |
| zod | 4.3.6 | Parameter validation & type inference | Required peer dep of MCP SDK. 14x faster parsing vs v3. Standard Schema compliant. |
| typescript | 5.7+ | Type system | Required for Zod 4 type inference and strict typing |
| tsx | 4.21.0 | TypeScript execution (dev) | Runs .ts directly via esbuild. Seamless ESM support. Zero config. |
| tsup | 8.5.1 | Production bundling | Bundles to single JS file for distribution |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.4 | Testing | Unit and integration tests for tool registration, validation, response shapes |
| @types/node | 22.x | Node.js type defs | Always -- matches Node.js 22 LTS runtime |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsx | ts-node | ts-node has well-documented ESM issues requiring complex loader configuration; tsx just works |
| vitest | jest | Jest requires extra config for ESM/TypeScript; vitest is native ESM and faster |
| console.error | pino (stderr) | pino adds structured JSON logging but is heavier; console.error is sufficient for Phase 1 |

**Installation:**
```bash
pnpm add @modelcontextprotocol/sdk zod
pnpm add -D typescript tsx tsup vitest @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  index.ts           # Entry point: create server, connect transport
  server.ts          # McpServer setup, tool registration orchestration
  tools/
    index.ts         # Tool registry -- registers all tools on server
    echo.ts          # Example/test tool (Phase 1 demo)
  types/
    envelope.ts      # Response envelope types (ToolSuccess, ToolError, Disambiguation)
    include.ts       # Include categories type and helpers
  errors/
    domain-error.ts  # Domain error class with suggestions
    validation.ts    # Zod error formatting (humanized messages)
  logging/
    logger.ts        # Stderr logger with level support
  cli/
    args.ts          # CLI argument parsing (--project, --verbose, --log-level)
tests/
  tools/
    echo.test.ts     # Tool integration tests via InMemoryTransport
  types/
    envelope.test.ts # Response shape validation tests
  helpers/
    client.ts        # Shared test helper: create linked client+server pair
```

### Pattern 1: Tool Registration with registerTool()
**What:** The MCP SDK v1.x uses `registerTool()` with Zod schemas passed as raw object shapes (not wrapped in `z.object()`).
**When to use:** Every tool definition.
**Example:**
```typescript
// Source: MCP SDK v1.x docs (https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'minecraft-dev', version: '0.1.0' });

server.registerTool(
  'echo',
  {
    title: 'Echo',
    description: 'Echo back the input with metadata',
    inputSchema: {
      message: z.string().describe('The message to echo'),
      include: z.array(z.enum(['provenance', 'stats', 'hints']))
        .optional()
        .describe('Optional metadata categories to include in response'),
    },
  },
  async ({ message, include }) => {
    const data = { echoed: message };
    const metadata: Record<string, unknown> = {};
    if (include?.includes('stats')) {
      metadata.stats = { length: message.length };
    }
    const envelope = { success: true, data, metadata };
    return {
      content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
      structuredContent: envelope,
    };
  }
);
```

### Pattern 2: Response Envelope
**What:** Every tool returns `{ success, data, metadata }` as structuredContent.
**When to use:** All tool responses, always.
**Example:**
```typescript
// Success response
interface ToolSuccess<T> {
  success: true;
  data: T;
  metadata: Record<string, unknown>; // filtered by include param
}

// Domain error response (class not found, jar missing, etc.)
interface ToolError {
  success: false;
  error: {
    code: string;           // e.g. 'CLASS_NOT_FOUND'
    message: string;        // humanized message
    tried: string[];        // what was searched/attempted
    suggestions?: string[]; // did-you-mean or next steps
  };
  metadata: Record<string, unknown>;
}

// Disambiguation response (multiple projects, ambiguous input)
interface Disambiguation {
  success: true;
  disambiguation: true;
  message: string;
  options: Array<{ value: string; label: string; description?: string }>;
}

type ToolResponse<T> = ToolSuccess<T> | ToolError | Disambiguation;
```

### Pattern 3: Server Entry Point with Stdio
**What:** Minimal entry point that creates server, registers tools, connects stdio transport.
**When to use:** `src/index.ts` -- the main entry point.
**Example:**
```typescript
// Source: MCP SDK v1.x docs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools/index.js';
import { parseArgs } from './cli/args.js';
import { logger } from './logging/logger.js';

const args = parseArgs(process.argv.slice(2));
logger.setLevel(args.logLevel);

const server = new McpServer(
  { name: 'minecraft-dev-mcp', version: '0.1.0' },
  { instructions: 'Minecraft mod development tools for browsing and navigating decompiled source code.' }
);

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

logger.info('Server started');  // goes to stderr

// Graceful shutdown
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
```

### Pattern 4: InMemoryTransport for Testing
**What:** Test tools without spawning a subprocess by using linked in-memory transports.
**When to use:** All vitest integration tests.
**Example:**
```typescript
// Source: MCP SDK InMemoryTransport (https://github.com/modelcontextprotocol/typescript-sdk)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('echo tool', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.1' });
    // register tools on server...

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(clientTransport);
  });

  it('echoes message with metadata', async () => {
    const result = await client.callTool({
      name: 'echo',
      arguments: { message: 'hello', include: ['stats'] },
    });
    // result.content contains the response
    const envelope = JSON.parse((result.content as any)[0].text);
    expect(envelope.success).toBe(true);
    expect(envelope.data.echoed).toBe('hello');
    expect(envelope.metadata.stats).toBeDefined();
  });
});
```

### Anti-Patterns to Avoid
- **console.log() anywhere in server code:** Pollutes stdout, breaks JSON-RPC framing. Use console.error() or a stderr logger.
- **Wrapping inputSchema in z.object():** The SDK's registerTool() accepts raw Zod shapes (plain object with Zod types as values), not a z.object() wrapper.
- **Multipurpose tools with mode params:** Per user decision, each tool does one thing. Don't create a single `source` tool with a `mode` parameter.
- **Throwing errors for domain failures:** Domain errors (class not found) should return `success: false` in the envelope, not throw. Only truly exceptional/unrecoverable situations should throw (which the SDK catches and converts to `isError: true`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC framing | Custom stdin/stdout parser | StdioServerTransport | Protocol compliance, error handling, message buffering |
| Tool parameter validation | Manual type checks | Zod schemas via registerTool inputSchema | Automatic JSON Schema generation for tool discovery, type inference, error paths |
| CLI argument parsing | Manual process.argv parsing | Node.js built-in `util.parseArgs()` | Available in Node 22 LTS, handles --flag and --key=value, typed options |
| JSON Schema generation | zodToJsonSchema() manually | SDK handles internally | registerTool() auto-converts Zod to JSON Schema for tool listing |

**Key insight:** The MCP SDK handles the hard parts (protocol, framing, schema conversion). Focus on the application layer: envelope types, tool implementations, logging discipline.

## Common Pitfalls

### Pitfall 1: stdout Pollution
**What goes wrong:** Any console.log(), debug output, or uncaught error printed to stdout corrupts the JSON-RPC stream, causing the MCP client to disconnect or fail silently.
**Why it happens:** Default logging (console.log) goes to stdout. Library dependencies may also write to stdout.
**How to avoid:** (1) Never use console.log in server code. (2) Replace with a logger that writes to stderr (fd 2). (3) Redirect or suppress any library stdout. (4) Test by running the server and piping stdout to a JSON parser -- any non-JSON-RPC output is a bug.
**Warning signs:** MCP client fails to connect, or "unexpected token" errors from Claude Code.

### Pitfall 2: ts-node ESM Configuration Pain
**What goes wrong:** ts-node has well-documented issues with ES modules. The MCP SDK uses ESM imports with `.js` extensions (e.g., `@modelcontextprotocol/sdk/server/mcp.js`). ts-node requires `--esm` flag plus `--experimental-specifier-resolution=node` or `--loader ts-node/esm`, which produces deprecation warnings and intermittent failures.
**Why it happens:** ts-node was designed for CommonJS. ESM support is bolted on and fragile.
**How to avoid:** Use tsx instead. It handles ESM natively via esbuild with zero configuration. The user's CONTEXT.md says "ts-node" but the project's CLAUDE.md recommends tsx, and tsx is the standard for MCP server development.
**Warning signs:** "ERR_UNKNOWN_FILE_EXTENSION", "ERR_MODULE_NOT_FOUND", or loader warnings on startup.
**Recommendation:** Use tsx. The SERV-02 requirement says "no compile step required for development" -- tsx satisfies this better than ts-node for ESM projects. If the user insists on ts-node, document the required flags: `node --loader ts-node/esm src/index.ts`.

### Pitfall 3: Zod 4 Schema Description Propagation
**What goes wrong:** Field descriptions set via `.describe()` may not appear in the MCP tool listing JSON Schema.
**Why it happens:** A bug in Zod 4.1.12 and earlier + MCP SDK < 1.23.0 where toJSONSchema() dropped descriptions.
**How to avoid:** Use Zod >= 4.1.13 and MCP SDK >= 1.23.0. Current versions (Zod 4.3.6, SDK 1.29.0) have this fixed.
**Warning signs:** Tool parameter descriptions missing when Claude discovers tools.

### Pitfall 4: registerTool inputSchema Shape
**What goes wrong:** Wrapping inputSchema in `z.object()` causes type errors or unexpected behavior.
**Why it happens:** The SDK's registerTool() expects a raw shape object `{ key: z.type() }`, not `z.object({ key: z.type() })`. The SDK wraps it internally.
**How to avoid:** Always pass raw shapes to inputSchema. Use z.object() only if you need to export the schema type separately (and extract `.shape` when passing to registerTool).
**Warning signs:** TypeScript type errors on registerTool() call, or tools not appearing in tool listing.

### Pitfall 5: Missing .js Extensions in Imports
**What goes wrong:** TypeScript files import from `./tools/echo` instead of `./tools/echo.js`, causing runtime module resolution failures in ESM mode.
**Why it happens:** ESM requires explicit file extensions. TypeScript's `nodenext` module resolution enforces this.
**How to avoid:** Always use `.js` extensions in import statements (even though the source files are `.ts`). TypeScript resolves `.js` to `.ts` during compilation. Configure tsconfig with `"module": "nodenext"` and `"moduleResolution": "nodenext"`.
**Warning signs:** "ERR_MODULE_NOT_FOUND" at runtime.

## Code Examples

### Stderr Logger with Level Support
```typescript
// src/logging/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    if (data !== undefined) {
      console.error(entry, JSON.stringify(data));
    } else {
      console.error(entry);
    }
  }

  debug(msg: string, data?: unknown) { this.log('debug', msg, data); }
  info(msg: string, data?: unknown) { this.log('info', msg, data); }
  warn(msg: string, data?: unknown) { this.log('warn', msg, data); }
  error(msg: string, data?: unknown) { this.log('error', msg, data); }
}

export const logger = new Logger();
```

### CLI Argument Parsing with util.parseArgs()
```typescript
// src/cli/args.ts
import { parseArgs } from 'node:util';

export interface CliArgs {
  project?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string', short: 'p' },
      verbose: { type: 'boolean', short: 'v' },
      'log-level': { type: 'string' },
    },
    strict: true,
  });

  const logLevel = values.verbose
    ? 'debug'
    : (values['log-level'] as CliArgs['logLevel'] ?? 'info');

  return {
    project: values.project,
    logLevel,
  };
}
```

### Zod Validation Error Formatting
```typescript
// src/errors/validation.ts
import { z } from 'zod';

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

// Example output: "className: Expected string; includeInnerClasses: Expected boolean"
```

### Package.json Essentials
```json
{
  "name": "minecraft-dev-mcp",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool()` | `server.registerTool()` | MCP SDK v1.x late 2025 | registerTool() provides better type safety and supports outputSchema/structuredContent |
| Zod v3 | Zod v4 (4.3.6) | 2025 | 14x faster parsing, Standard Schema support, smaller bundle |
| ts-node for ESM | tsx | 2024+ | tsx handles ESM natively without loader flags; community standard for MCP servers |
| JSON Schema manual | Zod auto-conversion | MCP SDK v1.x | SDK auto-converts Zod schemas to JSON Schema for tool discovery |

**Deprecated/outdated:**
- `server.tool()`: Older SDK versions used this; `registerTool()` is the current v1.x API with better type inference
- ts-node with `--esm` flag: Works but fragile; tsx is the community standard

## Open Questions

1. **registerTool() vs tool() in SDK v1.29.0**
   - What we know: Documentation shows registerTool() as the primary API. Earlier versions had tool().
   - What's unclear: Whether tool() still works as an alias in v1.29.0.
   - Recommendation: Use registerTool() exclusively -- it's the documented API.

2. **structuredContent support in Claude Code**
   - What we know: The SDK supports outputSchema and structuredContent in registerTool().
   - What's unclear: Whether Claude Code (the MCP client) reads structuredContent or just text content.
   - Recommendation: Always include both text content (JSON stringified) and structuredContent. The text content is the universal fallback.

3. **ts-node vs tsx user preference**
   - What we know: User locked "ts-node" in CONTEXT.md. CLAUDE.md recommends tsx. ESM + ts-node is a known pain point.
   - What's unclear: Whether the user has a strong preference or just defaulted to ts-node.
   - Recommendation: Plan for tsx but note the user's stated preference. The planner should flag this for user confirmation.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | vitest.config.ts (Wave 0 -- needs creation) |
| Quick run command | `pnpm vitest run --reporter=verbose` |
| Full suite command | `pnpm vitest run --reporter=verbose --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SERV-01 | Server starts and completes MCP handshake over stdio | integration | `pnpm vitest run tests/server.test.ts -t "handshake"` | Wave 0 |
| SERV-02 | Server runs via tsx without compile step | smoke | `pnpm tsx src/index.ts --help` (exits cleanly) | Wave 0 |
| SERV-03 | Zero stdout pollution -- only JSON-RPC on stdout | integration | `pnpm vitest run tests/server.test.ts -t "stdout"` | Wave 0 |
| SERV-04 | Tool has Zod schema, validation rejects bad input | unit | `pnpm vitest run tests/tools/echo.test.ts -t "validation"` | Wave 0 |
| SERV-05 | Tool response includes rich metadata via include param | unit | `pnpm vitest run tests/tools/echo.test.ts -t "metadata"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run --reporter=verbose`
- **Per wave merge:** `pnpm vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- vitest configuration for ESM TypeScript
- [ ] `tests/helpers/client.ts` -- shared helper to create linked McpServer + Client pair via InMemoryTransport
- [ ] `tests/server.test.ts` -- server handshake and stdout purity tests
- [ ] `tests/tools/echo.test.ts` -- echo tool validation and response shape tests

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK v1.x - GitHub](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) - registerTool API, StdioServerTransport, import paths
- [MCP SDK v1.x server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md) - Complete server API reference
- [MCP SDK ts.sdk.modelcontextprotocol.io](https://ts.sdk.modelcontextprotocol.io/documents/server.html) - Official API docs
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - v1.29.0 verified, peer deps checked
- [Zod API docs](https://zod.dev/api) - z.enum, z.array, z.object patterns
- npm registry -- all package versions verified via `npm view` on 2026-04-12

### Secondary (MEDIUM confidence)
- [Zod 4 field description issue #1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143) - Fixed in SDK >= 1.23.0 + Zod >= 4.1.13
- [MCP debugging best practices](https://modelcontextprotocol.io/docs/tools/debugging) - stderr logging patterns
- [MCPcat unit testing guide](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/) - InMemoryTransport testing pattern
- [MCP e2e testing example](https://creati.ai/mcp/mcp-server-e2e-testing-example/) - Vitest + InMemoryTransport pattern
- [tsx vs ts-node comparison](https://betterstack.com/community/guides/scaling-nodejs/tsx-vs-ts-node/) - ESM compatibility analysis

### Tertiary (LOW confidence)
- structuredContent support in Claude Code client -- not verified with official docs, assumed based on SDK support

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all versions verified against npm registry, SDK API confirmed from official docs
- Architecture: HIGH - patterns derived from official SDK documentation and examples
- Pitfalls: HIGH - stdout pollution and ESM issues are extensively documented across multiple sources

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable ecosystem, 30-day window)
