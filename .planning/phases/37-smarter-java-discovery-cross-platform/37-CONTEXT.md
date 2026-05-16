# Phase 37: Smarter Java Discovery (cross-platform) - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract Java discovery from `src/jdtls/client.ts` into a new `src/jdtls/java-discovery.ts` module exposing an async `discoverJava({ projectRoot? }): Promise<JavaDetectResult>`. Implements the priority chain `--java-home` → `org.gradle.java.home` (from `<projectRoot>/gradle.properties`) → `JAVA_HOME` → `java` on PATH → scanned common install locations. Sequential async probes, 3s per-candidate timeout, Java 21+ skip-on-fail. `unescapePropertiesValue` (new helper) applied to `org.gradle.java.home` at the consumer site to decode Java-properties backslash escapes.

Locked by ROADMAP / REQUIREMENTS (not re-asked in discussion):
- Priority order is fixed; sequential evaluation (no race)
- Per-candidate 3s timeout via async `execFile`
- Java 21+ probe is skip-on-fail (continue chain, only synthesize "not found" if every candidate fails)
- Common-location parents come from Phase 35's `commonJavaLocations()` (Adoptium / Microsoft / Oracle / Corretto / Zulu / IntelliJ `~/.jdks` / scoop on Windows; `/Library/Java/JavaVirtualMachines/*` / `~/Library/Java/JavaVirtualMachines/*` / Homebrew `/opt/homebrew/opt` / `/usr/local/opt` on macOS; `/usr/lib/jvm` / `/opt` on Linux)
- Old `setJavaHome` / `detectJava` symbols remain importable from `client.ts` for one milestone (re-export form is a discussion decision — see D-07)
- UNIX-01: Unix users who don't set `--java-home` or `org.gradle.java.home` see byte-identical v1.5 behavior

Out of scope (deferred to v1.7+ per REQUIREMENTS.md):
- `org.gradle.java.installations.paths` / Gradle toolchain discovery
- User-level `~/.gradle/gradle.properties` `org.gradle.java.home`
- Relative-path `org.gradle.java.home` resolution
- `gradlew --version` shellout
- Windows registry probing / `wmic` / PowerShell shellouts
- Auto-downloading / bundling a JDK
- Probing `JDK_HOME` / `JRE_HOME` / `JAVA_TOOL_OPTIONS`
- Surfacing `javaSource` (which slot matched) in JDT LS status — v1.7
- Parallel race for first-valid Java probe (destroys priority semantics)

</domain>

<decisions>
## Implementation Decisions

### Startup integration & projectRoot wiring (Area 1)

- **D-01: No new CLI flag in v1.6.** Do NOT add `--project-root`. The default project at startup has no `projectRoot`, so the `org.gradle.java.home` slot is unreachable at startup-time discovery. `discoverJava` is called with no `projectRoot` for the default project's initial JDT LS spawn.
- **D-02: On-demand reinit of degraded JDT LS sessions.** When the default project's JDT LS fails to initialize at startup (`session.available === false`, typically because no compatible Java was found in the slots reachable without `projectRoot`), trigger a reinit attempt later. The reinit hook fires on **every project add** (`add_fabric_mod` → after gradle.properties is parsed) and on **every project refresh** (`refresh_project` / `refresh_project_members` → after gradle.properties is re-parsed) **while any project's JDT LS is in degraded state**.
- **D-03: Retry scope = all degraded projects.** When the reinit hook fires, sweep every project in `projectStore` whose `jdtls.available === false`. For each, call `discoverJava({ projectRoot })` with that project's own root (resolved from the first fabric mod child, or null if the project has no fabric mods — in which case nothing new is reachable and the project remains degraded). If discovery now resolves a Java path, attempt `startJdtLs` with the existing or newly-derived workspace dir, and replace `session` fields atomically on success.
- **D-04: Retry trigger is unconditional on project add/refresh.** Don't gate the retry on "new project's gradle.properties contains `org.gradle.java.home`". The user may have installed Java in the meantime, or a different project may unlock the chain. The 3s per-candidate timeout caps worst-case retry latency. The chain is cheap when JAVA_HOME / PATH already work.
- **D-05: Each new project gets its own discoverJava call with its own projectRoot.** Independent of the reinit logic. A newly-added project always invokes `discoverJava({ projectRoot: <that project's first fabric mod root> })` before its JDT LS spawn. The default project's reinit is an opportunistic side-effect, not a substitute.
- **D-06: Default project initial spawn uses `discoverJava({ projectRoot: undefined })`.** Equivalent to skipping the `org.gradle.java.home` slot. UNIX-01 byte-identical preservation flows from this: when neither `--java-home` nor (impossible-at-startup) `org.gradle.java.home` is set, the remaining slots are `JAVA_HOME` → PATH → scan. The new scan slot only fires when JAVA_HOME and PATH both fail — exactly the case where v1.5 would have errored anyway, so the additional success path is acceptable under UNIX-01 (no Unix user who previously succeeded sees changed behavior).

