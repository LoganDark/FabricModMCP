# Technology Stack — v1.6 Windows Support

**Project:** FabricModMCP
**Researched:** 2026-05-15
**Scope:** Stack additions/changes for Windows support and smarter cross-platform Java discovery
**Confidence:** HIGH

## TL;DR

**No new runtime dependencies are needed for v1.6.** Node.js 22 LTS stdlib (`node:child_process`, `node:path`, `node:fs`, `node:os`, `node:url`) plus the existing `gradle-parser.ts` line-based parser already cover everything required for the four capability areas in question. The adjustments are pure code, not new packages:

1. Append `.exe` literally on `process.platform === 'win32'` when probing Java candidates — no `which`/PATHEXT dance needed (the existing `execSync('"<javaPath>" --version')` pattern on Windows runs through `cmd.exe`, which already honors PATHEXT for the bare `java` PATH fallback; explicit `javaHome/bin/java` candidates just need the `.exe` suffix).
2. Use the Node 22 stdlib `url.pathToFileURL()` / `url.fileURLToPath()` for any new (and audited existing) URI ↔ path conversions. Replaces the current `'file://' + path` string concatenation in `src/jdtls/client.ts` for the workspace root URI (broken on Windows: produces `file://C:\path` with 2 slashes, drive letter parsed as host).

**Why no JDK-detection library:** The existing `detectJava()` already probes Java via `execSync('"<javaPath>" --version')` and parses the output. That **is** the fundamental probe — a library would just wrap the same loop with a different candidate-collection strategy. The maintained `locate-java-home`-style options are inactive (~26 weekly downloads, no releases in 12+ months) or niche academic forks. The v1.6 priority chain (`--java-home` → `org.gradle.java.home` → `JAVA_HOME` → `java` on PATH → common install locations) is a clean linear sequence — better expressed as 20 lines of explicit candidate collection in `src/jdtls/client.ts` than as a dependency that doesn't quite fit.

---

## Recommended Stack Additions

### Core Technologies

**No additions.** The existing stack is sufficient. Reaffirmed below.

| Technology | Version | Purpose | Why for v1.6 |
|------------|---------|---------|--------------|
| Node.js `node:child_process` (stdlib) | 22 LTS | Spawning Java processes, `execSync('java --version')` | Already used in `src/jdtls/client.ts:76`. On Windows, `execSync` with a quoted string runs through `cmd.exe`, which **does** honor PATHEXT for a bare `java` invocation. `spawn` (used for the long-lived JDT LS) does **not** honor PATHEXT — but by that point `javaPath` has been resolved to an absolute path with `.exe` suffix on Windows, so this is a non-issue. |
| Node.js `node:path` (stdlib) | 22 LTS | Path joining, platform-specific separators | `join()` already normalizes per-platform. `path.win32.*` / `path.posix.*` available where a code path needs a forced flavor (e.g., POSIX-style globs into `picomatch`). |
| Node.js `node:url` (stdlib) | 22 LTS | `pathToFileURL()` / `fileURLToPath()` | **Critical for Windows:** existing `'file://' + workspaceDir` in `src/jdtls/client.ts:214,247` produces `file://C:\path` on Windows — 2 slashes, drive letter as host, backslash separators. JDT LS rejects/misinterprets this. `pathToFileURL()` produces the correct `file:///C:/path` form. Code change, not a dependency. Available since Node 10.12; rock-solid in 22 LTS. |
| Node.js `node:fs` (stdlib) | 22 LTS | `existsSync`, `mkdir` | No change; Node fs handles Windows paths transparently. |

### Supporting Libraries

| Library | Version | Recommendation |
|---------|---------|----------------|
| (none new) | — | **Do not add.** |

### Development Tools

| Tool | Status | Notes |
|------|--------|-------|
| vitest 4.x (existing) | Keep | Test new Windows branches via mocking `process.platform` and stubbing `existsSync`. A Windows CI runner is **not** required for v1.6 — the platform-guarded branches are unit-testable on macOS/Linux. |
| `@types/node` 25.x (existing) | Keep | Already covers `node:url` (`pathToFileURL` / `fileURLToPath`), `path.win32` / `path.posix`. |
| `tsx` 4.x, `tsup` 8.x (existing) | Keep | Both run cleanly on Windows; no change. |

## Installation

```bash
# No new dependencies for v1.6.
pnpm install
```

---

## Question-by-Question Recommendations

