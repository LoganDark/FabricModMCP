# Feature Research — v1.6 Windows Support

**Domain:** Cross-platform Java tooling integration (MCP server spawning JDK, JDT LS, building file URIs)
**Researched:** 2026-05-15
**Confidence:** HIGH for area 1 (Java discovery), area 3 (gradle.properties), area 4 (URI format); MEDIUM for area 2 (JDT LS install locations — no formally documented Windows convention exists)

---

## Scope

Four feature areas were investigated, all in service of the v1.6 milestone goal: make FabricModMCP work on Windows without breaking the existing Unix code paths. The Java-discovery work is the one piece that is intentionally cross-platform; everything else is a Windows-guarded special case.

For each area, table stakes are "Windows is broken until this is done." Differentiators are "Windows works either way, but this materially improves UX." Anti-features are scope-bounding rules — things that look plausible at first glance but expand surface area without enough value to justify the cost.

---

## Feature Landscape

### Area 1 — Java Discovery (cross-platform)

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Touches | Notes |
|---------|--------------|------------|---------|-------|
| Priority chain `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → `java` on PATH → common install locations | This is the resolution order the JVM ecosystem already uses. Maven and Gradle both read `JAVA_HOME` first, then PATH. The Loom-built project's `org.gradle.java.home` is the JDK the user's build is *known* to work with, so it is the strongest signal we have for "which JDK should JDT LS use." | M | `src/jdtls/client.ts` (`detectJava`), `src/project/gradle-parser.ts` (read `org.gradle.java.home` into `GradleConfig`) | The priority chain is the milestone's one explicit cross-platform change. Already-implemented `setJavaHome` (quick-260515-d0i) is the first link in the chain. |
| Probe each candidate for Java 21+ and pick the first compatible one | `detectJava` already returns an error when the first candidate is < 21. With multiple candidates we should *skip* incompatible candidates instead, since the user likely has both Java 8/17 (for some old project) and Java 21 (for JDT LS) installed. | S | `src/jdtls/client.ts` (loop semantics in `detectJava`) | The existing loop already does `continue` on parse failure; needs to also `continue` (not error) when version < 21, and only return the "Java X found but JDT LS requires 21+" error if *no* candidate is compatible. |
| Scan common Windows install locations as the final fallback | If `JAVA_HOME` is unset and `java` is not on PATH, the user almost certainly still has a JDK installed via the standard installer. The four mainstream Windows JDK distributions all install to well-known paths under `C:\Program Files\` by default. | M | `src/jdtls/client.ts` (new helper, gated by `process.platform === 'win32'`) | Specific paths to scan, glob-style: `C:\Program Files\Eclipse Adoptium\jdk-*-hotspot\` (Temurin), `C:\Program Files\Microsoft\jdk-*\` (Microsoft Build of OpenJDK), `C:\Program Files\Java\jdk-*\` (Oracle JDK), `C:\Program Files\Zulu\zulu-*\` (Azul Zulu). Also `%USERPROFILE%\scoop\apps\openjdk*\current\` and `%USERPROFILE%\.jdks\` (IntelliJ-managed). Pick highest version ≥ 21. |
| `--java-home` works when the user passes a path without `\bin\java.exe` (e.g. `C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot`) | This is the convention for `JAVA_HOME`: it points at the JDK *root*, and tools append `bin/java`. The existing code already does `join(javaHome, 'bin', 'java')` — on Windows this produces `C:\...\bin\java` which Node's `spawn` cannot resolve because PATHEXT is not applied. | S | `src/jdtls/client.ts` (`detectJava` and `startJdtLs` spawn) | Fix: when `process.platform === 'win32'`, append `bin\java.exe` instead of `bin/java`. Also applies to the `'java'` PATH-only candidate — must be `'java.exe'` on Windows because Node `spawn` does *not* honour PATHEXT (nodejs/node#6671, longstanding). |
| Honest error message when no Java 21+ found | The existing message says "Set JAVA_HOME or add java to PATH" — on Windows that is misleading because `java` on PATH may exist but be < 21. The new message should list which candidates were tried and what version each reported. | S | `src/jdtls/client.ts` (`JavaNotFound.error` synthesis) | Include the candidates tried and reasons for skipping (parse failure / version < 21). Helps the user understand why a JDK that "is installed" was not picked. |

#### Differentiators (UX wins)

| Feature | Value Proposition | Complexity | Touches | Notes |
|---------|-------------------|------------|---------|-------|
| Read `org.gradle.java.home` from project `gradle.properties` and feed it into `detectJava` | This is the JDK the user's Loom build is configured for. If the project sets it, we should honour it — picking a *different* JDK can cause subtle bytecode-level mismatches when JDT LS indexes the user's compiled output. Forward-slash path format is accepted on Windows (e.g. `C:/Users/foo/.jdks/temurin-21`); resolved with `path.normalize`. | M | `src/project/gradle-parser.ts` (extend `parseGradleProperties` consumer; add to `GradleConfig`), `src/jdtls/client.ts` (consume in `detectJava`) | Gradle itself reads this key with forward slashes on Windows (docs.gradle.org/current/userguide/build_environment.html). |
| Surface "which JDK was picked, and why" in the JDT LS status structured output | The existing v1.5 work added `jdtlsStatus` to project info. Adding `javaPath` and `javaSource` (one of: `cliFlag`, `gradleProperties`, `javaHome`, `pathLookup`, `scanned`) makes Windows debugging tractable. | S | `src/state/project-store.ts` or wherever JDT LS status is exposed | Optional but high-leverage — turns "JDT LS won't start" support questions from guessing into reading. |
| Order Microsoft Build of OpenJDK installs at `C:\Program Files\Microsoft\jdk-*\` ahead of Oracle JDK at `C:\Program Files\Java\jdk-*\` | Microsoft's JDK is the de-facto recommendation for Windows Minecraft (the launcher ships a bundled one). When both are present, Microsoft's is more likely to match the runtime the user actually plays Minecraft with. | S | Path-scan ordering in the Windows fallback | Low cost, mild ordering improvement. |

#### Anti-Features (explicitly NOT doing)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Read the Windows registry (`HKLM\SOFTWARE\JavaSoft\Java Development Kit\CurrentVersion`) to find JDKs | "Every Java installer writes a registry key, so we should read it." | (a) Requires either spawning `reg.exe` (yet another subprocess) or pulling in a native dep like `node-winreg` — both add complexity. (b) Modern JDK distributions (Temurin, Zulu, Microsoft) historically did not write to `HKLM\SOFTWARE\JavaSoft` and only some now do, optionally (adoptium/installer#64). (c) Gradle itself does not read the registry — it relies on env vars, package-manager locations, and IntelliJ's `.jdks/` directory. We have no reason to be more aggressive than Gradle. | Scan well-known install directories on disk. Faster, no native dep, no subprocess. |
| Shell out to `wmic`, `where java`, or PowerShell `Get-Command` to find Java | "Windows has these built-in tools, let's use them." | `wmic` is deprecated in Windows 11. `where java` only finds what is on PATH, which we already check via the existing PATH-fallback candidate. PowerShell adds 200ms+ cold-start per invocation. | The existing `execSync('"java.exe" --version')` already covers the PATH case. |
| Auto-download a JDK if none is found (à la Gradle's `auto-download`) | "Gradle does this — it would be nice if our MCP server could too." | Out of scope. We are a read/analysis server, not a provisioning tool. Auto-downloading 200MB across a slow connection during startup would block the MCP handshake and confuse Claude Code. | Print a clear error message with a download URL. |
| Bundle a JDK with the npm package | "Then there is no discovery problem at all." | Increases the published package size by ~150MB per platform, requires per-architecture builds, and we still have to integrate with the user's *project* toolchain to match their bytecode. Solves the wrong problem. | Direct users to install a JDK once, system-wide. |
| Probe `JDK_HOME`, `JRE_HOME`, or `JAVA_TOOL_OPTIONS` as additional env vars | "These exist in some Java ecosystems." | `JDK_HOME` is not a standard convention — neither Maven nor Gradle reads it. `JRE_HOME` points at a JRE (no `javac`, no JDT LS support). `JAVA_TOOL_OPTIONS` is for JVM flags, not for locating the JVM. Adding these adds confusion without picking up new users. | Stick to `JAVA_HOME` as the env-var entry point; defer to PATH otherwise. |
| Cross-platform refactor of `detectJava` into a `JavaResolver` strategy class | "While we are here, let's clean this up." | The milestone constraint explicitly forbids generic refactors. The existing function works on Unix and is < 60 LOC; the priority chain can be a `for…of` over candidate sources without inventing a class hierarchy. | Extend the existing function in place; add a small `collectJavaCandidates()` helper if needed. |

---

### Area 2 — JDT LS Install Locations on Windows

#### Table Stakes

| Feature | Why Expected | Complexity | Touches | Notes |
|---------|--------------|------------|---------|-------|
| `JDTLS_HOME` env var continues to work on Windows | Already in `findJdtLs`. This is the most reliable signal — if the user set it, honour it. | S | `src/jdtls/client.ts` (`findJdtLs`) | Existing code does `existsSync` check, which works fine on Windows. No change needed. |
| Probe `%USERPROFILE%\jdtls\` and `%LOCALAPPDATA%\jdtls\` as Windows fallbacks | The existing `findJdtLs` probes `~/.local/share/jdtls`, `/usr/local/share/jdtls`, `~/jdtls` — all Unix-shaped. On Windows, `~/jdtls` (= `%USERPROFILE%\jdtls`) does happen to resolve correctly via Node's `homedir()`, but `~/.local/share/jdtls` and `/usr/local/share/jdtls` are nonsensical. Need a Windows-specific list. | S | `src/jdtls/client.ts` (`findJdtLs`, platform-guarded branch) | There is no formally documented "place JDT LS here" convention on Windows — but `%USERPROFILE%\jdtls\` matches what the existing code already half-supports (`~/jdtls`), and `%LOCALAPPDATA%\jdtls\` matches the convention Mason uses (`%LOCALAPPDATA%\nvim-data\mason\packages\jdtls\`). |

#### Differentiators

| Feature | Value Proposition | Complexity | Touches | Notes |
|---------|-------------------|------------|---------|-------|
| Probe Mason's nvim-jdtls install at `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls\` | Mason is the most common JDT LS installer for power users on Windows. Picking it up automatically means "if you use Neovim with Mason, FabricModMCP just works." | S | `src/jdtls/client.ts` (extend Windows fallback list) | Low risk — directory only exists if user installed it. |
| Probe `%ProgramFiles%\jdtls\` for system-wide installs | Mirrors `/usr/local/share/jdtls` on Unix. Some teams may push a JDT LS install to all developer machines via Group Policy / Chocolatey to a `Program Files` location. | S | `src/jdtls/client.ts` | Low cost addition. |
| Improved error message when JDT LS not found, listing the Windows paths tried | Mirrors the Java-discovery improvement: tell the user exactly which paths were probed so they can drop the unzipped distribution into one of them. | S | `src/jdtls/client.ts` (`JdtLsNotFound.error`) | Already partially done — current error says "Set JDTLS_HOME". Augment with "or place it in: …". |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Bundle JDT LS as an npm dependency | "Then there is no discovery problem." | JDT LS milestone builds are ~80MB and are versioned independently of npm. We would be cutting users off from upgrades. Also, JDT LS is GPL/EPL-licensed — bundling has redistribution implications worth avoiding. | Document where to download from and which paths we probe. |
| Auto-download JDT LS milestone if not found | Same surface appeal as auto-download for the JDK. | Same problems: blocks startup, large download, no good progress UX over stdio. | Clear error message with the eclipse.org URL. |
| Probe inside VS Code's extension directory (`%USERPROFILE%\.vscode\extensions\redhat.java-*\server\`) | "VS Code Java users have a JDT LS in there." | VS Code ships a *patched* JDT LS with extra Red Hat plugins; the launcher jar path and config layout are not guaranteed to match upstream. Using it via stdio LSP works but is fragile. | Tell VS Code Java users to download a standalone JDT LS — it is a 5-minute one-time setup. |
| Read Windows registry for "installed JDT LS" | "Maybe Eclipse writes a registry key." | Eclipse JDT LS standalone (the language server, not the IDE) is not installed via an installer that writes registry keys — it ships as a tarball. | Path scanning is sufficient. |

---

### Area 3 — `org.gradle.java.home` Semantics

#### Table Stakes

| Feature | Why Expected | Complexity | Touches | Notes |
|---------|--------------|------------|---------|-------|
| Read `org.gradle.java.home` from `gradle.properties` and expose it on `GradleConfig` | This is the strongest signal of "the JDK this project builds with." Gradle reads it as the JVM to use for the build daemon (docs.gradle.org/current/userguide/build_environment.html). It is set as a simple `key=value` pair, already trivially parseable by the existing `parseGradleProperties`. | S | `src/project/gradle-parser.ts` (extend `parseGradleProperties` consumer; add `gradleJavaHome?: string` to `GradleConfig` in `types.ts`) | Forward slashes are accepted and idiomatic on Windows (`C:/Users/foo/.jdks/temurin-21`). Backslashes need to be escaped (`C:\\Users\\…`) per Java Properties file format — `parseGradleProperties` already does literal string read, so escaping is the user's responsibility. We should normalize via `path.normalize` before use. |
| Path value handling: accept forward slashes, native backslashes, escaped backslashes | Real-world `gradle.properties` files in Loom projects on Windows use *all three* forms. Java's `Properties.load` natively unescapes `\\` to `\`. Our parser doesn't, so we need to handle this. | S | `src/project/gradle-parser.ts` (`parseGradleProperties` value processing) | Specifically: replace `\\\\` (two literal backslashes) with `\\` (one) in values, then call `path.normalize`. Forward slashes pass through unchanged. |

#### Differentiators

| Feature | Value Proposition | Complexity | Touches | Notes |
|---------|-------------------|------------|---------|-------|
| Honour `org.gradle.java.installations.paths` as a secondary candidate source | Gradle toolchain convention: comma-separated list of JDK roots Gradle should consider. Power users on Windows use this to pin a specific Microsoft JDK build. | M | `parseGradleProperties` consumer; new candidates in `detectJava` | Lower priority than `org.gradle.java.home` (which is "use *this* JDK") because `.paths` is "*consider* these JDKs" — Gradle picks the best match by toolchain spec. We do not have a toolchain spec, so we should pick the highest-version 21+ entry. |
| Honour `org.gradle.java.installations.fromEnv` | Gradle convention: a comma-separated list of *env var names* to read JDK paths from, e.g. `org.gradle.java.installations.fromEnv=JDK17,JDK21`. Some monorepos rely on this. | M | Same files | Niche. Lower priority than `.paths`. Only add if Phase work shows it is common in Loom projects. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Run `gradlew --version` to ask Gradle which JDK it is using | "That is the most accurate signal." | (a) Gradle cold-start is 10-30s with a JDK init; we cannot block the MCP server that long. (b) Requires *already having a JDK* — chicken-and-egg with our discovery problem. (c) Per the existing decision log: "Gradle Tooling API: 10-30s cold start, requires JVM, massive overkill for reading a .properties file." Same logic applies here. | Read the property file directly. |
| Read the `gradle/wrapper/gradle-wrapper.properties` `distributionUrl` and probe for a Gradle-managed JDK | "Gradle 8+ can manage its own JDK installs." | Gradle's auto-downloaded JDKs go under `~/.gradle/jdks/` with non-deterministic subdirectory names. We would be reverse-engineering an internal cache layout, and Gradle does not commit to its stability. | If the user wants this, they set `org.gradle.java.home` to point at the auto-downloaded JDK. |
| Parse `settings.gradle.kts` `pluginManagement.plugins.id("...").version("...")` for toolchain version | "We could infer the required Java version from the toolchain plugin." | This tells us *which version* is required, not *where it is installed*. Discovery still has to happen separately. Adds parsing complexity for no new locating ability. | Trust the user's `org.gradle.java.home` or `JAVA_HOME`. |
| Detect IntelliJ-managed JDKs from `.idea/` directory | "IntelliJ users have their JDKs in `~/.jdks/`." | We already plan to probe `%USERPROFILE%\.jdks\` as a common install location (Area 1). Parsing `.idea/misc.xml` to find the *specific* selected SDK is overkill. | Scan `~/.jdks/` directly for any 21+. |

---

### Area 4 — Windows Path / URI Conventions for JDT LS

This is the area with the most concrete external evidence — there is a known-fixed bug in Claude Code itself (anthropics/claude-code#20331) for the exact same URI-construction problem we have in `uri-mapper.ts`.

#### Table Stakes

| Feature | Why Expected | Complexity | Touches | Notes |
|---------|--------------|------------|---------|-------|
| Build `file:///C:/...` URIs (three slashes, forward slashes, drive letter with colon) on Windows | RFC 8089 + Eclipse JDT LS's `ResourceUtils.canonicalFilePathFromURI`. The existing code does `file://${normalizedTempDir}/...` which on Windows produces `file://C:\Users\…\.classpath` — an invalid URI per JDT LS, fails with `java.lang.IllegalArgumentException: Illegal character in authority at index 9`. | M | `src/jdtls/uri-mapper.ts` (`toFileUri`, `fromFileUri`, `normalizedTempDir` construction), `src/jdtls/workspace-sync.ts` (4× `'file://' + resolvedTempDir` literals — lines 103, 141, 205, 254), `src/jdtls/client.ts` (`rootUri: 'file://' + workspaceDir` line 214 and `workspaceFolders` line 247) | The fix is mechanical: introduce a `pathToFileUri(absPath)` helper that returns `file:///` + forward-slashed path on Windows, and `file://` + path on Unix. Replace every `'file://' + path` literal. The existing `normalizedTempDir = resolvedTempDir.replace(/\/+$/, '')` strip becomes a generic `replace(/[\\/]+$/, '')` so it works for both separators. |
| `fromFileUri` reverses the Windows format correctly | Symmetric with the above. JDT LS sends responses back with the same URI format it received, so we must round-trip identically. | S | `src/jdtls/uri-mapper.ts` (`fromFileUri`) | Strip the `file:///` prefix (three slashes on Windows), convert forward slashes to native separators *only when comparing to a native path* — but ideally compare on the URI string side so we never mix formats. |
| Drive-letter case: tolerate `C:` vs `c:` in URI comparisons | JDT LS sometimes normalizes drive letter case (often to uppercase) and sometimes echoes whatever it received. The existing `fromFileUri` does exact `uri.startsWith(prefix)` which would fail if JDT LS uppercases the drive letter and we tracked it lowercase (or vice-versa). | S | `src/jdtls/uri-mapper.ts` (`fromFileUri` case-insensitive drive-letter prefix match on Windows) | On Windows only: do `prefix` and `uri` comparison with the drive letter normalised to uppercase before `startsWith`. Path component below the drive letter remains case-preserving (NTFS is case-insensitive but case-preserving). |
| URL-encode special characters in paths (spaces, `#`, `?`) | Windows user paths frequently contain spaces (`C:\Program Files\…`, `C:\Users\First Last\…`). Sending `file:///C:/Program Files/…` to JDT LS works because JDT LS tolerates literal spaces, but a `#` in a path would terminate the URI as a fragment. Encoding via `encodeURI` (NOT `encodeURIComponent` — we need `/` to remain unescaped) is the safe move. | S | `src/jdtls/uri-mapper.ts` (`pathToFileUri` helper) | `encodeURI('file:///C:/Program Files/foo')` keeps `/`, `:`, the literal space turns into `%20`. JDT LS accepts both literal and percent-encoded spaces, so this is robust. |