### API migration: setJavaHome / detectJava lifecycle (Area 3)

- **D-07: `java-discovery.ts` owns all three symbols; `client.ts` is a pure re-export.** New module `src/jdtls/java-discovery.ts` houses `setJavaHome`, `detectJava`, `discoverJava`, and the module-state `configuredJavaHome`. `client.ts` becomes literal:
  ```ts
  export { setJavaHome, detectJava, discoverJava } from './java-discovery.js';
  ```
  TypeScript ESM re-exports are zero-cost; the named-import paths `from './client.js'` continue to work for `tests/jdtls/client.test.ts` and `src/index.ts:10` without modification.
- **D-08: Module state `configuredJavaHome` stays.** Set by `setJavaHome(s)`, read by both `detectJava()` (sync, v1.5 slots only) and `discoverJava()` (async, full chain). This is the cleanest way to preserve the existing `index.ts:14` callsite and the existing test surface.
- **D-09: `detectJava()` retains v1.5 behavior byte-identically.** It is the sync, no-projectRoot, JAVA_HOME → PATH-only path (using `execSync` with the existing 10s per-candidate budget). It does NOT scan common install locations and does NOT read `org.gradle.java.home`. UNIX-01 byte-identical preservation flows from this: the Phase 35 Windows-mocked tests in `tests/jdtls/client.test.ts` and any v1.5 tests that assert exact `detectJava` shape pass without modification.
- **D-10: `discoverJava()` is the new async API used by all new callsites.** `startup.ts:29` migrates from `const java = detectJava()` to `const java = await discoverJava({ projectRoot })`. Internally `discoverJava` shares the candidate-evaluation helper with `detectJava` so the priority-chain logic is not duplicated — the difference between the two APIs is the slot set (2 slots for sync, 5 slots for async) and the I/O strategy (`execSync` vs `execFile` with timeout).
- **D-11: v1.7 cleanup path.** When the one-milestone window closes: delete `setJavaHome` and `detectJava` from `java-discovery.ts`; delete the re-export line from `client.ts`; migrate `index.ts` to pass `javaHome` as a parameter to `startup.ts` → `discoverJava({ projectRoot, javaHome })`. Mechanical, ~5 lines.

### Common-install enumeration strategy (Area 2)

