# Project Research Summary — v1.6 Windows Support

**Project:** FabricModMCP
**Domain:** Cross-platform Node.js MCP server (Unix-first) adding Windows support + smarter cross-platform Java discovery
**Researched:** 2026-05-15
**Confidence:** HIGH

## Executive Summary

v1.6 is a **targeted, surgical milestone**, not a platform-abstraction refactor. The four researchers converged: the codebase has 6–9 concrete sites that break on Windows, clustered into three independent fix domains — Java binary resolution (`spawn` does not honor PATHEXT), `file://` URI construction (`'file://' + path` is malformed on Windows), and JDT LS install-path discovery (`process.env.HOME` and Unix-only directories). Fixes are mechanical; discipline is keeping them mechanical and `process.platform === 'win32'`-guarded. The one intentional cross-platform improvement is smarter Java discovery — priority chain `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → common install locations — which improves Unix too by skipping incompatible JDKs and consulting the JDK the project is actually built against.

**No new runtime dependencies.** Node 22 LTS stdlib (`node:url`'s `pathToFileURL`/`fileURLToPath`, `node:os`'s `homedir`, `node:child_process`) covers everything. Existing `parseGradleProperties` reads `org.gradle.java.home` verbatim — only consumer-side backslash unescape is added. All four researchers explicitly rejected the candidate npm libraries (`locate-java-home` family inactive, `cross-spawn`/`which` solve problems we don't have, `slash`/`upath` push toward forbidden generic refactor).

**Key risks:** (1) `spawn` ENOENT for absolute `.exe`-less Java paths — detection passes via `execSync` → cmd.exe → PATHEXT, then JDT LS launch fails on the same path. Single most important fix. (2) URI malformation — `'file://' + 'C:\…'` produces `file://C:\…` which JDT LS rejects; 7 forward + 2 reverse sites. (3) `.properties` backslash semantics — targeted consumer-side unescape. (4) Mixed-separator corruption when ZIP entries meet `path.join` on Windows.

## Key Findings

### Recommended Stack

**Zero new dependencies.**

- `node:url` (`pathToFileURL`/`fileURLToPath`) — replaces all `'file://' + path` and `uri.replace('file://', '')` sites.
- `node:os` (`homedir()`) — replaces `process.env.HOME ?? ''` at `src/jdtls/client.ts:139`.
- `node:child_process` — `execSync` (shell, applies PATHEXT) vs `spawn` (no PATHEXT) asymmetry is PITFALL-1.
- Existing `parseGradleProperties` at `src/project/gradle-parser.ts:179` — unchanged. Backslash unescape at consumer site only.
- `glob` 11.x (existing) — expands `jdk-*` / `jdt-language-server-*` wildcards.

