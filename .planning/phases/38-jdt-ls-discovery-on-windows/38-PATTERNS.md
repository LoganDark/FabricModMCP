# Phase 38: JDT LS Discovery on Windows - Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 3 (1 modified, 2 created)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/jdtls/client.ts` (modify `findJdtLs` + add `composeFailureReason`) | domain (discovery) | request-response (sync probe) | `src/jdtls/java-discovery.ts` `discoverJava` + `formatSlotLine` + `formatReason` | exact (sibling discovery function in same module) |
| `tests/jdtls/client.test.ts` (extend) — new Windows / Unix / multi-line describes | unit test (platform-mocked) | request-response (mocked fs + glob) | `tests/jdtls/client.test.ts` existing `describe('resolveJavaExecutable on Windows', …)` blocks (lines 176-340) + `tests/platform/index.test.ts` `jdtlsCandidateDirs` describes | exact (same file already houses the Phase 35 Windows-mocked template) |
| `tests/no-process-env-home.test.ts` (new) — grep regression gate | unit test (fs scan) | batch (one-shot src walk) | none — no precedent in repo; closest cousin is the `vi.mock('node:fs')` + recursive-walk skeleton in RESEARCH §"Grep regression test skeleton" | role-only (novel test pattern) |

## Pattern Assignments

### `src/jdtls/client.ts` — `findJdtLs` rewrite + `composeFailureReason` helper

**Role:** domain — JDT LS discovery (sync, no external probe — just fs)
**Data flow:** request-response — caller invokes, function returns `{ jdtlsHome } | { jdtlsHome: null, error }`
**Analog (primary):** `src/jdtls/java-discovery.ts` — `discoverJava` body (lines 361-445), `formatSlotLine` (lines 452-476), `formatReason` (lines 478-487)
**Analog (secondary, for `JdtLsNotFound` envelope and slot-1 fast-fail shape):** the existing `findJdtLs` body at `src/jdtls/client.ts:47-80` itself (the JDTLS_HOME branch keeps the fail-fast structure; only the depth deepens per D-06/D-07).

#### Imports pattern (analog: `src/jdtls/client.ts:14-24` existing imports + `src/jdtls/java-discovery.ts:22-29`)

The existing client.ts imports block (lines 14-24):
```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { glob } from 'glob';
import { JSONRPCEndpoint, LspClient } from 'ts-lsp-client';
import { logger } from '../logging/logger.js';
import { pathToFileUri } from '../platform/uri.js';
import { hardenEndpoint } from './request-queue.js';
```

**Apply to Phase 38:** keep all of the above and ADD `globSync` to the existing `glob` import + add `jdtlsCandidateDirs` from `../platform/index.js`. Conventions to preserve from this block:
- `node:` protocol prefix on built-ins (`node:path`, `node:os`, `node:fs`)
- `.js` extension on local imports (ESM resolver)
- Tab indentation, no trailing comma
- Type-only imports use `import type` or inline `type` (see `type ChildProcess`)

Resulting Phase 38 import deltas:
```typescript
import { existsSync } from 'node:fs';              // unchanged (line 19)
import { glob, globSync } from 'glob';             // EXTENDED — globSync added (line 20)
import { jdtlsCandidateDirs } from '../platform/index.js';  // NEW
// NOTE: `process.env.HOME` and `join(home, …)` for candidate construction both DELETED.
//       homedir() is NOT imported here — jdtlsCandidateDirs() owns the home resolution.
```

#### Slot-record + outcome taxonomy pattern (analog: `src/jdtls/java-discovery.ts:277-283` + `:362`)

Java-discovery's `CandidateOutcome` (lines 277-283):
```typescript
type CandidateOutcome =
    | { kind: 'success'; javaPath: string; version: number }
    | { kind: 'not-set' }
    | { kind: 'file-not-found' }
    | { kind: 'version-too-old'; version: number }
    | { kind: 'timed-out' }
    | { kind: 'probe-failed'; message: string };
```

And the `SlotRecord` shape inside `discoverJava` (line 362):
```typescript
type SlotRecord = { label: string; outcome: CandidateOutcome };
const outcomes: SlotRecord[] = [];
```