### Q1: JDK detection library?

**Recommendation: DO NOT ADD. Keep the existing `execSync('java --version')` + `parseJavaVersion()` pattern in `src/jdtls/client.ts`, and extend it with new candidate sources (gradle.properties, well-known install locations).**

#### Evidence — library options

| Library | Latest | Status | Why not |
|---------|--------|--------|---------|
| `locate-java-home` (jvilk) | 1.1.2 | **Inactive** — no npm releases in 12+ months, ~26 weekly downloads (Snyk advisor). | Abandoned. |
| `@viperproject/locate-java-home` | 1.1.10 | Maintained fork, last published ~2 months ago by the Viper academic project. | Niche maintainer, tiny audience, pulls in Windows-registry probing we don't need. The fork exists because the Viper toolchain needs Java detection; not a general-purpose ecosystem standard. |
| `find-java-home` (jsdevel) | — | Old, Windows-registry-based, minimal maintenance signal. | Returns a single `JAVA_HOME` (registry → JAVA_HOME → PATH fallback), not a probe-multiple-candidates flow. Cannot express the v1.6 priority chain (`--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → well-known dirs). |
| `find-java-home-sync` | — | Thin sync wrapper. | Same issues. |

#### Why stdlib is sufficient

The v1.6 priority chain is **explicit and ordered**, and `detectJava()` already implements the inner loop:

```
for each candidate in (--java-home, gradle.properties:org.gradle.java.home, $JAVA_HOME, "java", well-known-locations...):
    run `${candidate} --version` via execSync
    parse major version
    if >= 21: use it; else: continue
```

Each candidate is just a `javaPath` string (either `<home>/bin/java[.exe]` or a bare `java`). The existing `execSync(...)` + `parseJavaVersion()` loop **is** the probe. A library would replace candidate collection with its own opinion — losing the explicit priority order the milestone requires.

**Java registry on Windows is NOT required.** The well-known-locations probe (last in the chain) covers the same JDKs the registry would surface, without needing to spawn `reg.exe` or pull in a `winreg`-style dep:

- `C:\Program Files\Eclipse Adoptium\jdk-*` (Adoptium / Temurin)
- `C:\Program Files\Microsoft\jdk-*` (Microsoft Build of OpenJDK)
- `C:\Program Files\Java\jdk-*` (Oracle JDK)
- `C:\Program Files\Amazon Corretto\jdk*` (Corretto)
- `%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-*` (user-scope Adoptium)

If the user has installed via the standard installer, the JDK lands in one of these. The `glob` package (already a dep) expands `jdk-*` patterns.

#### Unix regression analysis

**Zero risk.** No change to the actual JDK-spawn path on Unix. New code is additive candidate collection (gradle.properties parsing, well-known directory globbing) feeding the same existing `execSync` probe. The `JAVA_HOME` + bare `java` candidates and their order remain unchanged on Unix.

#### Integration point

Extend `detectJava()` in `src/jdtls/client.ts:65`:

- Accept an optional `gradleJavaHome` parameter (caller reads it from the active project's `gradle.properties`).
- After the existing `JAVA_HOME` / PATH candidates, append platform-specific well-known directories. Use `glob` (already a dep) to expand wildcards.
- On `process.platform === 'win32'`, every `<home>/bin/java` candidate gets `.exe` appended (see Q3).

Caller (likely `src/server.ts` startup or `create_project` tool handler) is responsible for reading `gradle.properties` from the active project — see Q4.

---

### Q2: Windows path / URI handling library?

**Recommendation: DO NOT ADD. Use Node 22 stdlib `node:path` and `node:url` (`pathToFileURL` / `fileURLToPath`).**

#### Why stdlib is sufficient

- **Path joining:** `path.join()` (already used everywhere) emits the correct platform separator. No change.
- **Drive letters and UNC:** Handled transparently by `node:fs` and `node:path` on Windows. No abstraction needed.
- **URI ↔ path:** `url.pathToFileURL(absPath).toString()` produces the correct form on every platform:
  - Unix: `pathToFileURL('/home/user/proj').href` → `'file:///home/user/proj'`
  - Windows: `pathToFileURL('C:\\Users\\u\\proj').href` → `'file:///C:/Users/u/proj'`
  - `fileURLToPath` reverses it.
  - Available since Node 10.12; stable in Node 22.
- **Forced POSIX paths:** If a specific code path needs Unix-style separators in a non-FS context (e.g., a glob pattern, or a jar entry path — jar entries are always `/`-separated regardless of host OS), use `path.posix.join()` explicitly. `picomatch` and `glob` already handle this internally for their domains.

#### What NOT to add

| Avoid | Why |
|-------|-----|
| `slash` (sindresorhus) | Just does `str.replace(/\\/g, '/')`. One-liner. No need for a dep. |
| `normalize-path` | Same as `slash` plus unicode normalization we don't need. |
| `upath` | Wraps `node:path` with POSIX-forcing variants. Useful if you want a single `upath.join()` everywhere — but **that's exactly the "platform-agnostic refactor" the milestone forbids.** Use `path.posix.*` explicitly when needed. |
| `file-uri-to-path`, `file-url` | Pre-Node-10 polyfills. Obsolete — `node:url` does this natively. |
| `cross-path` | Last meaningful release years ago. |

#### Unix regression analysis

**Adopting `pathToFileURL`/`fileURLToPath` produces identical output to the existing `'file://' + abspath` string concatenation on Unix for the typical absolute-path case:**

```
// Existing Unix behavior:
'file://' + '/home/user/proj'   →  'file:///home/user/proj'  (3 slashes)
// pathToFileURL on Unix:
pathToFileURL('/home/user/proj').href  →  'file:///home/user/proj'  (3 slashes)
```

Byte-for-byte identical for absolute paths. The only Unix-side wrinkle: `pathToFileURL` percent-encodes characters that need it (e.g., spaces become `%20`). The current naive concatenation **does not** — which is technically a Unix bug for paths with spaces. Adopting `pathToFileURL` is a Unix correctness improvement, not a regression. Workspace dirs are created with `randomUUID()` (`src/jdtls/client.ts:169`) so they never contain special chars in practice; the user's project root paths may, but `JDT LS` accepts both encoded and unencoded forms.

**Recommendation:** Adopt `pathToFileURL` for the JDT LS workspace URIs only (the audit-flagged sites). Leave `src/project/gradle-parser.ts:37` `fileUriToPath` alone — that one parses user-authored `build.gradle.kts` URIs which are a different beast and are already platform-portable in the Kotlin DSL (Gradle's own URI parsing).

#### Integration points (audit targets)

Files needing review during the audit, with their current pattern and required change:

| File | Current pattern | Required change |
|------|----------------|-----------------|
| `src/jdtls/client.ts:214` | `rootUri: 'file://' + workspaceDir` | `rootUri: pathToFileURL(workspaceDir).href` |
| `src/jdtls/client.ts:247` | `workspaceFolders: [{ uri: 'file://' + workspaceDir, ... }]` | `uri: pathToFileURL(workspaceDir).href` |
| `src/jdtls/uri-mapper.ts` | (named in milestone for audit) | Use `fileURLToPath` for inbound URIs from JDT LS; `pathToFileURL` for outbound |
| `src/jdtls/workspace-sync.ts` | (named in milestone for audit) | Same; any URI it constructs for didOpen/etc. |
| `src/project/gradle-parser.ts:37` | `fileUriToPath` for user-authored `build.gradle.kts` repo URIs | **Leave alone** — different domain (build script content, portable across platforms) |

---

### Q3: PATHEXT / `.exe` resolution on Windows?

**Recommendation: Append `.exe` literally on `process.platform === 'win32'` for explicit `<home>/bin/java` candidates. For the bare `java` PATH fallback, leave it as `java` — `execSync` runs through `cmd.exe` which honors PATHEXT. DO NOT add `which`, `cross-spawn`, or any PATH-resolver library.**

#### Evidence

- `child_process.spawn()` on Windows does **not** apply PATHEXT — confirmed by [nodejs/node#6671](https://github.com/nodejs/node/issues/6671) (open since 2016) and v0.x-era [nodejs/node-v0.x-archive#2318](https://github.com/nodejs/node-v0.x-archive/issues/2318). This is the long-standing reason `cross-spawn` exists.
- `child_process.execSync` with a string command on Windows **does** invoke `cmd.exe` (the default shell when a string command is passed), which **does** honor PATHEXT. The existing `execSync('"${javaPath}" --version', ...)` call in `detectJava()` therefore already works on Windows for a bare `java` input.
- `child_process.spawn` is used for the long-lived JDT LS process in `startJdtLs()` (`src/jdtls/client.ts:193`) — but by that point `javaPath` is an explicit absolute path returned by `detectJava()`. PATHEXT is irrelevant; we just need the `.exe` suffix to be present on the absolute path.

#### The minimal Windows fix

In `detectJava()` (`src/jdtls/client.ts:65`):

```ts
const isWin = process.platform === 'win32';
const exe = isWin ? '.exe' : '';

if (javaHome) {
    candidates.push(join(javaHome, 'bin', `java${exe}`));
}
candidates.push('java');  // unchanged — execSync resolves via cmd.exe / PATHEXT on Windows
```

For the bare `java` candidate: `execSync('"java" --version')` invokes `cmd.exe /d /s /c "java --version"`, which on Windows resolves `java` → `java.exe` via `PATHEXT`. **No code change needed for the PATH-resolution case.**

For the well-known-locations probe (NEW in v1.6), each candidate is an explicit absolute path: append `.exe` on Windows.

#### What NOT to add

| Avoid | Why |
|-------|-----|
| `which` (npm package by Isaac Schlueter) | Maintained, would work, but adds a dep solely to do `join(home, 'bin', 'java' + (isWin ? '.exe' : ''))`. The bare-`java` case is already handled by `cmd.exe` via `execSync`. No regression risk, but no value. |
| `cross-spawn` | Solves `spawn` + PATHEXT + shell-script invocation. We don't have that problem — JDT LS is `spawn`ed with an already-resolved absolute path, and Java is not a shell script. Adds a wrapper for a code path that doesn't need it. |
| `@npmcli/which` | Same as `which`. |
| `find-up` for `java.exe` | Wrong tool — find-up walks parent dirs, not PATH entries. |

#### Unix regression analysis

`exe` is the empty string on Unix. `join(javaHome, 'bin', 'java')` is byte-for-byte identical to existing Unix behavior. **Zero risk.**

#### Integration point

`detectJava()` in `src/jdtls/client.ts:65-104`. Three lines change inside the existing function — no new module, no new dependency.

For `findJdtLs()` (`src/jdtls/client.ts:128`), the JDT LS launcher is a `.jar`, not an `.exe` — no PATHEXT concern. Just add Windows install locations to the `commonLocations` array: `%LOCALAPPDATA%\jdtls`, `%USERPROFILE%\jdtls`, `C:\Program Files\jdtls`. Read these from `process.env.LOCALAPPDATA` / `process.env.USERPROFILE`.

---

### Q4: Java `.properties` parser for `org.gradle.java.home`?

**Recommendation: REUSE `parseGradleProperties()` from `src/project/gradle-parser.ts:179`. DO NOT ADD a dedicated `.properties` parser.**

#### Evidence

The existing parser handles the exact format needed:

```ts
// src/project/gradle-parser.ts:179-189
export function parseGradleProperties(content: string): Map<string, string> {
    const props = new Map<string, string>();
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        props.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
    }
    return props;
}
```

This already:
- Splits on `=` (Java properties separator).
- Skips `#` and `!` comments (both Java conventions).
- Trims whitespace.
- Returns a `Map<string, string>`.

