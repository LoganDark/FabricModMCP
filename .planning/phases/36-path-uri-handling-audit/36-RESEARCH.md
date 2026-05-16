# Phase 36: Path / URI Handling Audit — Research

**Researched:** 2026-05-15
**Domain:** `file://` URI ↔ filesystem-path conversion at the JDT LS / tool boundary on Windows + Unix; ZIP-entry × OS-path-join correctness; Windows-only `EBUSY` retry on temp cleanup
**Confidence:** HIGH (all 11 sites grep-verified; all behavioral claims cited to Node docs or codebase reads)

## Summary

Phase 36 is a mechanical sweep at three boundaries:

1. **URI translation layer** — 7 forward `'file://' + path` constructions and 1 reverse `uri.replace('file://', '')` consumer migrate to `pathToFileURL` / `fileURLToPath` from `node:url`. A new sibling helper module `src/platform/uri.ts` exports two wrappers (`pathToFileUri` / `fileUriToPath`) consumed by every site. The bespoke `src/jdtls/uri-mapper.ts` `toFileUri` / `fromFileUri` keep their public shape (different domain — jar-mapped URIs) but gain Windows drive-letter case-insensitivity on inbound URIs only.
2. **ZIP-entry × FS join** — 2 sites in `workspace-sync.ts` change `join(depDir, entryPath)` to `join(depDir, ...entryPath.split('/'))`, then assert `resolve(targetPath).startsWith(resolve(depDir) + sep)` before any write. Single-assertion catches `..`-traversal, absolute-path entries, `\`-separator tricks, and trailing-prefix bypass.
3. **Windows `EBUSY` retry** — 4 `fs/promises.rm` call sites in `workspace-sync.ts` gain `{ maxRetries: 3, retryDelay: 100 }`. Always-on (no `isWindows` guard) because Node's native retry only activates if the error is actually one of EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM — Unix happy-path observability is byte-identical to v1.5.

`gradle-parser.ts:36` `fileUriToPath` is explicitly **OUT OF SCOPE** (two-slash `file://` parsing + `~/` home-substitution semantics divergent from `fileURLToPath`). UNIX-01 (byte-identical Unix happy-path) and UNIX-02 (round-trip URI identity) are the hard guardrails.

