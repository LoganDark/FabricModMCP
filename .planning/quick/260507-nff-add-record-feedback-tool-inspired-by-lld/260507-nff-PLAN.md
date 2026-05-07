---
phase: quick-260507-nff
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/tools/descriptions.ts
  - src/tools/record-feedback.ts
  - src/tools/index.ts
  - src/state/paths.ts
  - tests/tools/record-feedback.test.ts
autonomous: true
requirements:
  - QUICK-NFF-01
must_haves:
  truths:
    - "Calling record_feedback with a non-empty message appends a single timestamped block to FEEDBACK.txt at the FabricModMCP install root, not at the downstream project's cwd."
    - "Multiple calls accumulate; existing entries are never modified or clobbered."
    - "Empty messages are rejected by Zod validation; the file is not created or appended."
    - "The agent's cwd at call time is captured verbatim in the entry header so feedback is traceable to the downstream project that triggered it."
    - "FEEDBACK_PATH env var overrides the default location (used by tests; useful for read-only deployments)."
  artifacts:
    - path: "src/state/paths.ts"
      provides: "getProjectRoot() and getFeedbackPath() — server-relative path resolution that walks up from import.meta.url to find package.json. New file."
      contains: "export function getFeedbackPath"
    - path: "src/tools/record-feedback.ts"
      provides: "registerRecordFeedbackTool — appends '[<iso>] cwd=<cwd>\\n<message>\\n\\n' to FEEDBACK.txt. New file."
      contains: "export function registerRecordFeedbackTool"
    - path: "src/tools/descriptions.ts"
      provides: "PARAMS.feedbackMessage Zod schema, TOOL_DESCRIPTIONS.record_feedback string."
      contains: "record_feedback:"
    - path: "src/tools/index.ts"
      provides: "registerAllTools wires registerRecordFeedbackTool into the server."
      contains: "registerRecordFeedbackTool"
    - path: "tests/tools/record-feedback.test.ts"
      provides: "vitest coverage for append-only behavior, multi-call accumulation, cwd capture, and empty-message rejection."
      contains: "describe('record_feedback'"
  key_links:
    - from: "src/tools/record-feedback.ts"
      to: "src/state/paths.ts"
      via: "getFeedbackPath() import"
      pattern: "getFeedbackPath"
    - from: "src/tools/record-feedback.ts"
      to: "src/tools/descriptions.ts"
      via: "TOOL_DESCRIPTIONS.record_feedback + PARAMS.feedbackMessage import"
      pattern: "TOOL_DESCRIPTIONS.record_feedback"
    - from: "src/tools/index.ts"
      to: "src/tools/record-feedback.ts"
      via: "registerRecordFeedbackTool registration call"
      pattern: "registerRecordFeedbackTool\\(server\\)"
---

<objective>
Add a `record_feedback` MCP tool to FabricModMCP, mirroring the design used by lldb-mcp at `~/Documents/Projects/MCP/lldb-mcp`. When Claude is using FabricModMCP from any downstream project's cwd, calling `record_feedback` appends a timestamped, cwd-stamped, free-form note to `FEEDBACK.txt` at the FabricModMCP server's install root — so papercuts, bugs, and suggestions accumulate in one place across sessions, regardless of which downstream project surfaced them.

Purpose: Close the feedback loop. Today, papercuts noticed by downstream agents evaporate at session end because there is no in-tool way to capture them where the maintainer (this project) will see them. lldb-mcp solved this exact problem with `record_feedback` + `FEEDBACK.txt` at the server install root; this plan ports that pattern verbatim, adapted to FabricModMCP's conventions (no nested JSON in text content, response envelope from `src/types/envelope.ts`, descriptions in `src/tools/descriptions.ts`).

Output:
- New file: `src/state/paths.ts` exporting `getProjectRoot()` and `getFeedbackPath()` (env-var override: `FEEDBACK_PATH`).
- New file: `src/tools/record-feedback.ts` with `registerRecordFeedbackTool`.
- New file: `tests/tools/record-feedback.test.ts` covering append-only, multi-call, cwd capture, empty rejection.
- Updates to `src/tools/descriptions.ts` (PARAMS.feedbackMessage, TOOL_DESCRIPTIONS.record_feedback).
- Update to `src/tools/index.ts` to register the new tool.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/server.ts
@src/types/envelope.ts
@src/tools/echo.ts
@src/tools/index.ts
@src/tools/descriptions.ts

