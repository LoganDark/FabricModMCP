# Pitfalls Research — v1.6 Windows Support + Smarter Java Discovery

**Domain:** Cross-platform Node.js MCP server (Unix-first) adding Windows support and multi-source Java discovery
**Researched:** 2026-05-15
**Confidence:** HIGH (codebase-specific manifestations verified; Node.js/Windows behaviour cross-referenced with current docs)

**Severity legend (per quality gate):**
- **HIGH** — breaks Windows or regresses Unix
- **MEDIUM** — partial breakage / poor UX on one platform
- **LOW** — cosmetic, recoverable, or edge-case

---

## Critical Pitfalls

### PITFALL-1: CreateProcess + PATHEXT — `spawn(javaPath, …)` fails for `.exe`-less paths on Windows

**Severity:** HIGH

**What goes wrong:**
On Windows, `child_process.spawn('C:\\Program Files\\Java\\jdk-21\\bin\\java', [...])` fails with `ENOENT` — even though the **exact same path** works through `execSync(\`"\${javaPath}" --version\`, ...)`. Result: Java is "detected" successfully at startup (because `detectJava` uses `execSync`), then JDT LS fails to spawn with a confusing error.

**Why it happens:**
- `execSync` defaults to `{ shell: true }` (it runs through `cmd.exe`), which means `cmd.exe` applies **PATHEXT** to resolve `java` → `java.exe`, and also handles quoting.
- `spawn(file, args)` defaults to `{ shell: false }`. It calls `CreateProcessW` directly. `CreateProcessW` does **not** consult PATHEXT and does **not** append `.exe` to bare names. The file must exist exactly as given.
- libuv's `uv_spawn` on Windows has historically had partial fallback logic that tries `.exe` for **PATH lookups**, but does **not** add `.exe` to absolute paths supplied to spawn. The asymmetry between `execSync` and `spawn` is the trap.

**Where it manifests in this codebase:**
- `src/jdtls/client.ts:76` — `detectJava` uses `execSync(\`"\${javaPath}" --version\`, ...)`. Works on Windows even without `.exe`. Returns `javaPath` to the caller unchanged.
- `src/jdtls/client.ts:193` — `startJdtLs` does `spawn(javaPath, [ ... ])`. **This is the failure point.** The `javaPath` produced by `detectJava` (e.g., `C:\…\bin\java`) is passed verbatim. CreateProcess rejects it. JDT LS never starts.
- `src/jdtls/client.ts:70` — `candidates.push(join(javaHome, 'bin', 'java'))` builds the path with no `.exe` suffix on any platform.

**How to avoid (concrete pattern):**

```typescript
// In a new helper, e.g. src/jdtls/platform.ts:
import { existsSync } from 'node:fs';

export function resolveJavaExecutable(candidate: string): string | null {
    // Bare 'java' (no separators) → leave it; spawn will resolve via PATH (+PATHEXT on Win).
    // Absolute or relative path → must point at a real file. On Windows, try .exe suffix.
    const hasSeparator = candidate.includes('/') || candidate.includes('\\');
    if (!hasSeparator) return candidate;

    if (process.platform === 'win32') {
        if (existsSync(candidate)) return candidate;
        if (!candidate.toLowerCase().endsWith('.exe') && existsSync(candidate + '.exe')) {
            return candidate + '.exe';
        }
        return null;  // surface this as a clean error, don't let spawn ENOENT
    }
    return existsSync(candidate) ? candidate : null;
}
```

Apply this resolver **once** in `detectJava` so the returned `javaPath` is already the literal file `spawn` will use. **Do not** rely on `shell: true` in `spawn` — it would also need shell-quoting of every JDT LS argument (the launcher jar path can contain spaces, and `-Dfoo=bar` style args have their own quoting hazards), and it spawns an extra cmd.exe in the process tree that complicates kill semantics for `shutdownJdtLs`.

**Bare `'java'` (PATH lookup) is the one case where Windows DTRT** — libuv does append PATHEXT for PATH lookups. So `spawn('java', […])` works on Windows iff `java.exe` is on PATH. Keep that fallback intact.

**DO NOT:**
- DO NOT add `'.exe'` unconditionally on all platforms — it breaks Linux/macOS where there is no `.exe`.
- DO NOT switch `spawn` to `{ shell: true }` to "fix" this — it changes signal handling (Ctrl-C, kill propagation), introduces quoting bugs for paths with spaces, and makes the JDT LS process tree harder to clean up in `shutdownJdtLs` (`src/jdtls/client.ts:298`).
- DO NOT just probe `existsSync(javaPath + '.exe')` and use that on Linux too — Linux JDKs have `java` (no extension). Branch on `process.platform === 'win32'`.

**Warning signs:**
- `detectJava` returns success; JDT LS spawn errors with `Error: spawn … ENOENT` referencing the exact path that just "worked".
- Tests pass on macOS/Linux CI; the same test on Windows CI fails only at the spawn step.

**Phase to address:** **Phase 1 — Java executable resolution** (must precede JDT LS launch work). Add `resolveJavaExecutable` helper and route every `detectJava` candidate through it before returning, so `javaPath` is always something `spawn` can actually exec. Unit-test on Win + nix with a fake `bin/java` and `bin/java.exe`.

---

### PITFALL-2: Launcher-jar path with spaces in `-jar` arg

