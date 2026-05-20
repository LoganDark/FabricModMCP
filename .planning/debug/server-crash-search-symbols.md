---
slug: server-crash-search-symbols
status: resolved
trigger: "FabricModMCP server crashes (MCP error -32000: Connection closed) on search_symbols / find_references / batched read_member, then restarts with an empty in-memory workspace"
created: 2026-05-20
updated: 2026-05-20
---

# Debug Session: server-crash-search-symbols

## Scope

**In scope:** Root cause of the server crash and a fix for the fault.

**Out of scope (user decision 2026-05-20):** workspace persistence/restore across
restart, and `add_fabric_mod` dedup / auto-suffix behaviour. The crash is the
trigger for all observed state loss — fix the crash, and the downstream papercuts
become unreachable. Those are tracked separately if still desired.

## Symptoms

Source: `FEEDBACK.txt` (6 user-recorded reports, 2026-05-20). Treat as data.

<DATA_START>
- During an investigation session, FabricModMCP worked correctly for several calls
  (list_classes, read_source, list_members on com.mojang.blaze3d.vulkan/opengl
  classes), then abruptly the workspace emptied: list_members began returning
  EMPTY_WORKSPACE, get_project_info reported memberCount:0, and the MCP server then
  disconnected entirely. No add/remove project tool was called between the working
  calls and the failure.
- A batch of read_member/search_symbols calls all suddenly returned EMPTY_WORKSPACE
  despite earlier calls in the same session succeeding. Immediately afterward the
  MCP host reported the FabricModMCP server itself had disconnected.
- Server repeatedly crashes (MCP error -32000: Connection closed) when calling
  search_symbols. Reproduced TWICE consecutively with the exact same trigger:
  search_symbols with kind=method, query="renderFrame". search_classes,
  list_members, read_member, read_source on com.mojang.blaze3d.vulkan.* all worked
  fine in the same session.
- Server crashed/disconnected three separate times during one session. Crashes
  seemed correlated with batched/parallel read_member calls.
- Twice the server returned "MCP error -32000: Connection closed" on a
  find_references call, after which the workspace was again empty.
- After each crash the server restarts but loses its entire workspace
  (memberCount:0, EMPTY_WORKSPACE). Reproduced on macOS, Minecraft 26.2-snapshot-8
  Fabric project. Working dir: /Users/LoganDark/Documents/Projects/Fabric/mc-wcg.
</DATA_END>

### Symptom breakdown

- **Expected:** tool calls (search_symbols, find_references, read_member) complete
  without terminating the server process.
- **Actual:** server process crashes — MCP host reports `MCP error -32000:
  Connection closed`; after restart the in-memory workspace is empty so subsequent
  tools fail with `EMPTY_WORKSPACE`.
- **Error messages:** `MCP error -32000: Connection closed`; `EMPTY_WORKSPACE`
  ("Project 'default' has no fabric mods or study jars loaded").
- **Timeline:** observed 2026-05-20 across multiple investigation sessions.
- **Reproduction:** most reliable — `search_symbols` with `kind=method,
  query="renderFrame"` (crashed twice in a row). Also `find_references`, and
  batched/parallel `read_member` calls.
- **Environment:** macOS, Minecraft 26.2-snapshot-8 Fabric project (mc-wcg).
  The crashing operations are JDT LS-backed (search_symbols, find_references).

## Current Focus

- hypothesis: CONFIRMED — `ts-lsp-client@1.1.1`'s `JSONRPCEndpoint` emits an
  unhandled `'error'` event (and runs uncaught `JSON.parse`) whenever an LSP
  response arrives whose id is not strictly `nextId-1`. Concurrent / interleaved
  LSP requests (parallel tool calls, batched read_member) therefore trip an
  unhandled EventEmitter `'error'` → Node terminates the MCP server process.
- test: trace every JDT LS-backed crash trigger through `endpoint.send` and the
  `JSONRPCEndpoint` data handler in node_modules.
- expecting: a code path that throws/emits-error without any catching listener
  on the MCP server side.
- next_action: (resolved — fix applied and verified)
- reasoning_checkpoint: (none)
- tdd_checkpoint: (none)

## Evidence

- timestamp: 2026-05-20
  finding: `src/index.ts` registers ONLY `SIGINT`/`SIGTERM` handlers. There is no
  `process.on('uncaughtException')` and no `process.on('unhandledRejection')`.
  Any uncaught throw or unhandled EventEmitter `'error'` therefore terminates the
  Node process — the MCP host observes this as `MCP error -32000: Connection
  closed`. The post-crash `EMPTY_WORKSPACE` is purely a restart side effect (fresh
  in-memory ProjectStore), not a separate bug — consistent with the scope note.
- timestamp: 2026-05-20
  finding: `node_modules/ts-lsp-client/build/esm/jsonRpcEndpoint.js` — the
  `readableByline` `'data'` handler does `JSON.parse(jsonRPCResponseOrRequest)`
  with NO try/catch (line 25). A malformed/partial payload from JDT LS throws
  synchronously inside the stream callback → uncaught → process exit.