**Apply to Phase 38:** copy the discriminated-union shape exactly; reduce the taxonomy to 3 variants per D-03 (no `success` variant — success short-circuits before the slot is recorded; no `timed-out`/`version-too-old`/`probe-failed` — JDT LS discovery does no execFile probe). Phase 38 also has no `--java-home` analog (no `--jdtls-home` flag), so `SlotRecord` collapses to `{ label: string; reason: SkipReason }`.

#### Multi-line failure composer (analog: `src/jdtls/java-discovery.ts:438-445`)

```typescript
// All slots failed — synthesize multi-line failureReason.
const lines: string[] = ['Java not found. Tried:'];
for (const { label, outcome } of outcomes) {
    lines.push('  ' + formatSlotLine(label, outcome, opts.projectRoot));
}
lines.push('Install Java 21+ (Adoptium / Microsoft / Zulu) or set JAVA_HOME / --java-home.');
return { javaPath: null, error: lines.join('\n') };
```

**Apply to Phase 38 verbatim (substituting JDT LS strings):**
- First line: `'JDT LS not found. Tried:'`
- Trailing install hint: `'Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.'`
- Indent: same `'  ' + …` (two-space indent per slot line)
- Join: `lines.join('\n')`
- Return shape: `{ jdtlsHome: null, error: lines.join('\n') }` (envelope at `client.ts:30-33`)

Place `composeFailureReason` as a private (non-exported) module-internal helper in `client.ts`, mirroring Phase 37's privacy boundary for `formatSlotLine` / `formatReason` (no `export` keyword).

#### Slot-line formatting (analog: `src/jdtls/java-discovery.ts:452-476`)

The Java composer's slot dispatch:
```typescript
function formatSlotLine(label: string, outcome: CandidateOutcome, projectRoot: string | undefined): string {
    if (label === '--java-home') {
        if (outcome.kind === 'not-set') return '--java-home: (not set)';
        return '--java-home ' + (configuredJavaHome ?? '') + ': ' + formatReason(outcome);
    }
    // …
    if (label === 'JAVA_HOME') {
        if (outcome.kind === 'not-set') return 'JAVA_HOME: (not set)';
        const v = process.env.JAVA_HOME ?? '';
        return 'JAVA_HOME=' + v + ': ' + formatReason(outcome);
    }
    if (label === 'java on PATH') {
        if (outcome.kind === 'not-set') return 'java on PATH: (not set)';
        return 'java on PATH: ' + formatReason(outcome);
    }
    // Scan slot: label is a bare absolute path
    return label + ': ' + formatReason(outcome);
}
```

**Apply to Phase 38 (simplified — only TWO branches needed per D-04):**
```typescript
function formatSlotLine(label: string, reason: SkipReason): string {
    if (label === 'JDTLS_HOME') {
        if (reason.kind === 'not-set') return 'JDTLS_HOME: (not set)';
        // unreachable in current control flow — JDTLS_HOME set+invalid returns early per D-07
        // (still implement defensively for type-completeness)
        return 'JDTLS_HOME: ' + formatReason(reason);
    }
    // Candidate dir slot: label IS the bare absolute path (D-04)
    return label + ': ' + formatReason(reason);
}
```

#### Reason formatter (analog: `src/jdtls/java-discovery.ts:478-487`)

```typescript
function formatReason(outcome: CandidateOutcome): string {
    switch (outcome.kind) {
        case 'success':         return 'OK (Java ' + outcome.version + ')';
        case 'not-set':         return '(not set)';
        case 'file-not-found':  return '(file not found)';
        case 'version-too-old': return 'Java ' + outcome.version + ' (need 21+)';
        case 'timed-out':       return 'timed out after 3s';
        case 'probe-failed':    return 'probe failed: ' + outcome.message;
    }
}
```

**Apply to Phase 38 (collapsed to 3 cases per D-03):**
```typescript
function formatReason(reason: SkipReason): string {
    switch (reason.kind) {
        case 'not-set':                                     return '(not set)';
        case 'directory does not exist':                    return 'directory does not exist';
        case 'exists but no launcher jar in plugins/':     return 'exists but no launcher jar in plugins/';
    }
}
```