**Severity:** MEDIUM (HIGH if combined with PITFALL-1's "fix" via `shell: true`)

**What goes wrong:**
On Windows, a typical JDT LS install lives under `C:\Program Files\jdtls\` or `C:\Users\Foo\Downloads\jdt-language-server-…\`. The path passed to `-jar` therefore contains spaces. Developers reflexively quote it (`'-jar', '"' + launcherJar + '"'`), which breaks because **argv-style spawn passes each array element as a separate argument; the inner quotes become part of the argument value**, not a quoting directive.

**Why it happens:**
- `spawn` without `shell: true` skips the shell entirely. Quoting is handled by libuv when it builds the lpCommandLine for CreateProcess. Adding quotes manually doubles them.
- Conversely, `shell: true` (PITFALL-1's tempting "fix") **does** require manual quoting because the command goes through `cmd.exe /c`.
- The Node docs warn about this asymmetry: with `shell: true`, "you need to make sure you escape any args that may contain spaces", but **without** `shell: true`, libuv handles it.

**Where it manifests in this codebase:**
- `src/jdtls/client.ts:182` — `const launcherJar = launcherJars[0];` (resolved by `glob`, returns absolute path)
- `src/jdtls/client.ts:201` — `'-jar', launcherJar,` passed as separate array elements to `spawn`. **This is correct as-is** — leave it.

**How to avoid:**
- Pass the path as its own array element with **no quoting** — current code does this and is correct.
- Same for `'-configuration', configDir` and `'-data', dataDir` — already correct (`src/jdtls/client.ts:202–203`).
- Do not "fix" PITFALL-1 by adding `shell: true`. If that path is ever taken, every argument containing a space (launcher jar, configDir under `Program Files`, dataDir under `Users\Username With Spaces`) would need manual quoting.

**DO NOT:**
- DO NOT do `'-jar', \`"\${launcherJar}"\``. The outer quotes become literal characters in the arg value passed to the JVM; Java prints "Error: Unable to access jarfile \"C:\Program Files\..."`.
- DO NOT do `spawn(\`"\${javaPath}" -jar "\${launcherJar}" ...\`, { shell: true })` as a single-string command. It conflates path resolution with arg handling and is fragile across Windows shells (cmd.exe vs PowerShell quoting rules differ).

**Warning signs:**
- JDT LS dies immediately with "Unable to access jarfile" containing visible `"` characters in the error.
- Manual smoke test on a user with a space-containing username (`C:\Users\John Smith\…`) reveals failures CI didn't catch.

**Phase to address:** Same phase as PITFALL-1 — write an integration test that exercises spawn with a launcher path containing a space on Windows.

---

### PITFALL-3: `'file://' + windowsPath` produces malformed URIs

**Severity:** HIGH

**What goes wrong:**
On Windows, paths look like `C:\Users\Foo\AppData\Local\Temp\mcp-jdtls-…`. Concatenating `'file://' + path` yields `file://C:\Users\Foo\…`, which is **not a valid file URI** for any of three reasons:

1. **Wrong host portion:** `file://C:` parses `C:` as the host, leaving `\Users\Foo\…` as the path. A correct Windows file URI has an empty authority: `file:///C:/Users/Foo/…` (three slashes, then drive letter, then forward slashes).
2. **Backslashes are not URL-safe:** `\` must be `/`, or each backslash must be percent-encoded as `%5C`. JDT LS / Eclipse strictly enforces the LSP spec, which says URIs must follow RFC 3986.
3. **Spaces and special chars unencoded:** `C:\Program Files\…` becomes `file:///C:/Program Files/…` which has a literal space — invalid per RFC 3986 (must be `%20`). Same for `#`, `?`, non-ASCII chars.

JDT LS is **strict** about URI form for `rootUri`, `workspaceFolders[].uri`, and `workspace/didChangeWatchedFiles` change URIs. A malformed URI silently fails workspace registration, then every `find_definition`/`find_references` returns empty results because JDT LS can't match URIs.

Eclipse JDT also has a documented historical quirk around **drive-letter casing**: it normalizes URIs internally and returns them with lowercase drive letters (`file:///c:/…`) even if you sent uppercase. The `fromFileUri` reverse path must be case-insensitive on the drive letter or `dirNameToJarIdMap.get(dirName)` lookups will fail.

**Where it manifests in this codebase (every single one is broken on Windows):**
- `src/jdtls/client.ts:214` — `rootUri: 'file://' + workspaceDir`
- `src/jdtls/client.ts:247` — `workspaceFolders: [{ uri: 'file://' + workspaceDir, name: 'sources' }]`
- `src/jdtls/uri-mapper.ts:77` — `\`file://\${normalizedTempDir}/\${dirName}/\${entryPath}\``
- `src/jdtls/uri-mapper.ts:81` — `const prefix = \`file://\${normalizedTempDir}/\`;`
- `src/jdtls/workspace-sync.ts:103,141,206,255` — `'file://' + resolvedTempDir + '/.classpath'`
- `src/tools/remove-project-member.ts:83` — `'file://' + resolvedTempDir + '/.classpath'`
- `src/tools/tool-helpers.ts:350` — `loc.uri.replace('file://', '')` (reverse direction; also broken on Windows)
- `src/project/gradle-parser.ts:36` — `fileUriToPath` does `uri.replace(/^file:\/\//, '')` (reverse direction; broken for Windows URIs from build.gradle.kts if anyone ever writes one)

**How to avoid (concrete pattern):**

```typescript
import { pathToFileURL, fileURLToPath } from 'node:url';

// Forward: filesystem path → file URI
const uri = pathToFileURL(absolutePath).href;
// macOS: file:///private/var/folders/…
// Linux: file:///tmp/mcp-jdtls-…
// Windows: file:///C:/Users/Foo/AppData/Local/Temp/mcp-jdtls-…
// Spaces and special chars percent-encoded automatically.

// Reverse: file URI → filesystem path
const path = fileURLToPath(uri);
// Windows: file:///C:/Foo → C:\Foo  (drive letter case preserved via OS, backslashes restored)
```

`pathToFileURL` and `fileURLToPath` (added in Node 10.12+) handle:
- The three-slash rule for `file:///` URIs
- Drive-letter encoding on Windows
- Percent-encoding of spaces, `#`, non-ASCII
- Conversion between `/` and `\` on Windows for the path side
- `URL.href` returns the canonical string form

**Action plan for `uri-mapper.ts`:**

```typescript
// Drop hand-rolled string ops; rebuild around URL objects.
return {
    toFileUri(jarId: string, entryPath: string): string {
        const dirName = jarIdToDirNameMap.get(jarId) ?? jarIdToDirName(jarId);
        // entryPath uses forward slashes (ZIP convention); resolvedTempDir uses OS-native.
        // path.join produces OS-native on Windows; then pathToFileURL normalizes.
        return pathToFileURL(join(resolvedTempDir, dirName, ...entryPath.split('/'))).href;
    },
    fromFileUri(uri: string): UriMapping | null {
        let fsPath: string;
        try { fsPath = fileURLToPath(uri); } catch { return null; }
        // Now do prefix matching in OS-native form, where path.relative works.
        const rel = relative(resolvedTempDir, fsPath);
        if (rel.startsWith('..')) return null;
        const parts = rel.split(/[\\/]/);  // accept both separators on Windows
        const dirName = parts[0];
        const entryPath = parts.slice(1).join('/');  // restore ZIP convention
        const jarId = dirNameToJarIdMap.get(dirName);
        return jarId === undefined ? null : { jar: jarId, entryPath };
    },
};
```

**DO NOT:**
- DO NOT do `'file://' + windowsPath.replace(/\\/g, '/')` and call it good. It still produces `file://C:/…` (two slashes, drive-letter-as-host) and doesn't percent-encode spaces.
- DO NOT keep the existing string-concat code for Linux/macOS "because it works there" and add a `process.platform === 'win32'` branch that uses `pathToFileURL`. Just use `pathToFileURL` on all platforms — its output for `/tmp/foo` is `file:///tmp/foo`, identical to what the current code emits. Consolidating avoids divergent test surfaces.
- DO NOT use `loc.uri.replace('file://', '')` to recover a path (`src/tools/tool-helpers.ts:350`). It (a) doesn't decode percent-escapes, (b) leaves a leading `/` ahead of the drive letter on Windows, (c) doesn't convert `/` back to `\`. Use `fileURLToPath`.

**Warning signs:**
- JDT LS returns empty arrays for every navigation request on Windows.
- `language/status` notifications never reach `ServiceReady` (workspace didn't initialize).
- Logs show "no such file" when JDT LS tries to load `.classpath` because the change-notification URI was malformed.
- On macOS, `fromFileUri` works inconsistently if JDT LS normalizes `/var/folders` → `/private/var/folders` (current code uses `realpathSync` to mitigate; verify this still works once switching to URL APIs).

**Phase to address:** **Phase 2 — URI handling audit.** Single sweeping change: replace every `'file://' + path` and `uri.replace('file://', '')` with `pathToFileURL`/`fileURLToPath`. Then write a parameterized test that exercises forward+reverse for `C:\Foo\Bar baz#qux/file.java`, `/tmp/foo`, `/private/var/folders/x y/file.java` to lock in the behaviour.

---

### PITFALL-4: Mixing `node-stream-zip` entry paths (forward slash) with `path.join` (OS-native)

**Severity:** HIGH (silent corruption on Windows)

**What goes wrong:**
ZIP file entries are **always** forward-slash, per the ZIP spec — regardless of the host OS that created or reads the archive. So `node-stream-zip` returns entries like `net/minecraft/client/MinecraftClient.java`.

On Windows, `path.join('extractRoot', 'net/minecraft/client/MinecraftClient.java')` returns `'extractRoot\\net/minecraft/client/MinecraftClient.java'` — a **mixed-separator path**. Node's `fs` APIs largely tolerate that (Win32 has accepted both since forever), but:

1. **Downstream string ops break.** `dirname` returns the substring up to the last separator; on Windows it considers `\\` the primary separator. So `dirname('a\\b/c/d')` returns `'a\\b/c'` (correct) but tests that compare against a known-good string get tripped up.
2. **JDT LS classpath strictness.** The `.classpath` `<classpathentry kind="src" path="..."/>` value must use forward slashes (Eclipse `IPath` convention). If you ever swap to `path.relative` for the path, you'd inject backslashes on Windows and JDT LS would silently fail to find the source folder. Currently `src/jdtls/workspace.ts:102` uses the bare dir name, so this is OK — but the moment subdirectories are used in classpath entries, it breaks.
3. **URL construction.** The fix in PITFALL-3 (`pathToFileURL(join(resolvedTempDir, dirName, entryPath))`) only does the right thing if `join` keeps forward slashes intact — and on Windows it doesn't. Splitting the entry into segments with `entryPath.split('/')` before `join` fixes this (because `join` will then re-emit with `\\` on Windows, and `pathToFileURL` converts to `/`).

**Where it manifests in this codebase:**
- `src/jdtls/workspace.ts:55` — `const targetPath = join(depDir, entryPath);` where `entryPath` is e.g. `net/minecraft/client/MinecraftClient.java`. On Windows this yields `…\dirname\net/minecraft/client/MinecraftClient.java`. `mkdir(dirname(targetPath))` and `writeFile(targetPath)` happen to work because Win32 accepts mixed slashes, but `dirname` returns `…\dirname` (because the LAST `\` is followed by forward slashes; `dirname` looks for the last separator of either kind on Windows — verify this isn't reversed).
- `src/jdtls/workspace-sync.ts:40` — same pattern (`join(depDir, entryPath)`), same hazard.
- `src/jdtls/workspace-sync.ts:184` — same pattern again.
- `src/browsing/source-adapter.ts:40` — `join(baseDir, entryPath)` for `mod-source` reads. `entryPath` here also uses forward slashes (passed through from ZIP-style normalization).
- `src/browsing/source-adapter.ts:33` — **already aware of this**: `.map(e => e.replaceAll('\\', '/'))` normalizes Windows `readdir` output to forward slashes before returning. This is correct and confirms the codebase convention: **entry paths are always forward slash; FS paths are OS-native**. The bug is that the boundary between the two is fuzzy elsewhere.

**The convention to enforce:**
- **Forward-slash domain:** Anything that flows through `JarReader`, `EntryIndex`, `SourceAdapter.listJavaEntries()`/`readEntry()`, or LSP URIs.
- **OS-native domain:** Anything passed to `fs` APIs, `path.join`, `path.dirname`.
- **Boundary conversion:**
  - Forward → OS-native: `join(fsPath, ...entryPath.split('/'))`
  - OS-native → forward: `osPath.split(path.sep).join('/')` or `osPath.replaceAll('\\', '/')` (Windows-only)

**How to avoid:**

```typescript
// At every boundary where an entry path becomes a filesystem path:
const targetPath = join(depDir, ...entryPath.split('/'));
// Now targetPath is OS-native; dirname/mkdir/writeFile behave consistently.

// At every boundary where a filesystem path becomes an entry path / URI:
const entryPath = path.relative(baseDir, fsPath).split(path.sep).join('/');
```

**DO NOT:**
- DO NOT use `path.posix.join` for entry paths "to keep them forward-slash". `path.posix.join('mod', 'foo/Bar.java')` returns `'mod/foo/Bar.java'` (correct), but if `mod` ever contains a backslash from a Windows source, `path.posix.join` will treat it as a literal character, not a separator. Mixing semantics is the trap.
- DO NOT do `path.join(depDir, entryPath).replace(/\//g, path.sep)`. Edge cases like Windows volume roots (`C:\`) and UNC paths (`\\server\share`) make blanket separator replacement unsafe.
- DO NOT trust `mkdir(dirname(targetPath), { recursive: true })` to silently DTRT on mixed-separator paths. Test it explicitly on Windows with an entry path that has 3+ levels of `/`.

**Warning signs:**
- Tests pass on Linux. On Windows, the extracted file tree has weird directory names like `mod\foo` (with backslash inside) as a single-level dir rather than `mod/foo/` as two levels. This happens when Win32 APIs see a backslash that's preceded by a forward slash and treat the whole thing as one literal segment.
- JDT LS workspace indexing finishes but `search_symbols` returns nothing — files exist but in the wrong tree shape.
- `dirname` returns suspiciously short paths in debug logs.

**Phase to address:** **Phase 2 — Path/URI audit** (paired with PITFALL-3). Codify the forward-slash-vs-OS-native convention in a comment header in `src/jdtls/workspace.ts`. Add tests with an entry path containing 3+ `/` separators on Windows that verify the on-disk tree has matching `\` directory boundaries.

---

### PITFALL-5: `.properties` backslash unescaping — Windows JDK paths in `gradle.properties` are mangled

**Severity:** HIGH (this is the smarter-Java-discovery feature's whole point)

**What goes wrong:**
The Java `.properties` file format (`java.util.Properties`) treats backslash as an **escape character**. Per the spec:

```
org.gradle.java.home=C:\Users\Foo\jdk-21
```

is parsed by a spec-compliant reader as `C:UsersFoojdk-21`, because `\U`, `\F`, `\j` are unrecognized escapes that strip the backslash. The correct forms are:

```
org.gradle.java.home=C:\\Users\\Foo\\jdk-21   # double-backslash, the only fully-portable form
org.gradle.java.home=C:/Users/Foo/jdk-21       # forward slashes — Gradle accepts these on Windows
```

Real-world `gradle.properties` files in the wild use **all three forms** — single-backslash (broken per spec, but tolerated by some lenient parsers), double-backslash, and forward-slash. Our smarter-Java-discovery feature has to make at least the latter two work. Gradle itself uses `Properties` to read this file, and Gradle accepts single-backslash on Windows in practice because **most unrecognized escapes** in `Properties` drop the backslash silently, but `\u` is interpreted as a Unicode escape and `U` etc. would produce real corruption. The pragmatic stance is: **decode backslash escapes the same way `java.util.Properties` does**, including continuation lines.

**Where it manifests in this codebase:**
- `src/project/gradle-parser.ts:179` — `parseGradleProperties` does **no unescaping**:

  ```typescript
  for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      props.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
  }
  ```

  Misses: backslash escapes (`\\`, `\n`, `\t`, `\:`, `\=`, `\ `, `\uXXXX`), line continuations (a line ending in `\` continues to the next line), separators other than `=` (the spec allows `:` and whitespace as key-value separator), and leading whitespace inside the key.

For our purposes, the **only escapes that matter** for v1.6 are `\\` (backslash) and `\:`/`\=` (literal separator in key). Line continuations and `\u` Unicode escapes are vanishingly rare in `gradle.properties`. The minimal-correct parser:

```typescript
function unescapePropertiesValue(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] !== '\\') { out += s[i]; continue; }
        const next = s[i + 1];
        if (next === undefined) break;  // trailing backslash, ignore
        i++;
        switch (next) {
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'f': out += '\f'; break;
            case 'u': {
                const hex = s.slice(i + 1, i + 5);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 4;
                } else {
                    out += 'u';  // malformed, treat as literal per spec leniency
                }
                break;
            }
            default: out += next;  // \\ → \, \: → :, \= → =, \U → U (spec: drop backslash)
        }
    }
    return out;
}
```

**Where `org.gradle.java.home` is resolved (Gradle's contract):**

Per Gradle's [Build Environment](https://docs.gradle.org/current/userguide/build_environment.html) docs and the `org.gradle.java.home` property: the value can be a relative path, in which case it is resolved **relative to the directory containing `gradle.properties`** — i.e., the project root (or `~/.gradle/` if it's the user-level file). Our resolver must:

1. Decode the value (PITFALL-5 fix).
2. If it's an absolute path, use as-is.
3. If relative, resolve against the directory of the `gradle.properties` file we read it from.
4. Look up the home (not a `bin/java` directly) — Gradle's `org.gradle.java.home` always points at a JDK home root, not the executable.
5. Append `bin/java` (and let PITFALL-1's resolver handle `.exe`).

**DO NOT:**
- DO NOT add a regex like `value.replace(/\\\\/g, '\\')` and call it done. That misses the `C:\Users\Foo` (single-backslash) case which becomes `C:UsersFoo` only if you DO decode but is left as-is if you DON'T decode. The actual user-frequent breakage is the single-backslash case, where the right move is exactly "drop the backslash before non-special chars" per spec.
- DO NOT skip unescaping and rely on "Windows paths usually work anyway". They don't — `\U`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v` are real escapes in `Properties` parsers. `C:\Users\new\test` → `C:Users<newline>ew<TAB>est`.
- DO NOT use `JSON.parse` or string-template eval to decode. The `.properties` escape set is a strict subset of JSON's and not 1:1.
- DO NOT forget the `:` and ` ` (whitespace) separators between key and value. `org.gradle.java.home : C:\jdk` and `org.gradle.java.home C:\jdk` are both valid per spec. **For v1.6 it is acceptable to handle only `=`** (Gradle's docs uniformly show `=`), but document the limitation.

**Warning signs:**
- User sets `org.gradle.java.home=C:\Users\new\jdk-21` (note `\n` in `\new`); our detection thinks it found a JDK at `C:Users\new` → `C:Users<newline>ew\jdk-21`. `existsSync` returns false. We fall back to `JAVA_HOME` or PATH and the user wonders why their explicit setting was ignored.
- Smarter-Java-discovery tests pass with `C:/Users/Foo/jdk-21` (forward-slash form) and fail with the more common single-backslash form.

**Phase to address:** **Phase 3 — Smarter Java discovery.** Implement `unescapePropertiesValue`, apply it in `parseGradleProperties`. Add tests for `C:\Users\Foo`, `C:\\Users\\Foo`, `C:/Users/Foo`, and a path containing a `\u` sequence. **Backport caveat:** the existing tests rely on `gradle.properties` values being returned verbatim; unescaping changes that contract. Audit `parseGradleProperties` callers (esp. `parseBuildGradle` at `src/project/gradle-parser.ts:191`, which uses the map for `${var}` substitution) to confirm none of them currently depend on raw backslashes — the variables there are typically version strings (`minecraft_version=1.21.1`) without backslashes, so this is low-risk in practice.

---

### PITFALL-6: Java version probing — slow serial probes, AV first-run delay, stderr vs stdout, `--version` vs `-version`

**Severity:** MEDIUM

**What goes wrong (several sub-issues, addressed together because they all bite the same code path):**

1. **Slow serial probing.** With a priority chain `--java-home → org.gradle.java.home → JAVA_HOME → PATH java → common install dirs`, you could have 5+ candidates. Each `execSync("java --version")` is 300–800ms cold-start on Windows (slower with Windows Defender real-time scan triggering on first invocation of a never-seen executable). Five serial probes = 2–4 seconds added to server startup. The MCP stdio server's startup time directly affects how snappy Claude Code feels when first invoking a tool.

2. **`--version` vs `-version` (legacy JDKs).** `java -version` (single dash, legacy) prints to **stderr**. `java --version` (double dash, Java 9+) prints to **stdout**. The current code (`src/jdtls/client.ts:76`) uses `--version` (good — Java 21+ is the requirement) but also doesn't capture stderr (`stdio: ['pipe', 'pipe', 'pipe']` does pipe stderr, and `execSync` returns stdout by default, ignoring stderr). For Java 21+ this is fine because `--version` writes to stdout. But: if a user has only Java 8 on PATH and Java 21 elsewhere, the `java --version` invocation against Java 8 will **error out** (unrecognized option) and `execSync` throws — the `catch { continue; }` handles it correctly. So this is mostly latent risk: don't "improve" the version probe by removing the `--version` form in favour of `-version` and string-parsing stderr.

3. **Windows Defender first-run delay.** A freshly downloaded `java.exe` may be scanned by Defender's Smart App Control / cloud lookup the first time it executes. Subsequent invocations are cached. Symptom: first probe takes 2–5 seconds; same probe ~50ms after. Don't write timing-sensitive tests that fail on cold cache.

4. **32-bit-only JDKs.** Vanishingly rare in 2026 — Oracle, Adoptium, and Microsoft all ship 64-bit JDK 21+ only. Stop worrying about this.

5. **stdout pollution from the JVM (stdio MCP server concern).** The stdio MCP server's stdout is JSON-RPC; **any** byte of garbage corrupts the channel. The Java version probe uses `execSync` with `stdio: ['pipe', 'pipe', 'pipe']` and **captures** stdout into the return value (not forwarded). The output is then either parsed or discarded. This is safe — the JVM's stdout cannot reach the MCP server's stdout via `execSync`. **Verified.** No mitigation needed beyond keeping the explicit `stdio` array.

   The risk is in `spawn` (PITFALL-1) for the long-running JDT LS process — `proc.stdout!` is piped into the LSP `JSONRPCEndpoint`, not the MCP server's stdout, so that's also safe. `proc.stderr!` is forwarded to `logger.debug` (`src/jdtls/client.ts:255`) which goes to **stderr** of the MCP server. Good. Do not "improve" this by attaching listeners that write JVM output to the MCP server's stdout.

**Where this manifests in this codebase:**
- `src/jdtls/client.ts:65–104` — `detectJava` is currently 2-candidate (`JAVA_HOME`, then `java` on PATH). Expanding to 5+ candidates requires being deliberate about probe latency.

**How to avoid:**

```typescript
// Parallel probe, race-style: take the first valid result, abort others.
async function probeOne(javaPath: string): Promise<JavaDetected | null> {
    try {
        const output = await new Promise<string>((resolve, reject) => {
            execFile(javaPath, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
                if (err) reject(err); else resolve(stdout + stderr);
            });
        });
        const v = parseJavaVersion(output);
        if (v === null || v < 21) return null;
        return { javaPath, version: v };
    } catch { return null; }
}

// Sequential in priority order (so we return THE PREFERRED candidate, not the fastest):
for (const candidate of candidates) {
    const result = await probeOne(candidate);
    if (result) return result;
}
```

**Why sequential, not parallel:** the priority chain (`--java-home` > `org.gradle.java.home` > `JAVA_HOME` > PATH > common locations) is a **preference order**, not a race. We want the user's `--java-home` if it works, even if `JAVA_HOME` would resolve faster. Parallel "first-valid-wins" would silently prefer whichever spawn finished first — wrong.

**Optimization, if needed:** spawn all probes in parallel but **wait for them in priority order**. Then total latency = max(individual probes), not sum.

**`execSync` → `execFile` (async):** the current code is blocking (`execSync`). For server startup this is acceptable (~500ms before the MCP `initialize` response). For the v1.6 expanded chain, switching to async lets the server respond to `initialize` immediately and detect Java in the background, then mark JDT LS as "ready" via the `language/status` notification path.

**DO NOT:**
- DO NOT race probes in parallel and return the first valid result — destroys the priority semantics.
- DO NOT switch from `--version` to `-version` to "support older JDKs" — Java 21+ supports `--version`; older JDKs are rejected anyway.
- DO NOT capture only stderr — `--version` on Java 21+ goes to stdout. Capture both (concat for parsing).
- DO NOT remove the `stdio: ['pipe', 'pipe', 'pipe']` array — if it gets defaulted to `'inherit'` for stdout, the JVM's startup banner corrupts the MCP JSON-RPC channel.
- DO NOT use `exec` (the shell-invoking variant) for the Java probe — same PATHEXT/quoting concerns as PITFALL-1. `execFile`/`execSync` with an array of args is safer.

**Warning signs:**
- Cold start of the server takes 3–5 seconds on Windows; warm start is <500ms.
- The "found Java" log line shows a different JDK than the user expected (priority order bug).
- Server startup intermittently fails on Windows CI with `ETIMEDOUT` from `execSync` (Defender scan exceeded the 10s timeout on a slow runner).

**Phase to address:** **Phase 3 — Smarter Java discovery.** Build the priority-ordered probe; add a unit test that mocks each candidate to specific exit codes and confirms the order. Add a soak test on Windows CI that runs the probe 100x and asserts p95 < 1s (warm).

---

## Moderate Pitfalls

### PITFALL-7: JDT LS Windows install locations missing from `findJdtLs`

**Severity:** MEDIUM

**What goes wrong:**
`findJdtLs` (`src/jdtls/client.ts:128`) probes Unix-only paths:
```typescript
join(home, '.local', 'share', 'jdtls'),
'/usr/local/share/jdtls',
join(home, 'jdtls'),
```

On Windows, none of these exist (and `process.env.HOME` is often unset — Windows uses `USERPROFILE`). Result: even if the user has JDT LS installed, auto-detection fails and they must set `JDTLS_HOME` manually.

**Where it manifests:**
- `src/jdtls/client.ts:139` — `const home = process.env.HOME ?? '';` On Windows, `HOME` is typically undefined, so this is `''`, and the join becomes `\.local\share\jdtls` (no drive letter, no user dir). `existsSync` returns false.
- `src/jdtls/client.ts:142` — `'/usr/local/share/jdtls'` is Unix-only.

**How to avoid:**
```typescript
import { homedir } from 'node:os';
const home = homedir();  // works on all platforms (USERPROFILE on Win, HOME on Unix)

const commonLocations: string[] = [];
if (process.platform === 'win32') {
    commonLocations.push(
        join(home, 'jdtls'),
        join(home, 'AppData', 'Local', 'jdtls'),
        join(home, 'scoop', 'apps', 'jdtls', 'current'),
        'C:\\Program Files\\jdtls',
        'C:\\tools\\jdtls',
    );
} else {
    commonLocations.push(
        join(home, '.local', 'share', 'jdtls'),
        '/usr/local/share/jdtls',
        join(home, 'jdtls'),
    );
}
```

Also: replace `process.env.HOME ?? ''` with `homedir()` — `HOME` is Unix-only by convention, while `os.homedir()` returns the platform-appropriate value (`USERPROFILE`/`HOMEDRIVE+HOMEPATH` on Windows, `HOME` on Unix).

**Warning signs:** Windows users always have to set `JDTLS_HOME` manually; bug reports asking "why doesn't it find my JDT LS".

**Phase to address:** **Phase 4 — JDT LS discovery on Windows.** Easy, isolated change. Worth a single PR.

---

### PITFALL-8: `glob` patterns and Windows path separators

**Severity:** MEDIUM

**What goes wrong:**
`glob` (npm v11) uses **forward-slash patterns** regardless of OS. The `cwd` option uses OS-native paths. So `glob('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: jdtlsHome, absolute: true })` works on Windows — but the **returned paths** use forward slashes on Windows by default. That's then handed to `spawn` as the `-jar` argument. The JVM is fine with either separator on Windows for the `-jar` value, so this happens to work — but it's fragile.

**Where it manifests:**
- `src/jdtls/client.ts:173` — `glob('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: jdtlsHome, absolute: true })` returns e.g. `C:/jdtls/plugins/org.eclipse.equinox.launcher_…jar` on Windows.

**How to avoid:**
- `glob` accepts `{ windowsPathsNoEscape: true }` and supports `{ nodir: true }`; the existing call is fine.
- If you ever need OS-native paths from glob output, normalize with `path.resolve` or pass `{ posix: false }`.
- For JVM args, forward-slash works on Windows; leave as-is.

This is **a non-issue today** but worth documenting so the next person doesn't "fix" it.

**Phase to address:** Documented in audit phase (Phase 2).

---

### PITFALL-9: `realpathSync` on Windows — junction points, drive-substitute, case-folding

**Severity:** MEDIUM

**What goes wrong:**
`realpathSync` resolves symlinks. On Windows, the analogous concepts are:
- **NTFS junction points** — resolved.
- **`subst`-mapped drives** — NOT resolved (they're a session-local trick, not a filesystem concept).
- **Case-folding** — the OS preserves case but matches case-insensitively. `realpathSync` returns the **canonical case** as stored on disk, which may differ from what the user typed.

If `tmpdir()` returns `C:\Users\Foo\AppData\Local\Temp\` (case-correct) but JDT LS later returns URIs as `file:///c:/users/foo/…` (lowercased — Eclipse's URI normalization), the prefix match in `fromFileUri` fails.

**Where it manifests:**
- `src/jdtls/uri-mapper.ts:66` — `resolvedTempDir = realpathSync(tempDir);`
- `src/jdtls/workspace-sync.ts:99,137,203,251` — same pattern.

**How to avoid:**
- Switch to `pathToFileURL` (PITFALL-3 fix) — handles case-folding consistently because both ends use the same conversion function.
- For drive-letter case mismatches that survive the URL fix, compare prefixes case-insensitively on Windows: `prefix.toLowerCase() === path.toLowerCase()` is safe for ASCII; for Unicode use `String.prototype.localeCompare(other, undefined, { sensitivity: 'base' })`.

**Warning signs:** `fromFileUri` returns `null` for URIs that JDT LS returned (i.e., that JDT LS knows about), only on Windows.

**Phase to address:** Part of **Phase 2 — URI handling audit**.

---

### PITFALL-10: `tmpdir()` returns a path with a `~1`-style 8.3 short name on some Windows configs

**Severity:** LOW

**What goes wrong:**
On Windows configurations with 8.3 short-name generation enabled (default on `C:\` for legacy compat, sometimes disabled by admins), `os.tmpdir()` may return `C:\Users\LONGUS~1\AppData\Local\Temp` (or any short-form variant) depending on how the env was set up. `realpathSync` will convert to the long form. JDT LS may return the long form. Mismatched in `fromFileUri`.

`realpathSync` on the tmpdir at startup time (already done at `src/jdtls/uri-mapper.ts:66`) mitigates this — JDT LS sees the long form, our resolver normalizes to the long form. Keep this behaviour after the URI refactor.

**Phase to address:** Same as PITFALL-9.

---

### PITFALL-11: Loom-cache probing — backslash inside `readdir` results

**Severity:** LOW (the existing code is already correct)

**What goes wrong (potential, not actual):**
`probeProjectLocal` (`src/project/loom-cache.ts:30`) calls `readdir(netMinecraft)` and gets back **bare basename** strings (e.g., `minecraft-merged-abc1234567`). These contain no separators, so platform doesn't matter. The constructed `join(versionDir, filename)` produces OS-native paths. **This code is already cross-platform.**

The risk would emerge if anyone "improved" the code to use `readdir(..., { recursive: true })` — recursive output uses OS-native separators, and the regex matchers would need updating. Currently safe.

**How to avoid:** Don't refactor `probeProjectLocal` to recursive readdir without re-auditing regex.

**Phase to address:** Document, no change needed.

---

### PITFALL-12: `process.env.HOME` vs `os.homedir()` inconsistency

**Severity:** MEDIUM

**What goes wrong:**
The codebase mixes the two:
- `src/jdtls/client.ts:139` — `process.env.HOME ?? ''` (broken on Windows)
- `src/project/gradle-parser.ts:1,38` — `homedir()` (correct)
- `src/project/loom-cache.ts:1,73` — `homedir()` (correct)

`homedir()` is portable; `process.env.HOME` is Unix-only convention. Result: Loom-cache resolution and Gradle parsing work on Windows; JDT LS discovery does not.

**How to avoid:** Sweep all `process.env.HOME` references. Replace with `homedir()`. Adopt a project rule: "never use `process.env.HOME` directly; always `homedir()`".

**Where it manifests:**
- `src/jdtls/client.ts:139` — the only known case.

**Phase to address:** **Phase 4 — JDT LS discovery** (drive-by during the `findJdtLs` Windows-locations fix).

---

## Minor Pitfalls

### PITFALL-13: `.classpath` XML path attribute and Windows separators

**Severity:** LOW

**What goes wrong:**
`<classpathentry kind="src" path="..."/>` — Eclipse's IPath expects forward slashes regardless of OS. Currently `generateClasspathFile` (`src/jdtls/workspace.ts:101`) injects only the bare dirname (no separators), so this is fine. If anyone adds nested subdirs (e.g., `mymod--minecraft/subdir`), use forward slashes explicitly.

**Phase to address:** Document in workspace.ts header.

---

### PITFALL-14: Line endings in extracted .java files

**Severity:** LOW

**What goes wrong:**
Source jars contain `.java` files with LF line endings (the JDK convention). When written to disk on Windows via `writeFile(targetPath, content)` where `content` is a `Buffer`, line endings are **preserved** (LF). JDT LS handles either. The MCP tools that return source content also preserve LF. No conversion happens anywhere. **This is the right behaviour** — don't add auto-CRLF conversion.

But: anyone running `git status` against the extracted temp dir on Windows with `core.autocrlf=true` would see noise. The temp dir isn't a git repo, so this is irrelevant unless someone misconfigures things.

**Phase to address:** No action.

---

### PITFALL-15: `tmpdir()` cleanup on Windows — open handles block `rm`

**Severity:** LOW (latent)

**What goes wrong:**
Windows is famously strict about deleting files/directories that have open handles. If JDT LS still holds a file open (lock file, log file, indexing-in-progress), `cleanupTempDir`/`rm` from `src/jdtls/workspace.ts:81` can fail with `EBUSY` or `EPERM`.

Current code uses `{ force: true }` which suppresses errors for non-existent paths but does not retry on `EBUSY`. The `shutdownJdtLs` path (`src/jdtls/client.ts:298`) waits up to 5s for the JVM to exit before SIGKILL — if cleanup runs immediately after, file handles may still be releasing.

**How to avoid:**
- Ensure cleanup happens **after** the process `exit` event fires, not just after the kill signal.
- Wrap `rm` in a 3x retry with 100ms backoff on `EBUSY`/`EPERM` (Windows-only).
- Don't fail the server shutdown if temp cleanup fails — log and continue.

**Phase to address:** **Phase 2 — Path/URI audit** (drive-by; small).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip backslash unescape in `.properties` parser; document "use forward slashes" | One-line workaround | Users hit silent failures with single-backslash paths; bug reports we can't easily explain | Never — v1.6 explicitly targets this |
| `process.platform === 'win32'` branching everywhere | Surgical, low-risk per the milestone constraint | Code paths diverge; Unix and Windows behaviours can drift; double the test matrix | Acceptable as long as branches are isolated to a few helper modules (resolveJavaExecutable, findJdtLs locations) — NOT acceptable in URI/path conversion where the right answer is "use the cross-platform API always" |
| Keep `'file://' + path` for Unix and add `pathToFileURL` only for Windows | Smaller diff | Two code paths; subtle drift (e.g., the macOS `/private/var/folders` realpath issue is handled differently in each) | Never — `pathToFileURL` produces identical output to the current code on Unix |
| Use `shell: true` in `spawn` to "fix" PATHEXT | One-character fix | Quoting bugs for paths with spaces; signal/kill semantics change; cmd.exe in process tree | Never |
| Bare 8.3-name handling instead of `realpathSync` | Skip a syscall | Random JDT LS URI mismatches on configs with short-name generation | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Eclipse JDT LS | Send malformed `file://` URIs as `rootUri`/`workspaceFolders` | Use `pathToFileURL(...).href`; verify with `language/status` notifications during init |
| Eclipse JDT LS | Send URIs with one set of slashes, get them back lowercased | Compare URIs case-insensitively on Windows in `fromFileUri` |
| Java `Properties` format | Treat the file as `key=value` lines without unescaping | Implement backslash-escape decoding for `\\`, `\=`, `\:`, `\n`, `\r`, `\t`, `\uXXXX` |
| `gradle.properties` `org.gradle.java.home` | Use as bare path; assume absolute | Resolve relative paths against the file's directory; append `bin/java` (let executable resolver handle `.exe`) |
| Node `child_process.spawn` on Windows | Pass `.exe`-less absolute path to executable | Resolve to actual `.exe` first; bare names pass through to PATH lookup which DOES apply PATHEXT |
| `node-stream-zip` entry paths | Mix with `path.join` (OS-native) | Split on `/`, then spread into `path.join`: `join(dir, ...entryPath.split('/'))` |
| `child_process.execSync` for version probe | Default `stdio: 'inherit'` writes JVM output to MCP server's stdout, corrupting JSON-RPC | Always pass explicit `stdio: ['pipe', 'pipe', 'pipe']` and capture output (current code is correct — preserve it) |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Serial Java probes through 5+ candidates | 2–4s server startup on Windows | Probe candidates in priority order but with shorter per-probe timeout (3s vs 10s); make detection async and let MCP `initialize` return immediately | Adding 3+ candidates to the chain (Phase 3 work) |
| Re-running `execSync` for each tool call | Server feels slow on first invocation of any JDT-LS-dependent tool | Cache the `detectJava` result for the process lifetime; refresh only on explicit reload | Always — already cached implicitly because `detectJava` is only called at startup; preserve this |
| Windows Defender first-run scan on `java.exe` | Cold start adds 2–5s, warm is fast | Test CI must allow cold-cache variance; consider preflight to warm Defender's cache | Fresh JDK installs, Windows runners on every CI run |
| Glob over a huge JDT LS plugins/ dir | Slow if user has many JDT LS versions | The current single-match glob `plugins/org.eclipse.equinox.launcher_*.jar` is fast (one-level pattern) | Never under expected use; document |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trust `org.gradle.java.home` path from project's `gradle.properties` and spawn it as the JVM | Project files are user-controlled; running an arbitrary executable is the obvious risk | Restrict to existing files under JDK-like layouts (`<dir>/bin/java(.exe)` present, version probes to 21+); log the chosen path prominently |
| Trust user-typed `--java-home` CLI value | Lower risk (user opted in) — but still need to validate it points at a real JDK 21+ | Run `--version` probe; reject if version <21 or invocation fails |
| `$JDTLS_HOME` set to attacker-controlled value | Equivalent to attacker controlling JVM args | Existing risk; environment trust is the user's problem |
| Path traversal via `entryPath` from ZIP | A crafted source jar with `../../etc/passwd` entry path could escape extraction dir | `node-stream-zip` (current lib) sanitizes by default, but verify; alternatively check `!entryPath.includes('..')` before `join(depDir, entryPath)` in `src/jdtls/workspace.ts:55` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent fallback when `--java-home` value is invalid | User explicitly told the server which JDK to use; gets ignored; uses a different one | If `--java-home` is set and invalid, **error out** rather than fall back. CLI-supplied values mean intent. |
| Detection log line buried in debug logs | User can't tell which JDK the server picked | Emit an info-level log line at startup: `Using Java 21 from C:\Users\Foo\jdk-21\bin\java.exe (source: org.gradle.java.home)` |
| Generic "JDT LS failed to start" error | User can't tell if it was Java, JDT LS, workspace, or URI | Differentiate error messages by phase: `JavaNotFoundError`, `JdtLsHomeNotFoundError`, `JdtLsSpawnFailedError`, `JdtLsWorkspaceInitTimeoutError`. The current `JavaDetectResult`/`JdtLsFindResult` discrimination is a good start; extend to spawn-time failures. |
| Server eats stderr from JDT LS | User can't diagnose JVM crashes | Current code logs stderr to `logger.debug` (`src/jdtls/client.ts:255`); ensure debug level is enabled by default during dev or surface a tail of stderr in error responses |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **`spawn(javaPath, ...)`:** Often missing — `.exe` resolution. Verify by running the integration test on Windows with `javaPath = "C:\\…\\bin\\java"` (no `.exe`).
- [ ] **`file://` URI construction:** Often missing — proper drive-letter handling. Verify by feeding JDT LS a Windows-style URI and confirming it returns matching URIs that round-trip through `fromFileUri`.
- [ ] **`.properties` parser:** Often missing — backslash unescaping. Verify with `org.gradle.java.home=C:\Users\new\jdk` (note `\n`) parses to `C:\Users\new\jdk` (literal), not `C:\Users<newline>ew\jdk`.
- [ ] **Java discovery priority:** Often missing — `--java-home` takes precedence over everything. Verify by setting `--java-home` to a valid JDK and `JAVA_HOME` to a different valid JDK; the chosen path must be the `--java-home` one.
- [ ] **JDT LS Windows locations:** Often missing — `homedir()` instead of `process.env.HOME`. Verify by unsetting `HOME` on Linux (sanity check) and running on Windows (real check).
- [ ] **Path traversal guard on ZIP extraction:** Often missing — `entryPath.includes('..')` check before `join`. Verify with a unit test using a synthesized jar containing `../escape.java`.
- [ ] **Temp cleanup retries on Windows:** Often missing — `EBUSY` retry. Verify by killing JDT LS hard and cleaning up immediately on Windows.
- [ ] **Unix regression suite still green:** Often missing — re-run the existing 696 tests on Linux+macOS after every Windows-targeted change. The constraint is explicit: Unix priority.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| PITFALL-1 (spawn ENOENT) | LOW | Add `.exe` resolver in `detectJava`; redeploy. No data lost; user retries. |
| PITFALL-3 (broken URIs) | MEDIUM | Refactor `uri-mapper.ts` to use `pathToFileURL`/`fileURLToPath`. JDT LS sessions need restart; sweep all call sites in one go. |
| PITFALL-4 (mixed separators) | LOW | Per-call site: replace `join(depDir, entryPath)` with `join(depDir, ...entryPath.split('/'))`. Files already extracted on Windows may have wrong shape — delete temp dir, let JDT LS re-extract. |
| PITFALL-5 (.properties escapes) | LOW | Add `unescapePropertiesValue`; affected users re-run; re-parse on next refresh. No persistent state corruption. |
| PITFALL-6 (slow startup) | MEDIUM | Convert `execSync` → async `execFile` with priority-ordered awaits; profile p95 latency. |
| PITFALL-7 (JDT LS not found) | LOW | Add Windows install locations to `findJdtLs`. Workaround for users in the meantime: set `JDTLS_HOME`. |
| PITFALL-9 (case-folding mismatch) | LOW | Side effect of PITFALL-3 fix — falls out of using URL APIs. |
| PITFALL-12 (HOME on Windows) | LOW | Replace with `homedir()` — drive-by fix in same PR as PITFALL-7. |
| PITFALL-15 (cleanup EBUSY) | LOW | Add retry loop; non-blocking. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| PITFALL-1: CreateProcess + PATHEXT | **Phase 1 — Java executable resolution** | Integration test: spawn JDT LS with a `.exe`-less `javaPath` on Windows succeeds |
| PITFALL-2: Launcher-jar spaces | **Phase 1** (verify) | Integration test with JDT LS installed under a path containing spaces |
| PITFALL-3: `file://` URI construction | **Phase 2 — URI handling audit** | Parametric test: forward + reverse round-trip on `C:\Foo\Bar baz#qux/file.java`, `/tmp/foo`, `/private/var/folders/x y/file.java` |
| PITFALL-4: ZIP-path × `path.join` mixing | **Phase 2** | On-disk tree shape test: extracted Windows tree has correct directory boundaries for entries with 3+ slashes |
| PITFALL-5: `.properties` backslash unescape | **Phase 3 — Smarter Java discovery** | Unit test: `org.gradle.java.home=C:\Users\new\jdk` parses correctly |
| PITFALL-6: Probe latency / `--version` semantics | **Phase 3** | Mocked priority-order test; soak test for p95 latency |
| PITFALL-7: JDT LS Windows install locations | **Phase 4 — JDT LS discovery on Windows** | Integration test on Windows finds JDT LS at one of the documented locations without `JDTLS_HOME` set |
| PITFALL-8: glob path separators | **Phase 2** (document) | No change; document convention in code comment |
| PITFALL-9: realpathSync Windows quirks | **Phase 2** (falls out of PITFALL-3 fix) | Round-trip test on a tmpdir with short-name form |
| PITFALL-10: 8.3 short names | **Phase 2** | Manually verify on a Windows VM with `fsutil 8dot3name query c:` |
| PITFALL-11: Loom-cache probing | **No change** | Existing tests are cross-platform; preserve |
| PITFALL-12: `process.env.HOME` vs `homedir()` | **Phase 4** (drive-by) | Grep audit: `grep -rn 'process.env.HOME' src/` returns no matches |
| PITFALL-13: `.classpath` separators | **Phase 2** (document) | Code comment in workspace.ts |
| PITFALL-14: Line endings | **No change** | N/A |
| PITFALL-15: Temp cleanup EBUSY | **Phase 2** | Windows CI test: kill JDT LS, run cleanup, verify retry logic |

**Suggested phase ordering and rationale:**

1. **Phase 1 — Java executable resolution.** Foundation; unblocks Windows entirely. Touches `client.ts:detectJava` + new `platform.ts` helper. Small scope, high impact. **PITFALL-1, PITFALL-2.**
2. **Phase 2 — Path / URI handling audit.** Wholesale move to `pathToFileURL`/`fileURLToPath`. Affects `uri-mapper.ts`, `workspace.ts`, `workspace-sync.ts`, `client.ts`, `tool-helpers.ts`, `gradle-parser.ts:fileUriToPath`, `remove-project-member.ts`. Sweeping but mechanical. **PITFALL-3, PITFALL-4, PITFALL-8 (doc), PITFALL-9, PITFALL-10, PITFALL-13 (doc), PITFALL-15.**
3. **Phase 3 — Smarter Java discovery.** Depends on Phase 1 (`resolveJavaExecutable`). Adds priority chain, `.properties` unescaping, async probing. **PITFALL-5, PITFALL-6.**
4. **Phase 4 — JDT LS discovery on Windows.** Smallest, most isolated. Could ship in parallel with Phase 3. **PITFALL-7, PITFALL-12.**

**Critical Unix-regression guard between phases:** Run full vitest suite on macOS + Linux after each phase. The constraint is explicit — Unix is priority. Windows-targeted changes that touch shared code (Phase 2 especially) must demonstrate zero Unix behaviour change.

---

## Sources

- [Node.js `child_process` documentation — spawn, execSync, PATHEXT behaviour](https://nodejs.org/api/child_process.html) — HIGH confidence; current Node 22 docs
- [Node.js `url` module — pathToFileURL, fileURLToPath](https://nodejs.org/api/url.html#urlpathtofileurlpath-options) — HIGH confidence
- [java.util.Properties.load() spec — backslash escapes, continuation lines](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html#load(java.io.Reader)) — HIGH confidence; primary source
- [Gradle Build Environment — `org.gradle.java.home` resolution rules](https://docs.gradle.org/current/userguide/build_environment.html) — HIGH confidence
- [libuv `uv_spawn` Windows behaviour — PATHEXT applies only to PATH lookups, not absolute paths](https://github.com/libuv/libuv/blob/v1.x/docs/src/process.rst) — HIGH confidence; libuv is the substrate Node uses
- [Eclipse JDT LS — URI handling and `IPath` conventions](https://github.com/eclipse-jdtls/eclipse.jdt.ls) — MEDIUM confidence; behaviour inferred from observed JDT LS responses + LSP spec
- [LSP 3.17 spec — DocumentUri / file:// URI requirements](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#uri) — HIGH confidence; RFC 3986 conformance is mandatory
- Codebase analysis — file:line references throughout this document — HIGH confidence

---
*Pitfalls research for: FabricModMCP v1.6 Windows Support + smarter Java discovery*
*Researched: 2026-05-15*
