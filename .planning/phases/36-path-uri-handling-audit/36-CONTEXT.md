# Phase 36: Path / URI Handling Audit - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Wholesale migration of every `'file://' + path` and `uri.replace('file://', '')` site to Node's `node:url` builtins (`pathToFileURL` / `fileURLToPath`); add ZIP path-traversal guard at the jar-entry → disk-path boundary; add Windows-only EBUSY/EPERM retry hardening to temp-dir cleanup. The `file://` URI is treated as a JDT LS translation-layer artifact only; the public tool API surface never accepts or emits `file://` URIs.

Sites in scope (grep-verified):
- 7 forward `'file://' + ...` constructions: `src/jdtls/client.ts:245,278`; `src/jdtls/workspace-sync.ts:103,141,206,255`; `src/tools/remove-project-member.ts:83`
- 1 reverse consumer in scope: `src/tools/tool-helpers.ts:350` (`uri.replace('file://', '')`). NOTE: `src/project/gradle-parser.ts:36` has a local `fileUriToPath` used 3× — it is **OUT OF SCOPE** (different semantics: two-slash `file://` form + `~/` home substitution; see "Claude's Discretion" below)
- Plus `src/jdtls/uri-mapper.ts` bespoke `toFileUri`/`fromFileUri` (lines 75–81) — JarEntry-URI domain, refactored to use the new shared helpers internally
- 2 ZIP extraction sites: `src/jdtls/workspace-sync.ts:40,184` — both add the split-and-spread `join(depDir, ...entryPath.split('/'))` pattern plus the post-resolution traversal check
- 4 `rm` sites: `src/jdtls/workspace-sync.ts:48,62,215,245` — all add `{ maxRetries: 3, retryDelay: 100 }`

Out of scope for this phase (deferred):
- UNC long-path conversion (`\\?\C:\…` prefix opt-in) — REQUIREMENTS.md "Out of Scope" already lists this
- Symlink resolution / canonical-path probing (no `fs.realpath`, no `GetFinalPathNameByHandle`)
- Behavioral changes to anything *outside* the 7 forward + 2 reverse + 2 extraction + 4 rm sites

</domain>

<decisions>
## Implementation Decisions

### URI Helper Architecture

- **D-01: New `src/platform/uri.ts` sibling module.** Two exported helpers — `pathToFileUri(absPath: string): string` and `fileUriToPath(uri: string): string` — wrap `node:url`'s `pathToFileURL(p).href` and `fileURLToPath(u)`. Lives next to `src/platform/index.ts` (the Phase 35 pure-helper module). `index.ts` retains its "no fs I/O, no child_process, no side effects" header — the new sibling is the home for cross-cutting URI conversion (and any future Windows URI quirks: drive-letter case fold, percent-encoding edge cases).
- **D-02: `src/jdtls/uri-mapper.ts` keeps its domain-specific `toFileUri`/`fromFileUri` methods.** They operate on jar-mapped URIs (a different domain from raw filesystem paths) and continue to live in the JDT LS layer. Internally, the new shared helpers MAY be used as building blocks where it simplifies code; the public method shape stays.
- **D-03: 7 forward + 1 reverse site swap to the new helpers in one sweep.** Forward sites use `pathToFileUri(absPath)`; reverse site (`tool-helpers.ts:350`) uses `fileUriToPath(uri)`. `gradle-parser.ts:36`'s local `fileUriToPath` is out of scope (see "Claude's Discretion" — divergent semantics).

### Tool API Path Domain (project-policy decision — affects everything downstream)

- **D-04: Tool API surface is Unix-shaped.** Every path that crosses the MCP tool boundary in either direction uses forward slashes:
  - Jar entry paths (always Unix — these come from ZIP central directories which use `/` per APPNOTE.TXT 4.4.17.1)
  - Jar identifiers (project-level IDs, already Unix-shaped)