## Reference implementation (READ FIRST, do not skip)

The whole point of this plan is to mirror lldb-mcp's design. Before writing any code, read these three files in full:

- `~/Documents/Projects/MCP/lldb-mcp/src/tools/record-feedback.ts` — handler (≈58 lines)
- `~/Documents/Projects/MCP/lldb-mcp/src/state/paths.ts` — `getProjectRoot()` walks up from `import.meta.url` looking for `package.json`; `getFeedbackPath()` honors `FEEDBACK_PATH` env override else `<root>/FEEDBACK.txt`
- `~/Documents/Projects/MCP/lldb-mcp/tests/tools/record-feedback.test.ts` — test shape we want to match

The on-disk format used by lldb-mcp (do not invent a different one):

```
[2026-05-07T23:49:30.597Z] cwd=/Users/LoganDark/Documents/Projects/valgrind
<message body, trailing whitespace stripped>

```

That is: header line `[<ISO>] cwd=<absolute cwd>`, newline, the verbatim message with `\s+$` stripped, then `\n\n` separator. Append-only. No JSON, no parser-friendly framing — eyeball-greppable for the maintainer.

## FabricModMCP conventions (differ from lldb-mcp in two ways)

1. **No `returnSuccess` helper / no `tool-helpers.ts` `returnSuccess`.** FabricModMCP uses `makeSuccess` from `src/types/envelope.ts` and the tool returns `{ content: [{ type: 'text', text: ... }], structuredContent: envelope }` directly (see `src/tools/echo.ts:42-46`). Match that exact shape — DO NOT JSON.stringify the envelope into the text content (project rule from CLAUDE.md).
2. **Description object naming.** FabricModMCP has `TOOL_DESCRIPTIONS` and `SERVER_INSTRUCTIONS` (no `TOOL_TITLES`, no `SUMMARIES`). The `title` field on `registerTool` is passed inline as a string literal (see echo.ts:13: `title: 'Echo'`). Use `title: 'Record Feedback'` inline.

## Storage location decision (locked)

Per the constraint in the task brief and the lldb-mcp precedent: `FEEDBACK.txt` lives at the **FabricModMCP server's install root**, NOT under the downstream project's cwd, NOT under `~/.config` or any XDG path.

Why: feedback is *about this server*, so it belongs with this server's source tree. The maintainer (this project) reviews it. The downstream project doesn't care about it. lldb-mcp made the same call and it works well — `FEEDBACK.txt` lives at the lldb-mcp project root and gets committed (or at least visible) to the maintainer.

