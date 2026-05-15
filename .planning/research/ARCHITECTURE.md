# Architecture Research — v1.6 Windows Support

**Domain:** Cross-platform Java tooling for a stdio MCP server (TypeScript / Node.js 22)
**Researched:** 2026-05-15
**Confidence:** HIGH (codebase fully inventoried; no external API changes assumed)
**Scope:** Architectural decisions for the v1.6 milestone only. Existing v1.0–v1.5 architecture (layered domain/tool/state) is settled and out of scope.

---

## 1. Java Discovery — Integration Approach

### Recommendation

Extract Java discovery into a new module `src/jdtls/java-discovery.ts`. The existing `setJavaHome`/`detectJava` pair in `src/jdtls/client.ts` becomes a thin compatibility shim that delegates. Discovery moves from a single-shot startup probe to a **per-resolution call site** that accepts an optional `projectRoot` argument so it can consult that project's `gradle.properties`.

**Priority chain, in `src/jdtls/java-discovery.ts`:**

```
1. --java-home CLI flag      (set once at startup via setCliJavaHome, module-level)
2. org.gradle.java.home      (read from <projectRoot>/gradle.properties on demand)
3. process.env.JAVA_HOME
4. `java` on PATH            (via spawn with PATHEXT-aware binary name)
5. Common install locations  (platform-branched; see §2)
```

Each candidate is probed via `execSync` of `"<path>" --version` with a 10s timeout, parsed by the existing `parseJavaVersion`, and accepted only if `version >= 21`.

### New File

**`src/jdtls/java-discovery.ts`** — exports:

```typescript
export type JavaCandidate = { source: 'cli' | 'gradle' | 'env' | 'path' | 'common'; path: string };
export type JavaDetectResult = JavaDetected | JavaNotFound;  // moved from client.ts

export function setCliJavaHome(home: string | undefined): void;  // replaces setJavaHome
export function getCliJavaHome(): string | undefined;
export function discoverJava(opts?: { projectRoot?: string }): Promise<JavaDetectResult>;
export function probeJavaBinary(javaPath: string): JavaDetectResult | null;  // single-candidate probe
export function listCommonJavaLocations(): string[];  // platform-branched
```

`discoverJava` is **async** (must `readFile` gradle.properties), unlike today's sync `detectJava`. This is a deliberate change — Java discovery is a startup/project-load cost amortized over the JDT LS session, not a per-tool-call hot path.

### Modified Files

**`src/jdtls/client.ts`** — keep the existing `setJavaHome`/`detectJava` symbols as a back-compat shim for one milestone (re-export from `java-discovery.ts`), then remove in v1.7. The `JavaDetected`/`JavaNotFound`/`JavaDetectResult` types move to `java-discovery.ts`; `client.ts` re-exports them so existing imports keep working.

**`src/index.ts`** — `setJavaHome(args.javaHome)` becomes `setCliJavaHome(args.javaHome)`. `initJdtLsSession()` continues to be called for the default project at startup (no project root → no `org.gradle.java.home`).

**`src/jdtls/startup.ts`** — `initJdtLsSession` gains an optional `projectRoot?: string` argument. When supplied, it threads through to `discoverJava({ projectRoot })`. The `detectJava()` call becomes `await discoverJava({ projectRoot })`.

**Project-creation code path** (the create_project / add_fabric_mod handlers under `src/tools/`) — when a project with a Fabric mod child is created, `initJdtLsSession({ projectRoot: fabricMod.rootPath })` is called so the per-project Java picks up `org.gradle.java.home` from that mod's gradle.properties. Today these handlers either reuse the default project's JDT LS session or call `initJdtLsSession()` without a project root; the wire-up will need the exact call site identified during execution.

### Project Context Reach

The current architecture has `initJdtLsSession` called twice in the lifecycle:

1. **Startup** (`src/index.ts:21`) — for the empty `default` project. No project root exists, so `gradle.properties` lookup is skipped. This call only needs the `--java-home` / `JAVA_HOME` / PATH / common-locations branches.
2. **Project creation** — when a fabric mod is added, the JDT LS session for that project is initialized against the mod's root. This is where `org.gradle.java.home` becomes relevant.

The key insight: **JDT LS sessions are per-project today** (see `Project.jdtls` field, one session per `Project`). The smarter Java discovery slots naturally into the per-project session initialization — no architectural shift is needed, only an argument addition.