- **D-05: Windows-native paths appear ONLY at the disk-location layer.** Specifically: jar file locations on disk, project directory locations on disk. These are the only path values where `\` separators, drive letters, UNC, DOS device paths, or Win32 file-namespace paths may surface.
- **D-06: Windows path forms the disk-location layer must accept** (in priority order of expected frequency):
  1. Drive letter — `C:\Users\foo\bar`
  2. UNC — `\\server07\share$\path`
  3. DOS device path (drive form) — `\\.\C:\path`
  4. DOS device path (volume GUID) — `\\.\Volume{b75e2c83-0000-0000-0000-602f00000000}\path`
  5. Win32 file namespace — `\\?\C:\path`, `\\?\UNC\server\share\path`
  Node's `path.win32` and `node:url`'s `pathToFileURL` are the canonical converters — we do not roll our own.
- **D-07: `file://` URIs are JDT-LS translation-layer artifacts only.** Tools never construct or consume `file://` URIs in their public API. The boundary where Windows-native paths become URIs is at the LSP send/receive layer inside `src/jdtls/*` and `src/tools/tool-helpers.ts:350` (LSP `Location.uri` consumer).

### Drive-Letter Case Insensitivity (`src/jdtls/uri-mapper.ts` `fromFileUri`)

- **D-08: Normalize-on-compare, surgically.** Inbound URIs may differ from outbound URIs only in the **single ASCII drive letter** before the `:`. Eclipse/EMF intentionally lowercases drive letters since EMF 2.9 (Eclipse Bug 446987) but the LSP-layer normalization is not contractually documented in JDT LS, so we treat the drive letter as case-insensitive on receive.
- **D-09: Only the drive letter is case-insensitive — everything else is byte-exact.** Specifically:
  - **Case-insensitive (Windows only):** the single ASCII letter at position 8 of `file:///<L>:` URIs
  - **Case-sensitive (always, on every form):** UNC server names, UNC share names, DOS device volume GUIDs, all path segments after the drive letter or authority, every byte of jar-entry path tails
  - **Rationale:** We cannot assume the filesystem (NTFS may be case-sensitive on Windows; ReFS is case-sensitive; mounted ext4 is case-sensitive). Treating anything other than the drive letter as case-insensitive risks colliding distinct files.
- **D-10: Semantic equivalence via string compare. No canonical-path probing.** Implementation MUST NOT call `fs.realpath`, `GetFinalPathNameByHandle`, or any symlink-resolving API. The compare is pure string: detect drive-letter URI form (`/^file:\/\/\/[A-Za-z]:/`); if matched, case-fold byte 8 on both sides only; otherwise byte-exact `startsWith`. UNC URIs, DOS device URIs, and Unix URIs all use byte-exact compare.
- **D-11: Non-drive-letter URI forms are byte-exact even on Windows.** UNC URIs (`file:////server/share/…` or `file://server/share/…`), DOS device URIs (`file:////./C:/…`, `file:////./Volume{…}/…`), and `\\?\` URIs (`file:////?/…`) compare byte-for-byte. If a user runs the server with `TMPDIR` set to any non-drive-letter form, the case-fold simply doesn't apply.

### ZIP Path-Traversal Rejection (`workspace-sync.ts:40,184`)

