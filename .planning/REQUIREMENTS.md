# v1.6 Windows Support — Requirements

**Milestone:** v1.6 Windows Support
**Goal:** Make FabricModMCP work out-of-the-box on Windows, with smarter Java discovery that prefers the JDK the user's mod project actually builds against.
**Constraint:** Linux/Unix is still the priority. Windows fixes live behind `process.platform === 'win32'` guards. Existing Unix code paths must remain unchanged unless an audit finding shows Unix is also broken. The smarter Java discovery feature is the one cross-platform exception.

## v1.6 Requirements

### Windows Compatibility (WIN)

- [ ] **WIN-01**: JDT LS spawns successfully on Windows when Java home is supplied via `--java-home`, `JAVA_HOME`, or discovery — `java.exe` resolution works for absolute paths so `child_process.spawn` (which doesn't honor PATHEXT) succeeds.
- [ ] **WIN-02**: `findJdtLs()` discovers a JDT LS installation on Windows in conventional locations (`%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`, `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`) and uses `os.homedir()` instead of `process.env.HOME`.
- [ ] **WIN-03**: JDT LS accepts `file://` URIs constructed for Windows workspace and classpath paths — drive letter as path component (not host), three-slash form (`file:///C:/…`), spaces percent-encoded.
- [ ] **WIN-04**: ZIP-entry paths join correctly with Windows filesystem paths when extracting sources into JDT LS workspaces (no mixed `\`/`/` corruption).
- [ ] **WIN-05**: Drive-letter case differences (`C:` vs `c:`) round-trip correctly through `fromFileUri`/`toFileUri`.
- [ ] **WIN-06**: Temp-dir cleanup on Windows handles transient `EBUSY` from antivirus/indexer with a brief retry loop.
- [ ] **WIN-07**: ZIP entry extraction rejects path-traversal entries (`../`) before writing to disk.

### Smarter Java Discovery — cross-platform (JAVA)

- [ ] **JAVA-01**: Java home is resolved by a priority chain — `--java-home` flag → `org.gradle.java.home` from project `gradle.properties` → `JAVA_HOME` → `java` on PATH → scanned common install locations — evaluated sequentially in priority order.
- [ ] **JAVA-02**: Candidates that fail the Java 21+ version check are skipped (not fatal); discovery continues to the next candidate.
- [ ] **JAVA-03**: `org.gradle.java.home` values with Java-properties backslash escapes (`C:\\Users\\foo` or `C:/Users/foo`) are correctly unescaped before use.
- [ ] **JAVA-04**: Discovery scans well-known JDK install locations (Adoptium, Microsoft, Oracle, Corretto, Zulu, IntelliJ `~/.jdks`, scoop) when no higher-priority candidate is compatible.
- [ ] **JAVA-05**: Java discovery probes use a per-candidate timeout (3s) so a misbehaving candidate cannot stall startup.

### Linux/Unix Preservation (UNIX)

- [ ] **UNIX-01**: Existing Unix `detectJava` / `findJdtLs` behavior is byte-identical for users who don't set `org.gradle.java.home` (no behavioral change on Linux/macOS).
- [ ] **UNIX-02**: URI round-trip output (`toFileUri` → `fromFileUri`) on Unix paths (including paths with spaces and `/private/var/folders/…` realpath cases) is byte-identical to v1.5.
- [ ] **UNIX-03**: All v1.5 tests pass unchanged after the refactor (regression guard).

## Future Requirements (Deferred to v1.7+)

- Surface `javaSource` in JDT LS status (which candidate matched, for debugging).
- Improved error messages listing attempted paths/versions.
- `org.gradle.java.installations.paths` and Gradle toolchain discovery.
- User-level (`~/.gradle/gradle.properties`) `org.gradle.java.home` resolution and relative-path support.
- macOS Apple Silicon JDK refinements.
- Windows CI runner / GitHub Actions matrix.

## Out of Scope (Explicit Non-Goals)

- **Windows registry probing** — Gradle itself doesn't read the registry; Temurin/Microsoft/Zulu don't all write keys. Out of scope.
- **`wmic`/`where`/PowerShell shellouts for Java discovery** — `wmic` deprecated in Windows 11; PATH probing already covers this.
- **Auto-downloading or bundling a JDK or JDT LS** — ~150MB; GPL/EPL redistribution; blocks MCP handshake; no progress UX over stdio.
- **`shell: true` on `spawn` to "fix" PATHEXT** — breaks signal/kill semantics and quoting for paths with spaces.
- **Generic `JavaResolver` / `PathFormat` / `slash`-or-`upath`-style abstraction** — violates the "Linux first; Windows guarded" constraint.
- **Probing `JDK_HOME` / `JRE_HOME` / `JAVA_TOOL_OPTIONS`** — non-standard / JRE has no `javac` / not a locator.
- **Probing VS Code's bundled JDT LS** — patched and not guaranteed upstream-compatible.
- **Custom URI scheme** — JDT LS only understands `file://`.
- **UNC `\\?\C:\…` long-path conversion** — Node 22 opts in already; defer until empirically observed.
- **`gradlew --version` shellout for Java discovery** — 10-30s cold start, chicken-and-egg.
- **Cygwin / MSYS2 / WSL detection** — WSL is Linux to Node; Cygwin too rare.
- **CRLF conversion of extracted .java files** — JDT LS handles either line ending.
- **Parallel race for first-valid Java probe** — destroys priority semantics; must be sequential.
- **Windows install docs / smoke test as a v1.6 deliverable** — user explicitly excluded during scoping.

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| WIN-01 | Phase 35 | Open |
| WIN-02 | Phase 38 | Open |
| WIN-03 | Phase 36 | Open |
| WIN-04 | Phase 36 | Open |
| WIN-05 | Phase 36 | Open |
| WIN-06 | Phase 36 | Open |
| WIN-07 | Phase 36 | Open |
| JAVA-01 | Phase 37 | Open |
| JAVA-02 | Phase 37 | Open |
| JAVA-03 | Phase 37 | Open |
| JAVA-04 | Phase 37 | Open |
| JAVA-05 | Phase 37 | Open |
| UNIX-01 | Phase 35 | Open |
| UNIX-02 | Phase 36 | Open |
| UNIX-03 | Phase 39 | Open |

_(Phase column filled by roadmapper. UNIX-01 is structurally a cross-phase constraint — it is anchored to Phase 35 where the Java code first changes, and the constraint is reiterated in the Phase 36 and Phase 37 goal statements. UNIX-02 is anchored to Phase 36 where the URI sweep happens. UNIX-03 is the end-to-end regression checkpoint validated in Phase 39.)_
