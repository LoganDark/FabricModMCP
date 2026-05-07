---
phase: quick-260507-nff
plan: 01
subsystem: tools
tags: [mcp, feedback, append-only, paths, env-override]

# Dependency graph
requires: []
provides:
  - record_feedback MCP tool that appends to FEEDBACK.txt at server install root
  - getProjectRoot() / getFeedbackPath() in src/state/paths.ts (server-relative path resolution)
  - PARAMS.feedbackMessage shared Zod schema
  - FEEDBACK_PATH env override for read-only deployments and tests
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-relative file paths via walk-up from import.meta.url for package.json"
    - "Append-only logs as first-class MCP tool surface"
    - "Env-var override for filesystem paths (testability + deployment flexibility)"

key-files:
  created:
    - src/state/paths.ts
    - src/tools/record-feedback.ts
    - tests/tools/record-feedback.test.ts
  modified:
    - src/tools/descriptions.ts
    - src/tools/index.ts

key-decisions:
  - "FEEDBACK.txt lives at the FabricModMCP install root, not under the downstream cwd or XDG dir — feedback is *about this server* and should ship with it"
  - "Resolve install root by walking up from import.meta.url for package.json (works under tsx, tsup bundle, pnpm start)"
  - "Cache resolved root after first call (one filesystem walk per process)"
  - "Append-only via fs.appendFile (never read-modify-write — concurrent calls cannot clobber)"
  - "FEEDBACK_PATH env override returns the path verbatim with no resolve/validation (matches lldb-mcp; tests rely on this exact behavior)"
  - "Body trims only trailing whitespace via /\\s+$/u — leading whitespace and intra-message blank lines preserved verbatim"
  - "FEEDBACK.txt is NOT in .gitignore so accumulated entries are committable / visible to maintainers"

patterns-established:
  - "Server-install-root resolution: src/state/paths.ts is the canonical place for any future file that must live next to the server (not the downstream project)"
  - "Tool descriptions stay in src/tools/descriptions.ts (TOOL_DESCRIPTIONS), shared params in PARAMS — record_feedback follows the established pattern with no helper-text bloat"

requirements-completed:
  - QUICK-NFF-01

# Metrics
duration: ~10min
completed: 2026-05-07
---

# Quick 260507-nff: Add record_feedback Tool Summary

**Append-only `record_feedback` MCP tool writes timestamped, cwd-stamped feedback blocks to `FEEDBACK.txt` at the FabricModMCP install root — independent of the downstream Fabric project's cwd.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- New `record_feedback` MCP tool: appends `[<iso>] cwd=<cwd>\n<body>\n\n` to FEEDBACK.txt
- Server-install-root resolution that survives a foreign cwd (verified manually from `/tmp`)
- Six-test vitest coverage through the in-memory MCP client harness — single call, multi-call, sentinel preservation, multi-line body, empty rejection, env override
- Maintainer-visible FEEDBACK.txt: not gitignored, lives at repo root once written

## Task Commits

1. **Task 1: Path resolution + handler + descriptions** — `4dcf0ff` (feat)
2. **Task 2: End-to-end record_feedback tests** — `057e0cb` (test)

## Files Created/Modified

- `src/state/paths.ts` — `getProjectRoot()` walks up from `import.meta.url` for `package.json`; `getFeedbackPath()` honors `FEEDBACK_PATH` env, else `<root>/FEEDBACK.txt`
- `src/tools/record-feedback.ts` — exports `formatEntry` (testable, pure) and `registerRecordFeedbackTool`; uses `makeSuccess` envelope per project conventions (no `JSON.stringify` into text content)
- `src/tools/descriptions.ts` — added `PARAMS.feedbackMessage` (Zod `string().min(1)`) and `TOOL_DESCRIPTIONS.record_feedback`
- `src/tools/index.ts` — registers `registerRecordFeedbackTool(server)` under a new `// Feedback` section
- `tests/tools/record-feedback.test.ts` — vitest cases via `createTestPair()` in-memory MCP harness

## On-disk Format

Each entry is a single block:

```
[2026-05-07T16:57:44.000Z] cwd=/Users/LoganDark/Documents/Projects/some-fabric-mod
the verbatim message body, trailing whitespace stripped

```