For the `default` startup project, `org.gradle.java.home` is structurally unavailable (no `gradle.properties` to read). This is acceptable: the default project exists for ad-hoc study jars, not for Fabric mod analysis. Users who care about JDK selection set `--java-home` explicitly or use `JAVA_HOME`.

### Singleton vs Per-Project Resolver

**Recommendation: keep the CLI flag global, make discovery per-call.**

- `--java-home` is a process-wide CLI flag — there's exactly one. Keep it as module-level state in `java-discovery.ts` (renamed to `cliJavaHome` to disambiguate from the env var).
- `discoverJava()` is a stateless function that reads the global flag + an optional project root. No instance state to carry around.
- The previously-detected `JavaDetectResult` is stored on the `JdtLsSession` (already happens implicitly — JDT LS is already running by the time the session is built). No need for a "current Java" cache.

This avoids creating a `JavaDiscoveryService` class that would be one-instance-per-process and provide nothing the function pair doesn't already.

### Unix Regression Risk: **Minimal**

The existing Unix code paths in `detectJava` (lines 65–104 of `client.ts`) become one of several branches in `discoverJava`. The CLI-flag-first → `JAVA_HOME` → PATH chain is preserved verbatim; only two new probes are inserted (`org.gradle.java.home` slots between CLI and `JAVA_HOME`; common locations slots after PATH). On Unix systems where the user has `JAVA_HOME` set or `java` on PATH (the documented prerequisite per v1.5), discovery short-circuits at the same place it does today.

**Mitigation:**
- Keep `setJavaHome`/`detectJava` as re-exports so existing tests and callers compile unchanged.
- Add an explicit test that verifies the priority chain on Unix: CLI flag wins over `JAVA_HOME`, `JAVA_HOME` wins over PATH, etc. The existing `--java-home` precedence test (commit `4e94b4b`) is the template.
- Async signature change for `discoverJava` is the only meaningful behavioral diff. Audit callers: today only `initJdtLsSession` calls `detectJava`, and it's already async-bodied, so the change is local.

---

## 2. Windows Branch Placement Strategy

### Recommendation

**Use a small `src/platform/` module that exposes named helpers, plus inline `process.platform === 'win32'` guards only at sites where the helper would be one-liner overkill.**

Justification: the codebase has very few platform-sensitive sites (counted below), but those sites cluster around two concepts — Java binary resolution and JDT LS install locations — that benefit from a single canonical implementation. Scattering `if (process.platform === 'win32')` blocks across `client.ts` and `java-discovery.ts` invites drift between checks. A typed helper API is enforced once.

### Branch Site Census

A `grep` across `src/` for sites that need Windows-specific behavior (excluding test files):