#### Differentiators

| Feature | Value Proposition | Complexity | Touches | Notes |
|---------|-------------------|------------|---------|-------|
| Use `pathToFileURL` from `node:url` instead of hand-rolling URI construction | Node provides `import { pathToFileURL, fileURLToPath } from 'node:url'` which handles every edge case (drive letters, UNC paths, spaces, special chars) per WHATWG URL spec. Less code to maintain, and round-trips correctly. | S | `src/jdtls/uri-mapper.ts` | Strong preference for this over the manual approach. Returns a `URL` object; call `.href` to get the string. Symmetric `fileURLToPath` for the reverse. This is the established Node idiom and matches what `vscode-uri` does for the VS Code Java extension. |
| `realpathSync` should be replaced with `realpathSync.native` on Windows | The existing `realpathSync(tempDir)` is used to resolve `/tmp` -> `/private/var/...` on macOS. On Windows it can return a junction-resolved path, which is correct. `.native` ensures the returned path uses native separators consistently. | S | `src/jdtls/uri-mapper.ts` (line 66), `src/jdtls/workspace-sync.ts` (lines 99, 137, 203, 251) | Verify with a Windows test that `realpathSync('C:\\Users\\…\\AppData\\Local\\Temp\\mcp-jdtls-…')` returns the same drive-letter casing on every call. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Custom URI scheme like `mcpfs://` to avoid file:// entirely | "Then we don't have to care about RFC 8089." | JDT LS only understands `file://` URIs for project sources. A custom scheme would require implementing a JDT LS protocol extension. Drastic over-engineering. | Use `file://` correctly via `pathToFileURL`. |
| Strip drive letter and pretend everything is rooted at `/` Unix-style | "Then both code paths look the same." | The classpath, project file, and extracted source paths all need to be valid on the actual filesystem. JDT LS validates them via `Path.of(URI.create(...))` and will reject paths that do not exist. | Embrace the platform difference at the URI boundary, normalise to native paths at the FS boundary. |
| Refactor `uri-mapper.ts` to abstract over a `PathFormat` strategy | "Future cross-platform support." | The existing module is 100 lines. The Windows fix is a 10-line `pathToFileURL` swap. The strategy abstraction is more code than the thing it replaces. | Use `pathToFileURL` directly. Branch on `process.platform === 'win32'` *only* if `pathToFileURL` proves insufficient (it should not). |
| Eagerly resolve all paths to UNC `\\?\C:\...` long-path form | "Avoids 260-char MAX_PATH issues." | Node 22 already opts into long-path support on Windows 10 1607+. Temp directories created via `os.tmpdir()` are well below 260 chars. Extracted source paths are a concern (deep package nesting + long class names), but converting to UNC form interferes with JDT LS's own path normalization. | Trust Node's default long-path handling. Address only if a real bug emerges. |

