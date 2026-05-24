# Phase 38: JDT LS Discovery on Windows - Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire `src/jdtls/client.ts` `findJdtLs()` to consume Phase 35's `jdtlsCandidateDirs()` so the existing JDT LS discovery works on Windows out-of-the-box, and replace the single `process.env.HOME ?? ''` site at `client.ts:63` with `os.homedir()`. The Windows candidate set (4 paths in fixed priority order) and the Unix candidate set (3 paths byte-identical to v1.5) are already built and tested by Phase 35 — Phase 38 only changes the consumer.

Locked by ROADMAP / REQUIREMENTS (not re-asked in discussion):
- Windows candidate paths and order: `%LOCALAPPDATA%\jdtls` → `%PROGRAMFILES%\jdtls` → `~\jdtls` → `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`
- Unix candidate paths (UNIX-01 byte-identical): `~/.local/share/jdtls` → `/usr/local/share/jdtls` → `~/jdtls`
- `JDTLS_HOME` env override continues to win when set
- `os.homedir()` replaces `process.env.HOME` (ROADMAP success criterion 2 enforces this via `grep -rn 'process.env.HOME' src/` returning no matches outside test fixtures)
- Improved "not found" error message lists candidate paths actually probed
- Test pattern reused from Phases 35/36/37: `setPlatform + vi.resetModules + dynamic import`

Out of scope (deferred to v1.7+ or already in REQUIREMENTS.md "Out of Scope"):
- `--jdtls-home` CLI flag (no entry in REQUIREMENTS.md; `JDTLS_HOME` env var is the only override)
- Auto-downloading or bundling JDT LS (REQUIREMENTS.md "Out of Scope")
- JDT LS version compatibility probing (no requirement)
- Probing VS Code's bundled JDT LS (REQUIREMENTS.md "Out of Scope")
- Reinit-on-add hook for degraded JDT LS sessions caused by missing JDT LS install (Phase 37 D-02 reinit is for Java-discovery failures only; a JDT LS install change between requests is not in the failure model for v1.6)

</domain>

<decisions>
## Implementation Decisions

### Probe depth (Area 1)

- **D-01: Each candidate must pass `existsSync(dir) && glob('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: dir, absolute: true }).length > 0`.** Both must be true for a candidate to be accepted. Eliminates the empty-dir shadow case (e.g., a stale empty `~/jdtls/` shadowing a valid `/usr/local/share/jdtls/`). Uses the `glob` runtime dep already imported in `client.ts:20` for `startJdtLs`. The glob is cheap on a populated jdtls/plugins/ dir (single-pattern, single-segment depth, sub-ms typical) and only runs for candidates whose dir actually exists.

### Error message format (Area 2)

- **D-02: Multi-line `failureReason` mirroring Phase 37 D-18.** When every candidate fails, synthesize:
  ```
  JDT LS not found. Tried:
    JDTLS_HOME: (not set)
    C:\Users\foo\AppData\Local\jdtls: directory does not exist
    C:\Program Files\jdtls: directory does not exist
    C:\Users\foo\jdtls: exists but no launcher jar in plugins/
    C:\Users\foo\AppData\Local\nvim-data\mason\packages\jdtls: directory does not exist
  Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.
  ```
  First line MUST start with `JDT LS not found.` — preserves any future test that uses `toContain('JDT LS not found')` and matches the existing terse-message prefix.
- **D-03: Skip-reason taxonomy.** Per-candidate outcomes the synthesizer must distinguish:
  1. `(not set)` — JDTLS_HOME slot only (no env var set)
  2. `directory does not exist` — `existsSync(dir) === false`
  3. `exists but no launcher jar in plugins/` — dir exists, glob returns zero matches
- **D-04: Slot-label conventions.** Per-candidate prefix in the multi-line message:
  - `JDTLS_HOME`: literal env-var name (when set: includes the resolved value; when unset: `(not set)`)
  - Candidate dirs from `jdtlsCandidateDirs()`: bare absolute path (no slot label — the path itself is the identifier)
