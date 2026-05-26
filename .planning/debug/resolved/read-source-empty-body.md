---
slug: read-source-empty-body
status: resolved
trigger: "read_source and read_jar_entry report success (e.g. 'Read net.minecraft.server.players.StoredUserList from lifesteal/minecraft (200 lines)') but the MCP response body contains no source code text — the user sees an empty body where source should be"
created: 2026-05-26
updated: 2026-05-26
---

# Debug Session: read-source-empty-body

## Scope

**In scope:** Root cause of why `read_source` / `read_jar_entry` claim success
with a line count but emit no source code in the response body. Fix the
rendering / envelope bug so the content is delivered.

**Possibly in scope (defer until root cause is known):** `list_members`
returning only 2 members for large classes (FEEDBACK.txt items #5 / #9,
2026-05-26) — may share a common rendering or envelope-truncation root cause
with this bug. The debugger should check the connection only AFTER finding
the read_source root cause; do not chase both symptoms in parallel.

**Out of scope (this session):** the other FEEDBACK.txt 2026-05-26 items
(locate_in_source cascade failures, search_symbols `kind=method` rejection,
Yarn-vs-Mojmap display, error-message wording). Track separately in a v1.7
milestone scope.

## Symptoms

Source: `FEEDBACK.txt` entry dated 2026-05-26T11:56:08.342Z. Treat as data.