- **D-12: Per-parent vendor-aware readdir with version-aware sort.** For each parent dir from Phase 35's `commonJavaLocations()`:
  1. `readdir(parent)` (skip if parent doesn't exist — no error)
  2. For each entry, derive the candidate Java binary path using vendor-aware layout knowledge (see D-13)
  3. Parse a version hint from the entry name (see D-14) and sort descending — newest version first within each parent
  4. Probe sequentially with the locked 3s timeout; first 21+ wins; failed candidates continue
- **D-13: Vendor layout map.** Each parent has a known shape for the candidate Java binary:
  - **Depth-1 (`<entry>/bin/java[.exe]`):** Adoptium, Microsoft, Java (Oracle), Amazon Corretto, Zulu, IntelliJ `~/.jdks`, `/usr/lib/jvm`, `/opt`
  - **macOS bundle (`<entry>/Contents/Home/bin/java`):** `/Library/Java/JavaVirtualMachines`, `~/Library/Java/JavaVirtualMachines`
  - **Homebrew (`<entry>/libexec/openjdk.jdk/Contents/Home/bin/java`):** `/opt/homebrew/opt`, `/usr/local/opt` — only `openjdk*` entries qualify; non-Java Homebrew packages are filtered by name prefix
  - **Scoop (`<entry>/current/bin/java.exe`):** `~/scoop/apps` — `current` is Scoop's version-pointer symlink/directory
  - The mapping lives in `java-discovery.ts` as a table keyed by the parent path (matched by string prefix or set membership; not by `commonJavaLocations()` order). New vendors require a one-line table addition.
- **D-14: Version-hint parser is best-effort.** Regex like `/\b(\d+)(?:[.\d_-]+)?/` matched against the entry name extracts a leading major. Vendor-specific suffixes (`-hotspot`, `_y`, `zulu-`) are stripped by the same regex catch-all. If the regex fails to match, treat the entry as version 0 — it sorts last but is still probed. The real version comes from the `--version` probe; the hint is purely for sort order within a parent.
- **D-15: Sequential probe, short-circuit on first 21+.** Once any candidate succeeds the version probe, `discoverJava` returns immediately — no further parents or vendors are scanned. Worst-case latency: 6 vendor parents × ~2 candidates each × 3s = 36s cap when everything misbehaves; typical case is the first JAVA_HOME / PATH hit short-circuits the scan entirely.
- **D-16: `/opt` filter on Linux.** `/opt` typically holds many unrelated packages (postgres, intellij-idea-community, etc.). Filter entries by name prefix — accept `jdk-*`, `*-jdk*`, `temurin-*`, `zulu-*`, `corretto-*`, `openjdk-*`; skip everything else. Avoids runaway probing.
- **D-17: Test strategy.** Mock `fs.readdir` per the existing `setPlatform + vi.resetModules + dynamic import` pattern from Phase 35/36. Vendor-aware layout map is unit-testable in isolation (no fs needed for the path-derivation step). Sequential probe behavior asserted via mocked `execFile` returning canned `--version` output / timeouts.

### Error / diagnostic message composition (Area 4)

- **D-18: Multi-line `failureReason` aggregating per-candidate outcomes.** When every candidate fails, synthesize:
  ```
  Java not found. Tried:
    --java-home: (not set)
    org.gradle.java.home: (not set in <projectRoot>/gradle.properties)
    JAVA_HOME=/opt/jdk17: Java 17 (need 21+)
    java on PATH: Java 17 (need 21+)
    /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home: Java 17 (need 21+)
    /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home: timed out after 3s
  Install Java 21+ (Adoptium / Microsoft / Zulu) or set JAVA_HOME / --java-home.
  ```
  The first line MUST start with `Java not found.` — existing tests that use `toContain('Java not found')` (e.g., `tests/jdtls/startup.test.ts`, `tests/tools/get-project-info.test.ts`) keep passing without edit.
- **D-19: `tried: string[]` envelope shape unchanged.** Bare candidate paths populate `tried[]` on any tool error surfacing this failure. Skip reasons live in the human `failureReason` only, NOT in the structured envelope. Do NOT widen `tried: string[]` to a `{candidate, reason}` array — that would ripple through every error path in `src/types/envelope.ts` and every `makeError` call site for one consumer.
- **D-20: Per-candidate reasons are also `logger.debug`-logged.** For `--verbose` audit trails. Format: `logger.debug('Java candidate skipped', { candidate, reason })`. Volume bounded by candidate count.
- **D-21: Slot-label conventions.** Per-candidate prefix in the multi-line message:
  - `--java-home`: literal flag name
  - `org.gradle.java.home`: literal property name, includes `(from <projectRoot>/gradle.properties)` when present
  - `JAVA_HOME=<value>`: env var name + resolved value
  - `java on PATH`: literal
  - Scan candidates: bare absolute path
- **D-22: Skip-reason taxonomy.** Per-candidate outcomes the synthesizer must distinguish:
  1. `(not set)` — slot is absent (no `--java-home`, no `JAVA_HOME`, no `org.gradle.java.home` key)
  2. `(file not found)` — candidate path doesn't exist on disk
  3. `Java N (need 21+)` — probe succeeded, parsed version <21
  4. `timed out after 3s` — `execFile` hit the per-candidate timeout
  5. `probe failed: <message>` — anything else (non-zero exit, unparseable output)

### Claude's Discretion

- **Splitting the work into plans.** Planner decides waves — e.g., (a) create `java-discovery.ts` with `discoverJava` + version-parser + vendor map + `unescapePropertiesValue`, (b) wire `client.ts` re-export shim, (c) migrate `startup.ts` callsite, (d) implement degraded-session reinit hook in `add_fabric_mod` / `refresh_project` / `refresh_project_members` tools, (e) tests across all of the above. Likely 3-4 plans.
- **Where `unescapePropertiesValue` lives.** Roadmap mandates "consumer site." Default placement: in `java-discovery.ts` as a private helper, applied to `properties.get('org.gradle.java.home')` before path resolution. Planner may put it in `src/project/gradle-parser.ts` as an exported helper if that's a more natural home.
- **Reinit hook plumbing detail.** Whether the retry is a method on `ProjectStore` (`projectStore.retryDegradedSessions()`), a free function in `src/jdtls/startup.ts`, or an inline block in the three tool handlers. Default: free function `retryDegradedJdtLsSessions()` in `src/jdtls/startup.ts`, called from `add_fabric_mod`, `refresh_project`, `refresh_project_members` tool handlers after their existing work is done.
- **Whether retry replaces an existing-but-degraded session in-place or fully reconstructs it.** Default: reconstruct (call `initJdtLsSession({ projectRoot })` and replace the `jdtls` field on the project). Cleaner than partial mutation; cleanup of the old failed session's `tempDir` / `dataDir` runs first.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements & milestone scope
- `.planning/REQUIREMENTS.md` — JAVA-01 / JAVA-02 / JAVA-03 / JAVA-04 / JAVA-05, UNIX-01, UNIX-03; "Out of Scope" section explicitly excludes user-level `~/.gradle/gradle.properties`, `org.gradle.java.installations.paths`, registry probing, `gradlew --version` shellout, parallel-race discovery, JDK_HOME / JRE_HOME probing, auto-download
- `.planning/ROADMAP.md` §"Phase 37: Smarter Java Discovery (cross-platform)" — locked success criteria (priority chain order, sequential evaluation, 3s timeout, `unescapePropertiesValue` at consumer site, common-location vendor set, old symbols as re-exports for one milestone)

### Phase 35 carry-forward (foundation)
- `src/platform/index.ts` — exports `isWindows`, `javaBinaryName()`, `javaBinaryInHome()`, `jdtlsCandidateDirs()`, `commonJavaLocations()` (the parent-dirs list Phase 37 enumerates within). DO NOT modify the public surface; new logic lives in `src/jdtls/java-discovery.ts`.
- `src/jdtls/client.ts` `resolveJavaExecutable()` at lines 124–136 — `.exe`-suffix resolution helper; used by `discoverJava`'s candidate probe to canonicalize Windows paths before `execFile`. Bare-name (no separator) candidates still pass through to PATH lookup unchanged.
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-RESEARCH.md` §"Architectural Responsibility Map" lines 51–54 (Phase 37's responsibilities pinned: vendor enumeration + version sort + chain orchestration); §"Pattern 1: Platform-Branched Helper"
- `.planning/phases/35-platform-helpers-java-executable-resolution/35-PATTERNS.md` — "Platform Mocking" + "Mocking a single named export of a node: built-in" (test patterns reused here)
- `tests/platform/index.test.ts` — `setPlatform + vi.resetModules + dynamic import` pattern; copy the shape into the new `tests/jdtls/java-discovery.test.ts`

### Phase 36 carry-forward
- `.planning/phases/36-path-uri-handling-audit/36-CONTEXT.md` — D-04 / D-05 / D-06 (Tool API path domain: Unix-shaped at the boundary, Windows-native only at the disk-location layer). `org.gradle.java.home` values from gradle.properties are disk-location-layer; they carry Windows-native shapes (drive letter, UNC, etc.) and pass through `resolveJavaExecutable` for `.exe` canonicalization.

### Files this phase modifies / creates
- `src/jdtls/java-discovery.ts` — NEW: houses `setJavaHome`, `detectJava`, `discoverJava`, `configuredJavaHome` state, vendor-aware enumeration, version-hint parser, `unescapePropertiesValue` (or import it from gradle-parser if planner chooses)
- `src/jdtls/client.ts` — slimmed: remove `setJavaHome` / `detectJava` / `configuredJavaHome` / `parseJavaVersion` (move to java-discovery.ts), replace with `export { setJavaHome, detectJava, discoverJava } from './java-discovery.js'`. `resolveJavaExecutable` and `parseJavaVersion` MAY stay or move — planner decides based on whether they're used outside java-discovery.
- `src/jdtls/startup.ts` — `initJdtLsSession()` signature extended to `initJdtLsSession({ projectRoot?: string }): Promise<JdtLsSession>`. Line 29 migrates from `detectJava()` (sync) to `await discoverJava({ projectRoot })` (async). New `retryDegradedJdtLsSessions()` free function in this file (or co-located helper).
- `src/index.ts` — line 21 `initialProject.jdtls = await initJdtLsSession()` — no projectRoot for default project (D-06). `setJavaHome(args.javaHome)` callsite at line 14 unchanged.
- `src/tools/add-fabric-mod.ts` — after the existing gradle.properties parse / dependency discovery work, call `retryDegradedJdtLsSessions()` if any project is degraded. Also: new project's own JDT LS spawn (if not the default) uses `await initJdtLsSession({ projectRoot })` with the new mod's project root.
- `src/tools/refresh-project.ts` — after the existing refresh work, call `retryDegradedJdtLsSessions()`.
- `src/tools/refresh-project-members.ts` — same hook.
- `src/project/gradle-parser.ts` — `parseGradleProperties` at line 179 stays as-is (already returns `Map<string, string>`). `unescapePropertiesValue` MAY be added here as an exported helper if planner prefers gradle-parser as its home; otherwise it lives in `java-discovery.ts`.
- `tests/jdtls/java-discovery.test.ts` — NEW: full chain coverage (priority order, version-skip continuation, backslash unescape via UTF-16 / hex sequences, per-candidate timeout, vendor enumeration, version-hint sort, multi-line error message)
- `tests/jdtls/client.test.ts` — existing Phase 35 Windows-mocked describes continue to pass; new describes for `detectJava` are NOT required (re-export shim preserves behavior)
- `tests/jdtls/startup.test.ts` — new describes for `initJdtLsSession({ projectRoot })` and `retryDegradedJdtLsSessions()`

### Files this phase MUST NOT modify
- `src/platform/index.ts` (Phase 35's pure-no-I/O contract). All Phase 37 enumeration logic lives in `src/jdtls/java-discovery.ts`.
- `src/platform/uri.ts` (Phase 36)
- `src/jdtls/uri-mapper.ts`, `src/jdtls/workspace-sync.ts`, `src/tools/remove-project-member.ts`, `src/tools/tool-helpers.ts` — Phase 36 work, not touched here

### External specs
- [Java Properties file format (java.util.Properties)](https://docs.oracle.com/javase/8/docs/api/java/util/Properties.html#load-java.io.Reader-) — `\\`, `\:`, `\=`, `\t`, `\n`, `\r`, `\f`, `\uXXXX` escape sequences. The `unescapePropertiesValue` helper must handle these.
- [Gradle `org.gradle.java.home` documentation](https://docs.gradle.org/current/userguide/build_environment.html#sec:gradle_configuration_properties) — must be an absolute path to a JDK home (not a JRE). v1.6 enforces absolute; relative-path support is deferred (REQUIREMENTS.md).
- [Node.js `child_process.execFile` docs](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback) — `timeout` option semantics (SIGTERM after timeout, then SIGKILL after `killSignal`). 3s is per-candidate.
- [Eclipse Adoptium / Temurin install layout](https://adoptium.net/installation/) — Windows: `C:\Program Files\Eclipse Adoptium\jdk-21.x.y-hotspot\bin\java.exe`; macOS: `/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java`; Linux: `/usr/lib/jvm/temurin-21-jdk/bin/java`
- [Homebrew openjdk formula layout](https://formulae.brew.sh/formula/openjdk) — installs to `${prefix}/libexec/openjdk.jdk/Contents/Home/` (Apple silicon prefix: `/opt/homebrew/opt/openjdk@21`; Intel: `/usr/local/opt/openjdk@21`)
- [Scoop versions / current symlink](https://github.com/ScoopInstaller/Scoop/wiki/Buckets) — Scoop installs to `~/scoop/apps/<app>/<version>` with a `current/` directory that's a junction/symlink to the active version

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 35's `commonJavaLocations()`** — returns ordered parent dirs per platform. Phase 37 enumerates within each. No glob characters in the returned strings (Phase 35 contract).
- **Phase 35's `javaBinaryName()` / `javaBinaryInHome()`** — used inside the vendor map to derive `<entry>/bin/<javaBinaryName>` for depth-1 layouts and `<entry>/Contents/Home/bin/<javaBinaryName>` for macOS bundles.
- **`resolveJavaExecutable(candidate)` in `client.ts:124`** — `.exe` resolution + bare-name passthrough. Reused by `discoverJava` for every candidate before `execFile`.
- **`parseJavaVersion(output)` in `client.ts:142`** — moves to `java-discovery.ts`; same regex shape handles `openjdk 21.0.1 …` and legacy `1.8.0_381`.
- **`parseGradleProperties(content)` in `src/project/gradle-parser.ts:179`** — returns `Map<string, string>` of `key=value` lines with `#`/`!` comments stripped. Phase 37 reads `properties.get('org.gradle.java.home')` from this.
- **`glob` (already a runtime dep)** — used in `client.ts:205` to find the JDT LS launcher jar. Available if planner chooses glob over readdir for any enumeration corner case, but D-12 recommends readdir.

### Established Patterns
- **Tab indentation, ESM with `.js` extensions, vitest + pnpm.** Non-negotiable.
- **`setPlatform + vi.resetModules + dynamic import` test pattern** — Phase 35/36 use this for cross-platform mocking. Reused in `tests/jdtls/java-discovery.test.ts`.
- **`vi.mock('node:fs')` and `vi.mock('node:child_process')`** — for fs.readdir / execFile assertions.
- **Module-state pattern** — `configuredJavaHome` already follows this; the move to `java-discovery.ts` preserves the pattern.
- **Layered architecture** — domain logic in `src/jdtls/`, tools as thin wrappers in `src/tools/`. `discoverJava` is domain; the retry hook is invoked from tool handlers.

### Integration Points
- **Startup spawn:** `src/index.ts:21` calls `initJdtLsSession()` for the default project — no projectRoot. Becomes `initJdtLsSession({ projectRoot: undefined })` (or kept as zero-arg + internal `discoverJava({})` call).
- **Tool-driven project add:** `src/tools/add-fabric-mod.ts` — after gradle.properties parse, the fabric mod's project root is known. The mod's own JDT LS spawn (if its project doesn't already have one) uses `initJdtLsSession({ projectRoot })`. Then `retryDegradedJdtLsSessions()` sweeps any still-degraded projects (typically just the default).
- **Tool-driven refresh:** `src/tools/refresh-project.ts` and `src/tools/refresh-project-members.ts` re-parse gradle.properties. After their existing work, call `retryDegradedJdtLsSessions()` for any degraded project.
- **CLI override:** `--java-home` continues to flow `args.javaHome` → `setJavaHome(args.javaHome)` → `configuredJavaHome` module state → read by both `detectJava` and `discoverJava`.
- **Logging:** `logger.debug` for per-candidate skip reasons; `logger.info` / `logger.warn` for retry-success / final-failure as appropriate.

</code_context>

<specifics>
## Specific Ideas

- User's framing of the startup-integration gray area, verbatim: *"when jdt ls fails to initialize on startup, attempt reinit when a project with org.gradle.java.home is added"* — encoded as D-02.
- User's expansion: *"also retry on project refresh while jdt ls is degraded"* — encoded as D-02 (refresh hook).
- User's retry scope: *"All degraded projects, not just default"* — encoded as D-03.
- User's trigger gating: *"On every project add when default JDT LS is degraded"* (with the unconditional intent — don't gate on the new project providing `org.gradle.java.home`) — encoded as D-04.

</specifics>

<deferred>
## Deferred Ideas

- **`--project-root` CLI flag.** Surfaced during research as Option A for Area 1; rejected in favor of the on-demand reinit pattern. May resurface in v1.7 if users frequently launch the server pointed at a single mod project and want startup-time `org.gradle.java.home` resolution.
- **Lazy JDT LS init (defer `initJdtLsSession` until first project loaded).** Rejected — too large a refactor for a Java-discovery extraction phase. Belongs in a dedicated phase that explicitly redesigns the default-project lifecycle.
- **Surfacing `javaSource` (which slot matched) in JDT LS status.** Listed in REQUIREMENTS.md Future Requirements as v1.7. Phase 37 builds the per-candidate outcome list internally (D-22) — that data could be exposed via a `discoverJava` return-field extension in v1.7.
- **Two-tier structured `tried[{candidate, reason}]` envelope shape.** Rejected as cross-cutting refactor for one consumer. If a future UI dashboard parses `tried` programmatically, revisit.
- **`org.gradle.java.installations.paths` / Gradle toolchain discovery.** REQUIREMENTS.md "Future Requirements" — v1.7.
- **User-level `~/.gradle/gradle.properties` `org.gradle.java.home`.** REQUIREMENTS.md "Future Requirements" — v1.7.
- **Relative-path `org.gradle.java.home` resolution.** REQUIREMENTS.md "Future Requirements" — v1.7. Phase 37 requires absolute paths; relative values may be rejected with a clear error.
- **Improved error messages listing attempted paths/versions.** REQUIREMENTS.md "Future Requirements" — partially delivered here via D-18; full surface (e.g., a dedicated diagnostics tool) is v1.7.

</deferred>

---

*Phase: 37-smarter-java-discovery-cross-platform*
*Context gathered: 2026-05-16*