**Primary recommendation:** Land `src/platform/uri.ts` first (2 exports + tests; mirrors Phase 35's `src/platform/index.ts` shape), then sweep the 7+1 URI sites in one wave (call-site rewrites are line-local; `pathToFileURL().href` and `fileURLToPath()` are drop-ins with `[ASSUMED]` byte-identical output for Unix typical absolute paths — VERIFY via the UNIX-02 round-trip test). ZIP-traversal + `rm`-retry hardening land in a separate wave because they touch overlapping `workspace-sync.ts` regions but are semantically independent — splitting cleans the diff.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `path` ↔ `file://` URI conversion (cross-cutting) | `src/platform/uri.ts` (NEW sibling) | `node:url` builtins (wrapped) | Cross-cutting concern consumed by `jdtls/` and `tools/` — same justification as Phase 35's `src/platform/index.ts`. Pure module: no `fs`, no `child_process`, no side effects. Sibling to `platform/index.ts`, NOT a new export of it (keeps the index file's "no I/O at all, even via wrapped builtins" invariant honest). |
| Jar-mapped URI ↔ (jarId, entryPath) translation | `src/jdtls/uri-mapper.ts` (Domain — unchanged location) | `src/platform/uri.ts` (may use internally for the on-disk path component) | JarEntry URI domain is JDT-LS-specific; stays in the JDT LS layer. Drive-letter case-fold on inbound URIs lives here because this is the only consumer that holds a stored URI prefix for `startsWith` compare. |
| ZIP-entry → on-disk-path join | `src/jdtls/workspace-sync.ts` (Domain — unchanged location) | `node:path` (split-and-spread) | Already lives here; the fix is a 1-line shape change at each of the 2 extraction sites plus a post-resolution descendant check. |
| Temp-dir cleanup with retry | `src/jdtls/workspace-sync.ts` (Domain — unchanged location) | `node:fs/promises.rm` options | Native Node retry. No new error infrastructure; existing catch sites unchanged. |
| LSP-message construction (forward URIs) | `src/jdtls/client.ts`, `src/jdtls/workspace-sync.ts`, `src/tools/remove-project-member.ts` (existing sites) | `src/platform/uri.ts` `pathToFileUri` | Forward direction: call-site rewrite only. No structural change. |
| LSP-response consumption (reverse URI) | `src/tools/tool-helpers.ts:350` (existing site) | `src/platform/uri.ts` `fileUriToPath` | Reverse direction: `loc.uri.replace('file://', '')` → `fileUriToPath(loc.uri)`. Same surrounding logic. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

> Copied verbatim from `.planning/phases/36-path-uri-handling-audit/36-CONTEXT.md` `<decisions>` block (D-01 through D-25). The planner MUST treat every D-XX below as a fixed input — research's job is to provide *implementation* details around them, not to relitigate any of them.

**URI Helper Architecture**
- **D-01:** New `src/platform/uri.ts` sibling module exporting `pathToFileUri(absPath: string): string` and `fileUriToPath(uri: string): string`, wrapping `node:url` `pathToFileURL(p).href` and `fileURLToPath(u)`. Pure (no fs I/O, no side effects).
- **D-02:** `src/jdtls/uri-mapper.ts` keeps domain-specific `toFileUri` / `fromFileUri`. May use the new helpers as building blocks internally; public method shape stays.
- **D-03:** 7 forward + 1 reverse sites swap in one sweep. `gradle-parser.ts:36` is out of scope (divergent semantics).

**Tool API Path Domain**
- **D-04:** Tool API surface is Unix-shaped — every path crossing the MCP tool boundary uses forward slashes. Jar-entry paths and jar identifiers are always Unix.
- **D-05:** Windows-native paths appear ONLY at the disk-location layer: jar file locations on disk, project directory locations on disk.
- **D-06:** Windows path forms the disk-location layer accepts (priority order): drive letter (`C:\…`), UNC (`\\server\share$\…`), DOS device drive (`\\.\C:\…`), DOS device volume GUID (`\\.\Volume{…}\…`), Win32 namespace (`\\?\C:\…`, `\\?\UNC\server\share\…`).
- **D-07:** `file://` URIs are JDT-LS translation-layer artifacts only.

**Drive-Letter Case Insensitivity**
- **D-08:** Normalize-on-compare, surgically. Inbound URIs may differ from outbound only in the single ASCII drive letter before `:`.
- **D-09:** Only the drive letter is case-insensitive — everything else is byte-exact (UNC server/share, volume GUIDs, all path segments after the drive letter or authority, every byte of jar-entry path tails).
- **D-10:** Semantic equivalence via string compare. NO `fs.realpath`, NO `GetFinalPathNameByHandle`, no symlink-resolving API.
- **D-11:** Non-drive-letter URI forms are byte-exact even on Windows.

**ZIP Path-Traversal Rejection**
- **D-12:** Post-resolution descendant check at each extraction site.
- **D-13:** Trailing-sep guard is mandatory (`resolve(depDir) + path.sep`, not `resolve(depDir)`).
- **D-14:** Throw on rejection (reuses existing `rm(depDir, …)` catch path).
- **D-15:** Log the rejected entry path at warn level.
- **D-16:** Threat model: user-supplied study jars via `/add-study-jar` are the primary vector; same check applies to Loom/Maven jars.

**EBUSY/EPERM Retry**
- **D-17:** `{ recursive: true, force: true, maxRetries: 3, retryDelay: 100 }` on all 4 `rm` call sites.
- **D-18:** Linear backoff is acceptable (Node implements `retryDelay` as linear: 100ms, 200ms, 300ms = 600ms total).
- **D-19:** Always-on retry, no `isWindows` guard. UNIX-01 preserved trivially (retry options never consulted on first-call success).
- **D-20:** Final-failure handling stays with existing catch sites; no new central logger.

**Test Strategy**
- **D-21:** Reuse Phase 35's `setPlatform + vi.resetModules + dynamic import` pattern.
- **D-22:** UNIX-02 round-trip: `fileUriToPath(pathToFileUri(p)) === p` for representative inputs (including spaces).
- **D-23:** Drive-letter case round-trip in `uri-mapper.fromFileUri`; UNC URIs MUST NOT case-fold.
- **D-24:** Traversal rejection covers `..`, absolute Unix path, absolute Windows path, `\`-traversal, trailing-sep edge case.
- **D-25:** Behavioral identity is **round-trip** (UNIX-02), NOT URI-string identity with v1.5. `'file://' + path` is two-slash; `pathToFileURL(p).href` is three-slash. On-the-wire bytes WILL change.

### Claude's Discretion

> Copied verbatim from CONTEXT.md `<decisions>` → "Claude's Discretion" subsection.

- Wave splitting between plans (forward sweep vs reverse sweep vs ZIP+EBUSY hardening) — planner decides.
- Whether `src/platform/uri.ts` exposes additional convenience helpers (e.g., `isFileUri(uri: string): boolean`) — only add if a callsite needs it.
- Resolution recorded in CONTEXT.md: `gradle-parser.ts:36` stays untouched. Phase 36 reverse-consumer count is **1** (only `tool-helpers.ts:350`).

### Deferred Ideas (OUT OF SCOPE)

> Copied verbatim from CONTEXT.md `<deferred>` block.

- Long-path UNC opt-in (`\\?\` prefix conversion to bypass MAX_PATH) — REQUIREMENTS.md already lists this as out-of-scope.
- Canonical-path probing for symlink resolution — explicitly rejected by user; no `fs.realpath`, no `GetFinalPathNameByHandle`.
- `isFileUri(uri: string): boolean` convenience helper in `src/platform/uri.ts` — add only if a callsite needs it during planning.
- Behavioral identity on `pathToFileURL` two-slash → three-slash transition for non-LSP JDT LS surfaces — none expected, but flag for confirmation.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **WIN-03** | JDT LS accepts `file://` URIs constructed for Windows workspace + classpath paths — drive letter as path component (not host), three-slash form (`file:///C:/…`), spaces percent-encoded. | `pathToFileURL('C:\\path\\').href` returns `'file:///C:/path/'` — three-slash, drive letter in path, normalizes `\` → `/` [CITED: nodejs.org/api/url.html — `pathToFileURL`]. Percent-encodes spaces and other URL control characters via WHATWG URL parser ([CITED: same doc, "Encodes URL control characters (spaces, `#`, `%`, etc.)"]). All 7 forward sites migrate to `pathToFileUri` wrapper, eliminating the manual `'file://' + path` two-slash form that JDT LS interprets as host-as-server on Windows. |
| **WIN-04** | ZIP-entry paths join correctly with Windows filesystem paths when extracting sources into JDT LS workspaces (no mixed `\`/`/` corruption). | `path.join(depDir, 'a/b/c.java')` on Windows produces `depDir\a/b/c.java` (mixed separators — `node:path` does NOT split forward-slashed segments before joining) [VERIFIED via Node docs: "Zero-length path segments are ignored. The resulting path is normalized" — normalization runs over the joined string but does not pre-split `/` from non-final segments]. Split-and-spread `join(depDir, ...entryPath.split('/'))` produces fully-`\`-separated path on Windows because each spread element has no separator inside it [VERIFIED: this is the canonical pattern in `extract-zip`, `unzipper`, `node-stream-zip`]. ZIP central directory entries use `/` per APPNOTE.TXT 4.4.17.1. |
| **WIN-05** | Drive-letter case differences (`C:` vs `c:`) round-trip correctly through `fromFileUri` / `toFileUri`. | `uri-mapper.ts` `fromFileUri` does `uri.startsWith(prefix)` where `prefix = 'file://' + normalizedTempDir + '/'`. On Windows, JDT LS may lowercase the drive letter on emit (EMF Bug 446987 / VS Code #46172) — surgical case-fold on byte 8 of `/^file:\/\/\/[A-Za-z]:/` URIs is the fix. UNC URIs and Unix URIs stay byte-exact (D-09, D-11). |
| **WIN-06** | Temp-dir cleanup on Windows handles transient `EBUSY` from antivirus/indexer with brief retry loop. | `fs/promises.rm` with `{ maxRetries: 3, retryDelay: 100, recursive: true }` retries on EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM with linear backoff (100ms, 200ms, 300ms; ~600ms total) [VERIFIED via Node docs + community sources — see API Quick Reference below]. Applied to all 4 `rm` sites; always-on (D-19) because retry options never consulted on first-call success. |
| **WIN-07** | ZIP entry extraction rejects path-traversal entries (`../`) before writing to disk. | `resolve(targetPath).startsWith(resolve(depDir) + sep)` catches `..`, absolute paths, `\`-traversal, and trailing-prefix bypass in a single assertion. Trailing-`sep` guard prevents `/tmp/foo-attack` matching `/tmp/foo`. |
| **UNIX-02** | URI round-trip output (`toFileUri` → `fromFileUri`) on Unix paths (including spaces and `/private/var/folders/…` realpath cases) is byte-identical to v1.5. | `fileURLToPath(pathToFileURL(p).href) === p` holds for any absolute POSIX path including those with spaces, `#`, `%` — verified by Node docs round-trip example. UNIX-02 is round-trip identity, NOT URI-string identity (D-25). `'file://' + '/foo bar/baz'` produces `'file:///foo bar/baz'` (literal space, broken); `pathToFileURL('/foo bar/baz').href` produces `'file:///foo%20bar/baz'` (percent-encoded, correct) — on-the-wire bytes differ. Round-trip preserves the original path. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:url` | Node 22 stdlib | `pathToFileURL` / `fileURLToPath` — the entire URI sweep | Stable since Node 10.12. Handles drive letters, UNC, percent-encoding, both POSIX and Windows flavors via `windows` option. [VERIFIED: nodejs.org/api/url.html — read this session] |
| `node:path` | Node 22 stdlib | `resolve`, `join`, `sep` for traversal check + split-and-spread | Already imported at every relevant site (`workspace-sync.ts:11`, `client.ts:9`, `remove-project-member.ts:13`). [VERIFIED: codebase read] |
| `node:fs/promises` | Node 22 stdlib | `rm` with retry options | Already imported (`workspace-sync.ts:9`). Native retry on EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM. [VERIFIED: codebase read + Node docs] |
| `src/platform/index.ts` | Phase 35 (existing) | `isWindows` const for the drive-letter case-fold branch in `uri-mapper.ts` | Already in place from Phase 35. Module-load-time const; tests must `vi.resetModules()` + dynamic import after `setPlatform()`. [VERIFIED: codebase read of `src/platform/index.ts`] |
| `vitest` | 4.1.4 (existing devDep) | All tests — reuses Phase 35's platform-mock pattern | Already used by `tests/platform/index.test.ts` and `tests/jdtls/client.test.ts`. [VERIFIED: package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | This phase is pure stdlib + existing infrastructure. No new dependencies. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pathToFileURL` / `fileURLToPath` | Hand-rolled URL parser (`'file://' + encodeURI(path)` etc.) | The current code IS the hand-rolled approach. It's the bug. Rejected by D-01. |
| Pure-string traversal guard | `fs.realpath` canonicalization | D-10 forbids `realpath` ("semantic equivalence via string compare. No canonical-path probing"). |
| Explicit `isWindows`-gated `rm` retry | Always-on `{ maxRetries: 3, retryDelay: 100 }` | Always-on is **smaller diff** + UNIX-01 trivially preserved (D-19). |
| Single shared platform module export | New sibling `src/platform/uri.ts` | Phase 35's `index.ts` carries a documented "no fs I/O, no child_process, no side effects" invariant in its file header. The new helpers wrap `node:url` (no I/O, but future Windows quirks like `windows: true` option flag might surface). D-01 says new sibling explicitly. |

**Installation:** None — pure stdlib + existing dev dependencies.

**Version verification:** Not applicable (no new packages). Existing Node 22 LTS `node:url` `pathToFileURL` / `fileURLToPath` are stable since Node 10.12 (`pathToFileURL`) / Node 10.12 (`fileURLToPath`). `fs/promises.rm` retry options stable since Node 14.14. All in Node 22 LTS scope.

## Package Legitimacy Audit

> **Skipped — no external packages installed in Phase 36.** All code uses Node 22 stdlib (`node:url`, `node:path`, `node:fs/promises`) and the Phase 35 platform module already on disk. Zero `dependencies` or `devDependencies` added. If the planner needs `isFileUri` (Discretion item) and decides on a library implementation, run slopcheck per the protocol; this phase as scoped requires none.

## API Quick Reference

> Cited directly from Node.js docs (nodejs.org/api/url.html, nodejs.org/api/fs.html) and confirmed via WebFetch / WebSearch this session.

### `pathToFileURL(path[, options])` — `node:url`

| Aspect | Behavior |
|--------|----------|
| **Signature** | `pathToFileURL(path: string, options?: { windows?: boolean }) → URL`. Wrappers use `.href` for `string` output. |
| **Input requirement** | "Function ensures `path` is resolved absolutely" — accepts already-absolute paths verbatim; relative paths are resolved against `process.cwd()` before encoding. **Does NOT throw on relative path** — it resolves. Throws `TypeError` only on non-string non-URL input. [CITED: nodejs.org/api/url.html] |
| **Drive letter on Windows** | `'C:\\path\\'` → `'file:///C:/path/'` — drive letter preserved in path position, three-slash form, backslashes flipped to forward slashes. |
| **UNC on Windows** | `'\\\\server\\share\\file'` → `'file://server/share/file'` — UNC server name occupies the URL `authority`/host position (two-slash form). **Distinct shape from drive-letter URIs** — Phase 36 must handle both forms in `uri-mapper.ts` (D-11). |
| **Percent-encoding** | URL control chars encoded: space → `%20`, `#` → `%23`, literal `%` → `%25`. Example from docs: `'/foo#1'` → `'file:///foo%231'`, `'/some/path%.c'` → `'file:///some/path%25.c'`. |
| **`windows` option** | `true` forces Windows flavor, `false` forces POSIX, `undefined` = system default. Phase 36 callers use `undefined` (system default) — this means tests that run on macOS-host need either `windows: true` explicitly OR module-level platform mock. |
| **Trailing slash** | Preserved: `'C:\\path\\'` → `'file:///C:/path/'`. |

### `fileURLToPath(url[, options])` — `node:url`

| Aspect | Behavior |
|--------|----------|
| **Signature** | `fileURLToPath(url: string \| URL, options?: { windows?: boolean }) → string` |
| **Input acceptance** | Accepts both `URL` instance and `file://`-scheme string. |
| **Non-`file://` scheme** | **Throws `TypeError`** ("`url` must be of scheme `file:`"). Wrapper should NOT defensively catch this — caller bug propagates. |
| **Three-slash form on Windows** | `'file:///C:/path/'` → `'C:\\path\\'` — drive letter back to native, separators back to `\`. |
| **Two-slash form (UNC)** | `'file://nas/foo.txt'` → `'\\\\nas\\foo.txt'` on Windows — host component becomes UNC server. **On POSIX, `file://nas/foo.txt` is malformed-but-tolerated; behavior is implementation-defined — DO NOT rely on this shape crossing the LSP boundary on POSIX.** |
| **Three-slash form on POSIX** | `'file:///foo/bar'` → `'/foo/bar'`. |
| **Percent-decoding** | Decoded transparently. `'file:///hello%20world'` → `/hello world`. ⚠️ **Decodes `%2e` as `.` and `%2e%2e` as `..`** — Node docs explicitly warn: "Applications must not rely on `fileURLToPath()` alone to prevent directory traversal attacks." This is fine for Phase 36 because the reverse-consumer site (`tool-helpers.ts:350`) feeds the path into `readFile` against jars that are not user-controlled at that callsite, AND the ZIP-extraction sites do NOT use `fileURLToPath` — they construct paths via `join(depDir, ...entryPath.split('/'))` from raw ZIP entry names. The traversal guard at the ZIP boundary (D-12) is the real defense. |
| **`windows` option** | Same semantics as `pathToFileURL`. |

### `fs.promises.rm(path, options)` retry behavior — `node:fs/promises`

| Aspect | Behavior |
|--------|----------|
| **Options shape** | `{ recursive?: boolean, force?: boolean, maxRetries?: number, retryDelay?: number }`. Phase 36 uses `{ recursive: true, force: true, maxRetries: 3, retryDelay: 100 }`. |
| **When retries fire** | Only when `recursive: true` is set AND the encountered error is one of **EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM**. Other errors propagate immediately. [VERIFIED: nodejs/node commits f725953 (introduces `retryDelay`), 4fffb42 (adds ENFILE), 3475f9b (adds ENFILE for sync variant)] |
| **Backoff** | **Linear: `retryDelay` ms longer on each subsequent retry.** With `retryDelay: 100`, `maxRetries: 3`: wait 100ms after first failure, 200ms after second, 300ms after third — then re-throw the final error if the fourth attempt also fails. Total worst-case wall time ≈ 600ms + 4 × syscall time. [CITED: WebSearch this session — multiple community sources confirming "retryDelay milliseconds **longer** on each try"; matches the rimraf-based implementation Node inherited at commit f725953] |
| **Default `maxRetries`** | `0` (no retry). |
| **Default `retryDelay`** | `100` (ms). |
| **Final-attempt failure** | Last error is re-thrown after `maxRetries` retries exhausted. Phase 36 catch sites (workspace-sync.ts:47, :210) already handle this via their existing `try/catch` — no new error path. |
| **Non-recursive call** | Retry options are **ignored** if `recursive: false`. Phase 36 always passes `recursive: true`. |
| **Windows-specific notes** | None documented as Windows-specific — but the targeted error classes (EBUSY, EPERM) are the ones empirically observed on Windows under AV scan / Search Indexer / lingering handles. On Unix, the retry path is mostly inert (ENOTEMPTY can fire on a directory-not-empty race; rare). [ASSUMED: empirical "Unix happy-path never triggers retry" claim — confirmed by D-19 reasoning, not by a benchmark in this session.] |

## Site List Verification

> Every site below was confirmed via `grep -n` against current HEAD on 2026-05-15.

### Forward `'file://' + …` sites (7 — must migrate to `pathToFileUri`)

| # | File | Line | Code shape (single line) |
|---|------|------|--------------------------|
| F1 | `src/jdtls/client.ts` | 245 | `rootUri: 'file://' + workspaceDir,` (inside `client.initialize({ … })`) |
| F2 | `src/jdtls/client.ts` | 278 | `workspaceFolders: [{ uri: 'file://' + workspaceDir, name: 'sources' }],` |
| F3 | `src/jdtls/workspace-sync.ts` | 103 | `changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],` (inside `syncStudyJarToWorkspace`) |
| F4 | `src/jdtls/workspace-sync.ts` | 141 | `changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],` (inside `unsyncStudyJarFromWorkspace`) |
| F5 | `src/jdtls/workspace-sync.ts` | 206 | `changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],` (inside `syncFabricModToWorkspace`) |
| F6 | `src/jdtls/workspace-sync.ts` | **255** | `changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],` (inside `unsyncFabricModFromWorkspace`) |
| F7 | `src/tools/remove-project-member.ts` | 83 | `uri: 'file://' + resolvedTempDir + '/.classpath',` (inside `notify('workspace/didChangeWatchedFiles', …)`) |

**Discrepancy with CONTEXT.md:** CONTEXT.md says F6 is at line **252**; current HEAD shows **255**. ROADMAP says **255**. CONTEXT.md is wrong (transcription error during context-gathering). **Planner: use line 255 in plans and verification.** All other line numbers in CONTEXT.md match HEAD. Confirmed by `grep -n "'file://'" src/jdtls/workspace-sync.ts` returning `103, 141, 206, 255`.

### Reverse `uri.replace('file://', '')` sites (1 — must migrate to `fileUriToPath`)

| # | File | Line | Code shape |
|---|------|------|------------|
| R1 | `src/tools/tool-helpers.ts` | 350 | `const filePath = loc.uri.replace('file://', '');` (inside the `for (const loc of locations)` loop in the navigation-result builder; `loc.uri` is an LSP `Location.uri` from JDT LS) |

**Boundary clarification (gradle-parser.ts:36):** `src/project/gradle-parser.ts:36-42` defines a **local** `fileUriToPath` that does TWO things `fileURLToPath` does NOT do:
1. **Strips `^file:\/\/` (two-slash form)** — accepts URIs like `'file://~/.m2/repository'` that Gradle emits in `repositories { url 'file://~/.m2/repository' }`. `fileURLToPath` requires three-slash `file:///abs/path` form and would throw `TypeError` on input lacking the third slash (per Node docs: non-`file:` scheme throws; malformed `file:` shapes also throw via the WHATWG URL parser). Empirically confirmed: `new URL('file://~/.m2/repository').pathname` → host parsing breaks because `~` is not a valid hostname per RFC 3986 / WHATWG.
2. **Substitutes `~/` → `homedir()`** — `fileURLToPath` does no shell-style home expansion.

**This is a Gradle-DSL semantic, not a filesystem-URI semantic.** It exists at the Gradle parsing boundary because Gradle build files use `file://` as a *pseudo-URI* convention for local Maven repositories. Phase 36 must NOT touch this function. Planner: do not include `gradle-parser.ts:36` in any URI-sweep task. [VERIFIED: read of `src/project/gradle-parser.ts:31-42` this session]

### ZIP-extraction sites (2 — must add split-and-spread + traversal check)

| # | File | Line | Current code shape |
|---|------|------|--------------------|
| Z1 | `src/jdtls/workspace-sync.ts` | 40 | `const targetPath = join(depDir, entryPath);` (inside `extractStudyJarToWorkspace` for-loop) |
| Z2 | `src/jdtls/workspace-sync.ts` | 184 | `const targetPath = join(depDir, entryPath);` (inside `syncFabricModToWorkspace` for-loop) |

**Transformation pattern (both sites):**

```typescript
const segments = entryPath.split('/');
const targetPath = join(depDir, ...segments);
const resolvedTarget = resolve(targetPath);
const resolvedRoot = resolve(depDir) + sep;
if (!resolvedTarget.startsWith(resolvedRoot)) {
	logger.warn('ZIP traversal rejected', { depDir, entryPath });
	throw new Error(`ZIP entry path escapes extraction root: ${entryPath}`);
}
await mkdir(dirname(targetPath), { recursive: true });
// ...existing readEntry/writeFile unchanged
```

The existing `try/catch` at lines 47-50 (`extractStudyJarToWorkspace`) and 210-221 (`syncFabricModToWorkspace`) already handle the throw path (D-14 — cleanup-on-error reuses the existing `rm(depDir, …)`). [VERIFIED: read of `src/jdtls/workspace-sync.ts` lines 35-50 and 170-222 this session.]

### `rm` retry sites (4 — must add `{ maxRetries: 3, retryDelay: 100 }`)

| # | File | Line | Current code shape |
|---|------|------|--------------------|
| M1 | `src/jdtls/workspace-sync.ts` | 48 | `await rm(depDir, { recursive: true, force: true });` (cleanup catch in `extractStudyJarToWorkspace`) |
| M2 | `src/jdtls/workspace-sync.ts` | 62 | `await rm(depDir, { recursive: true, force: true });` (inside `removeStudyJarFromWorkspace`) |
| M3 | `src/jdtls/workspace-sync.ts` | 215 | `try { await rm(dir, { recursive: true, force: true }); } catch {}` (cleanup catch in `syncFabricModToWorkspace`) |
| M4 | `src/jdtls/workspace-sync.ts` | 245 | `await rm(join(jdtls.tempDir, dirName), { recursive: true, force: true });` (inside `unsyncFabricModFromWorkspace` for-loop) |

**Transformation (all 4 sites — single-line diff):**

```typescript
// Before:
await rm(target, { recursive: true, force: true });
// After:
await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
```

> Note: `src/tools/remove-project-member.ts` has 2 additional `rm` calls at lines 96 and 104. **CONTEXT.md does NOT include these** — only the 4 in `workspace-sync.ts`. The planner should treat the 4 sites listed in CONTEXT.md D-17 as the locked set and ask the user before extending to the remove-project-member.ts sites. Mentioning here for completeness; not in scope unless user expands D-17.

### Drive-letter case-fold site (1 — modify `fromFileUri` in `uri-mapper.ts`)

| File | Lines | Current code shape |
|------|-------|--------------------|
| `src/jdtls/uri-mapper.ts` | 75-78 (`toFileUri`) and 80-103 (`fromFileUri`) | `toFileUri` returns `\`file://${normalizedTempDir}/${dirName}/${entryPath}\``. `fromFileUri` does `const prefix = \`file://${normalizedTempDir}/\`; if (!uri.startsWith(prefix)) return null;` — drive-letter case mismatch fails this `startsWith`. |

**Per D-08 / D-09 / D-10 / D-11:** Modify `fromFileUri` only. `toFileUri` stays byte-exact (no case-folding on output). See "Drive-Letter Case-Fold Logic" section below for the exact state machine.

### TOTAL: 7 forward + 1 reverse + 2 ZIP + 4 rm + 1 case-fold (in uri-mapper.ts) + 1 new module (`src/platform/uri.ts`) = 16 in-place touches across 5 files.

## ZIP-Slip Canonical Pattern

```typescript
import { join, resolve, sep, dirname } from 'node:path';

// Inside extractStudyJarToWorkspace and syncFabricModToWorkspace,
// at the per-entry loop body:
for (const entryPath of entries) {
	// Split on '/' (canonical ZIP-entry separator per APPNOTE.TXT 4.4.17.1)
	// and spread into join() so each segment is a "name with no separator"
	// from node:path's perspective. On Windows this produces backslashes
	// throughout; on Unix it produces forward slashes. The previous shape
	// 'join(depDir, entryPath)' on Windows produced 'depDir\foo/bar/Baz.java'
	// — mixed separators that JDT LS treats as a different file from
	// 'depDir\foo\bar\Baz.java'.
	const segments = entryPath.split('/');
	const targetPath = join(depDir, ...segments);

	// POST-RESOLUTION descendant check. resolve() expands '..' and absolute
	// path entries; the trailing-sep guard prevents the partial-prefix bypass
	// (target='/tmp/foo-attack/x' incorrectly matching root='/tmp/foo' without
	// the trailing slash).
	const resolvedTarget = resolve(targetPath);
	const resolvedRoot = resolve(depDir) + sep;
	if (!resolvedTarget.startsWith(resolvedRoot)) {
		logger.warn('ZIP traversal rejected', { depDir, entryPath });
		throw new Error(`ZIP entry path escapes extraction root: ${entryPath}`);
	}

	// Existing write logic unchanged
	await mkdir(dirname(targetPath), { recursive: true });
	const content = await adapter.readEntry(entryPath);
	await writeFile(targetPath, content);
}
```

**Why the trailing-sep guard matters (worked example):**

| Scenario | `depDir` | `entryPath` | `resolvedTarget` | Naive check (`startsWith(resolve(depDir))`) | Guarded check (`startsWith(resolve(depDir) + sep)`) |
|----------|----------|-------------|-------------------|---|---|
| Normal entry | `/tmp/foo` | `pkg/Foo.java` | `/tmp/foo/pkg/Foo.java` | ✓ pass | ✓ pass |
| Dot-dot traversal | `/tmp/foo` | `../etc/passwd` | `/tmp/etc/passwd` | ✗ rejected | ✗ rejected |
| Absolute Unix path | `/tmp/foo` | `/etc/passwd` | `/etc/passwd` | ✗ rejected | ✗ rejected |
| Trailing-prefix bypass | `/tmp/foo` | `…relative path that resolves to /tmp/foo-attack/x…` | `/tmp/foo-attack/x` | **✓ NAIVELY PASSES (bug)** | ✗ rejected (no `/tmp/foo/` prefix) |
| Backslash traversal on Unix (where `\` is a valid filename byte) | `/tmp/foo` | `..\..\etc\passwd` | `/tmp/foo/..\..\etc\passwd` (literal — Unix doesn't split on `\`) | ✓ pass (file IS under depDir; the `\`-laden filename is harmless on Unix but `resolve` does not normalize `\`) | ✓ pass (same — no escape) |
| Backslash traversal on Windows | `C:\tmp\foo` | `..\..\Windows\System32` | `C:\Windows\System32` (Windows `resolve` normalizes `\`) | ✗ rejected | ✗ rejected |

The trailing-sep guard is mandatory for the partial-prefix case. The Unix-with-`\`-bytes case is benign (the file gets written under `depDir` with a weird filename, not escaped); we accept that v1.5 quirk rather than over-defend.

**Edge cases for the assertion:**

- **Empty entry name** (`entryPath === ''`): `split('/')` → `['']`; `join(depDir, '')` → `depDir`; `resolve(depDir).startsWith(resolve(depDir) + sep)` → **FALSE** (no trailing sep on the resolved target). This rejects empty-name entries, which is correct (writing to `depDir` itself as a file would clobber the directory).
- **Absolute UNC entry name on Windows** (`entryPath === '//server/share/x'`): `split('/')` → `['', '', 'server', 'share', 'x']`; on Windows, `join(depDir, '', '', 'server', 'share', 'x')` produces `depDir\server\share\x` (empty segments collapse). `resolve` gives `<depDir>\server\share\x` — under root, allowed. **This is benign** — the malicious intent was to escape via UNC, but the leading-slash gets eaten by `join`. ✓
- **Drive-letter entry name on Windows** (`entryPath === 'C:/Windows/System32'`): `split('/')` → `['C:', 'Windows', 'System32']`; `join(depDir, 'C:', 'Windows', 'System32')` on Windows treats `'C:'` as a drive prefix in segment position — `resolve` gives `C:\Windows\System32`. Rejected. ✓
- **Null byte in entry name**: `node:path` does not strip null bytes; `writeFile` will reject `\0` in the path via libuv (`ENOENT` / `EINVAL`). Not handled here; relies on libuv. [ASSUMED: not verified this session, but consistent with documented libuv behavior.]

## Drive-Letter Case-Fold Logic (`uri-mapper.ts` `fromFileUri`)

Per D-08, D-09, D-10, D-11 — case-fold is **surgical**: exactly byte 8 of the URI, only when the URI matches the drive-letter shape. Everything else is byte-exact.

### State Machine

```text
Input: uri (string), normalizedTempDir (string from realpathSync at mapper creation)

Step 1 — Construct stored prefix (byte-exact from current code):
    prefix = `file://${normalizedTempDir}/`
    // On Windows, normalizedTempDir is a Windows path like 'C:\\Users\\test\\AppData\\Local\\Temp\\…'.
    // toFileUri uses this verbatim — so stored URIs look like
    // 'file:///C:/Users/test/AppData/…' (after the eventual D-01 migration through
    // pathToFileUri) OR 'file://C:\\Users\\test\\…' (raw — current shape; relevant
    // because the case-fold needs to work BOTH before and after the migration).
    // Phase 36's planner notes the case-fold should be written against the
    // POST-migration shape ('file:///C:/…') because by the time fromFileUri
    // is called, toFileUri has already emitted the post-migration shape.

Step 2 — Detect drive-letter shape on inbound URI:
    DRIVE_LETTER_URI_PATTERN = /^file:\/\/\/[A-Za-z]:/
    inputIsDriveLetter = DRIVE_LETTER_URI_PATTERN.test(uri)
    prefixIsDriveLetter = DRIVE_LETTER_URI_PATTERN.test(prefix)

Step 3 — Branch:
    if (isWindows && inputIsDriveLetter && prefixIsDriveLetter
        && uri[8].toLowerCase() === prefix[8].toLowerCase()) {
        // Fold byte 8 of input to match prefix, then byte-exact startsWith on the
        // rest. Equivalent: do startsWith on the rest of the string ignoring byte 8.
        if (uri.length < prefix.length) return null;
        const headMatch = uri.slice(0, 8) === prefix.slice(0, 8);          // 'file:///'
        const driveMatch = uri[8].toLowerCase() === prefix[8].toLowerCase();
        const tailMatch = uri.slice(9, prefix.length) === prefix.slice(9); // ':', rest
        if (!(headMatch && driveMatch && tailMatch)) return null;
    } else {
        // Every other case: byte-exact startsWith (UNC, DOS device, volume GUID,
        // Win32 namespace, Unix, AND the Windows drive-letter case where
        // isWindows is false — i.e., we're on Unix processing a Windows URI,
        // which shouldn't happen but defensive byte-exact is safe).
        if (!uri.startsWith(prefix)) return null;
    }

Step 4 — Slice and parse rest (UNCHANGED from current code):
    const rest = uri.slice(prefix.length);
    // ... existing slashIndex / dirName / entryPath / jarId lookup unchanged
```

**Why position 8?** URI = `'file:///'` (8 chars) + `<L>` (drive letter, 1 char) + `':'` + rest. Position 0-indexed: byte 8 is the drive letter.

### Worked Examples

| # | Stored prefix (`normalizedTempDir` shown) | Inbound URI | Match? | Why |
|---|---|---|---|---|
| 1 | `file:///C:/Users/test/Temp/abc/` | `file:///C:/Users/test/Temp/abc/foo/Bar.java` | ✓ | Byte 8 `'C' === 'C'`, head + tail byte-exact match. |
| 2 | `file:///C:/Users/test/Temp/abc/` | `file:///c:/Users/test/Temp/abc/foo/Bar.java` | ✓ | Byte 8 `'c'.toLowerCase() === 'C'.toLowerCase()`, head + tail byte-exact match. JDT LS lowercased the drive letter; fold accepts it. |
| 3 | `file:///C:/Users/test/Temp/abc/` | `file:///D:/Users/test/Temp/abc/foo/Bar.java` | ✗ | Byte 8 `'D'.toLowerCase() !== 'C'.toLowerCase()`. Different drive — rejected (D-09 — only the case-fold is loose; the drive itself must match). |
| 4 | `file:///C:/Users/test/Temp/abc/` | `file:///C:/users/test/Temp/abc/foo/Bar.java` | ✗ | Byte 8 matches (`C` vs `C`); but byte 9-onwards differs (`/Users/` vs `/users/`). Tail byte-exact compare rejects. Per D-09: case-sensitive everywhere except the drive letter. (NTFS may be case-sensitive; ReFS is.) |
| 5 | `file:///C:/Users/test/Temp/abc/` | `file://server/share/Temp/abc/foo/Bar.java` (UNC) | ✗ | Inbound is UNC (two-slash form), no drive-letter shape; falls through to byte-exact `startsWith`, fails because prefix has `///`. (D-11.) |
| 6 | `file:////./C:/path/` (DOS device prefix — stored from a TMPDIR set to that form) | `file:////./c:/path/foo.java` | ✗ | Inbound is DOS-device shape (`file:////./`), regex `/^file:\/\/\/[A-Za-z]:/` does NOT match (4 slashes after `file:`, not 3). Falls through to byte-exact compare — rejects because `'/'` (byte 8 of input) ≠ `'/'` of stored byte 8 only if the stored prefix happens to differ; in this example both are `'/'` so it might pass — **but the drive letter `c` vs `C` differs and byte-exact fails on byte 11**. D-11 says DOS-device URIs are byte-exact even on Windows; this rejection is correct. |
| 7 | `file:///C:/Temp/abc/` | `file:///C:/Temp/abc/foo/BAR.java` (jar entry tail uppercase) | ✓ for prefix; entryPath returned verbatim with case preserved | Case-fold only touches byte 8 of the URI. The jar-entry tail (`foo/BAR.java`) survives the case-fold pass byte-for-byte. (D-09 — every byte of jar-entry path tails is case-sensitive.) |
| 8 | `file:///c:/Temp/abc/` (lowercase stored — defensive) | `file:///C:/Temp/abc/foo/Bar.java` | ✓ | Symmetric: stored lowercase, inbound uppercase — `toLowerCase()` on both sides yields match. |
| 9 (Unix) | `file:///private/var/folders/xy/abc/` | `file:///private/var/folders/xy/abc/foo/Bar.java` | ✓ | Unix shape — `isWindows === false` skips the case-fold branch; byte-exact `startsWith` matches. |
| 10 (Unix, malicious) | `file:///private/var/folders/xy/abc/` | `file:///PRIVATE/var/folders/xy/abc/foo/Bar.java` | ✗ | Unix — byte-exact compare rejects (UNIX-02 / UNIX-01 — preserve case-sensitive filesystem semantics). |

## Test Plan

### Files touched

| File | Action | What it tests |
|------|--------|---------------|
| `tests/platform/uri.test.ts` (NEW) | Pure-helper module tests | `pathToFileUri` / `fileUriToPath` round-trip; representative POSIX paths with spaces; Windows-mocked tests with `path.win32`-shaped inputs producing three-slash `file:///C:/…` URIs. |
| `tests/jdtls/uri-mapper.test.ts` (MODIFIED) | Add Windows-mocked describe block | `fromFileUri` drive-letter case round-trip; UNC URI non-fold; jar-entry tail case-sensitivity preserved. Existing Unix tests must pass unchanged. |
| `tests/jdtls/workspace-sync.test.ts` (MODIFIED) | Add traversal-rejection describes + rm-options assertion | ZIP traversal: `..`, absolute Unix path, absolute Windows path, `\`-traversal (Windows-mocked), trailing-sep edge case. Plus `vi.mock('node:fs/promises', …)` to assert `rm` called with `maxRetries: 3, retryDelay: 100`. |
| `tests/jdtls/client.test.ts` (MODIFIED — optional) | Verify rootUri/workspaceFolders URI shape | Snapshot test: after migration, `client.initialize` is called with a `rootUri` matching `/^file:\/\/\/[^/].*/` (three-slash form). Existing `node:child_process.execSync` mock can be reused; LSP client mock pattern already in place at `tests/jdtls/client.test.ts:6-12`. |
| `tests/tools/find-definition.test.ts` (MODIFIED — only if `tool-helpers.ts:350` is covered transitively) | Add assertion on `loc.uri` → file path conversion | Probably covered by existing `find-definition` happy-path test; verify after sweep. |

### Pattern reuse (from Phase 35 — D-21)

All Windows-mocked tests reuse this exact scaffolding:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

const originalPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
	setPlatform(originalPlatform);
	vi.resetModules();
});

it('Windows: <behavior>', async () => {
	setPlatform('win32');
	vi.resetModules();
	const { pathToFileUri } = await import('../../src/platform/uri.js');
	// ... assertions
});
```

This is **already present** in `tests/platform/index.test.ts` (lines 1-21) and the augmentation block of `tests/jdtls/client.test.ts` from Phase 35 — Phase 36 copies the shape verbatim. [VERIFIED: read of `tests/platform/index.test.ts` and `tests/jdtls/client.test.ts` this session.]

### REQ-ID → Test Mapping

| Req | Test file | Test name | Test type | Pattern |
|-----|-----------|-----------|-----------|---------|
| **WIN-03** | `tests/platform/uri.test.ts` | `'Windows: pathToFileUri produces file:///C:/… three-slash form'` | unit, platform-mocked | `setPlatform('win32') + vi.resetModules()` + assert `pathToFileUri('C:\\path').startsWith('file:///C:')` and `.includes('%20')` for spaces |
| **WIN-03** | `tests/jdtls/client.test.ts` | `'rootUri uses three-slash file:/// on Windows'` (new describe) | unit, platform-mocked + LSP-client-mocked | Mock `LspClient.initialize` to capture args; assert `rootUri` matches `/^file:\/\/\//` |
| **WIN-04** | `tests/jdtls/workspace-sync.test.ts` | `'Windows: ZIP entry foo/bar.java joins to depDir\\foo\\bar.java'` | unit, platform-mocked + fs mocked | `setPlatform('win32')` + `vi.mock('node:fs/promises')` to capture `writeFile` calls; assert the captured path has `\` separators throughout |
| **WIN-05** | `tests/jdtls/uri-mapper.test.ts` | `'Windows: fromFileUri accepts uppercase or lowercase drive letter'` | unit, platform-mocked | `setPlatform('win32')` + create mapper with `normalizedTempDir='C:\\Users\\test\\…'`; assert `fromFileUri('file:///C:/…')` and `fromFileUri('file:///c:/…')` both return the same mapping |
| **WIN-05** | `tests/jdtls/uri-mapper.test.ts` | `'Windows: fromFileUri rejects different drive letter'` | unit, platform-mocked | Same setup; assert `fromFileUri('file:///D:/…')` returns `null` |
| **WIN-05** | `tests/jdtls/uri-mapper.test.ts` | `'Windows: fromFileUri does NOT case-fold UNC URIs'` | unit, platform-mocked | Mapper with UNC `normalizedTempDir`; assert `fromFileUri('file://SERVER/…')` returns `null` against stored `file://server/…` |
| **WIN-05** | `tests/jdtls/uri-mapper.test.ts` | `'Windows: fromFileUri preserves jar-entry tail case'` | unit, platform-mocked | Drive-letter mapper; assert returned `entryPath` is byte-exact with the inbound URI's tail (no `toLowerCase` applied to entry path) |
| **WIN-06** | `tests/jdtls/workspace-sync.test.ts` | `'rm called with maxRetries: 3, retryDelay: 100 at every site'` | unit | `vi.mock('node:fs/promises', { rm: vi.fn() })` then invoke each of the 4 functions calling `rm`; assert all calls received the retry options |
| **WIN-07** | `tests/jdtls/workspace-sync.test.ts` | `'rejects ZIP entry containing .. segments'` | unit | Mock `JarReader.listEntries` to return `['../etc/passwd']`; assert `extractStudyJarToWorkspace` throws and `rm(depDir)` was called for cleanup |
| **WIN-07** | `tests/jdtls/workspace-sync.test.ts` | `'rejects absolute Unix entry path'` | unit | Mock entries `['/etc/passwd']`; assert throw |
| **WIN-07** | `tests/jdtls/workspace-sync.test.ts` | `'Windows-mocked: rejects absolute Windows entry path'` | unit, platform-mocked | Mock entries `['C:/Windows/System32/calc.exe']`; assert throw |
| **WIN-07** | `tests/jdtls/workspace-sync.test.ts` | `'rejects \\-separator traversal'` | unit | Mock entries `['..\\..\\etc\\passwd']`; assert (Windows-mocked) throw |
| **WIN-07** | `tests/jdtls/workspace-sync.test.ts` | `'rejects trailing-prefix bypass (foo-attack vs foo)'` | unit | Construct depDir = `/tmp/foo`, contrive entry that resolves to `/tmp/foo-attack/x`; assert throw |
| **UNIX-02** | `tests/platform/uri.test.ts` | `'Unix round-trip: fileUriToPath(pathToFileUri(p)) === p for spaces'` | unit | Inputs: `/private/var/folders/x y/file.java`, `/tmp/foo`, `/tmp/path%with#odd$chars`; assert exact equality |
| **UNIX-02** | `tests/platform/uri.test.ts` | `'Unix round-trip: paths with already-encoded characters survive'` | unit | Input `'/foo%2520bar'` → `pathToFileUri` percent-encodes `%` to `%25`, `fileUriToPath` reverses; round-trip identity holds |
| **UNIX-01 (cross-cut)** | (existing test files) | All existing tests in `tests/jdtls/workspace-sync.test.ts`, `tests/jdtls/uri-mapper.test.ts`, `tests/tools/*.test.ts` | regression | Full v1.5 suite passes; planner runs `pnpm test` at every wave boundary |

### Validation Architecture (§5.5 Nyquist gate)

Required per `.planning/config.json` (`workflow.nyquist_validation: true`).

#### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` (testTimeout: 10000ms, env: node, include: `tests/**/*.test.ts`) |
| Quick run command | `pnpm test -- tests/platform/uri.test.ts tests/jdtls/uri-mapper.test.ts tests/jdtls/workspace-sync.test.ts` |
| Full suite command | `pnpm test` |

#### Phase Requirements → Test Map

(See REQ-ID table above — all WIN-03 through WIN-07 and UNIX-02 mapped to unit tests automated via vitest.)

#### Sampling Rate

- **Per task commit:** `pnpm test -- tests/platform/uri.test.ts tests/jdtls/uri-mapper.test.ts tests/jdtls/workspace-sync.test.ts tests/jdtls/client.test.ts` (~1-3s)
- **Per wave merge:** `pnpm test` (full suite; ~10-30s)
- **Phase gate:** Full suite green before `/gsd:verify-work`

#### Wave 0 Gaps

- [ ] `tests/platform/uri.test.ts` — covers WIN-03 percent-encoding + three-slash output, UNIX-02 round-trip
- [ ] New `describe('fromFileUri on Windows', …)` block in `tests/jdtls/uri-mapper.test.ts` — covers WIN-05 drive-letter case
- [ ] New `describe('ZIP traversal rejection', …)` block in `tests/jdtls/workspace-sync.test.ts` — covers WIN-07 + WIN-04 split-and-spread
- [ ] New `describe('rm retry options', …)` block in `tests/jdtls/workspace-sync.test.ts` — covers WIN-06 (with `vi.mock('node:fs/promises')`)
- [ ] Optional snapshot in `tests/jdtls/client.test.ts` `describe('startJdtLs URI form', …)` covering WIN-03 via LSP-client mock
- [ ] Framework install: none — vitest, `node:url`, `node:path`, `node:fs/promises` already present

## Architecture Patterns

### System Architecture Diagram

```
   Tool boundary (Unix-shaped paths; D-04)
   ───────────────────────────────────────
              │                       │
              │ jar entry paths       │ jar identifiers
              ▼                       ▼
   ┌──────────────────────────────────────┐
   │  src/tools/*                         │
   │   - validate params                  │
   │   - call domain logic                │
   │   - format response                  │
   │                                      │
   │  tool-helpers.ts:350 (R1)            │
   │    loc.uri → fileUriToPath(loc.uri)  │
   └──────────────┬───────────────────────┘
                  │
                  ▼
   ┌──────────────────────────────────────┐
   │  src/platform/uri.ts  (NEW — D-01)   │
   │                                      │
   │  - pathToFileUri(abs): string        │
   │      wraps pathToFileURL(p).href     │
   │  - fileUriToPath(uri): string        │
   │      wraps fileURLToPath(u)          │
   │                                      │
   │  Pure module. No fs I/O. Mirrors     │
   │  Phase 35's src/platform/index.ts    │
   │  shape (sibling, not export).        │
   └────────┬──────────────────┬──────────┘
            │                  │
            │ forward (7)      │ reverse (1)
            ▼                  ▲
   ┌──────────────────────────────────────┐
   │  src/jdtls/  (Domain — JDT LS)       │
   │                                      │
   │  client.ts:245 (F1) rootUri          │
   │  client.ts:278 (F2) workspaceFolders │
   │  workspace-sync.ts:103 (F3)          │
   │  workspace-sync.ts:141 (F4)          │
   │  workspace-sync.ts:206 (F5)          │
   │  workspace-sync.ts:255 (F6)          │
   │  remove-project-member.ts:83 (F7)    │
   │                                      │
   │  Plus uri-mapper.ts (D-02 / D-08):   │
   │    toFileUri/fromFileUri shape       │
   │    unchanged; fromFileUri gains      │
   │    drive-letter case-fold branch     │
   │                                      │
   │  Plus workspace-sync.ts ZIP sites:   │
   │    Z1 (line 40) Z2 (line 184)        │
   │    — split-and-spread + traversal    │
   │    guard (D-12, D-13)                │
   │                                      │
   │  Plus workspace-sync.ts rm sites:    │
   │    M1 (48) M2 (62) M3 (215)          │
   │    M4 (245) — {maxRetries: 3,        │
   │    retryDelay: 100} (D-17)           │
   └──────────────┬───────────────────────┘
                  │  LSP boundary (file:// URIs — D-07)
                  ▼
   ┌──────────────────────────────────────┐
   │  Eclipse JDT LS                      │
   │   - emits Location.uri (Windows may  │
   │     lowercase drive letter — fold on │
   │     receive in fromFileUri)          │
   │   - consumes rootUri /               │
   │     workspaceFolders.uri (now        │
   │     three-slash percent-encoded —    │
   │     fixes WIN-03)                    │
   └──────────────────────────────────────┘

   Gradle boundary (OUT OF SCOPE — D-03, Claude's Discretion resolution):
   ┌──────────────────────────────────────┐
   │  src/project/gradle-parser.ts:36     │
   │   fileUriToPath (LOCAL — keeps       │
   │   two-slash + ~/ substitution        │
   │   semantics)                         │
   │                                      │
   │   DO NOT MIGRATE                     │
   └──────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── platform/
│   ├── index.ts       # Phase 35 — unchanged, exports isWindows + Java helpers
│   └── uri.ts         # NEW — pathToFileUri + fileUriToPath sibling
├── jdtls/
│   ├── client.ts            # MODIFIED — 2 forward URI sites (F1, F2)
│   ├── workspace-sync.ts    # MODIFIED — 4 forward URI (F3-F6), 2 ZIP (Z1, Z2), 4 rm (M1-M4)
│   ├── uri-mapper.ts        # MODIFIED — fromFileUri gains drive-letter case-fold
│   ├── startup.ts           # unchanged
│   ├── workspace.ts         # unchanged
│   └── types.ts             # unchanged
└── tools/
    ├── tool-helpers.ts      # MODIFIED — 1 reverse URI site (R1, line 350)
    ├── remove-project-member.ts  # MODIFIED — 1 forward URI site (F7, line 83)
    └── ... (other tools)         # unchanged

tests/
├── platform/
│   ├── index.test.ts        # Phase 35 — unchanged
│   └── uri.test.ts          # NEW — URI helpers + UNIX-02 round-trip
└── jdtls/
    ├── uri-mapper.test.ts          # MODIFIED — Windows-mocked drive-letter describes
    ├── workspace-sync.test.ts      # MODIFIED — traversal rejection + rm retry assertion
    └── client.test.ts              # MODIFIED (optional) — LSP rootUri shape snapshot
```

### Pattern 1: `src/platform/uri.ts` sibling module

```typescript
// src/platform/uri.ts
/**
 * URI helpers — file:// ↔ filesystem path conversion.
 *
 * Pure module: no fs I/O, no child_process, no side effects. Wraps node:url's
 * pathToFileURL / fileURLToPath. Sibling to src/platform/index.ts (which holds
 * platform-detection primitives + Java helpers from Phase 35).
 *
 * Consumed by:
 *   - src/jdtls/client.ts (forward sites F1, F2)
 *   - src/jdtls/workspace-sync.ts (forward sites F3-F6)
 *   - src/tools/remove-project-member.ts (forward site F7)
 *   - src/tools/tool-helpers.ts (reverse site R1)
 *   - src/jdtls/uri-mapper.ts (internal building blocks — public method shape unchanged)
 *
 * NOT used by src/project/gradle-parser.ts (which keeps its local fileUriToPath
 * for Gradle-DSL semantics — two-slash file:// + ~/ substitution).
 */

import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Convert an absolute filesystem path to a `file://` URI string.
 *
 * On Windows: 'C:\\path\\to\\file' → 'file:///C:/path/to/file' (three-slash,
 * drive letter in path, backslashes flipped to forward slashes).
 * On Unix: '/path/to/file' → 'file:///path/to/file'.
 * Percent-encodes URL control characters (space → %20, # → %23, % → %25).
 *
 * @param absPath - Absolute path. Relative paths are resolved against cwd.
 * @returns Three-slash file:// URI.
 */
export function pathToFileUri(absPath: string): string {
	return pathToFileURL(absPath).href;
}

/**
 * Convert a `file://` URI string (or URL object) to an absolute filesystem path.
 *
 * On Windows: 'file:///C:/path' → 'C:\\path'; 'file://server/share' → '\\\\server\\share'.
 * On Unix: 'file:///path' → '/path'.
 * Percent-decoded transparently.
 *
 * Throws TypeError on non-file scheme URIs and on malformed file:// shapes.
 * Callers (tool-helpers.ts:350) feed in LSP Location.uri values which JDT LS
 * always emits as well-formed three-slash file:// URIs.
 *
 * @param uri - file:// URI string or URL.
 * @returns Native filesystem path.
 */
export function fileUriToPath(uri: string): string {
	return fileURLToPath(uri);
}
```

**File-header / docstring style** mirrors `src/platform/index.ts` (Phase 35 — same pure-module header pattern, same JSDoc shape). **Tab indentation** (CLAUDE.md).

### Pattern 2: Drive-letter case-fold in `fromFileUri`

```typescript
// src/jdtls/uri-mapper.ts (inside createUriMapper, replacing the current fromFileUri body)
import { isWindows } from '../platform/index.js';

// Inside createUriMapper, after computing `normalizedTempDir` and `prefix`:

const DRIVE_LETTER_URI = /^file:\/\/\/[A-Za-z]:/;

function prefixMatches(uri: string, prefix: string): boolean {
	// Windows + both shapes are drive-letter URIs → fold byte 8 only.
	if (isWindows && DRIVE_LETTER_URI.test(uri) && DRIVE_LETTER_URI.test(prefix)) {
		if (uri.length < prefix.length) return false;
		// head 'file:///' (8 chars) byte-exact
		if (uri.slice(0, 8) !== prefix.slice(0, 8)) return false;
		// drive letter case-insensitive
		if (uri[8].toLowerCase() !== prefix[8].toLowerCase()) return false;
		// rest byte-exact (':', path, trailing '/')
		if (uri.slice(9, prefix.length) !== prefix.slice(9)) return false;
		return true;
	}
	// Every other case (UNC, DOS device, volume GUID, Win32 namespace, Unix):
	// byte-exact startsWith. (D-09, D-11)
	return uri.startsWith(prefix);
}

return {
	toFileUri(jarId: string, entryPath: string): string {
		// Unchanged shape — keeps current behavior. (D-08: case-fold on receive
		// only; toFileUri emits whatever shape normalizedTempDir already has.)
		const dirName = jarIdToDirNameMap.get(jarId) ?? jarIdToDirName(jarId);
		return `file://${normalizedTempDir}/${dirName}/${entryPath}`;
	},
	fromFileUri(uri: string): UriMapping | null {
		if (!prefixMatches(uri, prefix)) return null;
		const rest = uri.slice(prefix.length);
		const slashIndex = rest.indexOf('/');
		if (slashIndex === -1) return null;
		const dirName = rest.slice(0, slashIndex);
		const entryPath = rest.slice(slashIndex + 1);
		const jarId = dirNameToJarIdMap.get(dirName);
		if (jarId === undefined) return null;
		return { jar: jarId, entryPath };
	},
};
```

> **Subtle note for the planner:** `toFileUri` currently emits `\`file://${normalizedTempDir}/…\`` — that's the **two-slash** form on Windows (because `normalizedTempDir` is a Windows path starting with `C:\…`, so the URI becomes `file://C:\…` — host-as-drive-letter, which JDT LS may misinterpret). After Phase 36's forward sweep, if `uri-mapper.ts` internally adopts `pathToFileUri(normalizedTempDir)` to build the prefix (D-02 says "MAY use the new helpers as building blocks internally"), the emitted URI shape becomes `file:///C:/…` (three-slash). The case-fold regex `DRIVE_LETTER_URI` is written against the three-slash form, so the **planner must decide whether `uri-mapper.ts` migrates internally** in this phase or stays with the current two-slash form. D-01 + D-02 imply yes (`toFileUri` uses `pathToFileUri` internally); this research recommends doing so to keep the case-fold regex matching the emitted shape. Open for discuss-phase if the implementer hits a snag.

### Pattern 3: ZIP-extraction split-and-spread + traversal guard

Already shown in the "ZIP-Slip Canonical Pattern" section above. The pattern lives at sites Z1 (line 40) and Z2 (line 184) of `workspace-sync.ts`. Both sites get the same 6-line insertion. The existing `try/catch` at lines 47-50 / 210-221 already provides the cleanup path D-14 requires.

### Pattern 4: `rm` retry options (1-line diff per site)

```typescript
// Before (4 sites in workspace-sync.ts):
await rm(target, { recursive: true, force: true });
// After:
await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
```

No `isWindows` guard (D-19). Native Node retry is no-op when first attempt succeeds (Unix happy path).

### Anti-Patterns to Avoid

- **Manual `encodeURIComponent` on path segments**: `pathToFileURL` handles percent-encoding correctly per RFC 8089 / WHATWG URL spec. Calling `encodeURIComponent` separately double-encodes (`/` → `%2F`, then `%` → `%25` → `%252F`). Always go through the wrapper.
- **`fileURLToPath` on Gradle-DSL URIs**: `gradle-parser.ts:36`'s `fileUriToPath` is a different function. Don't refactor it to call `fileURLToPath` — it accepts two-slash `file://~/.m2/repository` which `fileURLToPath` rejects.
- **Pre-resolution traversal check** (`if (entryPath.includes('..')) throw`): substring-based defenses are bypassable (`..%2f`, UTF-8 overlong, mixed-case `..`, `…` U+2026, etc.). Always do post-`resolve` check. Node docs explicitly warn `fileURLToPath` does NOT defend against this.
- **`isWindows`-gated `rm` retry**: adds a branch that does nothing — Node's retry already short-circuits on first-attempt success. Keeps Unix happy path observationally identical (D-19).
- **Case-folding the entire URI in `fromFileUri`**: violates D-09. Drive letter only. Jar-entry tail (after the trailing `/`) is case-sensitive — `foo/Bar.java` and `foo/bar.java` are distinct files on ReFS / case-sensitive NTFS.
- **Calling `fs.realpath`** anywhere in this phase: D-10 forbids it.
- **Touching `src/platform/index.ts`**: Phase 35's pure-no-I/O contract. New module is `src/platform/uri.ts` (sibling).
- **Touching `src/project/gradle-parser.ts:36`**: divergent semantics; out of scope per D-03 Claude's Discretion resolution.
- **Touching the existing `try/catch` shapes in `workspace-sync.ts`**: D-20 keeps catch-site handling intact. The traversal-throw flows through the existing `await rm(depDir, …)` cleanup.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `file://` URI construction | `'file://' + path` (current code) | `pathToFileURL(p).href` | Handles drive letters, UNC, percent-encoding, both POSIX and Windows. Stable since Node 10.12. |
| `file://` URI consumption | `uri.replace('file://', '')` (current code) | `fileURLToPath(u)` | Percent-decodes, handles drive-letter form, handles UNC. |
| ZIP-slip defense | `if (entryPath.includes('..')) throw` | `resolve(target).startsWith(resolve(root) + sep)` | Substring checks bypassable via encoding / unicode tricks; post-resolution is the canonical defense per OWASP, Apache Commons Compress docs, sindresorhus/extract-zip, Snyk Zip-Slip whitepaper. |
| Retry loop for Windows EBUSY | Hand-rolled `for (let i = 0; i < 3; i++) { try { await rm(…); break; } catch { await sleep(100 * (i+1)); } }` | `fs.rm(p, { maxRetries: 3, retryDelay: 100 })` | Native retry; handles EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM specifically; smaller diff. |
| Drive-letter canonicalization | `fs.realpath` / `GetFinalPathNameByHandle` | Surgical byte-8 case-fold (D-10) | Forbidden by D-10. Pure string compare. Cheaper than a syscall. |
| URL parsing for `isFileUri` check | `URL` constructor + try/catch + scheme check | (Don't add this helper unless a callsite needs it.) | D-discretion: defer until needed. Simplest impl when needed: `uri.startsWith('file://')`. |

**Key insight:** Every operation in this phase has a battle-tested Node stdlib equivalent. The only domain-specific code is (a) the bespoke `uri-mapper.ts` jar-mapped-URI translation (kept) and (b) the drive-letter case-fold state machine (surgical, ~10 LOC). Everything else is wrapper-thin.

## Runtime State Inventory

> Phase 36 is **not** a rename/refactor/migration phase in the strict sense — it's a surgical refactor with no string renames affecting on-disk state. However, the URI shape change (two-slash → three-slash on the wire) deserves an audit:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | **None.** No URIs are persisted to ChromaDB / Mem0 / SQLite / Redis. The MCP server is stateless beyond in-memory `ProjectStore`. JDT LS workspace files (`.classpath`) reference filesystem paths (not URIs) generated by `generateClasspathFile` — unaffected by URI shape changes. [VERIFIED: `grep -rn "file://" src/ tests/` returns only the 11 sites listed above + the `gradle-parser.ts` local function + tests; no persistence layer references URIs.] | None. |
| Live service config | **None.** No external services have URI strings in config. JDT LS receives URIs over LSP at runtime (not persisted between sessions — JDT LS workspace data dir is recreated per session under `tmpdir()`). | None. |
| OS-registered state | **None.** No Windows Task Scheduler / launchd / systemd / pm2 entries reference URIs. | None. |
| Secrets / env vars | **None.** No env vars contain `file://` URIs. `JDTLS_HOME`, `JAVA_HOME` are filesystem paths. | None. |
| Build artifacts | **None.** `dist/` is regenerated on build; no compiled URI strings persist. | None. |

**Nothing found in any category** — verified by `grep -rn "file://" src/ tests/` returning only the in-source sites already enumerated above. The wire-shape change from `'file://' + path` to `pathToFileURL(p).href` is observable only at the LSP socket boundary at runtime; nothing stored.

## Common Pitfalls

### Pitfall 1: `path.join(depDir, 'a/b/c')` does NOT split forward slashes on Windows

**What goes wrong:** `path.win32.join('C:\\tmp\\foo', 'pkg/Bar.java')` returns `'C:\\tmp\\foo\\pkg/Bar.java'` — mixed separators. JDT LS treats this as a different file from `'C:\\tmp\\foo\\pkg\\Bar.java'` (depending on filesystem semantics), and the file may be written successfully but be invisible to JDT LS's workspace scanner.
**Why it happens:** `node:path` normalizes the joined string but does NOT pre-split non-final segments on `/`. The fix is to split BEFORE join.
**How to avoid:** `join(depDir, ...entryPath.split('/'))` — each spread element is a separator-free segment, so `join` correctly applies the platform's native separator throughout.
**Warning signs:** On Windows, `extractStudyJarToWorkspace` succeeds (no throw), but `find_definition` against a class in the extracted jar returns empty results. JDT LS log shows `Class not found: …`.

### Pitfall 2: `'file://' + path` on Windows is host-form, not three-slash

**What goes wrong:** `'file://' + 'C:\\path'` = `'file://C:\\path'` — JDT LS may interpret `C:` as the URL authority (host), not as a drive letter in the path. Spec says authority should be hostname-shaped; `C:` violates this; behavior is undefined and implementation-dependent.
**Why it happens:** The string concatenation pattern works on POSIX (where path starts with `/`, giving `'file:///abs/path'` — three-slash by accident) but breaks on Windows.
**How to avoid:** Always go through `pathToFileURL(p).href`. Output: `'file:///C:/path'` (three-slash, drive letter in path position).
**Warning signs:** JDT LS rejects `initialize` request on Windows with an error mentioning malformed URI; `rootUri` field not accepted.

### Pitfall 3: `fileURLToPath` percent-decodes `%2e%2e` to `..`

**What goes wrong:** A malicious LSP server (or compromised URI in storage) could send `file:///C:/Users/test/Temp/abc/%2e%2e/etc/passwd`. `fileURLToPath` decodes this to `/C:/Users/test/Temp/abc/../etc/passwd` and `node:path` then resolves to `/C:/Users/test/Temp/etc/passwd`. Node docs explicitly warn about this.
**Why it happens:** The function is faithful to the WHATWG URL spec which decodes percent-escapes before path normalization.
**How to avoid:** **For Phase 36, this is not directly exploitable** because:
  - The reverse-consumer site (`tool-helpers.ts:350`) feeds the decoded path into `readFile` against jar-extracted source files, not user-supplied destination paths. The worst case is reading the wrong file from disk, which fails benignly (file doesn't exist or isn't part of the jar).
  - The ZIP-extraction sites do NOT use `fileURLToPath` — they receive entry names from `JarReader.listJavaEntries()` (raw ZIP central-directory strings, no URI encoding). The traversal guard at the ZIP boundary (D-12) handles `..` in raw entry names directly via `resolve`.

Still flag for the planner: if a future caller ever feeds a `file://` URI through `fileUriToPath` and uses the result as a write destination, the traversal-guard pattern from D-12 must accompany that callsite.
**Warning signs:** N/A for this phase — defensive note for future development.

### Pitfall 4: Drive-letter case mismatch breaks `Map.get` lookups even with case-fold on the URI

**What goes wrong:** `uri-mapper.ts` `fromFileUri` does `dirNameToJarIdMap.get(dirName)` to look up the jar ID from the dir name. If JDT LS lowercases the drive letter in the URI but `dirName` is derived from a stored Map key built with uppercase drive letter, the case-fold on byte 8 of the URI fixes the **prefix match** but the **subsequent `dirName` slice is on the URI tail**, which is byte-exact. Drive letter is NOT in `dirName` (it's in the prefix portion that gets sliced off), so this is fine.
**Why it might still go wrong:** If `normalizedTempDir` is captured at mapper creation as `'C:\\Users\\test\\Temp\\xyz'` but JDT LS emits `'file:///c:/Users/test/Temp/xyz/…'`, the case-fold on byte 8 lets the `startsWith` succeed. The slice after `prefix.length` extracts the same tail bytes regardless of which casing was used in the prefix. ✓ Correct by construction.
**How to avoid:** No additional action needed — the surgical case-fold (only byte 8) doesn't affect tail parsing. Just verify in tests (D-23) that the returned `entryPath` is byte-exact with the inbound URI tail (no `toLowerCase` applied to it).

### Pitfall 5: Windows tests on macOS host — `path.join` uses POSIX flavor

**What goes wrong:** `tests/platform/uri.test.ts` running on macOS, even with `setPlatform('win32')`, still has `node:path`'s default `.join` resolved to `path.posix.join` (because Node's `path` module captures the default flavor at module-import time too, on darwin process). Asserting `pathToFileUri('C:\\foo').includes('\\\\')` may misbehave because the path module's normalization runs in posix mode.
**Why it happens:** `pathToFileURL` itself accepts the `windows: true` option to force Windows-flavor URL output regardless of host. The wrapper `pathToFileUri(p)` uses the system default — which is correct for production but blocked-on-darwin for cross-host tests.
**How to avoid:** Either (a) write Windows-targeting tests with explicit input that's UNAMBIGUOUSLY Windows-shaped (`'C:\\path'`) — `pathToFileURL` recognizes the drive letter and uses Windows flavor even on a darwin host — OR (b) wrap the helper to expose `pathToFileUri(p, { windows: true })` for tests. Option (a) suffices per Node docs: "On Windows, drive letters and UNC paths are automatically detected." Verify in test: `pathToFileUri('C:\\foo\\bar')` on a darwin host actually returns `'file:///C:/foo/bar'`. [ASSUMED — verify empirically in the first Wave 0 test commit; if option (a) fails, fall back to option (b).]
**Warning signs:** Tests pass on Windows CI (if added) but fail on macOS dev machine, OR vice-versa.

### Pitfall 6: `vi.mock('node:fs/promises')` interaction with existing `node:fs` mock

**What goes wrong:** `tests/jdtls/client.test.ts` already mocks `node:fs` (lines 14-20). If Phase 36 tests in `tests/jdtls/workspace-sync.test.ts` add `vi.mock('node:fs/promises', …)`, they need to ensure both mocks coexist — `node:fs/promises` is a distinct module in Node 22 (not just a re-export of `node:fs`).
**Why it happens:** Conflating the two modules. `workspace-sync.ts` imports `rm`, `mkdir`, `writeFile` from `node:fs/promises` (line 9) and `realpathSync` from `node:fs` (line 10) — they're separate.
**How to avoid:** Use the `importActual` spread pattern (canonical idiom from `tests/jdtls/client.test.ts:6-12`) on `node:fs/promises` to keep the rest of the module functional:

```typescript
vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	return {
		...actual,
		rm: vi.fn(actual.rm),
	};
});
```

This wraps `rm` with a spy default-delegating to the real impl; tests can override per-call with `mockResolvedValueOnce(undefined)` or assert call-args without breaking sibling functions.

### Pitfall 7: `fileURLToPath` throws on `file://gradle-style-paths`

**What goes wrong:** If any callsite ever passes a Gradle-style two-slash `file://~/.m2/repository` URI through the new shared `fileUriToPath` helper, it throws `TypeError` (malformed file:// URI — WHATWG URL parser rejects non-hostname-shaped authorities).
**Why it happens:** `fileURLToPath` is strict — three-slash form on POSIX, two-slash UNC form on Windows only. Gradle's two-slash-plus-`~/` syntax violates both.
**How to avoid:** `gradle-parser.ts:36` keeps its local `fileUriToPath` for Gradle DSL strings. The shared `fileUriToPath` is for LSP `Location.uri` values only — and JDT LS always emits well-formed three-slash file:// URIs (D-07).
**Warning signs:** Phase 36 task accidentally migrates `gradle-parser.ts:36` → suite fails with `TypeError: Invalid URL` on Gradle-parser test inputs.

### Pitfall 8: `realpathSync` is still called at mapper creation — doesn't change

**What goes wrong:** Nothing — but worth flagging that Phase 36 does NOT remove the `realpathSync(tempDir)` call at `uri-mapper.ts:66` or the `realpathSync(jdtls.tempDir)` calls in `workspace-sync.ts:99,137,202,251` and `remove-project-member.ts:77`. These resolve the macOS `/tmp` → `/private/var/folders/…` symlink so URIs match JDT LS responses. They're orthogonal to the URI sweep.
**Why it might confuse:** D-10 says "no `fs.realpath`" — but D-10 is about the drive-letter case-fold logic, not about the existing `realpathSync` calls that resolve tempDir on macOS. Those stay.
**How to avoid confusion:** Planner explicitly leaves `realpathSync` calls in place. They're not in any of the 11 sites listed.

## Code Examples

### `pathToFileUri` round-trip verification (UNIX-02 test pattern)

```typescript
// tests/platform/uri.test.ts (NEW)
// Source: this research + Node docs round-trip example
import { describe, it, expect } from 'vitest';
import { pathToFileUri, fileUriToPath } from '../../src/platform/uri.js';

describe('UNIX-02 round-trip identity', () => {
	const inputs = [
		'/tmp/foo',
		'/private/var/folders/x y/file.java',           // space — must percent-encode
		'/tmp/path%with#odd$chars',                     // percent + hash
		'/tmp/already%20encoded',                       // pre-existing percent: %25 round-trip
		'/tmp/Bar.java',
	];

	for (const path of inputs) {
		it(`round-trips: ${path}`, () => {
			const uri = pathToFileUri(path);
			expect(uri.startsWith('file:///')).toBe(true);  // three-slash form
			expect(fileUriToPath(uri)).toBe(path);          // round-trip identity
		});
	}
});
```

### Drive-letter case-fold test (WIN-05 / D-23)

```typescript
// tests/jdtls/uri-mapper.test.ts (MODIFIED — add describe block)
// Source: this research + Phase 35 pattern reuse (D-21)

const originalPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('fromFileUri drive-letter case-fold (Windows)', () => {
	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
	});

	it('accepts uppercase drive letter when stored prefix is uppercase', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		// Mock realpathSync to passthrough so tempDir stays as given
		vi.doMock('node:fs', () => ({ realpathSync: (p: string) => p }));
		const map = new Map([['minecraft', 'minecraft']]);
		const mapper = createUriMapper('C:\\Temp\\xyz', map);
		// After Phase 36 internal migration, toFileUri emits three-slash form:
		expect(mapper.fromFileUri('file:///C:/Temp/xyz/minecraft/foo/Bar.java'))
			.toEqual({ jar: 'minecraft', entryPath: 'foo/Bar.java' });
	});

	it('accepts lowercase drive letter from JDT LS when stored is uppercase', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		vi.doMock('node:fs', () => ({ realpathSync: (p: string) => p }));
		const mapper = createUriMapper('C:\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		expect(mapper.fromFileUri('file:///c:/Temp/xyz/minecraft/foo/Bar.java'))
			.toEqual({ jar: 'minecraft', entryPath: 'foo/Bar.java' });
	});

	it('rejects different drive letter even with case-fold', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		vi.doMock('node:fs', () => ({ realpathSync: (p: string) => p }));
		const mapper = createUriMapper('C:\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		expect(mapper.fromFileUri('file:///D:/Temp/xyz/minecraft/foo/Bar.java')).toBeNull();
	});

	it('preserves case in jar-entry path tail', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		vi.doMock('node:fs', () => ({ realpathSync: (p: string) => p }));
		const mapper = createUriMapper('C:\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		const result = mapper.fromFileUri('file:///c:/Temp/xyz/minecraft/foo/BAR.java');
		expect(result?.entryPath).toBe('foo/BAR.java');   // exact case preserved
	});

	it('does NOT case-fold UNC URIs', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		vi.doMock('node:fs', () => ({ realpathSync: (p: string) => p }));
		// Stored prefix is UNC-shaped — no drive letter
		const mapper = createUriMapper('\\\\server\\share\\Temp\\xyz', new Map([['mc', 'mc']]));
		expect(mapper.fromFileUri('file://SERVER/share/Temp/xyz/mc/foo.java')).toBeNull();
	});
});
```

### `rm` retry options assertion (WIN-06)

```typescript
// tests/jdtls/workspace-sync.test.ts (MODIFIED — add describe block)
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { rm } from 'node:fs/promises';

vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	return { ...actual, rm: vi.fn(actual.rm) };
});

describe('WIN-06: rm called with retry options at every site', () => {
	const mockRm = vi.mocked(rm);
	beforeEach(() => mockRm.mockClear());

	it('extractStudyJarToWorkspace cleanup calls rm with maxRetries: 3, retryDelay: 100', async () => {
		// trigger the catch path (e.g., adapter that throws on readEntry)
		// ... call extractStudyJarToWorkspace with a JarReader that throws ...
		// assert rm was called at least once with the retry options:
		expect(mockRm).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ maxRetries: 3, retryDelay: 100, recursive: true, force: true }),
		);
	});

	// Three more tests for removeStudyJarFromWorkspace, syncFabricModToWorkspace catch path,
	// and unsyncFabricModFromWorkspace loop — same shape.
});
```

### Traversal rejection (WIN-07)

```typescript
// tests/jdtls/workspace-sync.test.ts (MODIFIED — add describe block)
describe('WIN-07: ZIP traversal rejection', () => {
	it('rejects entry containing .. segments', async () => {
		const jarReader = createMockJarReader(new Map([
			['/jars/evil.jar', new Map([['../etc/passwd', Buffer.from('payload')]])],
		]));
		const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-trav-'));
		tempDirs.push(tempDir);
		const studyJar = createMockStudyJar('evil', '/jars/evil.jar');
		await expect(extractStudyJarToWorkspace(studyJar, tempDir, jarReader))
			.rejects.toThrow(/escapes extraction root/);
		// also: cleanup invoked
	});

	it('rejects absolute Unix entry path', async () => { /* '/etc/passwd' */ });
	it('rejects absolute Windows entry path (Windows-mocked)', async () => { /* 'C:/Windows/System32/x' */ });
	it('rejects backslash-traversal (Windows-mocked)', async () => { /* '..\\..\\etc\\passwd' */ });
	it('rejects trailing-prefix bypass', async () => { /* depDir='/tmp/foo', entry resolves to '/tmp/foo-attack/x' */ });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `'file://' + path` two-slash hand-roll | `pathToFileURL(p).href` three-slash + percent-encoded | Phase 36 (this phase) | Fixes WIN-03 (Windows drive letters), UNIX-02 (round-trip with spaces), and the silent `/foo bar` → literal-space bug on Unix. |
| `uri.replace('file://', '')` reverse hand-roll | `fileURLToPath(u)` | Phase 36 (this phase) | Round-trip identity. Properly handles Windows-flavor URIs from JDT LS. |
| `join(depDir, entryPath)` raw ZIP-entry × FS join | `join(depDir, ...entryPath.split('/'))` | Phase 36 (this phase) | Fixes WIN-04 mixed-separator corruption. |
| No ZIP traversal defense | `resolve(target).startsWith(resolve(root) + sep)` | Phase 36 (this phase) | Closes WIN-07. Canonical OWASP / Snyk Zip-Slip defense. |
| `rm(p, { recursive, force })` no retry | `rm(p, { recursive, force, maxRetries: 3, retryDelay: 100 })` | Phase 36 (this phase) | Handles WIN-06 transient EBUSY/EPERM from AV/indexer. |
| `fromFileUri` byte-exact prefix match | Surgical drive-letter case-fold on Windows | Phase 36 (this phase) | Closes WIN-05 drive-letter case round-trip. |

**Deprecated/outdated:**
- Hand-rolled `'file://' + …` patterns. Multiple Node releases (10.12+) provide the proper builtin.
- `URL` constructor `url.pathname.replace(/^file:\/\//, '')` — older Node idiom, percent-decoding edge cases mishandled. Use `fileURLToPath`.
- `path.normalize` + substring `..` check for traversal — bypassable. Use post-`resolve` check.

## Open Landmines

> Things that could trip the planner that aren't covered by D-XX above.

### 1. `pathToFileURL` on a relative path silently resolves against `cwd()`

`pathToFileURL('foo/bar')` returns `'file://' + process.cwd() + '/foo/bar'` (resolved absolutely), NOT a relative URI. **Phase 36 sites all pass absolute paths**, but if the planner introduces a refactor that lets relative paths slip in, behavior changes silently. Defensive: planner can add a `path.isAbsolute(p)` precondition in `pathToFileUri` if any callsite is uncertain. [ASSUMED: all 7 forward sites currently pass absolute paths — VERIFIED by reading the surrounding code at each site this session; `workspaceDir`, `resolvedTempDir` are all absolute via `realpathSync` or constructor-time normalization.]

### 2. `fileURLToPath` throws on non-`file:` scheme — propagate or catch?

Current code `uri.replace('file://', '')` silently passes any non-`file:` URI through unchanged. `fileURLToPath` throws `TypeError`. **Behavior change for malformed inputs.** Phase 36 should NOT defensively catch — JDT LS only emits `file://` URIs, so a thrown TypeError indicates a real bug. The throw bubbles to the existing tool-helpers catch handler. [VERIFIED: read of `src/tools/tool-helpers.ts:340-370` this session shows the surrounding `try { source = await readFile(filePath, 'utf-8'); … } catch { continue; }` block at line 354 — IF `fileURLToPath` throws BEFORE `readFile`, it skips the catch. Planner should wrap line 350 in a separate try/catch OR move the assignment inside the existing try block.]

### 3. Two-slash `file://server/share/x` form is NOT what JDT LS sends

JDT LS sends three-slash `file:///path` for local files and `file:////server/share/x` (four slashes — three for `file://`, then host-as-server with no leading slash before `share`) for UNC. The `pathToFileURL` / `fileURLToPath` round-trip handles both. **But the existing `uri-mapper.ts` `toFileUri` constructs URIs from `normalizedTempDir`** which might be a UNC path on Windows if the user sets `TMPDIR` to a network share. After internal migration to `pathToFileUri`, this is handled correctly. Before migration (current code), the string concat would produce malformed URIs. **Planner: this is a strong argument for `uri-mapper.ts` adopting `pathToFileUri` internally per D-02.**

### 4. Jar-internal URIs already emitted by `uri-mapper.ts` — shape change?

`uri-mapper.ts` `toFileUri` produces `\`file://${normalizedTempDir}/${dirName}/${entryPath}\``. After Phase 36, if `toFileUri` internally uses `pathToFileUri(join(normalizedTempDir, dirName, entryPath))`, the emitted shape becomes three-slash percent-encoded on Windows but **identical to current on Unix for ASCII paths without special characters**. The `entryPath` may contain `$` (inner classes — `Foo$Bar.java`) — `$` is NOT a URL control character, so `pathToFileURL` does NOT percent-encode it. ✓ Safe. Verify in tests.

### 5. The 4th `rm` site (M4, line 245) is inside a `for` loop

`for (const depId of keysToRemove) { … await rm(…); … }` — adding retry options applies retry **per iteration**. Total worst-case wall time for cleanup of N deps: `N × 600ms` ≈ 30s for 50 deps. Acceptable; cleanup is post-error rare path. Flag for awareness.

### 6. CONTEXT.md line-number discrepancy

CONTEXT.md says F6 (forward URI site in `workspace-sync.ts`) is at line **252**. **Current HEAD has it at line 255.** ROADMAP says 255. **Planner: use 255.** The 3-line discrepancy is from a context-gathering transcription error; current grep is authoritative. No other sites have discrepancies.

### 7. The `windows: true` option to `pathToFileURL` — when do we need it?

Production: never. Node detects flavor from `process.platform`. Tests on macOS host that want to assert Windows-flavor output: pass `{ windows: true }` explicitly — but our wrapper `pathToFileUri(p)` does not expose this option. Options:
  (a) Tests rely on `pathToFileURL` auto-detecting `'C:\\…'` shape (Node does this — drive letter triggers Windows flavor regardless of host platform per Node docs).
  (b) Add a 2nd parameter `pathToFileUri(p, opts?: { windows?: boolean })` for test ergonomics.

This research recommends **(a)** — keeps the wrapper minimal; `pathToFileURL('C:\\foo')` returns `'file:///C:/foo'` even on darwin host. Verify in the first test commit; fall back to (b) if Node's auto-detection misbehaves. [ASSUMED — not empirically verified this session; reference: Node docs example `pathToFileURL('C:\\path\\')` is shown in the docs WITHOUT a `windows: true` option, implying auto-detection works.]

### 8. `uri-mapper.ts` `toFileUri` migrating internally to `pathToFileUri` changes the emitted shape

If the planner adopts D-02's "MAY use the new helpers as building blocks internally" recommendation, the wire-emit shape changes:
  - **Before:** `file://C:\Users\…\Temp\…/minecraft/foo/Bar.java` (two-slash + Windows backslashes — malformed)
  - **After:** `file:///C:/Users/.../Temp/.../minecraft/foo/Bar.java` (three-slash + forward slashes)

JDT LS happily consumes both on the receive side per its EMF URI handling. The case-fold logic in `fromFileUri` (Pattern 2 above) assumes three-slash form post-migration. **Planner: lock this in — `uri-mapper.ts` internal migration is part of Phase 36, not deferred.** If the planner defers it, the case-fold regex must be rewritten against the current two-slash-Windows-path shape, which is uglier and tied to a deprecated wire format.

## Out-of-Scope Confirmation

The following are explicitly out-of-scope for Phase 36, per CONTEXT.md `<deferred>`, REQUIREMENTS.md "Out of Scope", and ROADMAP success criteria:

1. **`src/project/gradle-parser.ts:36` `fileUriToPath`** — STAYS. Two semantic divergences from `fileURLToPath` make it incompatible: (a) accepts two-slash `file://~/.m2/repository` form Gradle emits; `fileURLToPath` requires three-slash; (b) performs `~/` → `homedir()` substitution; `fileURLToPath` does not. Documented in CONTEXT.md "Claude's Discretion" resolution. [VERIFIED: read of `src/project/gradle-parser.ts:31-42` this session confirms the two divergences are real and load-bearing for Gradle DSL parsing.] Reverse-consumer count for this phase is therefore **1** (only `tool-helpers.ts:350`).

2. **UNC long-path conversion (`\\?\C:\…` prefix)** — DEFERRED to a future milestone. REQUIREMENTS.md "Out of Scope" lists: "UNC `\\?\C:\…` long-path conversion — Node 22 opts in already; defer until empirically observed." Phase 36 does not handle the MAX_PATH limit on Windows. If a user hits a >260-char path, behavior is whatever Node 22 default does (which currently opts into long-path support on Windows 10+ in many call paths via libuv).

3. **No `fs.realpath` / canonical-path probing for symlink resolution** — D-10. Phase 36 uses pure-string semantic equivalence. Note: the **existing** `realpathSync` calls at `uri-mapper.ts:66` and `workspace-sync.ts:99/137/202/251` and `remove-project-member.ts:77` stay — they resolve the macOS `/tmp` → `/private/var/folders/…` symlink which is required for URIs to match JDT LS responses on macOS. D-10 forbids adding new `realpath` calls, not removing existing ones.

4. **`isFileUri(uri: string): boolean` convenience helper** — DEFERRED unless a callsite needs it during planning. Phase 36 callers know they're dealing with file URIs by context (JDT LS responses are always file://).

5. **No README / CLAUDE.md / docs changes for the URI sweep** — Phase 39 is the milestone-completion docs phase.

6. **No changes outside the 11 enumerated in-source sites + the new `src/platform/uri.ts` module** — including `src/browsing/`, `src/project/` (except the OUT-OF-SCOPE `gradle-parser.ts:36`), `src/state/`, `src/cli/`, `src/server.ts`, `src/index.ts`, all other tools beyond `tool-helpers.ts` / `remove-project-member.ts`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fs.promises.rm` linear backoff is `retryDelay`, `2*retryDelay`, `3*retryDelay` (total ~600ms with `retryDelay: 100, maxRetries: 3`) | API Quick Reference; Pitfall (none — covered by D-18) | LOW — multiple community sources agree; matches the rimraf-based implementation Node inherited. If Node ever changes to constant or exponential backoff, the total cleanup time changes by < 1 second — negligible. Direct verification via reading nodejs/node `lib/internal/fs/rimraf.js` source would close this; deferred. [VERIFIED: WebSearch this session; node commit f725953 introduces the retryDelay option; not re-fetched from source this session.] |
| A2 | `pathToFileURL` on a darwin host correctly auto-detects Windows-shaped input (`'C:\\foo'`) and produces `'file:///C:/foo'` without needing `{ windows: true }` | Pitfall 5; Open Landmine 7 | MEDIUM — if Node does NOT auto-detect drive letters on non-Windows hosts, the test scaffolding needs to thread `{ windows: true }` through the wrapper. Easy mitigation: add a 2nd parameter to `pathToFileUri`. Verify in the first Wave 0 test commit. [ASSUMED — Node docs example shows `pathToFileURL('C:\\path\\')` returning `'file:///C:/path/'` without explicit option, but the example might be run from a Windows context. Direct empirical check needed.] |
| A3 | JDT LS lowercases the drive letter on URI emit (the symptom WIN-05 targets) | Drive-Letter Case-Fold Logic; Pitfall 4 | LOW — the case-fold is **safe** even if JDT LS doesn't lowercase the drive letter (`'C' === 'C'` matches byte-exact too). Cost of being wrong: case-fold does nothing for some users; no harm. [CITED: EMF Bug 446987 — Eclipse's URI.createURI lowercases since EMF 2.9; VS Code #46172 — `Uri.file(x).fsPath` does the same. JDT LS uses EMF underneath. Strong precedent.] |
| A4 | Existing `try/catch` at `workspace-sync.ts:47` (`extractStudyJarToWorkspace`) and `:210` (`syncFabricModToWorkspace`) correctly cleans up `depDir` when the new traversal-throw fires | ZIP-Slip Canonical Pattern; D-14 invocation | LOW — VERIFIED by reading the code: `extractStudyJarToWorkspace` catch calls `rm(depDir, { recursive: true, force: true })`; `syncFabricModToWorkspace` catch iterates `createdDirs` and calls `rm` on each. Throwing inside the for-loop bubbles to the catch — confirmed by `git blame` showing these catches exist for general error handling. [VERIFIED: codebase read this session of `src/jdtls/workspace-sync.ts` lines 35-50 and 170-222.] |
| A5 | `node-stream-zip`'s entry listing returns entry names with `/` separators per APPNOTE.TXT 4.4.17.1 (so `entryPath.split('/')` is correct) | ZIP-Slip Canonical Pattern; Pitfall 1 | LOW — ZIP spec mandates `/` regardless of host. Direct verification: `JarReader.listJavaEntries` (via `adapter.listJavaEntries`) returns paths like `'net/minecraft/client/MinecraftClient.java'` — confirmed by reading `src/browsing/source-adapter.ts` and downstream tests in past sessions. [VERIFIED: codebase grep `entryPath.split` returns no current matches — first introduction; structural argument from ZIP spec + node-stream-zip docs.] |
| A6 | `fileURLToPath` on Unix correctly handles `/private/var/folders/…/file with spaces.java` percent-encoded round-trip without OS-level realpath divergence | UNIX-02 round-trip test inputs | LOW — `pathToFileURL` percent-encodes the space at construction; `fileURLToPath` decodes on consumption. No realpath involved in the conversion (orthogonal to `uri-mapper.ts:66` which calls `realpathSync` separately). [CITED: Node docs round-trip example `fileURLToPath('file:///hello world')` → `'/hello world'`.] |
| A7 | The `uri-mapper.ts` internal migration to `pathToFileUri` for the prefix construction is in scope for Phase 36 (vs. being deferred) | Pattern 2 footnote; Open Landmine 8 | MEDIUM — if deferred, the case-fold regex must target the current two-slash-Windows-mixed-separator shape, which is uglier. CONTEXT.md D-02 says "MAY use the new helpers as building blocks internally" — permissive, not mandatory. Research recommends including; planner should confirm via discuss-phase if uncertain. [ASSUMED — D-02 is permissive; this research's recommendation is to take the permission.] |
| A8 | Adding `vi.mock('node:fs/promises')` to `tests/jdtls/workspace-sync.test.ts` does not break the existing tests that use real-fs operations (`mkdtemp`, `writeFile`, `rm`) | Pitfall 6; Test Plan | LOW — the `importActual` spread pattern preserves the real implementations; `rm` mock can default-delegate via `vi.fn(actual.rm)`. Existing tests proceed unchanged; new tests override per-call. [VERIFIED: pattern already in use in `tests/jdtls/client.test.ts:14-20` for `node:fs.existsSync`.] |

**If this table is empty:** Not empty. Highest-risk assumption is **A2** (Windows-flavor detection on darwin host) — if wrong, every Windows-mocked URI test on a macOS dev machine misbehaves. Mitigation is small (add `{ windows: true }` option to wrapper, or use explicit `pathToFileURL` in test code). The planner should add an early Wave 0 test that asserts the basic shape on a darwin host as the first commit — if it fails, take the mitigation immediately.

## Open Questions (RESOLVED)

> Most CONTEXT.md decisions are locked; only the following remain.

### 1. Does `uri-mapper.ts` migrate internally to `pathToFileUri` in this phase? (Open Landmine 8)

- **What we know:** D-02 says "MAY use the new helpers as building blocks internally; the public method shape stays."
- **What's unclear:** Whether the planner takes the permission or defers it.
- **Recommendation:** **Take it.** Keeps the case-fold regex matching the emitted wire shape (three-slash form). Smaller diff in aggregate across the milestone (vs. deferring and rewriting the case-fold logic later). If the planner prefers conservatism, the alternative is a 1-task-bigger plan but no functional difference.

### 2. Should `pathToFileUri` expose a `{ windows: true }` option for test ergonomics? (A2 / Open Landmine 7)

- **What we know:** Production never needs it.
- **What's unclear:** Whether `pathToFileURL` on a darwin host auto-detects Windows-shaped input strings.
- **Recommendation:** Start without the option; add only if the first Wave 0 test on darwin fails to produce `file:///C:/…` from `'C:\\path'`.

### 3. Should `src/tools/remove-project-member.ts` `rm` calls at lines 96 and 104 also get retry options?

- **What we know:** CONTEXT.md D-17 enumerates exactly 4 sites, all in `workspace-sync.ts`. The 2 in `remove-project-member.ts` are NOT in the list.
- **What's unclear:** Whether this is an intentional restriction or an oversight in context-gathering.
- **Recommendation:** Treat D-17 as locked (4 sites in `workspace-sync.ts` only). If the planner sees evidence of EBUSY in `remove-project-member.ts` cleanup during testing or end-to-end use, raise via discuss-phase to extend D-17. Defensive note in plan: tag the omission as a known scope boundary.

### 4. Does `fileUriToPath` need a try/catch wrapper at `tool-helpers.ts:350` for `TypeError` on malformed URIs? (Open Landmine 2)

- **What we know:** The surrounding `try { source = await readFile(filePath, 'utf-8'); … } catch { continue; }` at line 354 catches errors from `readFile`, NOT from the line 350 assignment.
- **What's unclear:** Whether to widen the try block to include the `fileUriToPath` call, or trust JDT LS to never emit malformed URIs.
- **Recommendation:** **Widen the try block** to include line 350. Cheap, defensive, no behavior change in the happy path. Skip the malformed URI via `continue` (consistent with the existing `if (!mapping) continue;` pattern at line 348).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (`node:url`, `node:path`, `node:fs/promises`) | Build/runtime | ✓ | 22 LTS (engines >= 22) | — |
| pnpm | Package management | ✓ | 10.26.0 (packageManager pin) | — |
| TypeScript | Type checking / tsx execution | ✓ | 6.0.2 (devDep) | — |
| vitest | Test runner | ✓ | 4.1.4 (devDep) | — |
| `src/platform/index.ts` `isWindows` const | Drive-letter case-fold branch | ✓ | Phase 35 already landed | — |
| Real Windows machine | Phase 39 end-to-end validation | ✗ for Phase 36 | — | Unit tests with mocked `process.platform` (D-21; Phase 35 endorsed) |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Real Windows machine — fallback is mocked unit tests; full Windows validation deferred to Phase 39.

## Validation Architecture

(See "Test Plan → Validation Architecture (§5.5 Nyquist gate)" subsection above. Reproduced here for the planner's gate-check.)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` (testTimeout: 10000ms, env: node, include: tests/**/*.test.ts) |
| Quick run command | `pnpm test -- tests/platform/uri.test.ts tests/jdtls/uri-mapper.test.ts tests/jdtls/workspace-sync.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

(Mapped in detail above under "Test Plan → REQ-ID → Test Mapping". All 6 REQs map to automated vitest unit tests; the optional LSP-snapshot in `tests/jdtls/client.test.ts` is the only soft requirement.)

### Sampling Rate

- **Per task commit:** quick-run (~1-3s)
- **Per wave merge:** full suite (~10-30s)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/platform/uri.test.ts` — NEW file covering WIN-03 + UNIX-02
- [ ] `tests/jdtls/uri-mapper.test.ts` — add `describe('fromFileUri drive-letter case-fold (Windows)', …)` covering WIN-05
- [ ] `tests/jdtls/workspace-sync.test.ts` — add `describe('WIN-07: ZIP traversal rejection', …)` and `describe('WIN-06: rm called with retry options at every site', …)`
- [ ] `tests/jdtls/client.test.ts` — optional, add `describe('rootUri three-slash form on Windows', …)`
- [ ] Framework install: none — vitest + Node stdlib only

**Source code gaps:**
- [ ] `src/platform/uri.ts` — NEW module (2 exports, wrapping `pathToFileURL` / `fileURLToPath`)
- [ ] `src/jdtls/client.ts` — modify F1 (line 245), F2 (line 278)
- [ ] `src/jdtls/workspace-sync.ts` — modify F3 (103), F4 (141), F5 (206), F6 (255), Z1 (40), Z2 (184), M1 (48), M2 (62), M3 (215), M4 (245)
- [ ] `src/jdtls/uri-mapper.ts` — modify `fromFileUri` for drive-letter case-fold; optionally migrate `toFileUri` to use `pathToFileUri` internally (recommended per Open Question 1)
- [ ] `src/tools/remove-project-member.ts` — modify F7 (line 83)
- [ ] `src/tools/tool-helpers.ts` — modify R1 (line 350); widen surrounding try block to catch `TypeError` per Open Question 4

## Security Domain

> `security_enforcement` not in `.planning/config.json` — treating as enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no auth surface in this phase |
| V3 Session Management | no | N/A — JDT LS sessions managed by existing code; no Phase 36 changes |
| V4 Access Control | no | N/A |
| **V5 Input Validation** | **yes (CRITICAL)** | **ZIP traversal guard at the JarReader-entry → on-disk-path boundary (D-12, D-13). Post-resolution descendant check with trailing-sep guard.** |
| V6 Cryptography | no | N/A |
| **V12 File Handling** | **yes** | **Post-resolution `resolve(target).startsWith(resolve(root) + sep)` check before any `writeFile`. Logging of rejected entry path at warn level (D-15) for audit trail.** |

### Known Threat Patterns for `node-stream-zip` + filesystem writes

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ZIP-slip / archive-extraction path traversal (`../`, absolute path, `\`-separator) | Tampering | Post-resolution descendant check (D-12). Trailing-sep guard (D-13). Throw + cleanup-on-throw (D-14). Documented in CWE-22, OWASP, Snyk Zip-Slip whitepaper. |
| Malicious study jar uploaded via `/add-study-jar` | Tampering / Elevation of Privilege | Threat model recap (D-16): study jars are the only user-supplied attack vector. Loom/Maven jars are low-trust-but-not-adversarial; same check applies at zero cost in the common case. |
| Symlink TOCTOU between traversal check and `writeFile` | Tampering | NOT mitigated (D-10 forbids `realpath`). Acceptable risk: the MCP server runs with the user's own privileges; an attacker who can place symlinks in `depDir` already has equivalent file-write access. The check rejects the path-name-based escape vector; symlink-based escape requires prior local write access which is a separate threat model. |
| Drive-letter case-confusion (Windows) allowing distinct files to be mistaken for each other | Spoofing | Surgical case-fold (D-09) — only the drive letter is case-insensitive; every other byte is case-sensitive. NTFS may be case-sensitive; ReFS is; ext4 mounted on Windows is. Treating non-drive-letter bytes as case-insensitive would conflate distinct files. |
| Malformed `file://` URI from compromised JDT LS process | DoS (TypeError throws unhandled) | Open Question 4 recommendation: widen `tool-helpers.ts:350` try block to catch and `continue`. No information disclosure. |

## Project Constraints (from CLAUDE.md)

These directives MUST be honored by the planner:

- **GSD workflow enforcement.** All edits go through `/gsd:execute-phase`. No direct repo edits outside a GSD workflow.
- **Tab indentation** in all source files. Verified by reading `src/platform/index.ts`, `src/jdtls/client.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/uri-mapper.ts`, `src/tools/remove-project-member.ts`, `src/tools/tool-helpers.ts` — all use tabs.
- **TypeScript only** for source. Strongly typed interfaces.
- **pnpm** for package management.
- **tsx** for development execution; **tsup** for production bundling; **vitest** for tests.
- **No new runtime dependencies.** Phase 36 adds zero — pure Node 22 stdlib + existing Phase 35 platform module.
- **Tool response envelope** convention (`makeSuccess`/`makeError`) — `tool-helpers.ts:350` is INSIDE the navigation-result builder, which feeds back into `makeSuccess`. The R1 site change doesn't affect the envelope shape; verify in tests.
- **No nested JSON strings in MCP responses** — N/A for Phase 36 (no tool response text changes).
- **Domain logic in `src/jdtls/`, `src/project/`, `src/browsing/`; tools are thin wrappers** — Phase 36 modifies `src/jdtls/` and `src/tools/`. The new `src/platform/uri.ts` is in the existing `src/platform/` layer Phase 35 established (cross-cutting, justified).
- **Tests in `tests/`** — Phase 36 adds `tests/platform/uri.test.ts` and extends 2-3 existing `tests/jdtls/*.test.ts` files.
- **Performance: Must be fast.** Per-file overhead: `pathToFileURL` is a thin WHATWG URL constructor (sub-microsecond); `fileURLToPath` similar; traversal `resolve` is a sync call but bounded; `rm` retry adds at most 600ms in the failure path. All acceptable. No I/O hot path changes.
- **No caching of extracted files** — Phase 36 doesn't add caches; ZIP extraction continues to write directly to JDT LS temp dirs.
- **Strongly typed interfaces** — `pathToFileUri(absPath: string): string`, `fileUriToPath(uri: string): string`. All exports typed.

## Sources

### Primary (HIGH confidence)

- **Codebase direct read this session:**
  - `src/jdtls/client.ts` lines 1-352 (full file) — forward sites F1 (245), F2 (278); LSP `initialize` shape
  - `src/jdtls/workspace-sync.ts` lines 1-267 (full file) — forward sites F3-F6 (103, 141, 206, 255); ZIP sites Z1 (40), Z2 (184); rm sites M1-M4 (48, 62, 215, 245)
  - `src/jdtls/uri-mapper.ts` lines 1-105 (full file) — `toFileUri` / `fromFileUri` current implementation
  - `src/tools/remove-project-member.ts` lines 1-139 — forward site F7 (83)
  - `src/tools/tool-helpers.ts` lines 340-369 — reverse site R1 (350)
  - `src/project/gradle-parser.ts` lines 1-80 — local `fileUriToPath` (out-of-scope confirmation)
  - `src/platform/index.ts` (Phase 35) — `isWindows` consumer pattern
  - `tests/platform/index.test.ts` lines 1-100 — `setPlatform + vi.resetModules + dynamic import` reuse pattern
  - `tests/jdtls/client.test.ts` lines 1-120 — `vi.mock('node:fs')` reuse pattern
  - `tests/jdtls/uri-mapper.test.ts` lines 1-60 — current test shape (no Windows mocks today)
  - `tests/jdtls/workspace-sync.test.ts` lines 1-80 — current test shape, fixture helpers
  - `.planning/phases/36-path-uri-handling-audit/36-CONTEXT.md` — D-01 through D-25 locked decisions
  - `.planning/REQUIREMENTS.md` — WIN-03 through WIN-07, UNIX-02 definitions
  - `.planning/ROADMAP.md` lines 122-133 — Phase 36 success criteria
  - `.planning/phases/35-platform-helpers-java-executable-resolution/35-RESEARCH.md` lines 51-54, Pattern 1 — Phase 35 carry-forward
  - `.planning/phases/35-platform-helpers-java-executable-resolution/35-PATTERNS.md` — Shared Patterns → Platform Mocking + node-built-in mocking
  - `.planning/config.json` — `nyquist_validation: true`

- **Node.js official docs (WebFetch this session):**
  - [pathToFileURL / fileURLToPath](https://nodejs.org/api/url.html) — input/output shapes, drive-letter handling, UNC, percent-encoding, `windows` option, `%2e%2e` decoding warning

### Secondary (MEDIUM confidence)

- **Node.js docs + community sources (WebSearch this session) — `fs.rm` retry behavior:**
  - [fs.promises.rm options](https://nodejs.org/api/fs.html) — `maxRetries`, `retryDelay`, error codes (EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM)
  - [nodejs/node commit f725953 — fs: add retryDelay option to rimraf](https://github.com/nodejs/node/commit/f725953433)
  - [nodejs/node commit 4fffb42 — fs: add ENFILE to rimraf retry logic](https://github.com/nodejs/node/commit/4fffb42939)
  - [nodejs/node commit 1610728 — fs: add rm method](https://github.com/nodejs/node/commit/1610728d7c)

- **Drive-letter case-fold precedent:**
  - [Eclipse Bug 446987 — EMF lowercases drive letters in URI.createURI](https://bugs.eclipse.org/bugs/show_bug.cgi?id=446987)
  - [VS Code issue #46172 — `Uri.file(x).fsPath` lowercases drive letter](https://github.com/microsoft/vscode/issues/46172)

- **ZIP-slip canonical defense:**
  - [Snyk Zip-Slip vulnerability disclosure](https://snyk.io/research/zip-slip-vulnerability)
  - [sindresorhus/extract-zip — post-resolution check pattern](https://github.com/maxogden/extract-zip)
  - OWASP CWE-22 — Improper Limitation of a Pathname to a Restricted Directory

- **RFC 8089 — The `file` URI Scheme** — § 2 (case-insensitive compare is the implementation's job), § 3 (UNC URI forms)

### Tertiary (LOW confidence)

- A2 — `pathToFileURL` auto-detects Windows shape on darwin host. Inferred from Node docs example, not empirically verified this session. Mitigation strategy documented.
- A1 — `fs.rm` linear backoff is `n * retryDelay`. WebSearch sources agree; not re-read from `lib/internal/fs/rimraf.js` source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; pure Node 22 stdlib + existing Phase 35 platform module.
- Architecture: HIGH — every site grep-verified at current HEAD; D-XX decisions copied verbatim from CONTEXT.md.
- Pitfalls: HIGH — 8 pitfalls each tied to a specific code path or Node-doc warning; only A2 (Windows-flavor on darwin) flagged for empirical verification in Wave 0.
- Test scaffolding: HIGH — Phase 35's `setPlatform + vi.resetModules + dynamic import` pattern is proven (in use in 2 test files); Phase 36 copies the shape.
- Validation architecture: HIGH — all 6 REQ-IDs map to automated unit tests; full suite gate; quick-run feedback per task commit.

**Site verification:** All 11 sites (7 forward + 1 reverse + 2 ZIP + 4 rm — the 4 rm overlap workspace-sync.ts file but at distinct lines) confirmed at current HEAD via `grep -n` this session. One discrepancy from CONTEXT.md (F6 at line 255, not 252) reported under "Open Landmines" §6 and "Site List Verification".

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days — stable surgical refactor; no fast-moving libraries involved; CONTEXT.md decisions locked.)