- timestamp: 2026-05-20
  finding: jsonRpcEndpoint.js line 31 matches responses with
  `jsonRPCResponse.id === (this.nextId - 1)`. This only accepts the response to
  the MOST RECENT request. Any other response (line 36) triggers
  `this.emit('error', '[transform] Received id mismatch! ...')`. `JSONRPCEndpoint`
  extends `EventEmitter`; the MCP server attaches NO `'error'` listener (only
  `'language/status'` in client.ts:212). An EventEmitter that emits `'error'`
  with no listener THROWS — this crashes the MCP server process.
- timestamp: 2026-05-20
  finding: line 52 of the same file emits `'error'` again for any JSON-RPC
  message lacking both `id+result/error` and `method` — same unhandled-error
  crash path.
- timestamp: 2026-05-20
  finding: `jsonRpcTransform.js` calls `done(new Error(...))` on a bad
  Content-Length header (lines 42, 55). That surfaces as an `'error'` event on
  the transform stream `readableByline`; nothing listens → uncaught → crash.
- timestamp: 2026-05-20
  finding: Reproduction fit. The MCP host dispatches tool calls concurrently.
  `search_symbols` (`endpoint.send('workspace/symbol')`), `find_references`
  (`lspClient.references` inside `withLspDocument`), `find_implementations`,
  `type-hierarchy`, and batched `read_member` can each have an LSP request
  in-flight simultaneously. With two outstanding requests, `nextId` has already
  advanced, so the FIRST request's response no longer equals `nextId-1` →
  id-mismatch `emit('error')` → crash. This exactly matches "crashes correlated
  with batched/parallel read_member calls" and the intermittent nature of the
  single-call `search_symbols` repro (a slow `workspace/symbol` response
  overlapping a subsequent call).

## Eliminated

- timestamp: 2026-05-20
  ruled_out: "JDT LS child process itself dies and that is the root fault."
  why: `startup.ts:88` already handles `proc.on('exit')` gracefully (flips
  `available=false`, sets `failureReason`) — a JDT LS exit degrades navigation
  tools, it does NOT terminate the Node MCP server. The crash is on the Node
  side, in the unhandled `JSONRPCEndpoint`/stream error path.
- timestamp: 2026-05-20
  ruled_out: "Workspace eviction / a remove-project path emptying the store."
  why: symptom reports confirm no add/remove tool was called; `EMPTY_WORKSPACE`
  only ever appears AFTER a `Connection closed`, i.e. after a fresh process
  start. It is a restart consequence, explicitly out of scope.

## Resolution

- root_cause: The MCP server process crashes because `ts-lsp-client@1.1.1`'s
  `JSONRPCEndpoint` (a) only matches a response whose id equals `nextId-1`,
  emitting an unhandled EventEmitter `'error'` for every other response, and
  (b) runs `JSON.parse` with no try/catch — and the FabricModMCP server attaches
  no `'error'` listener and registers no `process.on('uncaughtException')` /
  `'unhandledRejection'` handler. As soon as two JDT LS-backed LSP requests are
  in flight at once (parallel tool calls / batched read_member, or a slow
  `workspace/symbol` overlapping the next call), an id-mismatch fires
  `emit('error')` on a listener-less EventEmitter, which throws and terminates
  the Node process — surfacing to the MCP host as `MCP error -32000: Connection
  closed`. The subsequent `EMPTY_WORKSPACE` is the restarted process booting a
  fresh empty ProjectStore.
- fix: Two-layer fix. (1) Root cause — new `src/jdtls/request-queue.ts`
  exports `hardenEndpoint`, called in `startJdtLs` immediately after the
  `JSONRPCEndpoint` is constructed. It wraps `endpoint.send` in a promise-chain
  mutex so at most ONE LSP request is ever outstanding; sequential requests keep
  the `response.id === nextId-1` invariant true, so the id-mismatch `emit('error')`
  can no longer fire. Because every `LspClient` request method delegates to
  `endpoint.send`, patching that single method serializes all JDT LS-backed
  tools (search_symbols, find_references, find_implementations, type_hierarchy,
  read_member). `endpoint.notify` is fire-and-forget and left untouched.
  `hardenEndpoint` also attaches an `'error'` listener so any stray emit is
  logged, not thrown. (2) Defense-in-depth — `src/index.ts` now registers
  `process.on('uncaughtException')` and `process.on('unhandledRejection')`
  handlers that log instead of exiting, covering the rarer transform-stream
  bad-header `'error'` path and any future regression.
- verification: `pnpm test` — 859 tests pass across 71 files (854 prior + 5 new
  regression tests in `tests/jdtls/request-queue.test.ts`). The serialization
  test proves the fix directly: with two concurrent `send()` calls, only request
  id 0 is written to the wire until its response arrives, so the id-mismatch
  `'error'` never fires; a 5-request stress test asserts zero `'error'` emits.
  `pnpm exec tsc --noEmit` is clean (only the pre-existing, unrelated `TS5101
  baseUrl` deprecation). The ESM server bundle (`pnpm build` → `dist/index.js`)
  builds successfully; the `--dts` step fails on the same pre-existing `baseUrl`
  deprecation, unrelated to this change.
- files_changed:
  - `src/jdtls/request-queue.ts` (new — `hardenEndpoint` request serializer + error listener)
  - `src/jdtls/client.ts` (call `hardenEndpoint` in `startJdtLs`)
  - `src/index.ts` (global `uncaughtException` / `unhandledRejection` crash guard)
  - `tests/jdtls/request-queue.test.ts` (new — 5 regression tests)
</content>