Resolve the install root by walking up from `import.meta.url` looking for `package.json` (lldb-mcp's exact strategy). Cache the result. Allow `FEEDBACK_PATH` env override for tests and read-only deployments.
</context>

<interfaces>
<!-- Key contracts the executor needs. Embedded so no codebase scavenger hunt is required. -->

From `src/types/envelope.ts`:
```typescript
export type ToolSuccess<T> = { success: true; data: T; metadata: Record<string, unknown> };
export function makeSuccess<T>(data: T, metadata?: Record<string, unknown>): ToolSuccess<T>;
```

From `src/tools/echo.ts` (canonical tool shape — copy this pattern):
```typescript
export function registerEchoTool(server: McpServer): void {
    server.registerTool(
        'echo',
        {
            title: 'Echo',
            description: TOOL_DESCRIPTIONS.echo,
            inputSchema: { message: z.string().describe('...'), include: includeSchema },
        },
        async ({ message, include }) => {
            // ...
            const envelope = makeSuccess(data, metadata);
            return {
                content: [{ type: 'text' as const, text: `Echoed: ${message}` }],
                structuredContent: envelope,
            };
        },
    );
}
```

From `src/tools/descriptions.ts`:
```typescript
export const PARAMS = { project, class, jar, jars, patterns, /* ... */ } as const;
export const TOOL_DESCRIPTIONS = { echo, create_project, /* ... */ } as const;
```

From `src/tools/index.ts`:
```typescript
export function registerAllTools(server: McpServer): void {
    registerEchoTool(server);
    // ... other registrations
}
```

From lldb-mcp `src/state/paths.ts` (port verbatim, adapt module path):
```typescript
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let cachedRoot: string | null = null;

export function getProjectRoot(): string {
    if (cachedRoot !== null) return cachedRoot;
    const start = dirname(fileURLToPath(import.meta.url));
    let dir = start;
    while (true) {
        if (existsSync(resolve(dir, 'package.json'))) {
            cachedRoot = dir;
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error(`Could not locate project root (no package.json found walking up from ${start})`);
        }
        dir = parent;
    }
}

export function getFeedbackPath(): string {
    const override = process.env.FEEDBACK_PATH;
    if (override && override.length > 0) return override;
    return resolve(getProjectRoot(), 'FEEDBACK.txt');
}
```

From lldb-mcp `formatEntry` (port verbatim):
```typescript
function formatEntry(timestamp: string, cwd: string, message: string): string {
    const body = message.replace(/\s+$/u, '');
    return `[${timestamp}] cwd=${cwd}\n${body}\n\n`;
}
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add path resolution + record_feedback handler + descriptions</name>
  <files>src/state/paths.ts, src/tools/record-feedback.ts, src/tools/descriptions.ts, src/tools/index.ts</files>
  <behavior>
    - `getFeedbackPath()` returns `<install-root>/FEEDBACK.txt` where install-root is the directory containing FabricModMCP's `package.json` (found by walking up from `import.meta.url`). Cached after first call.
    - `getFeedbackPath()` honors `FEEDBACK_PATH` env var when set and non-empty (returns it verbatim; no resolve, no validation — matches lldb-mcp).
    - `record_feedback({ message })` with a non-empty message appends `[<ISO>] cwd=<process.cwd()>\n<trimmed body>\n\n` to that path.
    - The handler returns `{ content: [{ type: 'text', text: 'Feedback appended to <path> at <iso>' }], structuredContent: makeSuccess({ path, timestamp, cwd, bytesAppended }, { tool: 'record_feedback' }) }`.
    - Empty message string fails Zod validation before the handler runs (file must not be created).
    - Multi-line messages preserved verbatim; only trailing whitespace (`\s+$/u`) is stripped from the body.
  </behavior>
  <action>
    Step 1 — Create `src/state/paths.ts` (new directory, new file). Port `getProjectRoot()` and `getFeedbackPath()` verbatim from `~/Documents/Projects/MCP/lldb-mcp/src/state/paths.ts`. The walk-up-from-import.meta.url strategy works regardless of how the server is launched (tsx, tsup bundle, pnpm start). Use tab indentation.

    Note: `src/state/` does NOT yet exist (the project's existing `state/` dir is `src/state/project-store.ts` — wait, check `ls src/state/`: it does exist). If `src/state/project-store.ts` already lives there, just add `paths.ts` alongside it.

    Step 2 — Edit `src/tools/descriptions.ts`:
    - Inside `PARAMS` object (around line 152, before the closing `} as const;`), add:
      ```typescript
      /** Free-form feedback message body. */
      feedbackMessage: z.string().min(1)
          .describe('Free-form feedback text. Multi-line is fine. Describe the issue, papercut, or suggestion in your own words.'),
      ```
    - Inside `TOOL_DESCRIPTIONS` object (around line 304, before the closing `} as const;`), add an entry. Adapt lldb-mcp's wording to FabricModMCP. Suggested text:
      ```typescript
      record_feedback:
          'Record free-form feedback about FabricModMCP itself — papercuts, bugs, unintuitive behavior, missing ' +
          'features, anything an agent notices while using these tools during Minecraft mod development. Each call ' +
          'appends a single entry to FEEDBACK.txt at the MCP server\'s installation root (NOT the agent\'s cwd, ' +
          'which is the downstream Fabric project). The entry records the timestamp, the agent\'s current working ' +
          'directory, and the verbatim message. Existing entries are never modified. Use this whenever something ' +
          'surprises you, blocks you, or could be smoother — the maintainers review FEEDBACK.txt to drive improvements.',
      ```

    Step 3 — Create `src/tools/record-feedback.ts`. Mirror lldb-mcp's handler but adapt to FabricModMCP's envelope. The full handler:
    ```typescript
    import { appendFile } from 'node:fs/promises';
    import { z } from 'zod';
    import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { makeSuccess } from '../types/envelope.js';
    import { logger } from '../logging/logger.js';
    import { getFeedbackPath } from '../state/paths.js';
    import { PARAMS, TOOL_DESCRIPTIONS } from './descriptions.js';

    function formatEntry(timestamp: string, cwd: string, message: string): string {
        const body = message.replace(/\s+$/u, '');
        return `[${timestamp}] cwd=${cwd}\n${body}\n\n`;
    }

    export function registerRecordFeedbackTool(server: McpServer): void {
        server.registerTool(
            'record_feedback',
            {
                title: 'Record Feedback',
                description: TOOL_DESCRIPTIONS.record_feedback,
                inputSchema: {
                    message: PARAMS.feedbackMessage,
                },
            },
            async ({ message }) => {
                const cwd = process.cwd();
                const timestamp = new Date().toISOString();
                const path = getFeedbackPath();
                const block = formatEntry(timestamp, cwd, message);
                const bytesAppended = Buffer.byteLength(block, 'utf-8');

                logger.debug('record_feedback called', { path, cwd, timestamp, bytes: bytesAppended });

                await appendFile(path, block, 'utf-8');

                const data = { path, timestamp, cwd, bytesAppended };
                const envelope = makeSuccess(data, { tool: 'record_feedback' });
                return {
                    content: [{ type: 'text' as const, text: `Feedback appended to ${path} at ${timestamp}` }],
                    structuredContent: envelope,
                };
            },
        );
    }
    ```

    Verify the logger import path matches the project — open `src/tools/echo.ts:6` to confirm: `import { logger } from '../logging/logger.js';` — yes, same path.

    Step 4 — Edit `src/tools/index.ts`:
    - Add import: `import { registerRecordFeedbackTool } from './record-feedback.js';` (alongside the existing block of imports near the top).
    - Add registration call inside `registerAllTools`. Place it at the end, after `registerListStudyJarsTool(server);`. Add a comment block separator:
      ```typescript
      // Feedback
      registerRecordFeedbackTool(server);
      ```

    Avoid: do NOT add `record_feedback` to the workflow numbered list in `SERVER_INSTRUCTIONS`. It is not part of the mod-development workflow; it is a meta tool. The TOOL_DESCRIPTIONS entry is sufficient.

    Avoid: do NOT add a `configure_study_jar` style include schema or pagination — this tool has exactly one input parameter (`message`) and returns a tiny fixed-shape envelope. Keep it minimal.

    Avoid: do NOT JSON.stringify the structuredContent into the text content (CLAUDE.md rule). The text content is the human-readable summary line; the envelope rides on `structuredContent`.

    Avoid: do NOT add `FEEDBACK.txt` to `.gitignore`. We want the file to be committable so accumulated feedback is visible to maintainers in the repo.
  </action>
  <verify>
    <automated>pnpm exec tsc --noEmit</automated>
  </verify>
  <done>TypeScript compiles cleanly. The new tool is wired into `registerAllTools`. `getFeedbackPath()` resolves to `<repo-root>/FEEDBACK.txt` when run from any cwd. PARAMS.feedbackMessage and TOOL_DESCRIPTIONS.record_feedback exist.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Test record_feedback append-only behavior end-to-end</name>
  <files>tests/tools/record-feedback.test.ts</files>
  <behavior>
    - Test 1: A single call with a non-empty message creates FEEDBACK.txt and the file contains the ISO timestamp header, `cwd=<process.cwd()>` line, and the message body. The block ends with `\n\n`.
    - Test 2: Three sequential calls produce three blocks separated by blank lines, with all three messages present and prior blocks unmodified.
    - Test 3: A pre-existing sentinel block at the start of FEEDBACK.txt remains intact after a new append (proves append-only — the implementation never reads-modifies-writes).
    - Test 4: A multi-line message with trailing whitespace (`'line one\nline two\n\nline four\n   \n\n'`) is preserved verbatim except for trailing `\s+$` being stripped, and the block still ends with exactly one `\n\n` separator.
    - Test 5: An empty-string message either errors out OR leaves FEEDBACK.txt non-existent (Zod `.min(1)` should reject before the handler runs).
    - Test 6: Setting `process.env.FEEDBACK_PATH` to a tmp path causes that path to be used, not the install-root default.
  </behavior>
  <action>
    Look at `tests/` to see if there is an existing test harness. Run `ls /Users/LoganDark/Documents/Projects/FabricModMCP/tests/` to find existing tool tests and a client test helper.

    Two viable approaches — pick whichever matches existing FabricModMCP test patterns:

    **Approach A (preferred if a test client harness exists):** Mirror lldb-mcp's `tests/tools/record-feedback.test.ts` shape: spawn a real MCP client/server pair, call the tool through the MCP protocol, assert against the file. This catches Zod schema wiring + envelope shape + actual file I/O. Look for a `tests/helpers/client.ts` or similar (check `ls tests/`); if it doesn't exist, fall back to Approach B.

    **Approach B (fallback if no harness exists):** Test the handler unit-style by calling `formatEntry` directly + calling `getFeedbackPath` with the env override + asserting `appendFile` behavior. Export `formatEntry` from `record-feedback.ts` if needed (or move it into `paths.ts` for testability — preferred if so, since it's small and pure).

    Use `mkdtempSync(join(tmpdir(), 'fabricmodmcp-feedback-'))` for an isolated tmp dir per test. Set `process.env.FEEDBACK_PATH` in `beforeEach` and restore in `afterEach`. Tab-indent the test file.

    Reference the lldb-mcp test file as a structural model — port the assertion logic directly. Six `it(...)` blocks total per the behavior list above.

    Avoid: do NOT run the test against the real `<repo-root>/FEEDBACK.txt` — always use the env override to a tmp path. A leaked test would scribble into the committed feedback file.

    Avoid: do NOT mock `node:fs/promises` — use real file I/O against the tmp dir. Mocking hides bugs in the encoding/append path which is the actual surface area we care about.
  </action>
  <verify>
    <automated>pnpm test -- record-feedback</automated>
  </verify>
  <done>All six tests pass. The test file uses tab indentation. FEEDBACK_PATH env override is restored after each test. No leaks into the real `FEEDBACK.txt`.</done>
</task>

</tasks>

<verification>
After both tasks:

1. `pnpm exec tsc --noEmit` — clean.
2. `pnpm test` — full suite green (no regressions in other tools).
3. Manual smoke (optional): `cd /tmp && pnpm --dir /Users/LoganDark/Documents/Projects/FabricModMCP exec tsx -e "import('./src/state/paths.js').then(m => console.log(m.getFeedbackPath()))"` should print `<FabricModMCP-root>/FEEDBACK.txt`, NOT `/tmp/FEEDBACK.txt`. Proves the install-root resolution survives a foreign cwd — the whole point of this tool.
4. List tools via the MCP server (e.g. start the server and observe registration logs, or run an existing integration test that lists tools): `record_feedback` appears with title "Record Feedback".
</verification>

<success_criteria>
- `record_feedback` MCP tool registered and callable via stdio.
- Tool takes `{ message: string }` (Zod min-length 1), returns `{ success: true, data: { path, timestamp, cwd, bytesAppended }, metadata: { tool: 'record_feedback' } }`.
- File at `<FabricModMCP-install-root>/FEEDBACK.txt` accumulates entries in `[<iso>] cwd=<cwd>\n<body>\n\n` format, regardless of the agent's cwd at call time.
- `FEEDBACK_PATH` env override works for tests.
- All new tests pass; no existing tests broken.
- TypeScript compiles cleanly.
- Tab indentation throughout.
</success_criteria>

<output>
After completion, create `.planning/quick/260507-nff-add-record-feedback-tool-inspired-by-lld/260507-nff-SUMMARY.md` documenting:
- Final on-disk format chosen (header line + body + `\n\n` separator).
- Resolved install-root strategy (walk up from `import.meta.url` for `package.json`).
- Env override (`FEEDBACK_PATH`) and its purpose.
- Confirmation that `FEEDBACK.txt` is NOT in `.gitignore` so accumulated feedback is committable.
- Any divergences from lldb-mcp's design and why.
</output>