Style notes preserved from Phase 37: switch with column-aligned `return`s, tab indentation, no fall-through.

#### Per-skip logger.debug pattern (analog: `src/jdtls/java-discovery.ts:365-372`)

```typescript
function record(label: string, candidate: string | null, outcome: CandidateOutcome): void {
    outcomes.push({ label, outcome });
    if (outcome.kind !== 'success' && candidate !== null) {
        logger.debug('Java candidate skipped', { candidate, reason: outcome.kind });
    } else if (outcome.kind !== 'success') {
        logger.debug('Java candidate skipped', { candidate: label, reason: outcome.kind });
    }
}
```

**Apply to Phase 38 verbatim (D-05):** call `logger.debug('JDT LS candidate skipped', { candidate, reason })` from the inline probe loop. Volume bounded at 4-7 candidates per call. Use the same `(message: string, data?: unknown)` signature already exported by `src/logging/logger.ts`.

#### Sync probe loop (analog: `src/jdtls/java-discovery.ts:419-436`, simplified)

Java-discovery's per-slot probe (Slot 4, PATH lookup):
```typescript
{
    const label = 'java on PATH';
    const candidate = javaBinaryName();
    const outcome = await probeCandidate(candidate);
    record(label, candidate, outcome);
    if (outcome.kind === 'success') return returnSuccess(outcome);
}
```

**Apply to Phase 38 (sync, no execFile — pure fs):**
```typescript
const LAUNCHER_GLOB = 'plugins/org.eclipse.equinox.launcher_*.jar';
for (const dir of jdtlsCandidateDirs()) {
    if (!existsSync(dir)) {
        logger.debug('JDT LS candidate skipped', { candidate: dir, reason: 'directory does not exist' });
        slots.push({ label: dir, reason: { kind: 'directory does not exist' } });
        continue;
    }
    if (globSync(LAUNCHER_GLOB, { cwd: dir, absolute: true }).length === 0) {
        logger.debug('JDT LS candidate skipped', { candidate: dir, reason: 'exists but no launcher jar in plugins/' });
        slots.push({ label: dir, reason: { kind: 'exists but no launcher jar in plugins/' } });
        continue;
    }
    return { jdtlsHome: dir };  // first match wins
}
```

#### JDTLS_HOME fast-fail (analog: existing `client.ts:53-61`, deepened per D-06/D-07)

Existing structure to preserve (the if/else fail-fast shape, the template-literal error message, the explicit `null` for `jdtlsHome`):
```typescript
if (process.env.JDTLS_HOME) {
    if (existsSync(process.env.JDTLS_HOME)) {
        return { jdtlsHome: process.env.JDTLS_HOME };
    }
    return {
        jdtlsHome: null,
        error: `JDTLS_HOME is set to "${process.env.JDTLS_HOME}" but the directory does not exist.`,
    };
}
```

**Apply to Phase 38 (deepened to also check launcher jar; SECOND error message for the new branch):**
```typescript
const envHome = process.env.JDTLS_HOME;
if (envHome) {
    if (!existsSync(envHome)) {
        return {
            jdtlsHome: null,
            error: `JDTLS_HOME is set to "${envHome}" but the directory does not exist.`,
        };
    }
    if (globSync(LAUNCHER_GLOB, { cwd: envHome, absolute: true }).length === 0) {
        return {
            jdtlsHome: null,
            error: `JDTLS_HOME is set to "${envHome}" but no JDT LS launcher jar was found in plugins/.`,
        };
    }
    return { jdtlsHome: envHome };
}
// Slot 1 (JDTLS_HOME unset) recorded for the multi-line composer:
slots.push({ label: 'JDTLS_HOME', reason: { kind: 'not-set' } });
```

The first-error template (`JDTLS_HOME is set to "X" but the directory does not exist.`) is preserved BYTE-IDENTICAL — `tests/jdtls/client.test.ts:153` (`toContain('does not exist')`) and the analogous JDTLS_HOME-set-but-missing assertion at `:148-154` MUST continue to pass.

#### Envelope (analog: `src/jdtls/client.ts:30-33`)

```typescript
export type JdtLsNotFound = {
    jdtlsHome: null;
    error: string;
}
export type JdtLsFindResult = JdtLsFound | JdtLsNotFound;
```