**Rejected:** `locate-java-home` (inactive), `cross-spawn`/`which` (we spawn absolute resolved paths), `slash`/`upath`/`normalize-path` (push toward generic refactor), `properties-reader`/`dot-properties` (replace graceful fallback with hard error), `winreg`/`node-windows`/`regedit` (Gradle itself doesn't probe registry).

See `.planning/research/STACK.md`.

### Expected Features

**Must have (table stakes):**
- `.exe` suffix on explicit `<javaHome>/bin/java` candidates on win32.
- Skip-on-version-mismatch loop in `detectJava` (Java 21+; older candidates `continue`).
- Priority chain `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → scanned locations, **sequential in priority order** (parallel races destroy semantics).
- Scan Windows install locations: `C:\Program Files\Eclipse Adoptium\jdk-*`, `C:\Program Files\Microsoft\jdk-*`, `C:\Program Files\Java\jdk-*`, `C:\Program Files\Amazon Corretto\jdk*`, `%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-*`, `%USERPROFILE%\scoop\apps\openjdk*\current\`, `%USERPROFILE%\.jdks\`.
- JDT LS Windows fallback paths in `findJdtLs`: `%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`, `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls\`.
- Replace `process.env.HOME` with `os.homedir()` in `findJdtLs`.
- Read `org.gradle.java.home` from project `gradle.properties`; apply consumer-side backslash unescape.
- Use `pathToFileURL`/`fileURLToPath` globally (Unix output byte-identical; consolidation avoids divergent surfaces).
- Drive-letter case tolerance in `fromFileUri` round-trip on Windows.

**Deferred to v1.7+:** Surface `javaSource` in JDT LS status; improved error messages listing attempted paths; `org.gradle.java.installations.paths` toolchain discovery; macOS Apple Silicon refinements.

**Explicit anti-features (DO NOT do):**
- Windows registry probing — Gradle itself doesn't.
- `wmic`/`where`/PowerShell shellouts — `wmic` deprecated in Windows 11.
- Auto-download / bundle a JDK or JDT LS — out of scope; ~150MB; redistribution licensing.
- `shell: true` on `spawn` — breaks signal/quoting semantics.
- `cross-spawn` — solves PATHEXT-for-shell-scripts; we spawn Java with absolute paths.
- Generic `JavaResolver` / `PathFormat` / `slash`/`upath`-style refactor — milestone explicitly forbids.
- `JDK_HOME`/`JRE_HOME`/`JAVA_TOOL_OPTIONS` probing.
- VS Code's bundled JDT LS.
- Custom URI scheme.
- Strip drive letter / UNC `\\?\` long-path conversion.
- `gradlew --version` shellout.
- Cygwin/MSYS2/WSL detection (WSL is Linux to Node).
- CRLF conversion of extracted .java files.
- Parallel race for first-valid Java.
- `-version` (use `--version`).

See `.planning/research/FEATURES.md`.

### Architecture Approach

**Two new files; surgical edits to four existing files. No layer rearrangement.**

**New files:**
1. `src/platform/index.ts` (~80 LOC) — `isWindows`, `javaBinaryName()`, `javaBinaryInHome(home)`, `jdtlsCandidateDirs()`, `commonJavaLocations()`. Unix branches return today's literals verbatim.
2. `src/jdtls/java-discovery.ts` — extracts `setJavaHome`/`detectJava`/`parseJavaVersion` from `client.ts`; adds async `discoverJava({ projectRoot? })`. `client.ts` keeps old symbols as re-exports for one milestone.

**Modified files:**
- `src/jdtls/client.ts` — `detectJava` and `findJdtLs` call platform helpers; `startJdtLs` workspace URIs use `pathToFileURL`. `resolveJavaExecutable` ensures `spawn` gets a real file (`.exe` on Windows).
- `src/jdtls/uri-mapper.ts` — `pathToFileURL`/`fileURLToPath`; case-insensitive drive-letter prefix match on Windows; ZIP-entry split-and-spread.
- `src/jdtls/workspace-sync.ts` — four `'file://' + tempDir` sites swap to `pathToFileURL`.
- `src/tools/remove-project-member.ts:83`, `src/tools/tool-helpers.ts:350` — same URI helper swap.
- `src/project/gradle-parser.ts` — **unchanged.**
- `src/index.ts`, `src/jdtls/startup.ts` — thread optional `projectRoot`.

**Code-site impact (collated):**

| Concern | Sites |
|---------|-------|
| Java spawn `.exe` resolution | `src/jdtls/client.ts:65-104,70,72,193` |
| URI forward construction | `src/jdtls/client.ts:214,247`; `src/jdtls/workspace-sync.ts:103,141,206,255`; `src/jdtls/uri-mapper.ts:77`; `src/tools/remove-project-member.ts:83` |
| URI reverse construction | `src/jdtls/uri-mapper.ts:81`; `src/tools/tool-helpers.ts:350` |
| ZIP-entry × `path.join` | `src/jdtls/workspace.ts:55`; `src/jdtls/workspace-sync.ts:40,184` |
| JDT LS install locations | `src/jdtls/client.ts:128-144` |
| JDT LS config dir per platform | `src/jdtls/client.ts:185-189` — **already correct**, leave alone |
| `.properties` `org.gradle.java.home` unescape | New consumer in `src/jdtls/java-discovery.ts` |
| Temp-dir cleanup `EBUSY` retries on Windows | `src/jdtls/workspace.ts:81` |
| ZIP path-traversal guard | `src/jdtls/workspace.ts:55` |

See `.planning/research/ARCHITECTURE.md`.

### Critical Pitfalls

1. **PITFALL-1: `spawn(javaPath, …)` ENOENT for `.exe`-less absolute paths on Windows.** `detectJava` succeeds via `execSync` → cmd.exe → PATHEXT, then JDT LS launch fails on the same path. **Fix:** `resolveJavaExecutable` helper; append `.exe` for explicit absolute candidates. **DO NOT** `shell: true`.
2. **PITFALL-3: `'file://' + windowsPath` produces malformed URIs.** Drive letter parsed as host (`file://C:`); JDT LS rejects with `IllegalArgumentException` for `rootUri`/`workspaceFolders`. **Fix:** `pathToFileURL`/`fileURLToPath` globally; Unix output byte-identical.
3. **PITFALL-4: Mixed-separator path corruption at ZIP → FS boundary.** ZIP entries are `/`; `path.join(depDir, 'net/minecraft/Foo.java')` on Windows produces `…\depDir\net/minecraft/Foo.java`. **Fix:** `join(depDir, ...entryPath.split('/'))` at every boundary.
4. **PITFALL-5: `.properties` backslash unescaping for `org.gradle.java.home`.** `=C:\Users\new\jdk` parses to `C:Users<newline>ew\jdk` under spec. **Fix:** `unescapePropertiesValue` at consumption site; parser unchanged.
5. **PITFALL-6: Probe latency on Windows.** 5+ serial `execSync` probes × 300-800ms = 2-4s cold start (Defender first-run worse). **Fix:** async `execFile` with 3s per-candidate timeout; sequential.

See `.planning/research/PITFALLS.md` for full 15-pitfall catalog.

## Implications for Roadmap

Recommended phase ordering (all four researchers converged after Phase 1/Phase 2 swap reconciliation):

### Phase 1: Platform Helpers + Java Executable Resolution

Foundation. Establishes `src/platform/index.ts` and makes Windows able to spawn `java.exe` at all. Without this, every subsequent Windows fix is unobservable.

**Delivers:** `src/platform/index.ts`; `resolveJavaExecutable(candidate)` helper; `detectJava` candidates use `javaBinaryName()`/`javaBinaryInHome()`.
**Addresses:** `.exe` suffix; foundation under priority chain.
**Avoids:** PITFALL-1, PITFALL-2.
**Unix guard:** Snapshot tests with mocked `process.platform`; existing `detectJava` Unix tests unchanged via re-export shim.

### Phase 2: Path / URI Handling Audit

Wholesale move to `pathToFileURL`/`fileURLToPath`. Single sweeping change across 7 forward + 2 reverse sites — easier reviewed and tested as one PR.

**Delivers:** Every `'file://' + path` → `pathToFileURL(path).href`; every `uri.replace('file://', '')` → `fileURLToPath(uri)`; `uri-mapper.ts` `fromFileUri` case-insensitive prefix on Windows; ZIP-entry × `path.join` boundary fix; ZIP path-traversal guard; temp-cleanup `EBUSY` retry loop on Windows.
**Avoids:** PITFALL-3, PITFALL-4, PITFALL-9, PITFALL-10, PITFALL-15.
**Unix guard:** Round-trip test on representative paths including `/private/var/folders/x y/file.java`. Output byte-identical for absolute paths without special chars.

### Phase 3: Smarter Java Discovery (cross-platform)

The cross-platform feature. Depends on Phase 1's `resolveJavaExecutable`.

**Delivers:** `src/jdtls/java-discovery.ts` with async `discoverJava({ projectRoot? })`; per-project `gradle.properties` read for `org.gradle.java.home`; `unescapePropertiesValue` at consumption site; skip-on-version-mismatch loop; async `execFile` probes 3s timeout sequential; common-Java-locations probe; old symbols retained as re-exports.
**Avoids:** PITFALL-5, PITFALL-6.
**Unix guard:** Priority-chain unit tests; existing `--java-home` precedence test (commit `4e94b4b`) extended. Users without `org.gradle.java.home` see no behavioral change.

### Phase 4: JDT LS Discovery on Windows

Smallest, most isolated change. Without this, Windows users must set `JDTLS_HOME` manually.

**Delivers:** `jdtlsCandidateDirs()` Windows branch returns `%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`, `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`; `findJdtLs` uses `homedir()`; improved error message listing attempted paths.
**Avoids:** PITFALL-7, PITFALL-12.
**Unix guard:** Unix branch returns the existing three paths verbatim.

### Phase 5: End-to-End Windows Validation

Milestone-completion checkpoint, not a code phase.

**Delivers:** Manual run on Windows: `create_project`, `add_fabric_mod`, `find_definition` round-trip, cross-mod navigation. README "Windows Support" section. CLAUDE.md update for the priority chain.

### Phase Ordering Rationale

- **Phase 1 before everything:** No Java spawn = no JDT LS = nothing observable on Windows.
- **Phase 2 (URIs) before Phase 3 (smarter Java):** Phase 3 first would leave Windows half-broken while shipping a cross-platform feature hard to validate.
- **Phase 4 last among code phases:** `JDTLS_HOME` is documented manual workaround.
- **Phases 2, 3, 4 are independent of each other after Phase 1** — parallelizable.

### Research Flags

- **Phase 2 (URIs):** JDT LS drive-letter casing behavior on Windows is inferred. Worth a small spike during planning to verify case-preservation.
- **Phase 1, 3, 4:** Standard patterns; well-documented behaviors. No deeper research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new deps; rejected libraries have unambiguous inactivity signals. |
| Features | HIGH for 1/3/4, MEDIUM for 2 | No formally documented Windows JDT LS install convention exists. |
| Architecture | HIGH | Codebase inventoried; modified files have exact lines; no layer rearrangement. |
| Pitfalls | HIGH | All 15 pitfalls have file:line manifestations verified by direct read. |

### Gaps / Open Questions

- **Windows CI runner:** None exists. Unit tests are mockable on macOS/Linux. Recommend adding Windows CI in Phase 5; out-of-scope to fully wire if time-constrained.
- **JDT LS drive-letter case behavior:** Phase 2 spike against real JDT LS.
- **Relative-path resolution for `org.gradle.java.home`:** v1.6 resolves relative to project root only; defer user-level (`~/.gradle/gradle.properties`) to v1.7.
- **Windows long-path support:** Defer until empirically observed; document as known limitation.

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `src/jdtls/client.ts`, `src/jdtls/uri-mapper.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/workspace.ts`, `src/project/gradle-parser.ts`, `src/project/loom-cache.ts`, `src/browsing/source-adapter.ts`, `src/tools/tool-helpers.ts`, `src/tools/remove-project-member.ts`, `src/index.ts`.
- [Node.js `child_process` documentation](https://nodejs.org/api/child_process.html)
- [Node.js `url` module — `pathToFileURL`/`fileURLToPath`](https://nodejs.org/api/url.html#urlpathtofileurlpath-options)
- [nodejs/node#6671 — `spawn` ignores PATHEXT on Windows](https://github.com/nodejs/node/issues/6671)
- [java.util.Properties.load spec](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html#load(java.io.Reader))
- [Gradle Build Environment — `org.gradle.java.home`](https://docs.gradle.org/current/userguide/build_environment.html)
- [LSP 3.17 — DocumentUri](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#uri)

### Secondary (MEDIUM)
- [Adoptium Windows installation](https://adoptium.net/installation/windows)
- [Microsoft Build of OpenJDK install](https://learn.microsoft.com/en-us/java/openjdk/install)
- [Claude Code issue #20331 — jdtls Windows URI bug](https://github.com/anthropics/claude-code/issues/20331)
- [mfussenegger/nvim-jdtls](https://github.com/mfussenegger/nvim-jdtls)

---

## Synthesizer Notes

**Strong convergence:**
- Zero new runtime dependencies.
- Same 9 URI sites and same 4 Java-spawn sites in same files.
- Phase 1 (`.exe`) precedes Phase 2 (URIs) precedes Phase 5 (validation).
- Full anti-feature list.

**Resolved divergences:**
- *URI first vs `.exe` first.* Architecture and pitfalls researchers argued `.exe` first because Windows is unobservable without it. **Resolved:** `.exe` first.
- *Parallel URI code paths vs global adoption.* Pitfalls researcher explicit on global to avoid drift; stack + architecture confirmed Unix output byte-identical. **Resolved:** global adoption.
- *Parser-level vs consumer-level `.properties` unescape.* **Resolved:** consumer-side only in `java-discovery.ts`; preserves graceful fallback for malformed values and zero risk to existing dependency-parsing callers.