- Header: `[<ISO>] cwd=<absolute cwd>`
- Body: verbatim with `/\s+$/u` stripped
- Separator: `\n\n` (block always ends with one blank line)
- Append-only — `fs.appendFile`, never read-modify-write

## Install-root Strategy

`getProjectRoot()` walks up from `dirname(fileURLToPath(import.meta.url))` until it finds a `package.json`. The result is cached. This works under all launch modes:

- `pnpm start` (tsx) — module path is `<root>/src/state/paths.ts`, walks up one level
- `tsup` production bundle — module path is `<root>/dist/...`, walks up similarly
- direct invocation from any cwd (verified: from `/tmp`, returns `<FabricModMCP>/FEEDBACK.txt`)

Throws if no `package.json` is found (defensive — should never trigger in practice).

## Env Override

`FEEDBACK_PATH` env var, when set and non-empty, is returned **verbatim** with no `path.resolve()` or validation. Two purposes:

1. **Tests:** every test sets `process.env.FEEDBACK_PATH` to a `mkdtempSync` path so isolated tmp dirs are used and the real `<root>/FEEDBACK.txt` is never touched.
2. **Deployments:** lets operators redirect feedback to a writable location if the install dir is read-only.

## Gitignore Status

`FEEDBACK.txt` is **NOT** in `.gitignore` (verified). This is intentional — accumulated feedback should be visible to and committable by the maintainer.

## Decisions Made

See `key-decisions` frontmatter. Headline ones:

- **Storage location:** install root, not cwd, not XDG. Feedback is *about the server*, lives with the server.
- **Append-only via fs.appendFile:** atomic, concurrent-call-safe, no risk of clobbering existing entries.
- **Tool excluded from numbered Workflow list in SERVER_INSTRUCTIONS:** `record_feedback` is meta — not part of the mod-development workflow. The TOOL_DESCRIPTIONS entry is sufficient for discoverability.

## Deviations from Plan

None — plan executed exactly as written. Two minor implementation refinements within plan latitude:

- Exported `formatEntry` from `record-feedback.ts` as the plan permitted (Task 2 fallback option), keeping it pure for direct unit-testing if ever desired. Tests didn't end up needing it because Approach A (the in-memory MCP client harness `createTestPair()` from `tests/helpers/client.ts`) was available.
- Sixth test (`FEEDBACK_PATH env override`) was added per Test 6 in the plan's `<behavior>` block — the plan listed six tests; lldb-mcp's reference test file had five. The override behavior is critical enough (every other test depends on it not leaking into real FEEDBACK.txt) to assert directly.

## Divergences from lldb-mcp's Design

Two intentional FabricModMCP-conventional adaptations (called out in plan):

1. **Envelope:** `makeSuccess(data, metadata)` with `{ content, structuredContent }` return — not `returnSuccess` helper. Matches `src/tools/echo.ts:42-46`.
2. **Description naming:** `title: 'Record Feedback'` inline string literal; no `TOOL_TITLES` / `SUMMARIES` objects (FabricModMCP doesn't have them).

Everything else — `getProjectRoot()`/`getFeedbackPath()`, `formatEntry()` body, file format, env override semantics, append-only contract — ports verbatim from lldb-mcp.

## Issues Encountered

None.

## Verification

- `pnpm exec tsc --noEmit` — clean
- `pnpm exec vitest run record-feedback` — 6/6 pass
- Full suite (`pnpm test`) — 756/756 pass, no regressions
- Manual smoke from `/tmp`: `getFeedbackPath()` → `/Users/LoganDark/Documents/Projects/FabricModMCP/FEEDBACK.txt` (correct — install root, not cwd)
- `.gitignore` does not contain `FEEDBACK` (verified)

## Self-Check: PASSED

- src/state/paths.ts: FOUND
- src/tools/record-feedback.ts: FOUND
- tests/tools/record-feedback.test.ts: FOUND
- src/tools/descriptions.ts: FOUND (modified)
- src/tools/index.ts: FOUND (modified)
- Commit 4dcf0ff: FOUND
- Commit 057e0cb: FOUND

---
*Quick task: 260507-nff-add-record-feedback-tool-inspired-by-lld*
*Completed: 2026-05-07*