**Apply to Phase 38:** UNCHANGED. The `error` field stays `string`; only its content becomes multi-line via `\n`. Do NOT widen the envelope to `{ tried: string[] }` or similar (RESEARCH §"Anti-Patterns" forbids).

---

### `tests/jdtls/client.test.ts` — extend with Windows / Unix / multi-line describes

**Role:** unit test (platform-mocked + fs-mocked + glob-mocked)
**Data flow:** request-response (mocked fs + glob; no real I/O)
**Analog (primary):** existing `describe('resolveJavaExecutable on Windows', …)` at `tests/jdtls/client.test.ts:176-233` and `describe('detectJava on Windows', …)` at `:274-340`
**Analog (secondary):** `tests/platform/index.test.ts:94-134` `describe('jdtlsCandidateDirs', …)` — for the Linux/Darwin/Windows ordering assertion templates

#### Top-of-file `vi.mock` patterns (analog: `tests/jdtls/client.test.ts:6-20`)

Existing mocks at the top of the file:
```typescript
vi.mock('node:child_process', async () => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    return {
        ...actual,
        execSync: vi.fn(),
    };
});

vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
    };
});
```

**Apply to Phase 38:** ADD a third mock block in the same shape (canonical "mock one named export, preserve the rest" idiom):
```typescript
vi.mock('glob', async () => {
    const actual = await vi.importActual<typeof import('glob')>('glob');
    return {
        ...actual,
        globSync: vi.fn(),
    };
});
```

Notes copied from analog:
- `vi.importActual<typeof import('module')>(module)` — preserves all unrelated exports (`glob` async function must still work for `startJdtLs:97`)
- Mock factory is `async () => …` — Vitest requires the async form when using `importActual`
- Pass `vi.fn()` (not `vi.fn(actual.globSync)`) — Windows-mocked tests need fully synthetic returns; passthrough would call real fs

#### setPlatform + originalPlatform + originalEnv (analog: `tests/jdtls/client.test.ts:22-32`)

```typescript
const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
```