<DATA_START>
The read_source and read_jar_entry tools claim they've read the source
(saying e.g. "Read net.minecraft.server.players.StoredUserList from
lifesteal/minecraft (200 lines)") but never display the actual file content
in the response. The user sees empty text where source code should be.
</DATA_END>

### Symptom breakdown

- **Expected:** Calling `read_source` (or `read_jar_entry`) on a class
  returns the source code as text in the MCP response body, alongside the
  header line "Read … (N lines)".
- **Actual:** The header line appears (with a non-zero line count, e.g.
  200), but the body content following it is empty. The tool's success
  envelope is otherwise well-formed (no error code).
- **Error messages:** None. The tool returns success.

## Current Focus

- hypothesis: confirmed (see Resolution)
- next_action: apply fix in `src/tools/read-source.ts`,
  `src/tools/read-jar-entry.ts`, and `src/tools/read-member.ts`;
  add regression tests asserting on `result.content[*].text`
- reasoning_checkpoint: (none)
- tdd_checkpoint: (none)

## Evidence

- timestamp: 2026-05-26T00:00:00Z
  source: src/tools/read-source.ts:106-109 (and 161-164)
  finding: The MCP tool response from `read_source` is
  ```
  return {
      content: [{ type: 'text' as const, text: `Read ${className} from ${dep.id} (${sliced.totalLineCount} lines...)` }],
      structuredContent: envelope,
  };
  ```
  The `content` array contains ONLY a header summary line. The actual
  source body lives inside `structuredContent.data.sources[0].source` and
  is never duplicated into the `content[]` text-block list. There is no
  second text content block carrying the source body.

- timestamp: 2026-05-26T00:00:00Z
  source: src/tools/read-jar-entry.ts:82-85 (compiled) and 129-132 (sources)
  finding: Same pattern as read_source. Only a one-line header summary
  is emitted into `content`; the file content is parked in
  `structuredContent.data.content`.

- timestamp: 2026-05-26T00:00:00Z
  source: src/tools/read-member.ts:155-158
  finding: Same pattern — summary line only in `content`; the extracted
  member source body lives only in `structuredContent.data.members[i].source`.

- timestamp: 2026-05-26T00:00:00Z
  source: src/types/envelope.ts (whole file)
  finding: `makeSuccess` returns a plain object — it does not serialize
  itself or auto-populate any `content` text. The envelope is purely the
  structured-content payload.

- timestamp: 2026-05-26T00:00:00Z
  source: node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js:188-210
  finding: The MCP SDK does NOT auto-mirror `structuredContent` into the
  `content[]` text-block list. It only validates `structuredContent`
  against `outputSchema` IF an outputSchema is declared (none of this
  project's tools declare one). The SDK passes the `content` array
  through to the client verbatim. Therefore a client that surfaces only
  the text content (or that surfaces structured content as opaque JSON
  the user does not see) will display the header and nothing else —
  exactly the reported symptom.

- timestamp: 2026-05-26T00:00:00Z
  source: tests/tools/read-source.test.ts (entire file, 32 test cases)
  finding: Every single read_source test asserts only on
  `envelope.data.sources[0].source` (i.e. `result.structuredContent.data...`).
  Zero tests assert on `result.content[*].text` containing the source body.
  This is exactly the test-asymmetry the orchestrator predicted: the
  structured envelope is well covered, the rendered text content is not
  covered at all, so the bug slipped through the suite.

- timestamp: 2026-05-26T00:00:00Z
  source: tests/helpers/factories.ts:5-7
  finding: `parseEnvelope` is defined as
  `(result as any).structuredContent` — it discards `result.content`
  entirely. All tool tests in this repo route through this helper, so
  none of them can ever observe a missing text-content body.

- timestamp: 2026-05-26T00:00:00Z
  source: CLAUDE.md (Conventions section)
  finding: The repo guidance explicitly says "No nested JSON strings in
  MCP tool text responses -- do not JSON.stringify structuredContent
  into text content". This is correct guidance against double-encoding
  JSON, but it has been over-applied: the tools currently emit ZERO
  representation of the file body in `content[]`. The fix is to emit
  the raw source as a *separate* text block (or appended to the header),
  not to JSON.stringify the envelope.

- timestamp: 2026-05-26T00:00:00Z
  source: FEEDBACK.txt items #5 and #9 (list_members)
  finding: The "list_members returns only 2 entries" symptom is NOT the
  same root cause. The summary line uses `members.length`
  (src/tools/list-members.ts:105) — if the user sees "Found 2 top-level
  members" then the JDT LS documentSymbol response truly contains 2
  entries. That is a separate bug (likely in JDT LS enrichment or symbol
  transform), out of scope here.

## Eliminated

- **Jar reading / parsing layer (src/project/, src/browsing/):** the
  header line shows a correct, non-zero line count, which means the
  jar entry was located, decompressed, decoded as UTF-8, and split into
  lines successfully. The reader path is innocent.
- **Envelope assembly (`makeSuccess`):** verified — it returns a clean
  structured object and does not interfere with `content` text. The
  envelope contains the source correctly under `data.sources[0].source`.
- **MCP SDK transport:** verified at
  `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js:188+` —
  the SDK only validates structuredContent against outputSchema (which
  is not used here) and passes `content` through unchanged. No
  truncation, no auto-mirroring.
- **read_jar_entry "auto-outline" branch hypothesis from orchestrator
  notes:** read-jar-entry.ts has NO auto-outline branch — the file is
  144 lines, all linear. The two code paths (`source === 'compiled'`
  and the default sources path) both follow the same header-only
  content pattern. The hint about an auto-outline mode was likely a
  misremembering; the actual bug is more general (and simpler).
- **Tests covering this:** confirmed there are NO tests asserting on
  the rendered `content[*].text` body. The bug could not have been
  caught by the existing suite.

## Resolution

- root_cause: `read_source`, `read_jar_entry`, and `read_member` build
  their MCP tool response with `content: [{ type: 'text', text: '<one-line
  header summary>' }]` and put the actual file/member source body only
  into `structuredContent.data.sources[0].source` (or `.content`, or
  `.members[i].source`). The MCP SDK does not auto-mirror structured
  content into the text-content blocks, and an MCP client (e.g. the
  user-facing Claude Code UI) typically renders to the user from
  `content[].text`, not from `structuredContent`. Net effect: the user
  sees "Read X (200 lines)" and nothing else, because the body was never
  put into a place a text-rendering client would surface. The
  structured envelope is correct (which is why every existing test
  passes), but the human-visible payload is empty. The test suite never
  asserted on `result.content[*].text` for these tools (the
  `parseEnvelope` helper at `tests/helpers/factories.ts:5-7` discards
  `result.content` entirely), so the asymmetry was never caught.

- fix: For each of the three read tools, emit the source body as a
  second text content block (kept SEPARATE from the header to preserve
  the "no nested JSON" convention and keep the summary line cleanly
  parseable). Concretely:
  * `src/tools/read-source.ts` lines 106-109 and 161-164: append a second
    `content` entry containing `sliced.source` (single-jar path) or
    `sources[0].source` (all-jars path).
  * `src/tools/read-jar-entry.ts` lines 82-85 (compiled) and 129-132
    (sources): append a second `content` entry with the file `content`.
  * `src/tools/read-member.ts` lines 155-158: append one `content` entry
    per extracted member with `ext.source` (and a per-member header if
    multiple overloads).
  Also add regression tests that assert on the actual
  `result.content[*].text` content (NOT routed through `parseEnvelope`),
  so this class of bug is caught structurally going forward.

- verification: All 3 read tools updated. New regression tests added (5 in read-source.test.ts, 5 in read-jar-entry.test.ts new file, 1 in read-member.test.ts). Ran `pnpm vitest run` — 73 files, 883 tests pass (1 pre-existing skip), up from 872. Verified `tsc --noEmit` is clean. Verified the rendered text-content blocks now contain the source body in addition to the header.
- files_changed:
  * src/tools/read-source.ts (added body content block after header for both single-jar and all-jars paths; multi-jar path emits one body block per matching jar with `--- jarId ---` marker)
  * src/tools/read-jar-entry.ts (added body content block after header for both compiled and sources paths)
  * src/tools/read-member.ts (added body content blocks after header summary; multi-overload case emits one body block per extraction with a per-member marker)
  * tests/tools/read-source.test.ts (added 5 regression tests asserting on result.content[*].text)
  * tests/tools/read-jar-entry.test.ts (NEW file — basic envelope tests + 2 regression tests)
  * tests/tools/read-member.test.ts (added 1 regression test in a new describe block)