`org.gradle.java.home` follows the **identical** format — it's the same `gradle.properties` file already being parsed for `minecraft_version`, `yarn_mappings`, etc. Calling `props.get('org.gradle.java.home')` Just Works.

#### What the existing parser does NOT handle (and why that's actually correct here)

The full Java `.properties` spec includes:
- `:` as separator (alternative to `=`) — Gradle convention is `=`. Unused.
- Line continuation with trailing `\` — Rare in gradle.properties; `org.gradle.java.home` is a single path. If a user does multi-line, we degrade gracefully (parse just the first line as the value, which will fail the `existsSync` check, falling through to the next candidate in the priority chain).
- Unicode escapes `\uXXXX` — Modern gradle.properties are UTF-8. Java paths don't need escapes.

The "good enough" semantics here are **better** than perfect: a malformed `org.gradle.java.home` will fall through to `JAVA_HOME` and PATH detection, which is exactly the milestone's priority chain. Adding a strict parser would convert "silently fall through" into "hard fail" — a regression.

#### What NOT to add

| Avoid | Why |
|-------|-----|
| `properties-reader` | Adds a dep + sync file I/O wrapper for what's 8 lines of existing code. |
| `dot-properties` | Strict Java spec compliance we don't need. Throws on malformed input — undesirable here. |
| `properties` (npm) | Old, callback-based API. |
| Any new line-based parser | The existing parser is already correct for this format. |

#### Path-value caveat (Windows-specific)

`org.gradle.java.home` values on Windows often appear in gradle.properties as either:

- `C:/Program Files/Java/jdk-21` (forward slashes — Gradle docs recommend this style, works on Windows)
- `C:\\Program Files\\Java\\jdk-21` (double-backslashes — Java properties spec requires escaping `\`)
- `C:\Program Files\Java\jdk-21` (single backslashes — technically invalid per spec, but Gradle's own properties loader is lenient)

The existing `parseGradleProperties()` does **not** unescape `\\` → `\`. This needs a small unescape step **only** at the consumption site for path values:

```ts
function unescapePropertiesPathValue(v: string): string {
    // Conservative: only collapse double-backslash. Single backslashes are
    // passed through (handles the "technically invalid but common" case).
    return v.replace(/\\\\/g, '\\');
}
```

Apply only at the consumption site (the new Java-home resolver), not in the parser itself — leaves `parseGradleProperties()` unchanged for other callers (existing dependency parsing, version detection, etc.).

#### Unix regression analysis

`parseGradleProperties()` is already called on every project load. Reading one additional key (`org.gradle.java.home`) from the same `Map` adds zero cost and zero behavior change to existing flows. The unescape helper is consumer-side and not called by any existing code path. **Zero Unix regression risk.**

#### Integration point

New consumer in `src/jdtls/client.ts` (or a new `src/jdtls/java-discovery.ts` module to house the priority chain): read `gradle.properties` from the active project, call existing `parseGradleProperties()`, apply the small unescape on the value, insert into the candidate chain between `--java-home` and `JAVA_HOME`. Caller wiring: pass through from `detectJava()`'s caller, since `detectJava()` itself shouldn't depend on `ProjectStore` (keeps it pure / testable).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `execSync` + `parseJavaVersion` (stdlib) | `@viperproject/locate-java-home` | If we later need to enumerate **all** installed JDKs (e.g., for a "pick a JDK" interactive UI). Not needed for the priority-chain probe in v1.6. |
| Literal `.exe` suffix on win32 | `which` package | If we ever start spawning shell scripts (`.bat`, `.cmd`) that we don't already know the path of. JDT LS is a `.jar`, Java is `java.exe` — neither case applies. |
| `pathToFileURL` / `fileURLToPath` (stdlib) | `slash`, `upath` | If a future feature needs aggressive cross-platform path normalization (e.g., displaying paths in tool output that must look POSIX-style across all platforms). Out of scope for v1.6. |
| Existing line-based properties parser | `properties-reader` | If we need full Java `.properties` spec compliance (multi-line `\` continuations, `\u` escapes, `:` separator). Gradle convention doesn't use these. |
| Platform-guarded `process.platform === 'win32'` branches | `is-wsl`, `os-name`, `platform`-style libs | If we need finer-grained platform detection (WSL vs native Windows, distro detection). Not needed; the WSL case where Node runs inside WSL is just "Linux" to Node and works without special handling. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `cross-spawn` | Solves PATHEXT for `spawn()` of shell scripts. We `spawn()` Java with an absolute resolved path — never affected. | Resolve `javaPath` to an absolute `.exe` path before `spawn()`, which `detectJava()` already does. |
| `which` (as a hard dep) | One-line replacement (`join(home, 'bin', 'java' + ext)`) doesn't justify a dep, and the bare-`java` case is handled by `execSync` → `cmd.exe` → PATHEXT. | Inline ternary on `process.platform`. |
| `locate-java-home` (original) | Inactive ~12+ months, ~26 weekly downloads. | Existing `execSync('java --version')` probe, extended with project-gradle-properties + well-known-locations candidates. |
| `find-java-home` | Old, registry-only on Windows, single-result, doesn't fit priority chain. | Same as above. |
| `slash`, `upath` for "platform-agnostic paths" | Would push toward a generic refactor the milestone explicitly forbids. | `node:path` stdlib + `path.win32.*` / `path.posix.*` accessors only where needed. |
| `node-windows` | Wraps WMI/services APIs we don't need. v1.6 Windows scope is JDK discovery + path quoting + URI conversion only. | Targeted `process.platform === 'win32'` branches. |
| Dedicated `.properties` parser (`properties-reader`, `dot-properties`) | Existing `parseGradleProperties()` is correct for the Gradle dialect we read. Stricter parsers turn graceful fallback into hard errors. | Reuse `parseGradleProperties()` + small unescape at consumption site. |
| Windows-registry probing libraries (`winreg`, `regedit`) | The well-known install locations cover Adoptium, Microsoft, Oracle, Corretto without needing registry access. Registry access requires admin in some cases and adds platform-specific complexity. | Glob `C:\Program Files\*\jdk-*` and `%LOCALAPPDATA%\Programs\*\jdk-*` patterns. |
| `is-wsl` | WSL runs Node as Linux; `process.platform === 'linux'` already does the right thing. WSL detection only matters if we want to special-case path translation between WSL and Windows, which we don't. | Standard `process.platform` checks. |

## Stack Patterns by Platform

**If running on Windows (`process.platform === 'win32'`):**
- Append `.exe` to explicit `<home>/bin/java` candidates in `detectJava()`.
- Add Windows well-known JDK locations: `C:\Program Files\Eclipse Adoptium\jdk-*`, `C:\Program Files\Microsoft\jdk-*`, `C:\Program Files\Java\jdk-*`, `C:\Program Files\Amazon Corretto\jdk*`, `%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-*`.
- Add Windows JDT LS locations in `findJdtLs()`: `%LOCALAPPDATA%\jdtls`, `%USERPROFILE%\jdtls`, `C:\Program Files\jdtls`.
- Use `pathToFileURL()` for any path → `file://` URI conversion (workspace roots, LSP rootUri, workspaceFolders).
- Unescape `\\` → `\` in `org.gradle.java.home` values read from `gradle.properties`.

**If running on Unix (Linux/macOS):**
- All existing v1.5 behavior preserved verbatim.
- Java candidates: `<home>/bin/java` (no extension). PATH fallback: `java`.
- JDT LS locations: `$HOME/.local/share/jdtls`, `/usr/local/share/jdtls`, `$HOME/jdtls` (unchanged).
- File URIs: `pathToFileURL` produces identical output to existing `'file://' + abspath` for typical absolute paths — adopting it is a Unix-side correctness improvement (percent-encodes special characters that the current concat does not).
- New well-known-locations probe (cross-platform feature):
  - macOS: `/Library/Java/JavaVirtualMachines/*/Contents/Home`, `~/Library/Java/JavaVirtualMachines/*/Contents/Home`, `/opt/homebrew/opt/openjdk@21` (Apple Silicon), `/usr/local/opt/openjdk@21` (Intel).
  - Linux: `/usr/lib/jvm/java-21-*`, `/usr/lib/jvm/temurin-21-*`, `/opt/jdk-21*`, `/usr/lib/jvm/default-java`.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Node.js 22 LTS | `node:url` `pathToFileURL`/`fileURLToPath` (since 10.12), `path.win32`/`path.posix` (since 0.11) | All stdlib APIs needed for v1.6 are stable in 22 LTS. No version bump needed. |
| `glob` 13.x (existing) | Windows path globs | Handles Windows paths correctly. Note: glob patterns themselves use `/` regardless of platform — pass POSIX-style patterns and `glob` does the right thing on Windows. |
| `ts-lsp-client` 1.1.1 (existing) | LSP `rootUri` field — must be valid `file:///C:/...` URI on Windows | The library passes the URI string through verbatim; correctness is on us. `pathToFileURL` produces the correct form. |
| `@modelcontextprotocol/sdk` 1.29.x (existing) | No Windows-specific changes needed | MCP stdio transport is platform-agnostic. |
| `node-stream-zip` 1.15.x (existing) | Windows file paths for jar opening | Already handles Windows paths transparently — jar entries inside the zip are always `/`-separated regardless of host OS, which is what the existing code assumes. No change. |
| `picomatch` 4.x (existing) | Glob patterns on Windows | Pure-JS, no Windows-specific quirks. Patterns are always `/`-separated; the existing code already conforms. |

