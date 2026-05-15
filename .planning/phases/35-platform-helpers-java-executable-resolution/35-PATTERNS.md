# Phase 35: Platform Helpers + Java Executable Resolution — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 4 (2 source, 2 test)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/platform/index.ts` (NEW) | pure helper module (cross-cutting) | sync pure functions (no I/O) | `src/types/include.ts` (small pure module with named const + exports) + `src/cli/args.ts` (helper-function module with multiple exports) | role-match (no existing platform module — this is a NEW domain layer per RESEARCH.md "Architecture Patterns") |
| `src/jdtls/client.ts` (MODIFIED) | domain module — JDT LS process lifecycle | sync candidate-loop + sync `execSync` probe | itself (modify in place — same file already houses `detectJava`, `parseJavaVersion`, `findJdtLs`, `startJdtLs`, `shutdownJdtLs`) | exact (in-file extension; `resolveJavaExecutable` sits next to `detectJava`) |
| `tests/platform/index.test.ts` (NEW) | unit test — pure helpers, platform-mocked | sync function-return assertions | `tests/cli/args.test.ts` (small pure-function module with `describe`/`it`/`expect` only — no mocks needed for Unix branch); Windows-branch pattern is novel to this codebase (see "Shared Patterns → Platform Mocking" below) | role-match (existing `args.test.ts` is the closest "test a pure helper module" analog; mocking `process.platform` is a new technique introduced by Phase 35) |
| `tests/jdtls/client.test.ts` (MODIFIED) | unit test — extend existing file | sync mocked `execSync`/`existsSync` | itself (existing `describe('detectJava', …)` block at lines 43-110 already establishes the pattern of mocking `node:child_process.execSync` and asserting exact `javaPath` strings) | exact (in-file extension; add new `describe` blocks for `resolveJavaExecutable` on Windows/Unix and `detectJava` on Windows) |

## Pattern Assignments

### `src/platform/index.ts` (NEW — pure helper module)

**Analog:** `src/types/include.ts` (lines 1-9) for "small pure module exporting named const + helpers" + `src/project/loom-cache.ts` line 1 for `homedir()` import idiom.

**Imports pattern** (model on `src/project/loom-cache.ts` line 1 + `src/jdtls/client.ts` line 9):

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
```

Note: research recommends `path.win32.join` / `path.posix.join` in branched code so cross-host tests can assert exact strings — import shape becomes `import { win32 as pathWin32, posix as pathPosix } from 'node:path';` *if* that recommendation is adopted. Default to plain `join` if not.

**File header / docstring pattern** (model on `src/jdtls/client.ts` lines 1-6):

```typescript
/**
 * Platform helpers — branched on process.platform === 'win32'.
 *
 * Pure module: no fs I/O, no child_process, no side effects.
 * Consumed by src/jdtls/client.ts (Phase 35), src/jdtls/workspace-sync.ts /
 * src/jdtls/uri-mapper.ts (Phase 36), src/jdtls/java-discovery.ts (Phase 37),
 * src/jdtls/client.ts findJdtLs (Phase 38).
 */
```

**Named-const pattern** (model on `src/types/include.ts` line 3 `INCLUDE_CATEGORIES`):

```typescript
export const isWindows = process.platform === 'win32';
```

**Helper-function pattern** (model on `src/cli/args.ts` lines 11-13 `isValidLogLevel`):

```typescript
export function javaBinaryName(): string {
    return isWindows ? 'java.exe' : 'java';
}

export function javaBinaryInHome(javaHome: string): string {
    return join(javaHome, 'bin', javaBinaryName());
}
```

**Strongly-typed return signatures** required by CLAUDE.md "Strongly typed: All tool interfaces must have precise types". Every export annotated: `(): string`, `(home: string): string`, `(): string[]`.

**Tab indentation** — confirmed by `src/jdtls/client.ts` and `src/types/include.ts` (both use tabs).

---

### `src/jdtls/client.ts` (MODIFIED — domain module)

**Analog:** itself. The modifications are surgical and in-place.

**Existing imports** (lines 8-16) — add one line:

```typescript
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';                       // already imported (line 13)
import { glob } from 'glob';
import { JSONRPCEndpoint, LspClient } from 'ts-lsp-client';
import { logger } from '../logging/logger.js';
import { javaBinaryName, javaBinaryInHome, isWindows } from '../platform/index.js';  // NEW
```

`existsSync` is **already imported** (line 13) — `resolveJavaExecutable` reuses it. Zero new imports beyond the platform module.

**Existing `detectJava` candidate loop to modify** (lines 65-104):

```typescript
// BEFORE (current code, lines 66-72):
const candidates: string[] = [];