---

## Feature Dependencies

```
Area 1 — Java Discovery
├── [TS-1.1] Priority chain in detectJava
│       └── requires ──> [TS-1.4] Windows .exe suffix fix
│                                └── (otherwise PATH-only candidate breaks)
├── [TS-1.2] Skip-on-version-mismatch loop
│       └── (independent — pure refactor of existing function)
├── [TS-1.3] Scan common Windows install locations
│       └── enhances ──> [TS-1.1] (provides the "common install" tier)
└── [DIFF-1.1] Read org.gradle.java.home
        └── requires ──> [TS-3.1] Parse gradle.properties value
        └── enhances ──> [TS-1.1] (provides the "gradleProperties" tier)

Area 2 — JDT LS Locations
└── [TS-2.1] Windows fallback paths in findJdtLs
        └── (fully independent of other areas)

Area 3 — gradle.properties
├── [TS-3.1] Read org.gradle.java.home
│       └── enables ──> [DIFF-1.1] (Area 1's gradleProperties tier)
└── [TS-3.2] Path value handling (forward slashes, escapes)
        └── required by ──> [TS-3.1] (path must be usable as javaHome)

Area 4 — URI Construction
├── [TS-4.1] Build file:///C:/... on Windows (toFileUri)
│       └── must change together with ──> [TS-4.2] fromFileUri reverse
│                                                  (otherwise round-trip breaks)
├── [TS-4.3] Drive-letter case tolerance
│       └── extends ──> [TS-4.1] and [TS-4.2]
├── [TS-4.4] URL-encode special chars
│       └── subsumed by ──> [DIFF-4.1] pathToFileURL (Node built-in)
└── [DIFF-4.1] Use node:url pathToFileURL
        └── replaces ──> [TS-4.1] + [TS-4.2] + [TS-4.4] (cleaner implementation)
```