| # | File | Existing site | Windows change needed | Strategy |
|---|------|---------------|----------------------|----------|
| 1 | `src/jdtls/client.ts:70` | `join(javaHome, 'bin', 'java')` | Append `.exe` on Windows | **platform helper** (`javaBinaryInHome()`) |
| 2 | `src/jdtls/client.ts:72` | `candidates.push('java')` (bare PATH) | `'java.exe'` on Windows (spawn does not apply PATHEXT) | **platform helper** (`javaBinaryName()`) |
| 3 | `src/jdtls/client.ts:139–144` | Common JDT LS locations: `~/.local/share/jdtls`, `/usr/local/share/jdtls`, `~/jdtls` | Replace with `%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls` | **platform helper** (`jdtlsCandidateDirs()`) |
| 4 | `src/jdtls/client.ts:139` | `process.env.HOME ?? ''` | `process.env.USERPROFILE` on Windows | **platform helper** (folded into `jdtlsCandidateDirs()`); also fix to use `os.homedir()` cross-platform |
| 5 | `src/jdtls/client.ts:185–189` | Already platform-branched (`config_mac`/`config_win`/`config_linux`) | None — already correct | leave as-is (the existing pattern is fine here because it's local and exhaustive) |
| 6 | `src/jdtls/java-discovery.ts` (new) | Common Java install locations | New: `C:\Program Files\Java\*`, `C:\Program Files\Eclipse Adoptium\*` on Win; `/usr/lib/jvm/*`, `/Library/Java/JavaVirtualMachines/*/Contents/Home` on Unix | **platform helper** (`commonJavaLocations()`) |

**Total platform-sensitive sites: 6.** Of these, **4 share two helper functions** (`javaBinaryName()`/`javaBinaryInHome()` cover sites 1 and 2; `jdtlsCandidateDirs()` covers sites 3+4). The remaining 2 (site 5 already-correct, site 6 new code) each have one call site.

### New File

**`src/platform/index.ts`** — exports:

```typescript
export const isWindows: boolean;  // process.platform === 'win32'

/** "java.exe" on Windows, "java" elsewhere. Used for spawn argv[0] and PATH lookup. */
export function javaBinaryName(): string;

/** Resolve `<javaHome>/bin/java[.exe]` with platform-appropriate suffix. */
export function javaBinaryInHome(javaHome: string): string;

/** Directories to probe for JDT LS installation (excluding JDTLS_HOME). */
export function jdtlsCandidateDirs(): string[];

/** Directories or glob roots to probe for JDK installations. */
export function commonJavaLocations(): string[];
```

Implementation is dual-branch (`if (isWindows) { ... } else { ... }`) inside each helper. The Unix branch returns today's behavior verbatim where possible. No abstraction over `path.join` or `path.sep` — those already work cross-platform via Node's path module.

### Modified Files

- **`src/jdtls/client.ts`**: replace `'java'`-literal and `join(home, 'bin', 'java')` with `javaBinaryName()` / `javaBinaryInHome()`; replace the `commonLocations` array with `jdtlsCandidateDirs()`. The function-level platform branch at lines 185–189 (JDT LS config dir) stays inline.
- **`src/jdtls/java-discovery.ts`** (new): uses `javaBinaryName()`, `javaBinaryInHome()`, `commonJavaLocations()`.

### Rationale for Splitting (helper module vs inline)

Inline `if (process.platform === 'win32')` is correct when the branch is:
- Local to one function (the JDT LS `config_*` switch is the exemplar — it's an enum-like 3-way split that won't recur).
- Trivially short (no shared logic).

A helper module is correct when:
- The same conditional appears in 2+ places (`javaBinaryName` would otherwise be duplicated between `detectJava`'s candidate building and any future spawn site).
- The conditional encapsulates a stable concept named the same way every time (`jdtlsCandidateDirs`).
- Tests want to mock the platform behavior in one place.

Six sites is small but two of them share helpers and the helpers have meaningful names. A `src/platform/` module of ~80 lines is the right size — not a heavyweight abstraction layer, just a place to put the four Windows constants.

### Unix Regression Risk: **None**

Every helper's Unix branch returns exactly the literal string or array the current code uses. The transformation is mechanical:

- `'java'` → `javaBinaryName()` → returns `'java'` on Unix.
- `join(home, 'bin', 'java')` → `javaBinaryInHome(home)` → returns `join(home, 'bin', 'java')` on Unix.
- `commonLocations` array literal → `jdtlsCandidateDirs()` → returns the same three paths on Unix.

**Mitigation:**
- Snapshot test the Unix helper outputs (`expect(jdtlsCandidateDirs()).toEqual([...])` with mocked homedir).
- The existing `findJdtLs` tests need no changes — they stub `existsSync`, not the candidate list.

---

## 3. `file://` URI Construction

### Recommendation

**Adopt `url.pathToFileURL(path).toString()` globally for URI construction**, and `url.fileURLToPath(uri)` for the reverse. Drop the manual `'file://' + path` concatenation everywhere. This is safe on Unix and necessary on Windows.

### Inventory of `file://` Construction Sites

| File | Line | Construction | Direction |
|------|------|--------------|-----------|
| `src/jdtls/client.ts` | 214 | `'file://' + workspaceDir` (initialize.rootUri) | path → URI |
| `src/jdtls/client.ts` | 247 | `'file://' + workspaceDir` (workspaceFolders) | path → URI |
| `src/jdtls/workspace-sync.ts` | 103, 141, 206, 255 | `'file://' + resolvedTempDir + '/.classpath'` | path → URI |
| `src/jdtls/uri-mapper.ts` | 77 | `file://${normalizedTempDir}/${dirName}/${entryPath}` (toFileUri) | path → URI |
| `src/jdtls/uri-mapper.ts` | 81 | prefix `file://${normalizedTempDir}/` (fromFileUri) | URI → path |
| `src/tools/remove-project-member.ts` | 83 | `'file://' + resolvedTempDir + '/.classpath'` | path → URI |
| `src/tools/tool-helpers.ts` | 350 | `loc.uri.replace('file://', '')` | URI → path |

**Total: 7 construction sites + 2 deconstruction sites = 9 sites to update.**

### Why Global, Not Windows-Special-Case

On Unix:
- `pathToFileURL('/tmp/foo')` returns `URL { 'file:///tmp/foo' }`. Its `.toString()` is `'file:///tmp/foo'`.
- Today's code produces `'file:///tmp/foo'` (note: `'file://' + '/tmp/foo'` = `'file:///tmp/foo'`). **Identical output.**
- For `fromFileUri`, today's code strips `'file://'` from `'file:///tmp/foo/bar'` yielding `'/tmp/foo/bar'`. `fileURLToPath` on the same URI returns `'/tmp/foo/bar'`. **Identical output.**

On Windows:
- `pathToFileURL('C:\\foo\\bar')` returns `URL { 'file:///C:/foo/bar' }` (three slashes, drive letter, forward slashes, URL-encoded special chars).
- Today's `'file://' + 'C:\\foo\\bar'` produces `'file://C:\\foo\\bar'` — **broken**: two slashes (not three), backslashes (not URL-encoded), no leading slash before the drive letter. JDT LS rejects this.
- `fileURLToPath('file:///C:/foo/bar')` returns `'C:\\foo\\bar'`. Today's `.replace('file://', '')` returns `'/C:/foo/bar'` — **broken** for opening as a file.

There's no Unix behavior worth preserving by branching: the WHATWG `pathToFileURL`/`fileURLToPath` round-trip is bit-equal to today's Unix output for the relevant inputs. The one edge case — paths containing characters that would be URL-encoded (spaces, `%`, `#`) — is **also a Unix bug today**, just unlikely to be hit because temp dirs are randomUUIDs. Adopting the standard library function fixes both platforms with one change.

### Modified Files

All 7 files above. The change pattern is mechanical:

```typescript
// Before
const uri = 'file://' + somePath;

// After
import { pathToFileURL } from 'node:url';
const uri = pathToFileURL(somePath).toString();
```

And for the reverse:

```typescript
// Before
const path = uri.replace('file://', '');

// After
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(uri);
```

### Special Consideration: `uri-mapper.ts`

The mapper uses string-prefix matching to recognize "URIs under our temp dir":

```typescript
const prefix = `file://${normalizedTempDir}/`;
if (!uri.startsWith(prefix)) return null;
```

This needs to become:

```typescript
const prefix = pathToFileURL(normalizedTempDir + '/').toString();  // trailing slash matters
if (!uri.startsWith(prefix)) return null;
const rest = uri.slice(prefix.length);
```

The "drive letter case" subtlety on Windows: JDT LS lowercases drive letters in some responses (`file:///c:/...`) but `pathToFileURL` produces uppercase (`file:///C:/...`). Compare case-insensitively for the prefix match on Windows. This is an inline guard, not a helper:

```typescript
const matchesPrefix = isWindows
  ? uri.toLowerCase().startsWith(prefix.toLowerCase())
  : uri.startsWith(prefix);
```

Note: `entryPath` segments inside the URI are URL-encoded by `pathToFileURL`. For typical Java entry paths (`net/minecraft/client/MinecraftClient.java`), no encoding is applied (alphanumerics and `/.-_` are URL-safe), so the existing slicing/splitting logic continues to work. If a future jar contains entries with `+`, space, or `#`, those will appear percent-encoded and the slice-after-prefix logic must `decodeURIComponent` each segment. Flag as a follow-up; not needed for v1.6.

### Unix Regression Risk: **Minimal**

The `pathToFileURL`/`fileURLToPath` functions are part of Node's stable `node:url` API since v10.12, well within the Node 22 LTS baseline. For the temp-dir paths the project uses (randomUUID-generated, no special characters, absolute), Unix output is byte-equal to today's. The single edge case — paths containing `%`, `#`, or spaces — is currently broken on Unix anyway (any such path would produce a malformed URI today), so adopting the standard fixes a latent bug.

**Mitigation:**
- Add a round-trip test: `fromFileUri(toFileUri(jarId, entryPath))` must equal `{ jar: jarId, entryPath }` for representative inputs on both platforms.
- The existing `uri-mapper` tests likely use mocked paths like `/tmp/mcp-test` — they continue to pass unchanged because the Unix output is identical.
- Audit `tool-helpers.ts:350` carefully — the resulting `filePath` is passed to `readFile`. On Unix the output is identical; verify any test that checks the exact `filePath` string.

---

## 4. Suggested Build Order

### Phase Sequence

```
Phase A: Platform Helpers Foundation
    ↓
Phase B: Java Discovery Extraction
    ↓
Phase C: Windows Java Binary Resolution (.exe handling)
    ↓
Phase D: URI Construction Migration
    ↓
Phase E: JDT LS Probe Path Expansion
    ↓
Phase F: org.gradle.java.home Integration
    ↓
Phase G: End-to-end Windows Validation
```

### Phase-by-Phase Rationale

**Phase A — Platform Helpers Foundation** (new `src/platform/index.ts`, no behavior change)

Create the four-helper module with Unix branches returning today's literals. No call sites updated yet. Lands with snapshot tests for both branches.

- *Why first:* Establishes the file structure so subsequent phases have a place to put Windows code. Standalone — zero risk to existing behavior.
- *Depends on:* nothing.
- *Unblocks:* Phases B, C, E.

**Phase B — Java Discovery Extraction** (new `src/jdtls/java-discovery.ts`, move types out of `client.ts`)

Move `JavaDetected`/`JavaNotFound`/`JavaDetectResult`/`detectJava`/`setJavaHome`/`parseJavaVersion` to `java-discovery.ts`. Re-export from `client.ts` for back-compat. Add `discoverJava` (async) alongside; `detectJava` (sync) keeps current behavior as a deprecation shim. **Do not yet** wire `org.gradle.java.home` — that's Phase F.

- *Why second:* Reorganizes without changing behavior. Sets up the file that Phases C and F will edit.
- *Depends on:* nothing structural (Phase A not strictly required but recommended for `javaBinaryName` use in C).
- *Unblocks:* Phases C, F.

**Phase C — Windows Java Binary Resolution** (use `javaBinaryName()` everywhere)

Replace literal `'java'` and `join(home, 'bin', 'java')` in `java-discovery.ts` (and the back-compat path in `client.ts`) with platform helpers. This is the change that makes JDT LS spawn work on Windows.

- *Why third:* The single most impactful Windows fix — without it, nothing else matters. Smallest possible diff with a verifiable result (Windows can now spawn `java.exe`).
- *Depends on:* Phase A (helpers exist), Phase B (Java code lives in the new file).
- *Unblocks:* Phase G (Windows can now start JDT LS).
- *Validation gate:* On a Windows machine, JDT LS process spawns and `ServiceReady` arrives. On Unix, no behavioral change.

**Phase D — URI Construction Migration** (`pathToFileURL`/`fileURLToPath` everywhere)

Sweep all 9 sites identified in §3. Update `uri-mapper.ts` with the case-insensitive prefix match on Windows. Round-trip tests.

- *Why fourth:* Independent of Java discovery — once JDT LS spawns (Phase C), the next thing that breaks on Windows is URI handling. Doing this before Phase E means JDT LS Windows install detection is the last thing wired up.
- *Depends on:* Phase A only (for `isWindows`).
- *Unblocks:* Phase G end-to-end (Windows JDT LS now sees correct URIs).
- *Cross-platform:* Improves Unix latent edge cases (paths with special chars).

**Phase E — JDT LS Probe Path Expansion** (`jdtlsCandidateDirs()` returns Windows paths)

Implement the Windows branch of `jdtlsCandidateDirs()` to probe `%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`. Update `findJdtLs` to use the helper.

- *Why fifth:* Required for Windows out-of-box discovery but `JDTLS_HOME` env var works as a manual override even without this. Smaller user-facing impact than Phases C and D.
- *Depends on:* Phase A.
- *Unblocks:* Phase G (Windows can discover JDT LS without explicit env var).
- *Unix regression risk:* None — Unix branch returns the existing three paths verbatim.

**Phase F — `org.gradle.java.home` Integration**

Add `gradle.properties` reading inside `discoverJava` (between CLI and `JAVA_HOME`). Thread `projectRoot` through `initJdtLsSession`. Wire the project-creation code path so per-project JDT LS sessions see their project's `org.gradle.java.home`.

- *Why sixth:* This is a **cross-platform improvement**, not a Windows fix. It works without any of the prior phases but provides the most value when combined with the Windows phases — otherwise Linux users with `JAVA_HOME` already set see no benefit. Doing it after Windows works avoids confounding two large changes.
- *Depends on:* Phase B (the `discoverJava` async function exists).
- *Unblocks:* Phase G validation includes mixed-JDK scenarios.
- *Unix regression risk:* Minimal — the lookup is read-only (`access` + `readFile` of `gradle.properties`), skipped silently if the file doesn't exist or doesn't contain `org.gradle.java.home`. On Unix, users without that property in `gradle.properties` see no change.

**Phase G — End-to-End Windows Validation**

Manual smoke test on Windows: create a project, load a Fabric mod, run `find_definition`, verify cross-mod navigation. Document the Windows install steps in README. Add to the GSD project's "validated" list.

### Build Order Dependency Graph

```
A (platform helpers) ─┬─→ C (.exe handling)        ─┬─→ G (validation)
                      ├─→ E (JDT LS probe paths)   ─┤
                      └─→ D (URI migration)         ─┤
                                                    │
B (java-discovery)    ─┬─→ C                        │
                      └─→ F (gradle.java.home)     ─┘
```

Phases C, D, E are independent of each other and **may be parallelized** if multiple developers are available. The recommended serial order above prioritizes user-facing impact: spawning JDT LS at all (C) > URIs working (D) > out-of-box discovery (E) > smarter Java selection (F).

### Why Not "URI First"?

A reasonable alternative is to do Phase D (URIs) before Phase C (.exe). Argument: URIs are a hot path that touches every navigation tool, while Java spawning happens once. **Counter-argument used here:** without Phase C, JDT LS doesn't start on Windows, so URIs are never exercised. Build order should make incremental progress observable — after C, a Windows user gets a JDT LS process and meaningful error messages. After D, navigation tools also work.

### Why Not "Java Discovery First"?

Phase F (`org.gradle.java.home`) is the largest architectural change but the smallest Windows fix — in fact, it's not a Windows fix at all. Doing it first would leave Windows still broken while shipping a cross-platform enhancement that's hard to test without Windows working. Deferring it lets the Windows phases ship first and validates the architecture incrementally.

---

## 5. Cross-Cutting Notes

### Tests

Each phase ships with tests in the existing vitest layout. The pattern:

- **Phase A:** unit tests in `tests/platform.test.ts`, mock `process.platform`.
- **Phase B:** rename/move existing `detectJava` tests; add `discoverJava` tests.
- **Phase C:** add Windows-branch tests using `vi.stubGlobal('process', { platform: 'win32' })` or similar.
- **Phase D:** round-trip test for URI mapping on both platforms.
- **Phase E:** stub `existsSync` and `process.env`, verify candidate ordering.
- **Phase F:** integration-style test with a fixture `gradle.properties` containing `org.gradle.java.home`.

### Backward Compatibility

The existing `setJavaHome` symbol exported from `src/jdtls/client.ts` is consumed by `src/index.ts:10,14` and by tests (per the recent commits `9179410`, `4e94b4b`). Keep this symbol as a re-export from `java-discovery.ts` through v1.6. Mark for removal in v1.7 with a planning note.

### Documentation

`CLAUDE.md`'s "Technology Stack" section currently describes Java detection as "JAVA_HOME → java on PATH". Update during Phase B to reflect the priority chain. Add a "Windows Support" subsection to the Stack notes during Phase G describing PATHEXT, JDT LS install locations, and `pathToFileURL` adoption.

### Out of Scope

- Mixed-mappings projects (a Fabric mod whose `org.gradle.java.home` differs between subprojects) — not encountered in practice.
- Windows path-length limits (260-char MAX_PATH) — the existing temp-dir layout (`%TEMP%\mcp-jdtls-<uuid>\<jar-id>\<package>\<class>.java`) is well under the limit for typical Minecraft sources. Defer until empirically observed.
- Cygwin/MSYS2/WSL detection — out of scope. WSL is Linux and works today. Native Windows is what v1.6 targets. Cygwin is too rare to support.

---

## Sources

- Codebase inventory (this repository, files listed in the milestone-context `<files_to_read>`): direct read.
- Node.js `node:url` API (`pathToFileURL`/`fileURLToPath`): stable since v10.12, documented at https://nodejs.org/api/url.html#urlpathtofileurlpath-options.
- Windows PATHEXT behavior on `child_process.spawn`: documented at https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows (the `.bat`/`.cmd` and PATHEXT discussion applies to `.exe` lookup as well).
- Eclipse JDT LS Windows config dir naming (`config_win`): https://github.com/eclipse-jdtls/eclipse.jdt.ls (already correctly handled in `client.ts:187`).

---
*Architecture research for: FabricModMCP v1.6 Windows Support*
*Researched: 2026-05-15*