const javaHome = configuredJavaHome ?? process.env.JAVA_HOME;
if (javaHome) {
    candidates.push(join(javaHome, 'bin', 'java'));   // <-- replace this literal
}
candidates.push('java');                              // <-- replace this literal

// AFTER (Phase 35 transformation):
const candidates: string[] = [];

const javaHome = configuredJavaHome ?? process.env.JAVA_HOME;
if (javaHome) {
    candidates.push(javaBinaryInHome(javaHome));      // 'java' or 'java.exe' suffix
}
candidates.push(javaBinaryName());                    // 'java' or 'java.exe'
```

**Existing for-loop body** (lines 74-98) — wrap each candidate in `resolveJavaExecutable`:

```typescript
// BEFORE (current code, lines 74-98):
for (const javaPath of candidates) {
    try {
        const output = execSync(`"${javaPath}" --version`, { ... });
        // ...
        return { javaPath, version };
    } catch {
        continue;
    }
}

// AFTER (Phase 35 transformation — minimal diff):
for (const candidate of candidates) {
    const javaPath = resolveJavaExecutable(candidate);
    if (javaPath === null) continue;          // .exe not found on Windows; skip cleanly
    try {
        const output = execSync(`"${javaPath}" --version`, { ... });
        // ... rest unchanged ...
        return { javaPath, version };
    } catch {
        continue;
    }
}
```

Loop body and error-message text otherwise unchanged. The variable rename `javaPath` → `candidate` (for input) + reassignment `javaPath = resolveJavaExecutable(...)` keeps `return { javaPath, version }` shape byte-identical.

**New `resolveJavaExecutable` helper** — placement: sits next to `detectJava` (between `detectJava` at lines 65-104 and `parseJavaVersion` at lines 110-121). Export it so it has a direct unit test (open question Q1 resolution per RESEARCH.md):

```typescript
/**
 * Resolve a Java candidate path to a file `spawn` can exec.
 *
 * - Bare names (no path separator): pass through unchanged. libuv applies
 *   PATHEXT for PATH lookups on Windows in spawn, even though it does NOT
 *   for absolute paths. See nodejs/node#6671.
 * - Absolute/relative paths on Windows: try as-is, then try `<path>.exe`.
 *   Returns null if neither exists (caller skips this candidate cleanly
 *   instead of letting spawn ENOENT later).
 * - Absolute/relative paths on Unix: return as-is, no existence check
 *   (UNIX-01: byte-identical to v1.5 — existing tests assert exact strings
 *   like '/cli/java/bin/java' which is a fake path that doesn't exist).
 */
export function resolveJavaExecutable(candidate: string): string | null {
    const hasSeparator = candidate.includes('/') || candidate.includes('\\');
    if (!hasSeparator) return candidate;

    if (isWindows) {
        if (existsSync(candidate)) return candidate;
        if (!candidate.toLowerCase().endsWith('.exe') && existsSync(candidate + '.exe')) {
            return candidate + '.exe';
        }
        return null;
    }
    return candidate;
}
```

**Doc-comment style** (model on existing `detectJava` doc at lines 58-64, `parseJavaVersion` doc at lines 107-109): block JSDoc above the function, no `@param`/`@return` tags, prose-style description.

**What NOT to touch in this phase** (per RESEARCH.md "Deferred Ideas"):
- Line 139: `process.env.HOME ?? ''` — Phase 38 (`findJdtLs` is unchanged in Phase 35).
- Lines 185-189: existing `process.platform === 'darwin' / 'win32'` ternary for `configName` (`config_mac`/`config_win`/`config_linux`) — stays inline. Not in Phase 35 scope. (Note: this is the codebase's existing platform-branching idiom, but it's a one-shot in `startJdtLs`, not a cross-cutting helper.)
- Lines 214, 247: `'file://' + workspaceDir` — Phase 36.
- Lines 164-262 `startJdtLs` — unchanged. The fix is that `javaPath` arriving here is now `.exe`-resolved.

---

### `tests/platform/index.test.ts` (NEW — unit tests for pure module)

**Analog:** `tests/cli/args.test.ts` (lines 1-53) for the basic `describe`/`it`/`expect` shape; `vi.resetModules()` + dynamic import pattern is new to this codebase (introduced for `process.platform` mocking).

**Imports + describe-block shape** (model on `tests/cli/args.test.ts` lines 1-4):

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
```

Note: `tests/cli/args.test.ts` imports only `describe, it, expect` because it tests pure functions with no mocks. Phase 35 platform tests need `vi` for `resetModules()` after platform patching.

**Platform-mock test helper** (NEW pattern — RESEARCH.md "Pitfall 3" Option B):

```typescript
const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
    setPlatform(originalPlatform);
    vi.resetModules();
});
```