- **D-12: Post-resolution descendant check.** At each extraction site, after computing `targetPath = join(depDir, ...entryPath.split('/'))`, assert `resolve(targetPath).startsWith(resolve(depDir) + sep)` and throw if false. This single check catches the canonical `..` case, absolute-path entries (`/etc/x`, `C:\Windows`), `\`-separated traversal in entry names, and mixed-separator tricks — all variants collapse into one assertion.
- **D-13: Trailing-sep guard is mandatory.** Use `resolve(depDir) + path.sep`, not `resolve(depDir)`, to avoid the well-known partial-prefix bypass (`/tmp/foo` matching `/tmp/foobar`).
- **D-14: Throw on rejection.** The existing `try/catch` at `workspace-sync.ts:47` already calls `rm(depDir, { recursive: true, force: true })` on error — throwing the traversal error reuses that cleanup path and surfaces a clear failure to the user. No silent skip.
- **D-15: Log the rejected entry path at warn level.** Audit trail for malicious-jar incidents. Volume is bounded (one log line per malicious jar, fails fast on first bad entry).
- **D-16: Threat model recap.** The only attack vector is user-supplied study jars via `/add-study-jar`. Loom/Maven-supplied source jars are low-trust-but-not-adversarial; the same check applies to them, costing nothing in the common case.

### EBUSY/EPERM Retry (4 `rm` sites in `workspace-sync.ts`)

- **D-17: Native `fs.rm` options at each call site.** Pass `{ recursive: true, force: true, maxRetries: 3, retryDelay: 100 }` to all 4 `rm` calls at lines 48, 62, 215, 245. Node 22's `fs.rm` already retries on EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE natively when these options are set — exactly the class of transient Windows failures WIN-06 targets (AV scanners, Search Indexer, lingering handles).
- **D-18: Linear backoff is acceptable.** Node implements `retryDelay` as linear (100ms, 200ms, 300ms = 600ms total wait), not constant. ROADMAP's "3x100ms backoff" reads naturally as `{ maxRetries: 3, retryDelay: 100 }`; literal constant-delay was not the intent.
- **D-19: Always-on retry, no `isWindows` guard.** UNIX-01 is preserved trivially — when Unix `fs.rm` succeeds on the first attempt (the v1.5 behavior), the retry options are never consulted; behavior is observationally identical to v1.5. The source diff is smaller without a branch.
- **D-20: Final-failure handling stays with the existing catch sites.** No new central logger. The 4 sites already handle errors differently (some swallow, some rethrow); preserve that.

### Test Strategy

- **D-21: Reuse Phase 35's `setPlatform + vi.resetModules + dynamic import` pattern** for any Windows-mocked URI test. Already proven on `tests/jdtls/client.test.ts` and `tests/platform/index.test.ts`.
- **D-22: UNIX-02 round-trip identity** — assert `fileUriToPath(pathToFileUri(p)) === p` for representative inputs including `/private/var/folders/x y/file.java`, `/tmp/foo` (paths with spaces especially — `pathToFileURL` percent-encodes them).
- **D-23: Drive-letter case round-trip** — assert that `uri-mapper.fromFileUri` accepts both `file:///C:/...` and `file:///c:/...` when the stored `normalizedTempDir` is `C:\...`, while rejecting `file:///D:/...` (different drive). UNC URIs MUST NOT be case-folded — assert `file:////SERVER/share/...` does NOT match a stored prefix of `file:////server/share/...`.
- **D-24: Traversal rejection coverage** — assert rejection of (a) `../`, (b) absolute Unix path `/etc/passwd`, (c) absolute Windows path `C:\Windows\System32`, (d) `\`-separator traversal `..\..\etc\passwd`, (e) trailing-sep edge case (`/tmp/foo-attack` vs `/tmp/foo`).
- **D-25: Behavioral identity for Unix `pathToFileURL` output** — NOTE that `'file://' + path` is the two-slash form (path interpreted as host); `pathToFileURL(p).href` is the three-slash form (`file:///abs/path`). On-the-wire bytes WILL change for Unix paths. UNIX-02 is **round-trip** identity (`fileUriToPath(toUri(p)) === p`), not URI-string identity with v1.5.

### Claude's Discretion

- Wave splitting between plans (forward sweep vs reverse sweep vs ZIP+EBUSY hardening) — planner decides.
- Whether the new `src/platform/uri.ts` exposes additional convenience helpers (e.g., `isFileUri(uri: string): boolean`) — only add if a callsite needs it.
- ~~Whether `gradle-parser.ts`'s 3 in-file usages of its local `fileUriToPath` switch to the shared helper~~ — **RESOLVED during context-gathering**: keep the local function. Two semantic divergences make it incompatible with `fileURLToPath`:
  1. It strips `^file://` (two-slash, path-as-host form Gradle emits in `repositories { url 'file://~/.m2/repository' }`); `fileURLToPath` requires the three-slash `file:///abs/path` form.
  2. It performs `~/` → `homedir()` substitution; `fileURLToPath` does not.
  Document this in `36-RESEARCH.md` so the planner does NOT touch `gradle-parser.ts:36`. The `<reverse consumer>` count for Phase 36 is therefore 1 (only `tool-helpers.ts:350`), not 2.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & milestone scope
