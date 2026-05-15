# Phase 35: Platform Helpers + Java Executable Resolution — Research

**Researched:** 2026-05-15
**Domain:** Cross-platform process spawning on Windows; foundation for v1.6 Windows Support
**Confidence:** HIGH

## Summary

This phase is the **foundation** of the v1.6 Windows Support milestone. It establishes a new `src/platform/index.ts` module (~80 LOC, four exported helpers) and surgically modifies `src/jdtls/client.ts` so that `child_process.spawn` can actually launch a Java process on Windows. Today, `detectJava` succeeds on Windows (via `execSync` → `cmd.exe` → PATHEXT), then `startJdtLs` immediately fails with ENOENT because `spawn` does NOT apply PATHEXT to absolute paths. The fix is mechanical: append `.exe` to `<javaHome>/bin/java` candidates on `process.platform === 'win32'`, and route every absolute Java candidate through a new `resolveJavaExecutable` helper before returning it from `detectJava`. Unix branches return today's literals **verbatim**, so v1.5 Unix behavior is byte-identical and `UNIX-01` is satisfied by construction.

The v1.6 milestone research (`.planning/research/{SUMMARY,STACK,ARCHITECTURE,FEATURES,PITFALLS}.md`, commit `1dc7250`) already exhaustively covered: which library to use (none — Node 22 stdlib is sufficient), what helpers to build, how to test, what NOT to do (`shell: true`, `cross-spawn`, `which`, `locate-java-home`). This research limits itself to (a) the exact current code in `src/jdtls/client.ts` so the planner has line numbers, (b) the test scaffolding needed to mock `process.platform`, and (c) carving Phase 35's scope cleanly from Phases 36–38 (which Phase 35 must NOT touch).