The `isWindows` const in `src/platform/index.ts` is **read at module-load time**, so each test must `vi.resetModules()` + dynamic `await import('../../src/platform/index.js')` AFTER patching `process.platform`. This is the load-bearing pattern for Phase 35 tests.

**Test-body shape per branch** (RESEARCH.md "Test pattern for platform mocking"):

```typescript
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

**Cross-host separator caveat** (RESEARCH.md "Implementation subtlety"): if the implementation uses plain `path.join`, the Windows-branch test running on macOS produces POSIX-separated output. Two resolutions documented in research — prefer `path.win32.join` in the Windows branch.

---

### `tests/jdtls/client.test.ts` (MODIFIED — extend existing file)

**Analog:** itself. The existing file (lines 1-154) already establishes the conventions for testing `detectJava` and `findJdtLs`.

**Existing `node:child_process` mock pattern** (lines 5-11) — keep verbatim:

```typescript
vi.mock('node:child_process', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    return {
        ...actual,
        execSync: vi.fn(),
    };
});
```

This is the project's canonical "mock one named export while preserving the rest" idiom. Reuse exactly for the new Windows-mocked `detectJava` tests.

**New `node:fs` mock pattern** (RESEARCH.md "resolveJavaExecutable test pattern") — model it on the existing `child_process` mock above (same shape):

```typescript
vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    return {
        ...actual,
        existsSync: vi.fn(),
    };
});
```

(RESEARCH.md showed a flatter shape `vi.mock('node:fs', () => ({ existsSync: vi.fn() }))` — recommend the `importActual` shape above for consistency with the existing `node:child_process` mock in the same file.)

**Existing `detectJava` describe-block pattern** (lines 43-110) — exact assertion style to mirror in new Windows describe:

```typescript
describe('detectJava', () => {
    const originalEnv = { ...process.env };
    const mockExecSync = vi.mocked(execSync);

    beforeEach(() => {
        mockExecSync.mockReset();
        setJavaHome(undefined);
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        setJavaHome(undefined);
    });

    it('uses setJavaHome override before JAVA_HOME', () => {
        process.env.JAVA_HOME = '/env/java';
        setJavaHome('/cli/java');
        mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

        const result = detectJava();

        expect(result.javaPath).toBe('/cli/java/bin/java');     // <-- exact string equality
        expect((result as any).version).toBe(21);
        const firstCall = mockExecSync.mock.calls[0][0] as string;
        expect(firstCall).toContain('/cli/java/bin/java');
    });
    // ... 3 more tests with same shape ...
});
```

**Critical regression invariant** (UNIX-01): these four existing tests at lines 62-109 MUST pass unchanged after Phase 35. The exact strings `'/cli/java/bin/java'`, `'/env/java/bin/java'`, `'java'` are fake paths that don't exist on the test machine. `resolveJavaExecutable`'s Unix branch MUST passthrough without `existsSync` — otherwise these tests break (RESEARCH.md Pitfall 4).

**New `describe` blocks to add** (Wave 0 gaps from RESEARCH.md):

1. `describe('resolveJavaExecutable on Windows', …)` — sets `platform='win32'`, mocks `existsSync`, asserts: existing → return as-is; bare missing + `.exe` exists → return `+'.exe'`; both missing → return `null`; bare name → passthrough without `existsSync` call.
2. `describe('resolveJavaExecutable on Unix', …)` — sets `platform='linux'`, asserts all candidates pass through unchanged WITHOUT calling `existsSync`.
3. `describe('detectJava on Windows', …)` — end-to-end with `platform='win32'` + `existsSync` mocked true for `.exe` paths + `execSync` mocked to return JDK 21 output; assert `result.javaPath` ends with `'\\bin\\java.exe'`.

All three follow the existing `beforeEach`/`afterEach` setup + `mockExecSync.mockReturnValueOnce(...)` shape from lines 43-110.

**Existing `findJdtLs` describe** (lines 112-145) — DO NOT modify in Phase 35. `findJdtLs` is Phase 38's territory.

---

## Shared Patterns

### Platform Mocking (NEW for Phase 35 — appears in 2 test files)

**Source:** RESEARCH.md "Pitfall 3" Option B + "Test pattern for platform mocking" — no existing codebase analog (this codebase has zero `process.platform` mocks today, confirmed by `grep -rn 'process.platform' tests/` returning empty).

**Apply to:** `tests/platform/index.test.ts` (every test) and the new Windows describes in `tests/jdtls/client.test.ts`.

```typescript
const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
    setPlatform(originalPlatform);
    vi.resetModules();
});