- `.planning/REQUIREMENTS.md` — WIN-03 / WIN-04 / WIN-05 / WIN-06 / WIN-07, UNIX-02, UNIX-03; "Out of Scope" section explicitly excludes UNC long-path conversion and registry probing for this phase
- `.planning/ROADMAP.md` §"Phase 36: Path / URI Handling Audit" — locked success criteria (pathToFileURL/fileURLToPath mandatory, split-and-spread `join(dir, ...entryPath.split('/'))` mandatory, post-resolution traversal check, `{ maxRetries: 3, retryDelay: 100 }` mandatory)

### Phase 35 carry-forward (foundation)
- `src/platform/index.ts` — exports `isWindows` (the platform-branch primitive Phase 36 imports). DO NOT modify; instead add a sibling `src/platform/uri.ts`.
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-RESEARCH.md` §"Architectural Responsibility Map" lines 51–54 (Phase 36's deferred items pinned here), §"Pattern 1: Platform-Branched Helper" (the file-header + named-const + helper-function pattern this phase reuses)
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-PATTERNS.md` — "Shared Patterns → Platform Mocking" + "Shared Patterns → Mocking a single named export of a node: built-in" (both used in Phase 36 tests)
- `tests/platform/index.test.ts` — `setPlatform + vi.resetModules + dynamic import` pattern; copy the shape into `tests/platform/uri.test.ts`

### Files this phase modifies (verified by grep 2026-05-15)
- `src/jdtls/client.ts` — forward sites at lines 245, 278
- `src/jdtls/workspace-sync.ts` — forward sites at lines 103, 141, 206, 252 (note: 252, not 255 as ROADMAP says — verify); ZIP extraction at lines 40 and 184; 4 `rm` sites at 48, 62, 215, 245
- `src/jdtls/uri-mapper.ts` — `toFileUri` at line 75–78, `fromFileUri` at line 80–onwards (drive-letter case-fold lives here)
- `src/tools/remove-project-member.ts` — forward site at line 83
- `src/tools/tool-helpers.ts` — reverse consumer at line 350 (`loc.uri.replace('file://', '')` → `fileUriToPath(loc.uri)`)
- ~~`src/project/gradle-parser.ts`~~ — **NOT MODIFIED**: local `fileUriToPath` at line 36 has divergent semantics (two-slash `file://` + `~/` substitution) and must stay

### Files this phase MUST NOT modify
- Phase 35's `src/platform/index.ts` (pure-no-I/O contract; new URI helpers live in sibling `src/platform/uri.ts`)
- Anything in `src/browsing/`, `src/project/` (except `gradle-parser.ts`), `src/state/`, `src/cli/`, `src/server.ts`, `src/index.ts` — out of scope for this audit