- **D-05: Per-candidate reasons are also `logger.debug`-logged.** For `--verbose` audit trails. Format: `logger.debug('JDT LS candidate skipped', { candidate, reason })`. Volume bounded (4-7 candidates max).

### JDTLS_HOME validation depth (Area 3)

- **D-06: JDTLS_HOME validates with the same depth as candidates.** `existsSync(JDTLS_HOME) && glob('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: JDTLS_HOME, absolute: true }).length > 0` both must be true. Consistent behavior — no surprising "trust the user" downgrade where an explicit override is checked less strictly than discovered candidates.
- **D-07: JDTLS_HOME failure branches with distinct error messages (when JDTLS_HOME is the only attempt).** When JDTLS_HOME is set but invalid, return immediately with one of:
  - `JDTLS_HOME is set to "X" but the directory does not exist.` (dir-missing branch)
  - `JDTLS_HOME is set to "X" but no JDT LS launcher jar was found in plugins/.` (dir-present-but-empty branch)
  
  Do NOT fall through to candidate probing in either case — an explicit override that's wrong is a user-config bug to surface, not a silent fallback. This matches v1.5's existing dir-missing branch behavior.

### os.homedir() migration scope (Area 4)

- **D-08: Migration = one-line replacement at `src/jdtls/client.ts:63` + CI-grade regression gate.** Replace `const home = process.env.HOME ?? '';` with `const home = homedir();` (where `homedir` is already importable via `import { homedir } from 'node:os'`). Since `jdtlsCandidateDirs()` already owns the candidate enumeration and resolves `homedir()` itself, the post-refactor `findJdtLs()` won't even read `home` — but the line replacement is mandatory per the ROADMAP grep gate.
- **D-09: Add a vitest regression test that greps `src/` for `process\.env\.HOME` and fails on any match.** Direct enforcement of ROADMAP success criterion 2 (`grep -rn 'process.env.HOME' src/` returns no matches outside test fixtures). Place the test in `tests/jdtls/findJdtLs.test.ts` or a new `tests/no-process-env-home.test.ts` — planner's call. Uses `glob` or `fs.readdir` + simple string match, no subprocess. The test asserts on `src/` only — `tests/` fixtures and `node_modules/` are exempt.
- **D-10: Audit complete — no other home-adjacent env vars exist in `src/`.** Grep verified:
  - `process.env.LOCALAPPDATA` (2 sites in `src/platform/index.ts`) — intentional Windows env-var consumption with native fallback (`pathWin32.join(home, 'AppData', 'Local')`); NOT home-resolution; stays
  - `process.env.ProgramFiles` (2 sites in `src/platform/index.ts`) — intentional Windows env-var with `'C:\\Program Files'` fallback; NOT home-resolution; stays
  - `HOMEDRIVE` / `HOMEPATH` / `USERPROFILE` / `APPDATA` / `TMPDIR` / `TMP` / `TEMP`: **zero** uses
  - `homedir()` already used correctly in `src/platform/index.ts`, `src/project/dependency-discovery.ts`, `src/project/gradle-parser.ts`, `src/project/source-jar-finder.ts`, `src/project/loom-cache.ts`
  
  The "sweep" produced 1 fix + 1 regression test. No additional refactoring required.

### Claude's Discretion