// In each platform-branch test:
setPlatform('win32');     // or 'linux' / 'darwin'
vi.resetModules();
const { /* ... */ } = await import('../../src/<module>.js');
```

Inline this helper in each test file for Phase 35 (research recommends NOT extracting to `tests/helpers/platform.ts` yet — only two consumers; extract if Phase 36/37/38 also need it).

### Mocking a single named export of a node: built-in

**Source:** `tests/jdtls/client.test.ts` lines 5-11 (existing canonical pattern).

**Apply to:** the new `node:fs` mock in `tests/jdtls/client.test.ts` for `resolveJavaExecutable` tests.

```typescript
vi.mock('<module-name>', async () => {
    const actual = await vi.importActual<typeof import('<module-name>')>('<module-name>');
    return {
        ...actual,
        <namedExport>: vi.fn(),
    };
});
```

Use `vi.mocked(<namedExport>)` to access the typed mock inside the describe block; call `mockReset()` in `beforeEach`.

### Tab indentation (cross-cutting CLAUDE.md rule)

**Source:** CLAUDE.md "Conventions: Tab indentation in all source files (not spaces)" + verified by reading `src/jdtls/client.ts`, `src/types/include.ts`, `src/cli/args.ts`, `tests/cli/args.test.ts`, `tests/jdtls/client.test.ts` — all use tabs.

**Apply to:** every line of every new and modified file. Do not introduce space-indented blocks even in code excerpts pasted from RESEARCH.md (RESEARCH.md examples use 4-space indentation in places — convert to tabs before committing).

### Strongly-typed exports

**Source:** CLAUDE.md "Strongly typed: All tool interfaces must have precise types" + existing examples in `src/jdtls/client.ts` lines 18-46 (typed result unions like `JavaDetectResult = JavaDetected | JavaNotFound`).

**Apply to:** every export in `src/platform/index.ts` (`isWindows: boolean` — implicit but acceptable; functions explicit `(): string` / `(home: string): string` / `(): string[]`); `resolveJavaExecutable(candidate: string): string | null` in `src/jdtls/client.ts`.

### File-header JSDoc

**Source:** `src/jdtls/client.ts` lines 1-6 (block JSDoc summarizing module purpose).

**Apply to:** top of `src/platform/index.ts`. Use the same `/** … */` block style with prose description, no `@module` tag.

## No Analog Found

| Concept | Why no analog | Planner action |
|---------|---------------|----------------|
| Pure platform-branching helper module (`src/platform/`) | No `src/platform/`, `src/utils/`, or similar pure-helper module exists in this codebase. The new module is a new domain layer per RESEARCH.md "Architectural Responsibility Map". | Use `src/types/include.ts` (tiny pure module with named const + exports) as the structural model + `src/cli/args.ts` (helper-function module) as the function-shape model. |
| Mocking `process.platform` in tests | `grep -rn 'process.platform' tests/` returns zero matches. This codebase has never mocked `process.platform`. | Follow RESEARCH.md "Pitfall 3" Option B verbatim (`Object.defineProperty(process, 'platform', { value, configurable: true })` + `vi.resetModules()` + dynamic import). Inline the helper in each test file. |
| `commonJavaLocations()` consumers | This phase ships the helper but has no consumer until Phase 37. The function exists for the module to be complete — pure data return. | No analog needed; planner ships the function with parent-directory strings per RESEARCH.md Open Question 3 recommendation (return parent dirs, not glob patterns). |

## Metadata

**Analog search scope:** `src/` (full tree), `tests/` (full tree).
**Files scanned:** ~25 source + test files via Bash directory listings and targeted Reads; deep-read 5 files for pattern extraction (`src/jdtls/client.ts`, `tests/jdtls/client.test.ts`, `src/types/include.ts`, `src/cli/args.ts`, `tests/cli/args.test.ts`).
**Pattern extraction date:** 2026-05-15

**Key patterns identified:**
1. New pure helper modules follow `src/types/include.ts` shape: imports → block JSDoc → named const → typed functions, tabs throughout.
2. `src/jdtls/client.ts` already imports `existsSync` (line 13) — `resolveJavaExecutable` is a zero-new-import addition to the file.
3. Existing v1.5 `detectJava` tests assert exact `javaPath` string equality (`'/cli/java/bin/java'`, `'/env/java/bin/java'`, `'java'`) — UNIX-01 is enforced by these tests; `resolveJavaExecutable`'s Unix branch MUST be a passthrough.
4. The project's canonical "mock one named export" idiom is the `importActual` spread pattern in `tests/jdtls/client.test.ts` lines 5-11. Reuse for the new `node:fs` mock.
5. `process.platform` is mocked nowhere in the codebase today — Phase 35 introduces this technique. Use `Object.defineProperty` + `vi.resetModules()` + dynamic import per RESEARCH.md Pitfall 3.