**Primary recommendation:** Land `src/platform/index.ts` with all four helpers (even the ones Phase 35 doesn't consume yet — Phases 36/38 use them), wire `javaBinaryName()` / `javaBinaryInHome()` into `detectJava`'s existing candidate loop, add `resolveJavaExecutable` as a private helper in `client.ts` (NOT in the platform module — it touches `fs`, the platform module should stay pure), and add tests that mock `process.platform = 'win32'` via `vi.stubGlobal`. Do not extract a `java-discovery.ts` module — that's Phase 37.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Platform branching (`isWindows`, binary names, candidate dirs) | `src/platform/` (new) | — | Cross-cutting concern; consumed by `jdtls/` and (later) `tools/`. Pure (no `fs`, no `child_process`). |
| Java executable resolution (`.exe` suffix existence check) | `src/jdtls/` (Domain) | `src/platform/` (for `isWindows`) | Touches `fs.existsSync`, so it belongs in the domain layer that already handles process spawning. The platform module stays free of side effects. |
| Java candidate construction (`detectJava` loop) | `src/jdtls/client.ts` (Domain — unchanged location) | `src/platform/` (for binary names) | Existing v1.5 home; no rearrangement in Phase 35. Phase 37 will extract this into `java-discovery.ts`. |
| Spawning JDT LS process | `src/jdtls/client.ts` `startJdtLs` (Domain — unchanged) | — | Already correct; receives an already-resolved `javaPath` from `detectJava`. No code change in Phase 35. |

## User Constraints (from CONTEXT.md)

> **CONTEXT.md does not exist for this phase** — research was spawned by `/gsd:plan-phase` integrated flow, no separate discuss-phase step ran. Constraints are therefore drawn from the ROADMAP Phase 35 success criteria and milestone-level CLAUDE.md / REQUIREMENTS.md.

### Locked Decisions (from ROADMAP success criteria + REQUIREMENTS.md)

1. **`src/platform/index.ts` exports exactly four named helpers** plus the `isWindows` constant: `isWindows`, `javaBinaryName()`, `javaBinaryInHome(home)`, `jdtlsCandidateDirs()`, `commonJavaLocations()`. All four helpers ship in this phase even though Phase 35 only consumes two — Phases 36/37/38 consume the others and the milestone research is firm that one canonical module avoids drift.
2. **Unix branches return today's literals verbatim.** `javaBinaryName()` returns `'java'`; `javaBinaryInHome(home)` returns `join(home, 'bin', 'java')`; `jdtlsCandidateDirs()` returns the existing three Unix paths (`~/.local/share/jdtls`, `/usr/local/share/jdtls`, `~/jdtls`). This is the UNIX-01 commitment — byte-identical Unix behavior.
3. **`resolveJavaExecutable(candidate)` lives in the JDT LS layer, NOT in `src/platform/`.** It touches `fs.existsSync`. The platform module stays pure (no I/O).
4. **`resolveJavaExecutable` rules:**
   - Bare names (no `/` or `\`) — pass through unchanged (so `'java'` PATH lookups still work on both platforms; on Windows, libuv applies PATHEXT for PATH lookups even when `spawn` does not for absolute paths).
   - Absolute/relative paths on Windows — if the literal exists, return it; else if `<path>.exe` exists, return that; else return `null` (so the caller surfaces a clean error instead of letting `spawn` ENOENT later).
   - Absolute/relative paths on Unix — return as-is (no existence check; existing behavior).
5. **No `shell: true` on `spawn`.** Explicitly forbidden by milestone PITFALL-1 — breaks signal/kill semantics, introduces quoting bugs.
6. **No new runtime dependencies.** Milestone-wide decision (STACK.md). Node 22 stdlib is sufficient.
7. **`setJavaHome` / `detectJava` symbol locations unchanged** in this phase. They stay in `src/jdtls/client.ts`. Phase 37 extracts them into `src/jdtls/java-discovery.ts` with re-exports.

### Claude's Discretion

- Internal structure of `src/platform/index.ts` (one file vs split — recommend one file at ~80 LOC).
- Whether `resolveJavaExecutable` is a private (unexported) helper inside `client.ts` or exported. Recommend **exported** so it has its own unit test, but called only from `detectJava`'s candidate loop (single call site).
- Test fixture style for mocked Windows existsSync — recommend `vi.mock('node:fs', ...)` with a programmable map.
- Whether to also fix the existing `process.env.HOME ?? ''` site at `client.ts:139` opportunistically. Recommend **no** — that's explicitly Phase 38's territory (REQ WIN-02 / PITFALL-12). Phase 35 must not bleed scope.
- Test file naming — `tests/platform.test.ts` is fine, or `tests/platform/index.test.ts` to match the source layout.

### Deferred Ideas (OUT OF SCOPE for Phase 35)

- **All `file://` URI handling** — Phase 36 (`pathToFileURL`/`fileURLToPath` sweep across 9 sites).
- **ZIP-entry × `path.join` separator fix** — Phase 36.
- **Temp-dir EBUSY retry loop** — Phase 36.
- **ZIP path-traversal guard** — Phase 36.
- **`org.gradle.java.home` reading** — Phase 37 (depends on this phase's helpers).
- **Async `execFile` probes with 3s timeout** — Phase 37.
- **`unescapePropertiesValue`** — Phase 37.
- **Common-install-location scanning for Java** — Phase 37 (this phase ships `commonJavaLocations()` returning the right strings, but `detectJava` does not yet probe them).
- **Windows JDT LS install location probing** — Phase 38 (this phase ships `jdtlsCandidateDirs()` with the Windows paths, but `findJdtLs` does not yet consume it).
- **`process.env.HOME` → `homedir()` sweep** — Phase 38 (drive-by during PITFALL-12 fix).
- **README "Windows Support" section / CLAUDE.md priority chain note** — Phase 39.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIN-01 | JDT LS spawns successfully on Windows when Java home is supplied via `--java-home`, `JAVA_HOME`, or discovery — `.exe` resolution works for absolute paths so `child_process.spawn` (which doesn't honor PATHEXT) succeeds. | Addressed by (a) `javaBinaryInHome(home)` appending `.exe` on Windows, and (b) `resolveJavaExecutable` ensuring the path `detectJava` returns is a real file on disk. PITFALL-1 in milestone research [CITED: `.planning/research/PITFALLS.md` §PITFALL-1]. Confirmed by [nodejs/node#6671 — spawn ignores PATHEXT on Windows](https://github.com/nodejs/node/issues/6671). |
| UNIX-01 | Existing Unix `detectJava` / `findJdtLs` behavior is byte-identical for users who don't set `org.gradle.java.home` (no behavioral change on Linux/macOS). | Addressed by (a) every helper's Unix branch returning today's literal verbatim — `javaBinaryName()` returns `'java'`, `javaBinaryInHome(home)` returns `join(home, 'bin', 'java')`, and (b) `resolveJavaExecutable` short-circuiting on Unix to return the candidate unchanged. Existing v1.5 `tests/jdtls/client.test.ts` `detectJava` tests must pass without modification — they assert exact `/cli/java/bin/java` / `/env/java/bin/java` strings, which is exactly what the Unix branch produces. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | Node 22 stdlib | `existsSync` for `.exe` resolution in `resolveJavaExecutable` | Already imported in `src/jdtls/client.ts:13`. Zero new deps. [VERIFIED: codebase grep] |
| `node:path` | Node 22 stdlib | `join()` for `<home>/bin/java[.exe]` construction | Already imported in `src/jdtls/client.ts:9`. Platform-aware separators on output. [VERIFIED: codebase grep] |
| `node:os` | Node 22 stdlib | `homedir()` for Unix branch of `jdtlsCandidateDirs()` (replaces today's `process.env.HOME ?? ''`) | Already imported elsewhere in repo (`src/project/gradle-parser.ts:1`, `src/project/loom-cache.ts:1`). [VERIFIED: codebase grep] |
| `vitest` | 4.1.4 | Test runner; `vi.stubGlobal('process', ...)` for platform mocking | Already in devDependencies. [VERIFIED: package.json line 33] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | This phase is pure stdlib. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `.exe` ternary in `detectJava` | `which` npm package | `which` is a maintained Isaac Schlueter library, but adds a dep for a one-liner. The bare-`java` case (PATH lookup) is already handled by libuv's PATHEXT logic in `spawn` for PATH lookups, and the `<home>/bin/java` case is `join(home, 'bin', \`java${ext}\`)`. Rejected by milestone STACK.md §Q3. |
| Resolver helper in `src/jdtls/` | `cross-spawn` library | `cross-spawn` solves PATHEXT for shell-script spawning (`.bat`/`.cmd`). We spawn `java.exe` (an executable, not a script) with an absolute resolved path — `cross-spawn` solves a problem we don't have. Rejected by milestone STACK.md §Q3. |
| Spawning with `shell: true` | (none) | Forbidden by milestone PITFALL-1 — breaks signal handling, introduces quoting bugs for paths with spaces (JDT LS launcher under `C:\Program Files\jdtls\` would need manual quoting), adds an extra `cmd.exe` to the process tree. |
| Pure `src/platform/index.ts` (no `fs`) vs. inlining `existsSync` checks | (chosen) | Keep `src/platform/` side-effect-free so it's trivially mockable. `resolveJavaExecutable` (which needs `fs.existsSync`) goes in `client.ts` where `existsSync` is already imported. |

**Installation:** None — pure stdlib + existing dev dependencies.

**Version verification:** Not applicable (no new packages). Existing Node 22 LTS `node:fs`/`node:path`/`node:os` APIs used are stable since Node 10.12 (`pathToFileURL`/`fileURLToPath` — not used in this phase but proven stable across the v1.6 sweep). `existsSync` and `join` have been stable since Node 0.x.

## Package Legitimacy Audit

> **Skipped — no external packages installed in Phase 35.** All code uses Node 22 stdlib (`node:fs`, `node:path`, `node:os`) and existing dev dependencies (`vitest`). Package legitimacy gate is not triggered because the phase adds zero `dependencies` or `devDependencies`. If the planner discovers a need to add a package, run slopcheck per the protocol before approval.

## Architecture Patterns

### System Architecture Diagram

```
                       ┌────────────────────────────────────────┐
                       │  src/platform/index.ts  (NEW)          │
                       │                                        │
                       │  - isWindows (const)                   │
                       │  - javaBinaryName(): string            │
                       │  - javaBinaryInHome(home): string      │
                       │  - jdtlsCandidateDirs(): string[]      │
                       │  - commonJavaLocations(): string[]     │
                       │                                        │
                       │  Pure module. No I/O. No side effects. │
                       └─────────────┬──────────────────────────┘
                                     │
                          imports (in Phase 35):
                          - javaBinaryName
                          - javaBinaryInHome
                                     │
                                     ▼
              ┌──────────────────────────────────────────────────────┐
              │  src/jdtls/client.ts  (MODIFIED)                     │
              │                                                      │
              │   detectJava() {                                     │
              │       candidates = []                                │
              │       if (javaHome)                                  │
              │           candidates.push(javaBinaryInHome(home))    │
              │       candidates.push(javaBinaryName())              │
              │       for c of candidates:                           │
              │           resolved = resolveJavaExecutable(c)        │
              │           if !resolved: continue                     │
              │           probe via execSync; parse version          │
              │           if version ≥ 21: return resolved           │
              │       return error                                   │
              │   }                                                  │
              │                                                      │
              │   resolveJavaExecutable(candidate) {  // NEW         │
              │       if no separator: return candidate              │
              │       if Windows:                                    │
              │           if existsSync(candidate): return it        │
              │           if !.exe && existsSync(c+'.exe'): return   │
              │           return null                                │
              │       return candidate (Unix unchanged)              │
              │   }                                                  │
              │                                                      │
              │   startJdtLs(javaPath, ...) {                        │
              │       spawn(javaPath, ...)   // unchanged            │
              │       // javaPath is now guaranteed-resolvable       │
              │   }                                                  │
              └──────────────────────────────────────────────────────┘
                                     │
                                     ▼
                       ┌─────────────────────────────────────┐
                       │  src/jdtls/startup.ts  (UNCHANGED)  │
                       │                                     │
                       │   initJdtLsSession() {              │
                       │     java = detectJava()             │
                       │     // java.javaPath is now safe    │
                       │     // for spawn on Windows         │
                       │     startJdtLs(java.javaPath, ...)  │
                       │   }                                 │
                       └─────────────────────────────────────┘

Data flow on Windows:
  user JAVA_HOME = "C:\Program Files\Java\jdk-21"
   → detectJava builds candidate: "C:\Program Files\Java\jdk-21\bin\java.exe"
       (javaBinaryInHome appended .exe on win32)
   → resolveJavaExecutable: existsSync("…\bin\java.exe") = true → returns it
   → execSync probes version: "openjdk 21..." → version 21, ≥ 21, accept
   → return { javaPath: "C:\…\bin\java.exe", version: 21 }
   → startJdtLs(javaPath, ...): spawn("C:\…\bin\java.exe", [...]) → SUCCESS

Data flow on Unix (UNIX-01: byte-identical to v1.5):
  user JAVA_HOME = "/usr/lib/jvm/temurin-21"
   → detectJava builds candidate: "/usr/lib/jvm/temurin-21/bin/java"
       (javaBinaryInHome — Unix branch returns join(home, 'bin', 'java'))
   → resolveJavaExecutable: Unix branch returns candidate as-is (no existsSync)
   → execSync probes; identical to v1.5
   → return { javaPath: "/usr/lib/jvm/temurin-21/bin/java", version: 21 }
   → startJdtLs: unchanged
```

### Recommended Project Structure

```
src/
├── platform/
│   └── index.ts        # NEW — platform-branched helpers, pure
├── jdtls/
│   ├── client.ts       # MODIFIED — detectJava uses platform helpers + resolveJavaExecutable
│   ├── startup.ts      # unchanged
│   ├── workspace.ts    # unchanged (touched by Phase 36)
│   ├── workspace-sync.ts # unchanged (touched by Phase 36)
│   ├── uri-mapper.ts   # unchanged (touched by Phase 36)
│   ├── client.ts       # see above
│   └── ...             # other files unchanged
tests/
├── platform/
│   └── index.test.ts   # NEW — snapshot tests for both branches
└── jdtls/
    └── client.test.ts  # MODIFIED — adds Windows-mocked tests for resolveJavaExecutable + detectJava
```

### Pattern 1: Platform-Branched Helper

**What:** A named function that returns different values on Windows vs Unix, encapsulating the branch in one place.
**When to use:** When 2+ call sites need the same platform-conditional value; when a future test wants to mock the platform behavior in one place.
**Example:**
```typescript
// src/platform/index.ts
// Source: codebase pattern (existing config_mac/config_win/config_linux ternary at
// src/jdtls/client.ts:185-189 is the inline counterpart; this is the module form)
import { join } from 'node:path';
import { homedir } from 'node:os';

export const isWindows = process.platform === 'win32';

export function javaBinaryName(): string {
    return isWindows ? 'java.exe' : 'java';
}

export function javaBinaryInHome(javaHome: string): string {
    return join(javaHome, 'bin', javaBinaryName());
}

export function jdtlsCandidateDirs(): string[] {
    const home = homedir();
    if (isWindows) {
        const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
        const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
        return [
            join(localAppData, 'jdtls'),
            join(programFiles, 'jdtls'),
            join(home, 'jdtls'),
            join(localAppData, 'nvim-data', 'mason', 'packages', 'jdtls'),
        ];
    }
    return [
        join(home, '.local', 'share', 'jdtls'),
        '/usr/local/share/jdtls',
        join(home, 'jdtls'),
    ];
}

export function commonJavaLocations(): string[] {
    // Returns glob roots / parent dirs; consumed by Phase 37 (not Phase 35).
    // Phase 35 ships this stub so the platform module is complete; Phase 37
    // adds the scanning logic in src/jdtls/java-discovery.ts.
    if (isWindows) {
        const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
        const home = homedir();
        return [
            join(programFiles, 'Eclipse Adoptium'),     // jdk-*-hotspot
            join(programFiles, 'Microsoft'),            // jdk-*
            join(programFiles, 'Java'),                 // jdk-*
            join(programFiles, 'Amazon Corretto'),      // jdk*
            join(programFiles, 'Zulu'),                 // zulu-*
            join(home, '.jdks'),                        // IntelliJ-managed
            join(home, 'scoop', 'apps'),                // scoop openjdk*
        ];
    }
    if (process.platform === 'darwin') {
        return [
            '/Library/Java/JavaVirtualMachines',
            join(homedir(), 'Library', 'Java', 'JavaVirtualMachines'),
            '/opt/homebrew/opt',  // openjdk@21 etc.
            '/usr/local/opt',     // Intel Homebrew
        ];
    }
    return [
        '/usr/lib/jvm',
        '/opt',
    ];
}
```

### Pattern 2: Resolve-Before-Return

**What:** Convert candidates into known-resolvable file paths *before* handing them to `spawn`. The asymmetry between `execSync` (resolves via cmd.exe + PATHEXT) and `spawn` (does not, for absolute paths) is the trap.
**When to use:** Whenever a path discovered via `execSync` will later be passed to `spawn`.
**Example:**
```typescript
// src/jdtls/client.ts (new helper, sits next to detectJava)
// Source: milestone PITFALLS.md §PITFALL-1 fix pattern
// [CITED: .planning/research/PITFALLS.md lines 34-58]
import { existsSync } from 'node:fs';
import { isWindows } from '../platform/index.js';

export function resolveJavaExecutable(candidate: string): string | null {
    // Bare names (no separator) pass through unchanged.
    // libuv DOES apply PATHEXT for PATH lookups on Windows in spawn, only failing
    // for absolute paths. So `spawn('java', ...)` works on Windows iff java.exe is on PATH.
    const hasSeparator = candidate.includes('/') || candidate.includes('\\');
    if (!hasSeparator) return candidate;

    if (isWindows) {
        if (existsSync(candidate)) return candidate;
        if (!candidate.toLowerCase().endsWith('.exe') && existsSync(candidate + '.exe')) {
            return candidate + '.exe';
        }
        return null;  // clean error; do not let spawn ENOENT later
    }
    // Unix: pass through unchanged (UNIX-01 commitment — no new existsSync
    // gate that could change behavior for users with unusual setups).
    return candidate;
}
```

### Anti-Patterns to Avoid

- **`shell: true` on `spawn`:** Breaks signal/kill semantics, requires manual quoting of every JDT LS argument, adds a `cmd.exe` to the process tree. Forbidden by milestone PITFALL-1.
- **Unconditional `.exe` append:** `join(home, 'bin', 'java.exe')` on Linux produces a path that doesn't exist (Linux JDKs ship `java`, no extension). Must branch on `process.platform === 'win32'`.
- **`existsSync` gate on Unix in `resolveJavaExecutable`:** Tempting "for symmetry," but changes behavior for users with unusual Unix setups (chroots, network mounts, custom `JAVA_HOME` pointing at a wrapper script). UNIX-01 says byte-identical — keep the Unix branch as a passthrough.
- **Inline `process.platform === 'win32'` checks duplicated across `detectJava` and (later) `findJdtLs` and (later) `java-discovery.ts`:** Drift hazard. Use the helper module.
- **Putting `resolveJavaExecutable` in `src/platform/index.ts`:** It needs `fs.existsSync`. Keep the platform module pure (no I/O). Put it in `client.ts` where `existsSync` is already imported.
- **Refactoring `detectJava`'s structure beyond inserting helper calls:** Phase 37 extracts the whole function into `java-discovery.ts`. Don't pre-empt that work in Phase 35 — minimize the diff.
- **Adding `resolveJavaExecutable` to the bare-`java` PATH candidate:** Today's `detectJava` pushes `'java'` after the `javaHome` candidate. `resolveJavaExecutable` on a bare name returns it unchanged, so this is fine — but don't "improve" it by running `existsSync` against `process.env.PATH` entries. libuv handles it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Platform detection | Custom `isWindows` from environment variables (`os.type()`, `os.platform()`) | `process.platform === 'win32'` | Standard Node idiom. Single source of truth. Stable since v0.x. |
| Java binary name per platform | Try `.exe`, fall back to no-extension, fall back to `.cmd`… | `javaBinaryName()` helper returning `'java.exe'` or `'java'` | Binary suffix on Windows is deterministically `.exe` for JDK distributions. No probing needed. |
| PATH resolution for bare `java` | `which` package; manually scan `process.env.PATH` | Let libuv handle it via `spawn('java', ...)` — applies PATHEXT for PATH lookups on Windows | libuv's PATHEXT logic only fails for **absolute** paths. PATH lookups work. (See PITFALL-1 §"Bare 'java' (PATH lookup) is the one case where Windows DTRT".) |
| `.exe` existence check | `find` / glob | `fs.existsSync(candidate)` then `fs.existsSync(candidate + '.exe')` | Two-call sequence, predictable, no async needed. |
| Testing platform branches | OS-conditional CI matrix only | `vi.stubGlobal('process', { ..., platform: 'win32' })` per test | Unit-testable on macOS/Linux. Milestone explicitly states "Windows CI runner is **not** required for v1.6" (STACK.md line 42). |

**Key insight:** This phase has six platform-sensitive sites total across the whole milestone (per ARCHITECTURE.md §2). Phase 35 covers two of them (`javaBinaryInHome` for the `<home>/bin/java` candidate, `javaBinaryName` for the bare candidate). The remaining four are explicit non-goals here and handled by Phases 36/37/38. **The single most important rule for this phase is "don't bleed scope."**

## Common Pitfalls

### Pitfall 1: `spawn` ENOENT on Windows for `.exe`-less absolute paths (the bug this phase exists to fix)

**What goes wrong:** `child_process.spawn('C:\\Program Files\\Java\\jdk-21\\bin\\java', [...])` fails with `ENOENT`. Same path through `execSync('"<javaPath>" --version', ...)` works. Result: `detectJava` succeeds (uses `execSync`), then `startJdtLs` fails (uses `spawn`) on the same path.
**Why it happens:** `execSync` with a string command invokes `cmd.exe /d /s /c`, which applies PATHEXT to resolve `java` → `java.exe`. `spawn` calls `CreateProcessW` directly via libuv; `CreateProcessW` does NOT consult PATHEXT for absolute paths. libuv DOES apply PATHEXT for PATH lookups (bare-name spawn), but not for absolute paths.
**How to avoid:** This phase's entire purpose. `javaBinaryInHome` appends `.exe` on Windows; `resolveJavaExecutable` double-checks existence and tries `.exe` if the bare path doesn't exist.
**Warning signs:** `detectJava` returns a `javaPath`; `startJdtLs` immediately fails with `Error: spawn … ENOENT` mentioning the same path. Tests pass on macOS/Linux; new Windows-mocked tests catch it. [CITED: milestone PITFALLS.md §PITFALL-1; nodejs/node#6671]

### Pitfall 2: Unconditional `.exe` append breaks Linux

**What goes wrong:** `join(home, 'bin', 'java.exe')` on Linux produces a path that doesn't exist. `detectJava` falls back to `'java'` on PATH, masking the bug — but `JAVA_HOME` is silently ignored.
**Why it happens:** Forgetting the `process.platform === 'win32'` guard.
**How to avoid:** `javaBinaryName()` is the only function that knows the suffix. Every other piece of code calls `javaBinaryName()` / `javaBinaryInHome()` — no inline string literals.
**Warning signs:** A Linux test asserting `result.javaPath === '/env/java/bin/java'` (line 84 of `tests/jdtls/client.test.ts`) fails with `'/env/java/bin/java.exe'`.

### Pitfall 3: Mocking `process.platform` in tests — caveats

**What goes wrong:** `process.platform` is a *getter* on a non-configurable descriptor in some Node builds. Naive reassignment (`process.platform = 'win32'`) silently fails or throws in strict mode. Tests pass on macOS, false-positive Windows coverage.
**Why it happens:** `process.platform` is read at import time of `src/platform/index.ts` and stored in the `isWindows` const — so even if you successfully patch `process.platform` mid-test, the imported module has already cached the wrong value.
**How to avoid:**
1. **Option A (recommended):** Make `isWindows` a function `isWindows()` that reads `process.platform` on each call. Tests use `vi.stubGlobal` or `Object.defineProperty(process, 'platform', { value: 'win32' })` then dynamically `await import('../src/platform/index.js')` after `vi.resetModules()`.
2. **Option B:** Keep `isWindows` as a const but have tests use `vi.resetModules()` + dynamic import after patching `process.platform`.

Recommendation: Option B keeps the call sites cleaner (`if (isWindows)` reads more naturally than `if (isWindows())`) and the milestone research's pattern matches (`export const isWindows: boolean`). The test pattern is then:

```typescript
// tests/platform/index.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
    setPlatform(originalPlatform);
    vi.resetModules();
});

it('Windows branch returns java.exe', async () => {
    setPlatform('win32');
    vi.resetModules();
    const { javaBinaryName } = await import('../../src/platform/index.js');
    expect(javaBinaryName()).toBe('java.exe');
});

it('Unix branch returns java (UNIX-01)', async () => {
    setPlatform('linux');
    vi.resetModules();
    const { javaBinaryName } = await import('../../src/platform/index.js');
    expect(javaBinaryName()).toBe('java');
});
```

**Warning signs:** A test that "patches `process.platform`" but still sees the original platform's value. Add an assertion `expect(process.platform).toBe('win32')` after the patch and before the import to catch this.

### Pitfall 4: Forgetting that existing `client.test.ts` tests assert exact string equality

**What goes wrong:** A test asserts `result.javaPath === '/cli/java/bin/java'` (line 70 of `tests/jdtls/client.test.ts`). After Phase 35, on the platform the test runs on (Unix), this MUST still hold. If `resolveJavaExecutable` is ever wired to gate Unix candidates through `existsSync` (it should not), the test breaks because `/cli/java/bin/java` is a fake path that doesn't exist on the test machine — `resolveJavaExecutable` would return `null` and `detectJava` would fall through to `'java'`.
**Why it happens:** Over-eager "consistency" between Windows and Unix branches.
**How to avoid:** `resolveJavaExecutable` Unix branch passes through unchanged WITHOUT calling `existsSync`. The Unix `detectJava` candidate-spawn loop, today, relies on `execSync` to fail (catch block, `continue`) for non-existent paths — that behavior is preserved.
**Warning signs:** `tests/jdtls/client.test.ts` `'uses setJavaHome override before JAVA_HOME'` fails with `result.javaPath` being `'java'` instead of `'/cli/java/bin/java'`.

### Pitfall 5: `existsSync` is synchronous I/O on a startup path

**What goes wrong:** Synchronous filesystem I/O during MCP server startup. Negligible on local SSDs; potentially slow on network-mounted JDKs or Defender-scanned `Program Files`.
**Why it happens:** `existsSync` blocks the event loop.
**How to avoid:** Accept it for Phase 35 — `resolveJavaExecutable` is called at most ~3 times during startup (one `<home>/bin/java[.exe]` candidate, one bare-name candidate). Total cost on Windows: ~5–50ms warm, ~200ms cold (Defender first-touch on `java.exe`). Phase 37 converts the surrounding `execSync` probes to async `execFile` per PITFALL-6 — at that point, consider whether to convert `existsSync` to `fs.promises.access`. Out of scope for Phase 35.
**Warning signs:** Cold-start warnings on Windows CI > 1s. Not expected in Phase 35; soak-test in Phase 37.

## Runtime State Inventory

> Phase 35 is **not** a rename/refactor/migration phase. It is a greenfield feature phase that adds new files and one surgical modification. No stored data, live service config, OS-registered state, secrets, or build artifacts reference any string that this phase changes. **Section omitted by trigger rule.**

## Code Examples

Verified patterns from official sources:

### Current `detectJava` candidate loop (BEFORE Phase 35)

```typescript
// Source: src/jdtls/client.ts lines 65-104 (read directly)
// [VERIFIED: codebase read]
export function detectJava(): JavaDetectResult {
    const candidates: string[] = [];

    const javaHome = configuredJavaHome ?? process.env.JAVA_HOME;
    if (javaHome) {
        candidates.push(join(javaHome, 'bin', 'java'));   // <-- Phase 35 changes this line
    }
    candidates.push('java');                              // <-- and this line

    for (const javaPath of candidates) {
        try {
            const output = execSync(`"${javaPath}" --version`, {
                encoding: 'utf-8',
                timeout: 10_000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const version = parseJavaVersion(output);
            if (version === null) continue;
            if (version < 21) {
                return { javaPath: null, error: `Java ${version} found but JDT LS requires Java 21+` };
            }
            return { javaPath, version };
        } catch {
            continue;
        }
    }
    return { javaPath: null, error: 'Java not found. Set JAVA_HOME or add java to PATH.' };
}
```

### Target `detectJava` (AFTER Phase 35)

```typescript
// Source: this research — exact transformation
import { javaBinaryName, javaBinaryInHome } from '../platform/index.js';

export function detectJava(): JavaDetectResult {
    const candidates: string[] = [];

    const javaHome = configuredJavaHome ?? process.env.JAVA_HOME;
    if (javaHome) {
        candidates.push(javaBinaryInHome(javaHome));   // returns join(javaHome, 'bin', 'java[.exe]')
    }
    candidates.push(javaBinaryName());                 // 'java' or 'java.exe'

    for (const candidate of candidates) {
        const javaPath = resolveJavaExecutable(candidate);
        if (javaPath === null) continue;                // .exe not found on Windows; skip
        try {
            const output = execSync(`"${javaPath}" --version`, {
                encoding: 'utf-8',
                timeout: 10_000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const version = parseJavaVersion(output);
            if (version === null) continue;
            if (version < 21) {
                return { javaPath: null, error: `Java ${version} found but JDT LS requires Java 21+` };
            }
            return { javaPath, version };
        } catch {
            continue;
        }
    }
    return { javaPath: null, error: 'Java not found. Set JAVA_HOME or add java to PATH.' };
}
```

Note: error message text is left unchanged — Phase 38 / Phase 39 improve it to list attempted paths (out of scope here).

### Test pattern for platform mocking (NEW for Phase 35)

```typescript
// Source: vitest 4.x docs + Node's `Object.defineProperty(process, 'platform', ...)` idiom
// [CITED: https://vitest.dev/api/vi.html#vi-stubglobal]
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('javaBinaryInHome', () => {
    afterEach(() => {
        setPlatform(originalPlatform);
        vi.resetModules();
    });

    it('Windows: appends .exe', async () => {
        setPlatform('win32');
        vi.resetModules();
        const { javaBinaryInHome } = await import('../../src/platform/index.js');
        // Use forward slashes so test works on any host OS where node:path
        // normalizes consistently — but verify both branches separately.
        expect(javaBinaryInHome('C:\\Program Files\\Java\\jdk-21'))
            .toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
        // Note: on a macOS test host, path.join uses posix separators even for Windows-shaped
        // input strings. Use path.win32.join in the implementation OR assert with a regex/contains.
    });

    it('Unix: returns join(home, "bin", "java") byte-identical to v1.5', async () => {
        setPlatform('linux');
        vi.resetModules();
        const { javaBinaryInHome } = await import('../../src/platform/index.js');
        expect(javaBinaryInHome('/usr/lib/jvm/temurin-21'))
            .toBe('/usr/lib/jvm/temurin-21/bin/java');
    });
});
```

**Implementation subtlety:** if `javaBinaryInHome` is called on macOS-host while testing the Windows branch, `path.join` uses POSIX separators. Two options:
1. Use `path.win32.join` in the Windows branch and `path.join` in the Unix branch (forces correct separators for cross-host tests).
2. Use `path.join` everywhere and accept that Windows-branch tests on Unix hosts produce `/`-separated output; assert with `expect(result).toContain('java.exe')` and `expect(result).toContain('bin')` rather than exact string equality.

Recommend **option 1** (`path.win32` / `path.posix` explicit) — milestone STACK.md §Q2 already endorses this for "code paths that need a forced flavor." This is one such case.

### `resolveJavaExecutable` test pattern

```typescript
// Source: this research
import { existsSync } from 'node:fs';
vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
}));

describe('resolveJavaExecutable on Windows', () => {
    const mockExistsSync = vi.mocked(existsSync);

    beforeEach(() => {
        setPlatform('win32');
        vi.resetModules();
        mockExistsSync.mockReset();
    });

    it('returns candidate unchanged if it exists', async () => {
        mockExistsSync.mockReturnValueOnce(true);
        const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
        expect(resolveJavaExecutable('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe'))
            .toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
    });

    it('appends .exe if bare path missing but .exe variant exists', async () => {
        mockExistsSync.mockImplementation((p) =>
            String(p).endsWith('.exe'));
        const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
        expect(resolveJavaExecutable('C:\\Program Files\\Java\\jdk-21\\bin\\java'))
            .toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
    });

    it('returns null if neither bare nor .exe exists', async () => {
        mockExistsSync.mockReturnValue(false);
        const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
        expect(resolveJavaExecutable('C:\\nonexistent\\bin\\java')).toBeNull();
    });

    it('passes bare names through unchanged (PATH lookup)', async () => {
        const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
        expect(resolveJavaExecutable('java')).toBe('java');
        // existsSync should not be called for bare names
        expect(mockExistsSync).not.toHaveBeenCalled();
    });
});

describe('resolveJavaExecutable on Unix (UNIX-01)', () => {
    beforeEach(() => {
        setPlatform('linux');
        vi.resetModules();
    });

    it('passes all candidates through unchanged without existsSync', async () => {
        const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
        expect(resolveJavaExecutable('/usr/lib/jvm/temurin-21/bin/java'))
            .toBe('/usr/lib/jvm/temurin-21/bin/java');
        expect(resolveJavaExecutable('java')).toBe('java');
        expect(resolveJavaExecutable('/nonexistent/path')).toBe('/nonexistent/path');
    });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-roll PATHEXT resolution / use `which` package | Two-line `if (isWindows) candidate + '.exe'` after `fs.existsSync` check | Node 22 LTS — `child_process.spawn`'s libuv behavior has been stable since Node 0.x; `existsSync` is sync stdlib | Three-LOC helper replaces a dependency. |
| `'file://' + path` URI construction | `pathToFileURL(path).href` from `node:url` | Phase 36 (NOT this phase) | N/A here — flagged so the planner doesn't accidentally include URI work. |
| `process.env.HOME ?? ''` | `os.homedir()` | Phase 38 (NOT this phase) | N/A here — already correct everywhere except `src/jdtls/client.ts:139`, deferred to Phase 38. |
| Sync `execSync` Java version probe | Async `execFile` with 3s timeout | Phase 37 (NOT this phase) | N/A here — `detectJava` remains synchronous in Phase 35. |

**Deprecated/outdated:**
- `cross-spawn` for our use case — solves `spawn` of shell scripts (`.bat`/`.cmd`), we spawn `.exe`. Rejected.
- `which` / `@npmcli/which` as a hard dep — one-line replacement (`join(home, 'bin', \`java${ext}\`)`) doesn't justify a dep. Rejected.
- `locate-java-home` — inactive (~26 weekly downloads, no releases in 12+ months). Rejected.
- `find-java-home` — Windows-registry-based, single-result; doesn't fit priority chain (Phase 37 concern). Rejected.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | libuv `uv_spawn` applies PATHEXT for **bare-name** lookups on Windows even when it doesn't for absolute paths (so `spawn('java', ...)` works on Windows iff `java.exe` is on PATH) | "Don't Hand-Roll" table; Pitfall 1; Code Examples comment | LOW — if wrong, the bare-`java` candidate would also need `.exe` appended. Easy retrofit; tests will catch it. Sourced from milestone PITFALLS.md line 58 ("Bare `'java'` (PATH lookup) is the one case where Windows DTRT — libuv does append PATHEXT for PATH lookups") which itself cites the libuv source; not re-verified in this session. [ASSUMED] |
| A2 | `Object.defineProperty(process, 'platform', { value, configurable: true })` is the canonical pattern for mocking `process.platform` in vitest | Pitfall 3; Code Examples test patterns | LOW — alternative `vi.stubGlobal` exists. If the chosen approach has issues, the other works. Not verified against vitest 4.x docs in this session. [ASSUMED] |
| A3 | `commonJavaLocations()` shipped in Phase 35 but consumed only by Phase 37 will not cause lint/dead-code warnings | "Recommended Project Structure" decision to ship all four helpers | LOW — TypeScript exports are not flagged as dead by default. If a lint rule flags it, plan B is to ship only `isWindows`, `javaBinaryName`, `javaBinaryInHome` in Phase 35 and add the other two in Phase 38. [ASSUMED] |
| A4 | The fake test paths `/cli/java` and `/env/java` in `tests/jdtls/client.test.ts` will continue to work after Phase 35 because `resolveJavaExecutable`'s Unix branch is a passthrough (no `existsSync` gate) | Pitfall 4; "Locked Decision #4 (Unix branch)" | HIGH if wrong — would break existing tests, violating UNIX-01. Mitigated by explicit decision to never add `existsSync` on Unix. [VERIFIED: source code read of `tests/jdtls/client.test.ts` lines 62-109 confirms exact string assertions; design decision is to preserve them.] |
| A5 | `process.env.LOCALAPPDATA` / `process.env.ProgramFiles` / `process.env.USERPROFILE` are reliably set on Windows | `jdtlsCandidateDirs()` Windows branch | LOW — these are standard Windows environment variables set by the OS. Fallback to `join(homedir(), 'AppData', 'Local')` for `LOCALAPPDATA` and `'C:\\Program Files'` for `ProgramFiles` covers edge cases. [ASSUMED — not verified against an actual Windows machine] |
| A6 | `node-stream-zip`, `glob`, `ts-lsp-client`, and the other existing deps work correctly on Windows (out of Phase 35 scope but assumed for the eventual end-to-end success) | Implicit | LOW for Phase 35 (we don't exercise them); deferred to Phase 39 validation. [CITED: milestone STACK.md `Version Compatibility` table confirms all existing deps work on Windows.] |

**If this table is empty:** N/A — table is not empty. The planner and any future discuss-phase should treat A1 as the most load-bearing — if `spawn('java', ...)` doesn't resolve via PATHEXT on Windows, the bare-`'java'` candidate construction needs `.exe` too. Test this explicitly on real Windows during Phase 39.

## Open Questions (RESOLVED)

1. **Should `resolveJavaExecutable` be exported from `client.ts` or kept private?**
   - What we know: It has exactly one production call site (`detectJava`'s loop).
   - What's unclear: Whether it warrants its own unit test (which requires export) vs. testing it transitively through `detectJava`.
   - RESOLVED: **Export it.** A pure helper with branchy logic deserves a direct unit test. Phase 37 will leave it in place (renamed module location TBD); not a churn cost.

2. **`path.join` vs `path.win32.join` in the Windows branches?**
   - What we know: On a macOS/Linux test host, `path.join('C:\\foo', 'bar')` uses POSIX semantics and produces unexpected output.
   - What's unclear: Whether tests should assert exact strings or use `path.win32.join` in the implementation.
   - RESOLVED: **Use `path.win32.join` in the Windows branch of `javaBinaryInHome`**, `path.posix.join` in the Unix branch. Lets tests assert exact strings cross-host. (Milestone STACK.md endorses this pattern.)

3. **Should the `commonJavaLocations()` helper return parent dirs (for globbing in Phase 37) or fully-resolved candidate paths?**
   - What we know: Phase 37 will `glob('jdk-*', { cwd: location })` to enumerate JDK installs.
   - What's unclear: Whether `commonJavaLocations()` returns `'C:\\Program Files\\Eclipse Adoptium'` (parent) or `'C:\\Program Files\\Eclipse Adoptium\\jdk-*'` (glob pattern).
   - RESOLVED: **Return parent dirs.** Phase 37 owns the globbing; Phase 35 ships data, not glob logic. The contract is "directories that may contain JDK installations" — Phase 37 applies appropriate glob patterns. This keeps `src/platform/index.ts` free of `glob` dependency.

4. **Does the existing v1.5 test suite have any tests that import `src/jdtls/client.js` and depend on a *specific* signature for `detectJava` (e.g., its candidate count, the form of error messages)?**
   - What we know: `tests/jdtls/client.test.ts` asserts exact `javaPath` strings on success and error message substrings on failure. `tests/jdtls/startup.test.ts` mocks `detectJava` entirely (line 11), so it doesn't care about internals.
   - What's unclear: Whether any test asserts the *order* of `candidates.push` calls or counts them.
   - RESOLVED: Planner runs `pnpm test -- tests/jdtls/client.test.ts` after each task to confirm. The four existing `detectJava` tests should pass unchanged.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build/runtime | ✓ | (engines: ">=22") | — |
| pnpm | Package management | ✓ | 10.26.0 (packageManager pin) | — |
| TypeScript | Type checking / tsx execution | ✓ | 6.0.2 (devDep) | — |
| vitest | Test runner | ✓ | 4.1.4 (devDep) | — |
| Windows machine for end-to-end validation | Phase 39 only | ✗ for Phase 35 | — | Unit tests with mocked `process.platform` (milestone-endorsed; STACK.md line 42) |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Real Windows machine — fallback is mocked unit tests; full Windows validation deferred to Phase 39.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` (testTimeout: 10000ms, env: node, include: tests/**/*.test.ts) |
| Quick run command | `pnpm test -- tests/platform/ tests/jdtls/client.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIN-01 | `javaBinaryName()` returns `'java.exe'` on Windows | unit | `pnpm test -- tests/platform/index.test.ts -t "Windows"` | ❌ Wave 0 (new file) |
| WIN-01 | `javaBinaryInHome(home)` appends `.exe` on Windows | unit | `pnpm test -- tests/platform/index.test.ts -t "javaBinaryInHome"` | ❌ Wave 0 |
| WIN-01 | `resolveJavaExecutable` returns `.exe` variant when bare path missing on Windows | unit | `pnpm test -- tests/jdtls/client.test.ts -t "resolveJavaExecutable on Windows"` | ❌ Wave 0 (new describe block in existing file) |
| WIN-01 | `resolveJavaExecutable` returns `null` when neither bare nor `.exe` exists | unit | same as above | ❌ Wave 0 |
| WIN-01 | `resolveJavaExecutable` passes bare names through (PATH lookup) | unit | same as above | ❌ Wave 0 |
| WIN-01 | `detectJava` integration — Windows-mocked JAVA_HOME produces `.exe`-suffixed javaPath | unit | `pnpm test -- tests/jdtls/client.test.ts -t "detectJava .* Windows"` | ❌ Wave 0 (new describe block) |
| UNIX-01 | `javaBinaryName()` returns `'java'` on Linux/Darwin | unit | `pnpm test -- tests/platform/index.test.ts -t "Unix"` | ❌ Wave 0 |
| UNIX-01 | `javaBinaryInHome(home)` returns `join(home, 'bin', 'java')` on Linux/Darwin | unit | same as above | ❌ Wave 0 |
| UNIX-01 | `resolveJavaExecutable` Unix branch passes through without existsSync | unit | `pnpm test -- tests/jdtls/client.test.ts -t "resolveJavaExecutable on Unix"` | ❌ Wave 0 |
| UNIX-01 | All existing v1.5 `detectJava` tests pass unchanged | unit | `pnpm test -- tests/jdtls/client.test.ts -t "detectJava"` | ✅ existing (4 tests at lines 62-109) |
| UNIX-01 | Full v1.5 test suite (696 tests) passes | regression | `pnpm test` | ✅ existing |

### Sampling Rate

- **Per task commit:** `pnpm test -- tests/platform/ tests/jdtls/client.test.ts` (~1s)
- **Per wave merge:** `pnpm test` (full suite, ~10–30s depending on workspace-sync test latency)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/platform/index.test.ts` — covers WIN-01 (platform helpers Windows branch) and UNIX-01 (platform helpers Unix branch byte-identical)
- [ ] New `describe('resolveJavaExecutable on Windows', …)` block in `tests/jdtls/client.test.ts` — covers WIN-01 `.exe` resolution
- [ ] New `describe('resolveJavaExecutable on Unix', …)` block in `tests/jdtls/client.test.ts` — covers UNIX-01 Unix passthrough
- [ ] New `describe('detectJava on Windows', …)` block in `tests/jdtls/client.test.ts` — covers WIN-01 end-to-end through `detectJava` with mocked `process.platform = 'win32'` + mocked `existsSync` + mocked `execSync`
- [ ] Test helper for `setPlatform(p)` — either inline in each test file or as `tests/helpers/platform.ts` (recommend inline for Phase 35 — only two test files use it; extract if Phase 36/37/38 also need it)
- [ ] Framework install: none — vitest already present

**Source code gaps:**
- [ ] `src/platform/index.ts` — new file
- [ ] `src/jdtls/client.ts` — modify `detectJava` (lines 65-104) to use platform helpers and `resolveJavaExecutable`; add `resolveJavaExecutable` export

## Security Domain

> **`security_enforcement` not in `.planning/config.json`** — treating as enabled by default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no auth surface in this phase |
| V3 Session Management | no | N/A — no session state changes |
| V4 Access Control | no | N/A — no access control surface |
| V5 Input Validation | yes (mild) | Validate that `javaHome` string from `process.env.JAVA_HOME` or CLI `--java-home` is a string before passing to `path.join`. Existing code already does this implicitly (TypeScript types). No new attack surface introduced. |
| V6 Cryptography | no | N/A — no crypto in this phase |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User-controlled `JAVA_HOME` / `--java-home` points to attacker-controlled executable | Elevation of Privilege | Already-existing risk — server runs whatever Java binary the user configures. Phase 35 does not amplify this; it just makes Windows able to spawn what the user configured. Version probe (`--version` execSync) rejects non-`java` binaries that don't respond with parseable version output. **No new mitigation needed.** Documented in milestone PITFALLS.md §Security Mistakes. |
| `existsSync(candidate + '.exe')` time-of-check vs. time-of-use (TOCTOU) race | Tampering | Window between `existsSync` and `spawn` is sub-millisecond on the same path; no realistic attack vector for an MCP server running with the user's own privileges. **No mitigation needed.** |
| Path traversal via crafted `--java-home` value (e.g., `../../../etc/passwd`) | Tampering | `join(home, 'bin', 'java')` + `execSync` version probe — if the path resolves to a non-Java binary or a non-executable, the probe fails and the candidate is skipped. Existing graceful-degradation pattern. **No new mitigation needed for Phase 35.** Phase 37 adds an explicit existsSync + version check at the JDK-home level which further hardens this. |

## Project Constraints (from CLAUDE.md)

These directives MUST be honored by the planner:

- **GSD workflow enforcement.** All edits go through `/gsd:execute-phase`. No direct repo edits outside a GSD workflow.
- **Tab indentation** in all source files. Verified by reading `src/jdtls/client.ts` — uses tabs.
- **TypeScript only** for source. Strongly typed interfaces.
- **pnpm** for package management.
- **tsx** for development execution; **tsup** for production bundling; **vitest** for tests.
- **No new runtime dependencies** unless absolutely necessary. Phase 35 adds none.
- **Tool response envelope** convention (`makeSuccess`/`makeError`) — not applicable to Phase 35 (no tool changes).
- **Domain logic in `src/browsing/`, `src/project/`, `src/jdtls/`** — Phase 35 adds a *new* domain layer at `src/platform/`. Justified because platform-branching is a cross-cutting concern, not a domain.
- **Tests in `tests/`** — Phase 35 adds `tests/platform/index.test.ts` and extends `tests/jdtls/client.test.ts`.
- **Performance: Must be fast.** `existsSync` is sync I/O; per Pitfall 5, total cost is bounded at ~50ms warm / ~200ms cold. Acceptable.
- **No caching of extracted files** — N/A for Phase 35.
- **Strongly typed interfaces** — `javaBinaryName(): string`, `javaBinaryInHome(home: string): string`, etc. All exports typed.

## Sources

### Primary (HIGH confidence)

- **Codebase direct read:**
  - `src/jdtls/client.ts` lines 1-321 (full file) — detectJava, findJdtLs, startJdtLs, shutdownJdtLs
  - `src/jdtls/startup.ts` lines 1-91 — initJdtLsSession (consumer of detectJava)
  - `tests/jdtls/client.test.ts` lines 1-154 — existing detectJava / parseJavaVersion / findJdtLs tests
  - `tests/jdtls/startup.test.ts` lines 1-30 (header) — confirms detectJava is mocked at line 11
  - `package.json` — devDependencies (vitest 4.1.4, TypeScript 6.0.2)
  - `vitest.config.ts` — test config (testTimeout 10000ms, env node)
  - `.planning/REQUIREMENTS.md` — WIN-01 / UNIX-01 definitions
  - `.planning/ROADMAP.md` — Phase 35 success criteria (lines 108-118)
  - `CLAUDE.md` — project conventions
- **Milestone v1.6 research (commit `1dc7250`):**
  - `.planning/research/SUMMARY.md` — phase ordering rationale
  - `.planning/research/STACK.md` — no new deps, stdlib sufficient
  - `.planning/research/ARCHITECTURE.md` §1, §2 (Java discovery, branch placement), §4 (build order — Phase 35 = "Phase A")
  - `.planning/research/FEATURES.md` — Area 1 (Java discovery) table stakes, anti-features
  - `.planning/research/PITFALLS.md` §PITFALL-1 — spawn ENOENT root cause and fix pattern; §PITFALL-2 — launcher jar spaces (relevant for Phase 35 spawn safety check); §PITFALL-12 — `process.env.HOME` deferred to Phase 38

### Secondary (MEDIUM confidence)

- [nodejs/node#6671 — child_process.spawn ignores PATHEXT on Windows](https://github.com/nodejs/node/issues/6671) — cited via milestone PITFALLS.md; not re-fetched in this session
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) — execSync vs spawn PATHEXT asymmetry
- [Node.js `node:url` docs — pathToFileURL / fileURLToPath](https://nodejs.org/api/url.html) — referenced for Phase 36 context; not used in Phase 35

### Tertiary (LOW confidence)

- Vitest `vi.stubGlobal` / `Object.defineProperty(process, 'platform', ...)` test pattern — milestone-research-suggested but not re-verified against vitest 4.x docs in this session [ASSUMED — Assumption A2]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, all stdlib; verified against `package.json` and existing imports.
- Architecture: HIGH — exact line numbers from codebase read; phase scope locked by ROADMAP success criteria.
- Pitfalls: HIGH — five v1.6-research pitfalls map directly to this phase's territory; PITFALL-1 is the bug this phase exists to fix.
- Test scaffolding: MEDIUM — `Object.defineProperty(process, 'platform', ...)` pattern is widely used in the Node ecosystem but not currently used in this codebase; first introduction. Mitigated by inline-test-pattern example in research.

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days — stable foundation phase; no fast-moving libraries involved; milestone research valid until same date)