- **Plan splitting.** Likely a single plan (5 functions worth of work — refactor `findJdtLs` body to consume `jdtlsCandidateDirs()`, replace HOME→homedir, compose multi-line error, write Windows-mocked tests, write grep regression test). Planner may split into 2 plans (refactor + tests) if waves help with parallel review.
- **Whether `findJdtLs` becomes async.** Currently sync (uses `existsSync` + `globSync`-equivalent). The Phase 38 probe (`existsSync` + `glob`) — `glob` from `glob` package returns a Promise by default; the sync variant is `import { globSync } from 'glob'`. Planner decides: keep `findJdtLs` sync via `globSync` (zero ripple to callers; `glob.globSync` exists in the same package) OR migrate `findJdtLs` to async (1-2 callsite changes in `src/index.ts` and `src/jdtls/startup.ts`). Default: **sync via `globSync`** — preserves the current call shape and matches `existsSync` siblings; the I/O is bounded (≤4 cheap globs).
- **Test-suite file naming.** Whether new tests live in `tests/jdtls/client.test.ts` (alongside existing Phase 35 Windows-mocked describes) or a dedicated `tests/jdtls/findJdtLs.test.ts`. Planner's call.
- **Whether the grep regression test lives at the project root or under `tests/`.** Default: `tests/no-process-env-home.test.ts`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & milestone scope
- `.planning/REQUIREMENTS.md` — WIN-02, UNIX-01, UNIX-03; "Out of Scope" section explicitly excludes auto-downloading JDT LS, probing VS Code's bundled JDT LS, custom URI schemes, registry probing
- `.planning/ROADMAP.md` §"Phase 38: JDT LS Discovery on Windows" — locked success criteria (4 Windows install locations in fixed order, grep gate for `process.env.HOME`, JDTLS_HOME continues working, improved error message lists probed candidates, Unix tests pass unchanged + new Windows-mocked tests)

### Phase 35 carry-forward (foundation)
- `src/platform/index.ts` `jdtlsCandidateDirs()` at lines 70–87 — returns the ordered candidate list per platform. Phase 38 consumes this list directly; do NOT duplicate the candidate enumeration in `findJdtLs`. The Windows branch uses `pathWin32.join` with `LOCALAPPDATA` / `ProgramFiles` fallbacks; the Unix branch uses `pathPosix.join` and returns v1.5 literals verbatim (UNIX-01).
- `src/platform/index.ts` `isWindows` const at line 28 — single-import branching primitive. Phase 38 doesn't need it directly (the platform branch lives inside `jdtlsCandidateDirs()`), but tests may need it for assertion ordering.
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-RESEARCH.md` §"Architectural Responsibility Map" — Phase 38's responsibility was pinned here as "wire `findJdtLs` to consume `jdtlsCandidateDirs()` and migrate HOME→`os.homedir()`"
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-PATTERNS.md` — "Platform Mocking" + "Mocking a single named export of a node: built-in" (test patterns reused here)
- `tests/platform/index.test.ts` — `setPlatform + vi.resetModules + dynamic import` pattern; the existing `jdtlsCandidateDirs()` Windows-mocked describes are the template for the new `findJdtLs` Windows tests

### Phase 37 carry-forward (failure-message precedent)
- `.planning/phases/37-smarter-java-discovery-cross-platform/37-CONTEXT.md` D-18 / D-19 / D-20 / D-21 / D-22 — the multi-line `failureReason` pattern that Phase 38 D-02 mirrors. Same first-line-MUST-start-with-known-prefix rule, same per-candidate `logger.debug` audit, same `tried: string[]` envelope shape (do NOT widen to `{candidate, reason}`).
- `src/jdtls/java-discovery.ts` — the Phase 37 implementation of the multi-line failure-message composer; Phase 38 follows the same structural pattern but for JDT LS, not Java.

### Files this phase modifies / creates
- `src/jdtls/client.ts` — `findJdtLs()` at lines 47–80 is the main rewrite target:
  - Replace `const commonLocations = [ … hardcoded literals … ]` at lines 63–68 with `const candidates = jdtlsCandidateDirs()` (import added)
  - Replace `process.env.HOME ?? ''` at line 63 — by virtue of consuming `jdtlsCandidateDirs()` instead of building the list inline, the `home` variable disappears entirely
  - Replace `for (const loc of commonLocations) { if (existsSync(loc)) { return ... } }` with the deeper probe (`existsSync + globSync('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: loc }).length > 0`)
  - Extend JDTLS_HOME validation to also check launcher jar (D-06 / D-07)
  - Compose the new multi-line `error` field per D-02 / D-03 / D-04 (note: the error lives on the `JdtLsNotFound` envelope shape — `{ jdtlsHome: null, error: string }`; field name stays `error`, just the content becomes multi-line)