## Integration Summary (for downstream consumer)

**Files affected by v1.6 stack guidance:**

| File | Change | Reason |
|------|--------|--------|
| `src/jdtls/client.ts` `detectJava()` (line 65) | Add `.exe` suffix on win32; accept optional `gradleJavaHome` param; append well-known-locations candidates | Q1 + Q3 |
| `src/jdtls/client.ts` `findJdtLs()` (line 128) | Add Windows install locations to `commonLocations` array | Win32 only |
| `src/jdtls/client.ts` `startJdtLs()` (lines 214, 247) | Replace `'file://' + workspaceDir` with `pathToFileURL(workspaceDir).href` | Q2 |
| `src/jdtls/uri-mapper.ts` | Audit `file://` URI construction; switch to `pathToFileURL`/`fileURLToPath` for any platform-sensitive sites | Q2 |
| `src/jdtls/workspace-sync.ts` | Same as `uri-mapper.ts` | Q2 |
| `src/project/gradle-parser.ts` | **No change** — `parseGradleProperties` already handles the format | Q4 |
| New file or new function in `src/jdtls/client.ts` (or new `src/jdtls/java-discovery.ts`) | Implement the priority chain: read project gradle.properties via `parseGradleProperties`, unescape `\\` for the `org.gradle.java.home` value, pass into `detectJava()` | Q1 + Q4 |
| `src/cli/` (existing `--java-home` flag from quick-260515-d0i) | No change — already feeds `setJavaHome()` which `detectJava()` consults | Q1 (priority position 1, already wired) |