### External specs
- [RFC 8089 — The `file` URI Scheme](https://datatracker.ietf.org/doc/html/rfc8089) §2 (case-insensitive comparison is the implementation's job, not the transport's), §3 (UNC URI forms)
- [Node.js `node:url` docs — `pathToFileURL` / `fileURLToPath`](https://nodejs.org/api/url.html) — drive-letter behavior, percent-encoding rules, three-slash output form
- [Node.js `fs.rm` docs](https://nodejs.org/api/fs.html) — `maxRetries` / `retryDelay` semantics; retry covers EBUSY/EPERM/ENOTEMPTY/EMFILE/ENFILE
- [Eclipse Bug 446987 — EMF lowercases drive letters in URI.createURI](https://bugs.eclipse.org/bugs/show_bug.cgi?id=446987) — root cause of drive-letter case mismatch from JDT LS
- [VS Code issue #46172 — `Uri.file(x).fsPath` lowercases drive letter](https://github.com/microsoft/vscode/issues/46172) — additional precedent for the case-fold
- ZIP-slip canonical defenses (post-resolution descendant check): apache-commons-compress docs, sindresorhus/extract-zip, Sonar's path-traversal rule

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/platform/index.ts` `isWindows` const** — single import, branch-on-Windows primitive. Phase 36 imports this from `src/platform/uri.ts` and from `src/jdtls/uri-mapper.ts`. No new platform-detection logic.
- **Phase 35's `setPlatform + vi.resetModules + dynamic import` test pattern** — reproduce in `tests/platform/uri.test.ts` and any new Windows-mocked describes in `tests/jdtls/uri-mapper.test.ts`.
- **Existing `try/catch` shape at `workspace-sync.ts:47` and `:210`** — the rm-then-rethrow pattern is already in place; traversal-rejection errors flow through it unchanged. No new error infrastructure.
- **`vi.mock('node:fs')` pattern from Phase 35's `tests/jdtls/client.test.ts`** — copy-paste for any test asserting `fs.rm` was called with the retry options object.

### Established Patterns
- **Tab indentation, ESM with `.js` extensions, vitest + pnpm** — non-negotiable (CLAUDE.md).
- **Tools are thin wrappers; domain logic lives in `src/jdtls`, `src/browsing`, `src/project`** — the new URI helpers live in `src/platform/uri.ts` because they're cross-cutting (consumed by both jdtls/ and tools/), not in any one domain.
- **No nested JSON in MCP responses, structured envelope `{ ok, ... }`** — Phase 36 doesn't touch tool response shapes, but any new error message text shouldn't be JSON-stringified into a text content block.
- **`@$HOME/.claude/get-shit-done` workflow conventions** — atomic commits per task, SUMMARY.md per plan, byte-identical Unix preserved.

### Integration Points
- **LSP boundary (forward):** `src/jdtls/client.ts:245,278` and `src/jdtls/workspace-sync.ts:103,141,206,252` and `src/tools/remove-project-member.ts:83` — all construct LSP messages with `rootUri` / workspace-folder URIs / `DidChangeWatchedFiles` change URIs. These become `pathToFileUri(absPath)` calls.
- **LSP boundary (reverse):** `src/tools/tool-helpers.ts:350` — consumes `Location.uri` from JDT LS responses. Becomes `fileUriToPath(loc.uri)`.
- **JarEntry boundary:** `src/jdtls/uri-mapper.ts` — bidirectional jar-mapped URI ↔ (jarId, entryPath) mapping. The drive-letter case-fold lives here. The "rest" portion (jar-entry path tail) is always Unix-shaped per D-04.
- **Gradle boundary (out of scope):** `src/project/gradle-parser.ts:36` keeps its local `fileUriToPath`. Two-slash `file://` parsing + `~/` home substitution are Gradle-specific semantics that the shared `fileUriToPath` in `src/platform/uri.ts` (which wraps `fileURLToPath`, three-slash only, no home expansion) does not provide.

</code_context>

<specifics>
## Specific Ideas

- User's explicit statement: "everything inside the jar is addressed by unix path and windows paths are only used for the locations of jars on disk and locations of project directories on disk" — encoded as D-04 / D-05.
- User's explicit statement: "absolutely everything except the drive letter itself should be treated as completely case sensitive, you can't assume which file system they are using" — encoded as D-09.
- User's explicit statement: "there is no need to check for canonical path equivalence, only semantic equivalence (so by string is fine)" — encoded as D-10.
- User's Windows path-form enumeration (drive letter, UNC, DOS device drive form, DOS device volume GUID, `\\?\` Win32 file namespace) — encoded as D-06.

</specifics>

<deferred>
## Deferred Ideas

- **Long-path UNC opt-in (`\\?\` prefix conversion to bypass MAX_PATH)** — REQUIREMENTS.md already lists this as out-of-scope ("UNC `\\?\C:\…` long-path conversion — Node 22 opts in already; defer until empirically observed").
- **Canonical-path probing for symlink resolution** — explicitly rejected by user; no `fs.realpath`, no `GetFinalPathNameByHandle`. If a real-world bug demonstrates need, revisit in a future milestone.
- **`isFileUri(uri: string): boolean` convenience helper in `src/platform/uri.ts`** — add only if a callsite needs it during planning.
- **Behavioral identity on `pathToFileURL` two-slash → three-slash transition for non-LSP JDT LS surfaces** — none expected (JDT LS is the only consumer of these URIs), but flag in 36-RESEARCH.md so the researcher confirms no other code path inspects the URI string shape.

</deferred>

---

*Phase: 36-path-uri-handling-audit*
*Context gathered: 2026-05-15*