**Apply to Phase 38:** REUSE the existing helper at module scope (it's already in client.test.ts:27-32). No new declaration needed — new describes share it.

#### Per-describe lifecycle (analog: `tests/jdtls/client.test.ts:176-189` resolveJavaExecutable on Windows)

```typescript
describe('resolveJavaExecutable on Windows', () => {
    const mockExistsSync = vi.mocked(existsSync);

    beforeEach(() => {
        setPlatform('win32');
        vi.resetModules();
        mockExistsSync.mockReset();
    });

    afterEach(() => {
        setPlatform(originalPlatform);
        vi.resetModules();
        mockExistsSync.mockReset();
    });
    // …
});
```

**Apply to Phase 38 (extended to also mock globSync and reset process.env per Pitfall 2):**
```typescript
describe('findJdtLs on Windows', () => {
    const mockExistsSync = vi.mocked(existsSync);
    const mockGlobSync = vi.mocked(globSync);  // import { globSync } from 'glob' at file top

    beforeEach(() => {
        setPlatform('win32');
        process.env = { ...originalEnv };
        delete process.env.JDTLS_HOME;
        process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
        process.env.ProgramFiles = 'C:\\Program Files';
        vi.resetModules();
        mockExistsSync.mockReset();
        mockGlobSync.mockReset();
    });

    afterEach(() => {
        setPlatform(originalPlatform);
        process.env = { ...originalEnv };
        vi.resetModules();
        mockExistsSync.mockReset();
        mockGlobSync.mockReset();
    });
    // …
});
```

The `process.env = { ...originalEnv }` reset is load-bearing per Pitfall 2 (mock hoisting + dynamic import): without it, `LOCALAPPDATA`/`ProgramFiles` leak between tests and `jdtlsCandidateDirs()` re-evaluation captures stale values.

#### Dynamic-import + `setPlatform` test shape (analog: `tests/jdtls/client.test.ts:191-196`)

```typescript
it('returns the candidate unchanged when existsSync(candidate) is true', async () => {
    mockExistsSync.mockReturnValue(true);
    const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
    const result = resolveJavaExecutable('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
    expect(result).toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
});
```

**Apply to Phase 38:** same shape. ALWAYS arrange mocks BEFORE the dynamic import (per Pitfall 2 — `vi.resetModules()` in `beforeEach` invalidates the cache; the dynamic `import('…')` triggers re-evaluation that captures the current mock state).

Example new test:
```typescript
it('returns the first Windows candidate that has both dir-exists AND launcher jar', async () => {
    // Make only the LOCALAPPDATA candidate (index 0) "exist and have a launcher jar"
    mockExistsSync.mockImplementation((p) => String(p).includes('AppData\\Local\\jdtls'));
    mockGlobSync.mockReturnValue(['C:\\Users\\test\\AppData\\Local\\jdtls\\plugins\\org.eclipse.equinox.launcher_1.6.900.jar']);
    const { findJdtLs } = await import('../../src/jdtls/client.js');
    const result = findJdtLs();
    expect(result.jdtlsHome).toBe('C:\\Users\\test\\AppData\\Local\\jdtls');
});
```

#### Unix regression describe (analog: `tests/platform/index.test.ts:111-133` Linux/Darwin describes for `jdtlsCandidateDirs`)

```typescript
it('Linux: returns the three v1.5 literal paths byte-identical (UNIX-01)', async () => {
    setPlatform('linux');
    vi.resetModules();
    const { jdtlsCandidateDirs } = await import('../../src/platform/index.js');
    const home = homedir();
    expect(jdtlsCandidateDirs()).toEqual([
        pathPosix.join(home, '.local', 'share', 'jdtls'),
        '/usr/local/share/jdtls',
        pathPosix.join(home, 'jdtls'),
    ]);
});
```

**Apply to Phase 38:** same shape for the new `describe('findJdtLs on Unix (UNIX-01 regression)', …)` block. Use `setPlatform('linux')` and `setPlatform('darwin')` for the two cases. Assert that the first existing+launcher-jar-bearing candidate wins, and that the candidate set is exactly the 3 paths returned by `jdtlsCandidateDirs()` (no Windows paths leak in).

#### JDTLS_HOME branch tests (analog: existing `tests/jdtls/client.test.ts:140-165`)

Existing tests at lines 140-165 cover (a) set+valid (line 140), (b) set+missing (line 148), and (c) unset+no-common-location (line 156). Phase 38 ADDS a fourth case:

```typescript
it('returns specific error when JDTLS_HOME exists but no launcher jar', async () => {
    process.env.JDTLS_HOME = '/tmp';  // dir exists
    mockGlobSync.mockReturnValue([]);  // no launcher jar
    const { findJdtLs } = await import('../../src/jdtls/client.js');
    const result = findJdtLs();
    expect(result.jdtlsHome).toBeNull();
    expect((result as any).error).toContain('JDTLS_HOME');
    expect((result as any).error).toContain('launcher jar');
    // Critically: NO fall-through — error is the terse single-line form, not multi-line
    expect((result as any).error).not.toContain('Tried:');
});
```

Note: the existing test at line 140 (`returns jdtlsHome when JDTLS_HOME is set to existing directory`) passes `/tmp` as JDTLS_HOME — which under Phase 38's deeper probe will now FAIL because `/tmp/plugins/org.eclipse.equinox.launcher_*.jar` does not exist. This test MUST be updated to also mock `globSync` to return a non-empty array, OR rewritten to use a fake JDTLS_HOME under a `vi.mock('node:fs')` + `vi.mock('glob')` regime. The implementer should explicitly handle this regression rather than letting it surface as a "mystery break."

#### Multi-line message composition test (analog: pattern conceptually mirrors Phase 37 Java-discovery tests; concrete template in CONTEXT D-02)

```typescript
it('composes multi-line failureReason when every candidate fails', async () => {
    delete process.env.JDTLS_HOME;
    // Mock all candidates to fail in mixed ways
    mockExistsSync.mockImplementation((p) => String(p).includes('AppData\\Local\\jdtls') === false);
    // Mock globSync to return [] for ALL calls (so the one existing dir still fails the launcher-jar check)
    mockGlobSync.mockReturnValue([]);
    const { findJdtLs } = await import('../../src/jdtls/client.js');
    const result = findJdtLs();
    expect(result.jdtlsHome).toBeNull();
    const err = (result as any).error as string;
    // First-line prefix preserved (Phase 37 D-18 convention)
    expect(err.split('\n')[0]).toBe('JDT LS not found. Tried:');
    // JDTLS_HOME line with (not set) marker
    expect(err).toContain('JDTLS_HOME: (not set)');
    // Each Windows candidate appears with its skip reason
    expect(err).toContain('C:\\Users\\test\\AppData\\Local\\jdtls: exists but no launcher jar in plugins/');
    expect(err).toContain('C:\\Program Files\\jdtls: directory does not exist');
    // Trailing install hint
    expect(err).toContain('Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.');
});
```

#### Per-skip logger.debug test (D-05, optional but mandated)

Analog: no in-repo test currently asserts on `logger.debug` calls in jdtls discovery. The pattern would be a `vi.spyOn(logger, 'debug')` or a `vi.mock('../../src/logging/logger.js', …)`. If implementer adds this, follow the canonical mock-one-export shape (same as the `vi.mock('node:fs', …)` block at lines 14-20).

---

### `tests/no-process-env-home.test.ts` — grep regression gate (NEW)

**Role:** unit test (fs scan — CI gate)
**Data flow:** batch (one-shot recursive readdir + regex check)
**Analog:** none in-repo. The closest cousin pattern is the recursive walker skeleton already drafted in `38-RESEARCH.md` §"Grep regression test skeleton" (lines 437-465). Lift verbatim.

#### Imports pattern (vitest + node:fs/promises + node:path)

```typescript
import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
```

Apply project conventions:
- `node:` protocol prefix (matches `src/jdtls/client.ts:14-18` style)
- No `.js` extension (test files import only npm packages and Node built-ins; no relative project imports)
- Tab indentation (CLAUDE.md non-negotiable)

#### Recursive walker pattern (analog: `38-RESEARCH.md:442-451`, verified valid Node 22 API)

```typescript
async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(p);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            yield p;
        }
    }
}
```

Alternative: `readdir('src', { recursive: true, withFileTypes: true })` (Node 18.17+, project on Node 22 LTS — fully available). Either works; the explicit walker is more readable and matches the RESEARCH.md skeleton.

#### Test body (analog: `38-RESEARCH.md:453-464`)

```typescript
describe('process.env.HOME regression gate', () => {
    it('src/**/*.ts contains no references to process.env.HOME', async () => {
        const offenders: string[] = [];
        for await (const file of walk('src')) {
            const content = await readFile(file, 'utf-8');
            if (/process\.env\.HOME\b/.test(content)) {
                offenders.push(file);
            }
        }
        expect(offenders, 'use os.homedir() instead — see Phase 38 D-08').toEqual([]);
    });
});
```

Critical details (Pitfall 5):
- Scope = `'src'` ONLY (not `'.'`, not `'tests'`). Test file itself contains the literal pattern (in the regex source) and MUST live outside `src/`.
- Word boundary `\b` in `/process\.env\.HOME\b/` — prevents future false positives on hypothetical `process.env.HOMEDIR`.
- `expect(offenders, 'use os.homedir() …').toEqual([])` — the second arg is vitest's message override; surfaces actionable guidance when CI fails.

---

## Shared Patterns

### Multi-line failureReason composition (cross-cutting from Phase 37)

**Source:** `src/jdtls/java-discovery.ts:438-487`
**Apply to:** `findJdtLs` rewrite in `src/jdtls/client.ts` (the sole Phase 38 consumer)

Structural invariants the implementer MUST replicate:
1. First line: `'<Subject> not found. Tried:'` — preserves `toContain('<Subject> not found')` test compatibility forever
2. Per-slot lines: `'  ' + formatSlotLine(label, reason)` — exactly two leading spaces
3. Trailing line: `'Install <thing> from <URL> or set <ENV_VAR>.'` — actionable next step
4. `lines.join('\n')` — POSIX newlines, no `\r\n`
5. Helpers (`formatSlotLine`, `formatReason`) are private (non-exported) module-internal
6. `logger.debug('<Subject> candidate skipped', { candidate, reason })` per skip — audit trail
7. The discriminated-union shape `{ kind: '…'; <field>?: T }` for reasons — type-narrowing in `switch (reason.kind)` with no `default` (exhaustiveness check)

### Platform mocking (Phase 35/36/37 carry-forward)

**Source:** `tests/platform/index.test.ts:13-21` + `tests/jdtls/client.test.ts:27-32`
**Apply to:** all new `findJdtLs` tests that need platform-specific assertions

```typescript
const originalPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
// In beforeEach:  setPlatform('win32'); vi.resetModules();
// THEN: const { findJdtLs } = await import('../../src/jdtls/client.js');
// In afterEach:   setPlatform(originalPlatform); vi.resetModules();
```

Critical ordering (Pitfall 2): `setPlatform → process.env mutations → vi.resetModules → mock setup → dynamic import`. Reversing any pair breaks the test.

### Mock one named export of a built-in / package

**Source:** `tests/jdtls/client.test.ts:6-20`
**Apply to:** the new `vi.mock('glob', …)` block at the top of `tests/jdtls/client.test.ts`

```typescript
vi.mock('<module>', async () => {
    const actual = await vi.importActual<typeof import('<module>')>('<module>');
    return {
        ...actual,
        <namedExport>: vi.fn(),
    };
});
```

Required for `glob` because `startJdtLs:97` still uses `await glob(…)` — passing through the real `glob` async function preserves that callsite while overriding `globSync` for `findJdtLs` tests.

### Tab indentation, ESM `.js` extensions, no trailing comma

**Source:** CLAUDE.md "Conventions" + every file in `src/jdtls/`
**Apply to:** every new line of code in `src/jdtls/client.ts`, `tests/jdtls/client.test.ts`, `tests/no-process-env-home.test.ts`

Non-negotiable. Lift indentation/style verbatim from the immediately surrounding existing code in each file.

### JDT LS error envelope (UNCHANGED)

**Source:** `src/jdtls/client.ts:30-33`
**Apply to:** all Phase 38 return statements from `findJdtLs`

```typescript
export type JdtLsNotFound = {
    jdtlsHome: null;
    error: string;
}
```

The `error` field stays `string`. Phase 38 only enriches its CONTENT (multi-line `\n`-separated) — the SHAPE does not change. Forbidden: adding `tried: string[]`, `slots: SlotRecord[]`, or other new fields.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/no-process-env-home.test.ts` | unit test (CI gate) | batch (fs scan) | First test in the repo that scans `src/` for forbidden source patterns. The recursive walker + regex check is novel here — implementer should lift the verbatim skeleton from `38-RESEARCH.md` §"Grep regression test skeleton" (lines 437-465) since no in-repo precedent exists for "test that asserts on the absence of a source-code substring." This is acceptable: the pattern is ~25 lines, fully self-contained, and uses only stdlib APIs (`readdir`, `readFile`) already used elsewhere in `src/project/gradle-parser.ts`. |

## Metadata

**Analog search scope:**
- `src/jdtls/` (5 files — `client.ts`, `java-discovery.ts`, `startup.ts`, `workspace-sync.ts`, `request-queue.ts`, `uri-mapper.ts`)
- `src/platform/` (2 files — `index.ts`, `uri.ts`)
- `tests/jdtls/` (existing test files)
- `tests/platform/` (existing test files)

**Files scanned:** ~15 source files + ~6 test files (focused on the directly-relevant Phase 35/37 carry-forward surfaces; broader scan unnecessary — Phase 38 is a surgical refactor within a tightly-bounded module).

**Pattern extraction date:** 2026-05-24

**Key insight:** Phase 38 is ~95% pattern reuse. The `findJdtLs` rewrite is a structural copy of `discoverJava`'s slot-iteration + multi-line failure composition, simplified by removing the async execFile probe (replaced with sync `existsSync + globSync`) and the 6-variant outcome taxonomy (collapsed to 3). The test scaffolding is a copy of the existing Windows-mocked describes already in `tests/jdtls/client.test.ts`, extended with one new `vi.mock('glob', …)` block. The only genuinely novel surface is the grep regression test, which is ~25 lines of stdlib code.