**Files explicitly NOT requiring change:**

- `src/project/gradle-parser.ts` `fileUriToPath()` (line 37) — different domain (user-authored Kotlin DSL string literals, portable across platforms)
- Anything using `path.join()` — already cross-platform-correct
- `node-stream-zip` integration sites — jar internal paths are always POSIX
- `picomatch` / `glob` callers passing POSIX-style patterns — already correct
- Tools layer (`src/tools/`) — no platform-specific concerns in the MCP protocol layer

## Sources

- [npm: locate-java-home](https://www.npmjs.com/package/locate-java-home) — Inactive (~26 weekly downloads, no recent releases). MEDIUM confidence.
- [Snyk advisor: locate-java-home](https://snyk.io/advisor/npm-package/locate-java-home) — "Inactive project" classification, no new versions in 12+ months. MEDIUM confidence.
- [npm: @viperproject/locate-java-home 1.1.10](https://www.npmjs.com/package/@viperproject/locate-java-home) — Maintained fork, last published ~2 months ago. MEDIUM confidence.
- [npm: find-java-home](https://www.npmjs.com/package/find-java-home) — Windows-registry-based, single-result, doesn't fit priority chain. MEDIUM confidence.
- [GitHub: jsdevel/node-find-java-home](https://github.com/jsdevel/node-find-java-home) — Source for find-java-home; confirms registry + JAVA_HOME + PATH order. MEDIUM confidence.
- [nodejs/node#6671 — child_process.spawn ignores PATHEXT on Windows](https://github.com/nodejs/node/issues/6671) — Confirmed `spawn` does not honor PATHEXT; long-standing issue, still open. HIGH confidence (official Node issue tracker).
- [nodejs/node-v0.x-archive#2318](https://github.com/nodejs/node-v0.x-archive/issues/2318) — Original PATHEXT/spawn issue with workarounds documented. HIGH confidence.
- [Node.js `child_process` documentation](https://nodejs.org/api/child_process.html) — `execSync` with string + Windows uses `cmd.exe /d /s /c`, which honors PATHEXT. HIGH confidence (official docs).
- [Node.js `path` documentation](https://nodejs.org/api/path.html) — `path.win32`, `path.posix` accessors stable since Node 0.11. HIGH confidence.
- [GitHub: npm/node-which](https://github.com/npm/node-which) — Confirms PATHEXT semantics on Windows (reads PathExt env, appends extensions). Background info, not a recommendation. HIGH confidence.
- Codebase analysis: `src/jdtls/client.ts` (detectJava, findJdtLs, startJdtLs lines 65-321), `src/project/gradle-parser.ts` (parseGradleProperties line 179) — verified that the existing parser handles the gradle.properties format and that `execSync` is already the probe mechanism. HIGH confidence (read directly).
- [Eclipse JDT LS GitHub](https://github.com/eclipse-jdtls/eclipse.jdt.ls) — JDT LS launcher jar location pattern (`plugins/org.eclipse.equinox.launcher_*.jar`) and `config_win` config dir already handled in existing code. HIGH confidence.
- Java `.properties` format conventions — Standard Gradle uses `key=value` with `#`/`!` comments; existing parser is sufficient. HIGH confidence.

---

*Stack research for: v1.6 Windows Support additions*
*Researched: 2026-05-15*