### Dependency Notes

- **[TS-1.4] is a blocker for everything else in Area 1.** Without `.exe` suffix handling, every Java candidate we try will fail on Windows because `spawn` does not honour PATHEXT (nodejs/node#6671). Implement first.
- **[TS-3.1] gates [DIFF-1.1].** Reading `org.gradle.java.home` and using it for discovery are two steps. The parser change is in `src/project/gradle-parser.ts` (Area 3 owns it); the consumption is in `src/jdtls/client.ts` (Area 1 owns it). Roadmap should put gradle-parser change first.
- **[DIFF-4.1] (pathToFileURL) subsumes three table-stakes URI items.** If we use Node's built-in, we get correct Windows URIs, correct percent-encoding, and correct round-tripping for free. Strongly recommend implementing as DIFF-4.1 and treating TS-4.1/TS-4.2/TS-4.4 as "validated by the same change."
- **Area 2 (JDT LS locations) is the loosest-coupled.** It can ship in any order relative to the others.
- **[TS-4.3] drive-letter case** depends on whichever URI implementation we land. With `pathToFileURL` we should still test it because JDT LS may return uppercase even when we sent lowercase — Node's `fileURLToPath` is case-preserving, so we need a case-insensitive prefix match in `fromFileUri`.

---

## MVP Definition

### Launch With (v1.6)

The bar for v1.6 is "Windows works end-to-end for the common case." Everything below is required to clear that bar.

- [ ] **[TS-1.4] `detectJava` + JDT LS spawn append `.exe` on Windows** — without this, *no* Java discovery path works on Windows. The single most important fix in the milestone.
- [ ] **[TS-1.2] Skip-on-version-mismatch in `detectJava` loop** — required so multi-tier candidate lookup behaves correctly when a user has both Java 8 and Java 21 installed.
- [ ] **[TS-1.1] Priority chain across `--java-home` → `org.gradle.java.home` → `JAVA_HOME` → PATH → scanned locations** — the milestone's explicit deliverable. Cross-platform.
- [ ] **[TS-1.3] Scan common Windows install paths** — required for the "user installed Temurin via the MSI and never set JAVA_HOME" case, which is the most common Windows JDK setup.
- [ ] **[TS-2.1] Windows fallback paths in `findJdtLs`** — `%USERPROFILE%\jdtls\` and `%LOCALAPPDATA%\jdtls\` at minimum.
- [ ] **[TS-3.1] Parse `org.gradle.java.home` from `gradle.properties`** and expose it on `GradleConfig`.
- [ ] **[TS-3.2] Path value handling for backslash-escaped Windows paths in `.properties` values.**
- [ ] **[DIFF-4.1] (de facto) Use `pathToFileURL` from `node:url`** for all `file://` URI construction — replaces TS-4.1, TS-4.2, TS-4.4. Promoting to MVP because it is *less* code than implementing the table-stakes items manually.
- [ ] **[TS-4.3] Drive-letter case tolerance** in `fromFileUri` round-trip.

### Add After Validation (v1.7)

- [ ] **[DIFF-1.1] (extended) Honour `org.gradle.java.installations.paths`** — adds toolchain-aware discovery. Defer until v1.6 hardens.
- [ ] **[DIFF-1.2] Surface `javaSource` in JDT LS status** — debugging affordance, valuable once Windows users start filing issues.
- [ ] **[DIFF-2.1] Probe Mason's nvim-jdtls path** — niche but cheap.
- [ ] **Improved error messages with attempted-paths listing** in both `detectJava` and `findJdtLs`.

### Future Consideration (v2+)

- [ ] **[DIFF-3.2] `org.gradle.java.installations.fromEnv` support** — only if a Loom user reports needing it.
- [ ] **macOS Apple Silicon JDK discovery refinements** — `/Library/Java/JavaVirtualMachines/` versus Homebrew's `/opt/homebrew/opt/openjdk@21/`. Out of v1.6 scope (Unix is "still works"), but a natural next step.
- [ ] **UNC path support** for JDT LS workspaces on `\\server\share\…` paths — almost no one runs Minecraft mod development from a network share.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| [TS-1.4] `.exe` suffix on Windows for spawn | HIGH (blocker) | LOW | P1 |
| [TS-1.1] Priority chain | HIGH | MEDIUM | P1 |
| [TS-1.2] Skip incompatible candidates | HIGH | LOW | P1 |
| [TS-1.3] Scan common Windows install locations | HIGH | MEDIUM | P1 |
| [TS-3.1] Read `org.gradle.java.home` | HIGH | LOW | P1 |
| [TS-3.2] gradle.properties path value handling | HIGH | LOW | P1 |
| [TS-2.1] Windows JDT LS fallback paths | HIGH | LOW | P1 |
| [DIFF-4.1] `pathToFileURL` from node:url | HIGH | LOW | P1 |
| [TS-4.3] Drive-letter case tolerance | HIGH | LOW | P1 |
| [DIFF-1.1] Read `org.gradle.java.installations.paths` | MEDIUM | MEDIUM | P2 |
| [DIFF-1.2] `javaSource` field in JDT LS status | MEDIUM | LOW | P2 |
| [DIFF-2.1] Probe Mason path | LOW | LOW | P2 |
| Improved error messages with attempted paths | MEDIUM | LOW | P2 |
| `org.gradle.java.installations.fromEnv` | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.6 launch — Windows broken or substantially degraded without it
- P2: Should have, add when possible — improves UX but Windows works without it
- P3: Nice to have, future consideration

---

## Convention References (Where Documented Externally)

| Convention | Source |
|------------|--------|
| Temurin default install: `C:\Program Files\Eclipse Adoptium\jdk-<ver>-hotspot\` | [Adoptium Windows installation docs](https://adoptium.net/installation/windows) |
| Microsoft Build of OpenJDK default install: `C:\Program Files\Microsoft\jdk-<ver>\` | [Microsoft Learn: Install the Microsoft Build of OpenJDK](https://learn.microsoft.com/en-us/java/openjdk/install) |
| Oracle JDK default install: `C:\Program Files\Java\jdk-<ver>\` | [Oracle JDK 21 Installation Guide for Windows](https://docs.oracle.com/en/java/javase/21/install/installation-jdk-microsoft-windows-platforms.html) |
| Scoop install layout: `%USERPROFILE%\scoop\apps\<app>\current\` | [Gradle issue #29121 — Support Scoop installed JDK discovery on Windows](https://github.com/gradle/gradle/issues/29121) |
| `org.gradle.java.home` reads forward slashes on Windows | [Gradle: Build Environment Configuration](https://docs.gradle.org/current/userguide/build_environment.html) |
| Gradle toolchain auto-detection probes JAVA_HOME, package managers (SDKMAN/Asdf/Jabba), IntelliJ `.jdks/`, but **not the Windows registry** | [Gradle: Toolchains for JVM projects](https://docs.gradle.org/current/userguide/toolchains.html) |
| VS Code Java extension resolution order: `java.jdt.ls.java.home` → `java.home` → `JAVA_HOME` → PATH | [redhat-developer/vscode-java JDK Requirements](https://github.com/redhat-developer/vscode-java/wiki/JDK-Requirements) |
| JDT LS Windows config path is `config_win` | [eclipse-jdtls/eclipse.jdt.ls README](https://github.com/eclipse-jdtls/eclipse.jdt.ls) |
| nvim-jdtls / Mason JDT LS install path on Windows: `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls\` | [mfussenegger/nvim-jdtls discussions](https://github.com/mfussenegger/nvim-jdtls) |
| RFC 8089 file URI format on Windows: `file:///C:/path/with/forward/slashes` (three slashes, forward-slash path, drive letter with colon) | [Claude Code issue #20331 — jdtls plugin fails on Windows due to incorrect file URI construction](https://github.com/anthropics/claude-code/issues/20331) |
| Node `child_process.spawn` does not apply PATHEXT on Windows | [nodejs/node issue #6671 — spawn ignores PATHEXT on Windows](https://github.com/nodejs/node/issues/6671) |
| Node 22 `pathToFileURL` / `fileURLToPath` for WHATWG-compliant cross-platform file URI handling | [Node.js url module documentation](https://nodejs.org/api/url.html#urlpathtofileurlpath-options) |
| JDT LS expects valid RFC 8089 URIs; rejects `file://C:\\...` with `IllegalArgumentException: Illegal character in authority` | [Claude Code issue #20331](https://github.com/anthropics/claude-code/issues/20331) |

---

## Sources

- [Adoptium Windows installation](https://adoptium.net/installation/windows)
- [Microsoft Learn: Install Microsoft Build of OpenJDK](https://learn.microsoft.com/en-us/java/openjdk/install)
- [Oracle JDK 21 Windows installation docs](https://docs.oracle.com/en/java/javase/21/install/installation-jdk-microsoft-windows-platforms.html)
- [Gradle Build Environment configuration](https://docs.gradle.org/current/userguide/build_environment.html)
- [Gradle Toolchains for JVM projects](https://docs.gradle.org/current/userguide/toolchains.html)
- [Gradle issue #29121 — Scoop JDK discovery](https://github.com/gradle/gradle/issues/29121)
- [redhat-developer/vscode-java JDK Requirements wiki](https://github.com/redhat-developer/vscode-java/wiki/JDK-Requirements)
- [eclipse-jdtls/eclipse.jdt.ls README](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
- [mfussenegger/nvim-jdtls](https://github.com/mfussenegger/nvim-jdtls)
- [Claude Code issue #20331 — jdtls Windows URI bug](https://github.com/anthropics/claude-code/issues/20331)
- [Claude Code issue #17643 — jdtls-lsp plugin fails on Windows](https://github.com/anthropics/claude-code/issues/17643)
- [nodejs/node issue #6671 — spawn ignores PATHEXT](https://github.com/nodejs/node/issues/6671)
- [Node.js url module — pathToFileURL/fileURLToPath](https://nodejs.org/api/url.html)
- [adoptium/installer issue #64 — provide Oracle JDK compatible registry keys](https://github.com/AdoptOpenJDK/openjdk-installer/issues/64)
- [JDriven: Gradle Toolchain Configuration Using User Defined Java Locations](https://jdriven.com/blog/2024/02/Gradle-Goodness-Java-Toolchain-Configuration-Using-User-Defined-Java-Locations)

---
*Feature research for: v1.6 Windows Support*
*Researched: 2026-05-15*