- `src/jdtls/client.ts` — new imports: `import { homedir } from 'node:os'` (only if the regression test still wants it staged anywhere; otherwise unused once `jdtlsCandidateDirs()` is consumed); `import { globSync } from 'glob'` (sibling of the existing `import { glob }`); `import { jdtlsCandidateDirs } from '../platform/index.js'`
- `tests/jdtls/client.test.ts` OR new `tests/jdtls/findJdtLs.test.ts` — new describes:
  - Windows-mocked candidate ordering: `setPlatform('win32') + vi.resetModules + dynamic import + vi.mock('node:fs')` + assert `jdtlsCandidateDirs()` order is respected and the first candidate with both dir-exists and launcher-jar wins
  - Unix-mocked: existing Unix candidates still work (UNIX-01 byte-identical regression)
  - JDTLS_HOME branches: unset (falls through), set+missing (returns first error), set+empty (returns second error), set+valid (returns it)
  - Empty-dir shadow case: candidate at higher priority has dir but no launcher jar → skipped; lower-priority valid candidate wins
  - Multi-line error composition: every candidate fails → assert each line, including JDTLS_HOME line
- `tests/no-process-env-home.test.ts` (or co-located in another test file — planner's call) — greps `src/**/*.ts` and asserts no match for `/process\.env\.HOME\b/`. Test fixtures under `tests/` are exempt.

### Files this phase MUST NOT modify
- `src/platform/index.ts` (Phase 35's pure-no-I/O contract). All Phase 38 consumption logic lives in `src/jdtls/client.ts`.
- `src/platform/uri.ts` (Phase 36)
- `src/jdtls/java-discovery.ts`, `src/jdtls/uri-mapper.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/startup.ts`, `src/jdtls/request-queue.ts` (Phase 36/37 work — not touched here unless an unrelated call to `findJdtLs` changes; verify before editing)
- Anything in `src/browsing/`, `src/project/`, `src/tools/`, `src/state/`, `src/cli/`, `src/server.ts`, `src/index.ts` — out of scope

### External specs
- [Eclipse JDT LS install layout](https://github.com/eclipse-jdtls/eclipse.jdt.ls#download-or-build) — `plugins/org.eclipse.equinox.launcher_<version>.jar` is the canonical launcher inside any valid jdtls install (any milestone release, any platform)
- [Mason.nvim jdtls package layout](https://github.com/williamboman/mason.nvim) — installs to `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls\` on Windows; same launcher-jar structure as an upstream tarball install
- [Node.js `os.homedir()` docs](https://nodejs.org/api/os.html#oshomedir) — uses `USERPROFILE` on Windows (falls back to `homeDir` field of effective UID's password entry on Unix). NOT equivalent to `process.env.HOME` when HOME is unset; `homedir()` always returns a value, `process.env.HOME` may be `undefined`.
- [glob package — `globSync`](https://github.com/isaacs/node-glob#sync) — synchronous sibling of `glob`; same `{ cwd, absolute }` options. Sub-ms cost on a populated single-segment directory.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`jdtlsCandidateDirs()`** in `src/platform/index.ts:70` — returns the ordered candidate list per platform. Phase 38's primary consumer.
- **`existsSync`** in `src/jdtls/client.ts:19` — already imported. Stays.
- **`glob`** in `src/jdtls/client.ts:20` — already imported as the async `glob` function (used by `startJdtLs` at line 97 to find the launcher jar after `findJdtLs` returns). Phase 38 imports `globSync` from the same package (zero new runtime dep).
- **The "find launcher jar" glob pattern** — `'plugins/org.eclipse.equinox.launcher_*.jar'` already lives at `client.ts:97`. Phase 38 reuses the same pattern in `findJdtLs`'s probe (extract to a module-local const or duplicate; either is fine).
- **`JdtLsNotFound` envelope shape** at `client.ts:30–33` — `{ jdtlsHome: null; error: string }`. The `error` field is a free-text string. Phase 38 just makes it multi-line. No envelope changes.

### Established Patterns
- **Tab indentation, ESM with `.js` extensions, vitest + pnpm.** Non-negotiable.
- **`setPlatform + vi.resetModules + dynamic import` test pattern** — used by Phases 35/36/37; Phase 38 reuses without modification.
- **`vi.mock('node:fs')` + `vi.mock('glob')`** — for `existsSync` and `globSync` assertions in `findJdtLs` tests.
- **Multi-line `failureReason` first-line-prefix convention** — Phase 37 D-18 established `Java not found.` as the first-line lead-in for the Java failure path. Phase 38 mirrors with `JDT LS not found.`.
- **Layered architecture** — `src/platform/` is the pure data layer (no fs I/O); `src/jdtls/` is the JDT LS domain layer (does fs I/O against the data). Phase 38 stays within this layering: `jdtlsCandidateDirs()` is consumed pure-data; `existsSync`/`globSync` are domain-layer concerns.

### Integration Points
- **Startup spawn:** `src/index.ts` (line where `findJdtLs()` is called — verify before editing) consumes `{ jdtlsHome, error? }`. If `findJdtLs` stays sync (recommended), zero callsite changes. If it becomes async, the call becomes `await findJdtLs()`.
- **JDT LS launch:** `startJdtLs(javaPath, jdtlsHome, workspaceDir)` at `client.ts:88` does its own launcher-jar glob at line 97 — that glob is redundant after Phase 38's deeper probe in `findJdtLs`, but is cheap and serves as a defense-in-depth check; planner may leave it or delete it.
- **Diagnostics path:** `JdtLsNotFound.error` flows into MCP tool error responses (e.g., when JDT LS isn't found at server startup, the resulting error string surfaces in tool-call failures that depend on JDT LS). The multi-line message will render in stdio JSON-RPC payloads; verify no consumer is splitting on `\n` in a way that breaks.
- **CLI override:** no new flag in Phase 38 (out of scope; `JDTLS_HOME` env var stays as the only override path). `--java-home` analogous flag is intentionally not added.

</code_context>

<specifics>
## Specific Ideas

- Probe depth must catch the empty-dir shadow case (e.g., an empty `~/jdtls/` shadowing `/usr/local/share/jdtls/`). Both `existsSync` AND launcher-jar glob must pass.
- Error message follows Phase 37 D-18's multi-line "Tried: ..." convention. First line `JDT LS not found.` keeps test-prefix compatibility.
- JDTLS_HOME validation is NOT a "trust the user" path — same depth as candidates. An explicit override that points to an empty dir errors clearly instead of falling through.
- `os.homedir()` migration is gated by a vitest regression test that greps `src/` — directly enforcing the ROADMAP grep criterion in CI.

</specifics>

<deferred>
## Deferred Ideas

- **`--jdtls-home` CLI flag** — no entry in REQUIREMENTS.md. If users frequently want CLI-level override beyond the `JDTLS_HOME` env var, revisit in v1.7. The env var is already the documented convention.
- **JDT LS version compatibility probing** — no current requirement for "this milestone of jdtls is too old/new"; users responsible for installing a version compatible with FabricModMCP. v1.7+ if needed.
- **Auto-download / bundle JDT LS** — REQUIREMENTS.md "Out of Scope" (~150MB, GPL/EPL redistribution, blocks MCP handshake, no progress UX over stdio).
- **Probing VS Code's bundled JDT LS** — REQUIREMENTS.md "Out of Scope" (patched and not guaranteed upstream-compatible).
- **Reinit on JDT LS install change between requests** — Phase 37 D-02's reinit hook is for Java-discovery degraded sessions, not JDT LS install changes. A user installing JDT LS mid-session and expecting hot-reload is not in scope for v1.6.

</deferred>

---

*Phase: 38-jdt-ls-discovery-on-windows*
*Context gathered: 2026-05-24*
