# Phase 38: JDT LS Discovery on Windows - Research

**Researched:** 2026-05-24
**Domain:** JDT LS discovery — consume Phase 35's `jdtlsCandidateDirs()`, deepen probe to `existsSync` + launcher-jar glob, migrate `process.env.HOME` → `os.homedir()`, compose multi-line failure message mirroring Phase 37
**Confidence:** HIGH

## Summary

Phase 38 is a small, surgical refactor of `src/jdtls/client.ts` `findJdtLs()` (lines 47-80 of the current file) with three locked outcomes per CONTEXT.md: (1) consume `jdtlsCandidateDirs()` from `src/platform/index.ts` instead of building the candidate list inline, (2) deepen each probe to require BOTH `existsSync(dir)` AND a `globSync('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: dir })` match, (3) compose a multi-line `failureReason` string mirroring Phase 37's `java-discovery.ts` `discoverJava()` failure-message convention, with distinct error branches for JDTLS_HOME-set-but-invalid (no fall-through). The Phase 35 foundation (`jdtlsCandidateDirs()`) is already shipped and tested — Phase 38 only changes the consumer in `client.ts` plus the test file.

The decision tree is essentially closed already (CONTEXT.md D-01..D-10). Research's value-add is confirming: the rewrite target's current shape matches the CONTEXT description exactly; `jdtlsCandidateDirs()` returns what was promised; `globSync` is exported from `glob@^13.0.6` (already a runtime dep, currently imported in client.ts:20 as the async `glob`); `findJdtLs` has exactly **two** real callers (`src/jdtls/startup.ts:56` in an `async` context, plus 4 invocations across two test files); existing test assertions (`toContain('JDT LS not found')` in startup.test.ts:124 and client.test.ts:163, `toContain('JDTLS_HOME')` in client.test.ts:164, `toContain('does not exist')` in client.test.ts:153) **all remain satisfied** under the new multi-line format because the new format preserves both the `JDT LS not found.` first-line lead-in and the JDTLS_HOME/does-not-exist lexemes in the per-slot lines.

**Primary recommendation:** Implement findJdtLs as a sync function consuming `jdtlsCandidateDirs()` + `globSync`, with a private `composeFailureReason(slots: SlotRecord[])` helper that mirrors `java-discovery.ts`'s `formatSlotLine`/`formatReason` structure literally (same shape, simpler taxonomy — only 3 outcomes vs Java's 6). Tests live alongside the existing `describe('findJdtLs', …)` in `tests/jdtls/client.test.ts` (lines 133-166) as new Windows-mocked describes, plus a single new `tests/no-process-env-home.test.ts` for the grep regression gate. One plan should suffice.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Candidate-directory enumeration (per-platform priority list) | `src/platform/` (Phase 35) | — | Pure data; already shipped by Phase 35; Phase 38 only consumes |
| Existence check + launcher-jar glob probe | `src/jdtls/` (domain — does fs I/O) | — | Phase 38's exclusive work; lives in `findJdtLs()` |
| JDTLS_HOME env-var read + validation | `src/jdtls/` (domain) | — | Inline in `findJdtLs`; same depth as candidate probe (D-06) |
| Multi-line failure-message composition | `src/jdtls/` (domain helper) | — | Mirrors Phase 37 `java-discovery.ts:formatSlotLine`/`formatReason` |
| `os.homedir()` substitution for `process.env.HOME` | `src/jdtls/client.ts` (one-line replacement) | — | After consuming `jdtlsCandidateDirs()`, the `home` variable disappears entirely; the regression gate enforces no NEW sites can appear |
| Grep regression test (CI gate) | `tests/` | — | Pure-fs scan of `src/**/*.ts`; no subprocess |
| Caller adaptation (sync vs async) | `src/jdtls/startup.ts` | tests | Already in async context; sync `findJdtLs` is zero-ripple (recommended) |

## Standard Stack

### Core (already in the project — zero new deps)

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| `glob` | `^13.0.6` (package.json — `[VERIFIED: package.json + Bash node -e]`) | Launcher-jar pattern match | Already imported async at `src/jdtls/client.ts:20`. `globSync` is exported sibling (`[VERIFIED: node -e "const g=require('glob'); console.log(...)" → ['streamSync','iterateSync','sync','globStreamSync','globSync','globIterateSync']]`) |
| `node:os` `homedir()` | Node 22 LTS built-in | Cross-platform home dir | Already used in `src/platform/index.ts:21`, `src/project/loom-cache.ts`, `src/project/dependency-discovery.ts`, `src/project/gradle-parser.ts`, `src/project/source-jar-finder.ts` (per CONTEXT D-10) — established idiom |
| `node:fs` `existsSync` | Node 22 LTS built-in | Directory existence check | Already imported at `src/jdtls/client.ts:19`. Reused for both candidate dirs and JDTLS_HOME |
| `vitest` | `^4.1.4` (package.json — `[VERIFIED: package.json grep]`) | Test framework | Project standard. `vi.mock` + `vi.resetModules` + dynamic `import()` is the load-bearing platform-mocking idiom |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/platform/index.ts` `jdtlsCandidateDirs()` | shipped Phase 35 | Returns 4-path Windows ordered list or 3-path Unix ordered list | **The** candidate source — Phase 38 must not duplicate the enumeration in `findJdtLs` |
| `src/logging/logger.ts` `logger.debug` | existing | Per-candidate audit trail (D-05) | `logger.debug('JDT LS candidate skipped', { candidate, reason })` — verified `logger.debug(msg, data?)` signature exists in `src/logging/logger.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `globSync` (sync) | `await glob(...)` (async) | Async migration ripples to 1 callsite (`src/jdtls/startup.ts:56` — already in `async initJdtLsSession`, so `await findJdtLs()` would be a one-token edit) plus 4 test-call edits. CONTEXT D-Discretion recommends sync via `globSync` — preserves call shape, matches sibling `existsSync`, I/O bounded at ≤4 cheap globs. **Stay sync.** |
| `readdir('plugins/').filter(/equinox\.launcher_.*\.jar/)` | (alternative to globSync) | Six more lines for no perf gain; globSync is one call and matches the pattern already used at `client.ts:97` for the launcher-jar lookup inside `startJdtLs` |
| Extend `tests/jdtls/client.test.ts` | New `tests/jdtls/findJdtLs.test.ts` | Existing `describe('findJdtLs', …)` already lives in `client.test.ts:133-166` with the right env-mocking scaffolding. Add new Windows-mocked describes inline. **Recommend: extend in place.** A separate file fragments coverage. |
| Co-locate grep regression test | Standalone `tests/no-process-env-home.test.ts` | A standalone test file makes the CI-gate intent unambiguous; the file becomes a permanent guard, easier to find on future refactors. **Recommend: standalone.** |

**Version verification:**
- `glob ^13.0.6` — `[VERIFIED: package.json line for glob; node -e check confirms globSync exported]`
- `vitest ^4.1.4` — `[VERIFIED: package.json grep]`
- `@types/node ^25.6.0`, `typescript ^6.0.2`, `tsx ^4.21.0`, `tsup ^8.5.1` — `[VERIFIED: package.json grep]` (no relevance — Phase 38 doesn't add deps)

## Package Legitimacy Audit

Phase 38 installs **zero** new packages. All imports come from the project's existing runtime dependency set (`glob`, `node:os`, `node:fs`, `node:path`) plus the existing devDependency `vitest`. Slopcheck gate is N/A.

## Architecture Patterns

### System Architecture Diagram

```
startup.ts:initJdtLsSession (async caller)
        │
        ▼
client.ts:findJdtLs() ───── (1) reads process.env.JDTLS_HOME
        │                          │
        │                          ▼
        │                   existsSync + globSync(plugins/...)
        │                          │
        │                          ├── valid     → { jdtlsHome }
        │                          ├── dir missing → JdtLsNotFound (specific msg, NO fallthrough)
        │                          └── dir w/o jar → JdtLsNotFound (specific msg, NO fallthrough)
        │
        ▼ (JDTLS_HOME unset)
        ├──► platform/index.ts:jdtlsCandidateDirs() ──► [dir1, dir2, dir3 (, dir4 on Windows)]
        │                                                       │
        ▼                                                       ▼
   for each candidate:                                  per-candidate:
        existsSync(dir) ─── false ──► skipReason = 'directory does not exist'
              │
              ▼ true
        globSync('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: dir, absolute: true })
              │
              ├── length > 0  ──► return { jdtlsHome: dir }   (first match wins)
              └── length == 0 ──► skipReason = 'exists but no launcher jar in plugins/'
        │
        ▼ (all candidates skipped)
   composeFailureReason(slots) ──► multi-line string starting with `JDT LS not found.`
        │                          + JDTLS_HOME slot line (or "(not set)")
        │                          + one line per candidate with its skip reason
        │                          + trailing "Install ... or set JDTLS_HOME."
        ▼
   { jdtlsHome: null, error: <multi-line> }
        │
        ▼
   logger.debug per skip (D-05) for --verbose audit
```

### Recommended Project Structure (unchanged — Phase 38 is in-place)

```
src/
├── jdtls/
│   └── client.ts        # MODIFIED: rewrite findJdtLs (lines 47-80) + 2 new imports
├── platform/
│   └── index.ts         # UNCHANGED (Phase 35's pure-no-I/O contract)
tests/
├── jdtls/
│   └── client.test.ts   # MODIFIED: extend existing describe('findJdtLs', …)
└── no-process-env-home.test.ts   # NEW: grep regression gate
```

### Pattern 1: Multi-line failureReason composer (Phase 37 mirror)

**What:** Synthesize per-slot outcome records, then format with a small `formatSlotLine`-style function. Mirror `src/jdtls/java-discovery.ts:formatSlotLine` (lines 452-476) and `formatReason` (lines 478-487) literally — same shape, smaller outcome taxonomy.

**When to use:** When every candidate plus the JDTLS_HOME slot has been exhausted and the function must return a human-readable diagnostic.

**Example (mirroring Phase 37's java-discovery.ts):**
```typescript
// Source: src/jdtls/java-discovery.ts:438-445 (verified by Read)
// All slots failed — synthesize multi-line failureReason.
const lines: string[] = ['Java not found. Tried:'];
for (const { label, outcome } of outcomes) {
    lines.push('  ' + formatSlotLine(label, outcome, opts.projectRoot));
}
lines.push('Install Java 21+ (Adoptium / Microsoft / Zulu) or set JAVA_HOME / --java-home.');
return { javaPath: null, error: lines.join('\n') };
```

**Phase 38 adaptation (skeleton):**
```typescript
// Skip-reason taxonomy (CONTEXT D-03) — 3 outcomes (vs Java's 6)
type SkipReason =
    | { kind: 'not-set' }                          // JDTLS_HOME slot only
    | { kind: 'directory does not exist' }
    | { kind: 'exists but no launcher jar in plugins/' };

type SlotRecord = { label: string; reason: SkipReason };

function composeFailureReason(slots: SlotRecord[]): string {
    const lines: string[] = ['JDT LS not found. Tried:'];
    for (const { label, reason } of slots) {
        lines.push('  ' + formatSlotLine(label, reason));
    }
    lines.push('Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.');
    return lines.join('\n');
}
```

### Pattern 2: Sync findJdtLs body shape

**What:** Sequential candidate probe with early return on first match; otherwise accumulate skip records and synthesize multi-line failure.

**Example (Phase 38 skeleton):**
```typescript
// imports
import { existsSync } from 'node:fs';
import { globSync } from 'glob';
import { jdtlsCandidateDirs } from '../platform/index.js';
import { logger } from '../logging/logger.js';

const LAUNCHER_GLOB = 'plugins/org.eclipse.equinox.launcher_*.jar';

export function findJdtLs(): JdtLsFindResult {
    const slots: SlotRecord[] = [];

    // Slot 1: JDTLS_HOME (D-06: same depth as candidates; D-07: NO fallthrough on failure)
    const envHome = process.env.JDTLS_HOME;
    if (envHome) {
        if (!existsSync(envHome)) {
            return {
                jdtlsHome: null,
                error: `JDTLS_HOME is set to "${envHome}" but the directory does not exist.`,
            };
        }
        const jars = globSync(LAUNCHER_GLOB, { cwd: envHome, absolute: true });
        if (jars.length === 0) {
            return {
                jdtlsHome: null,
                error: `JDTLS_HOME is set to "${envHome}" but no JDT LS launcher jar was found in plugins/.`,
            };
        }
        return { jdtlsHome: envHome };
    }
    slots.push({ label: 'JDTLS_HOME', reason: { kind: 'not-set' } });

    // Slot 2..N: jdtlsCandidateDirs() probed in order
    for (const dir of jdtlsCandidateDirs()) {
        if (!existsSync(dir)) {
            logger.debug('JDT LS candidate skipped', { candidate: dir, reason: 'directory does not exist' });
            slots.push({ label: dir, reason: { kind: 'directory does not exist' } });
            continue;
        }
        const jars = globSync(LAUNCHER_GLOB, { cwd: dir, absolute: true });
        if (jars.length === 0) {
            logger.debug('JDT LS candidate skipped', { candidate: dir, reason: 'exists but no launcher jar in plugins/' });
            slots.push({ label: dir, reason: { kind: 'exists but no launcher jar in plugins/' } });
            continue;
        }
        return { jdtlsHome: dir };
    }

    return { jdtlsHome: null, error: composeFailureReason(slots) };
}
```

### Pattern 3: Platform-mocking test (Phase 35 carry-forward)

**What:** `setPlatform + vi.resetModules + dynamic import` — flip `process.platform`, reset module cache, dynamically re-import so `isWindows` (a module-load-time const) re-evaluates.

**When to use:** Any test that needs to assert findJdtLs behavior on a specific platform when running on a different CI host.

**Example (verbatim from `tests/platform/index.test.ts:24-30` and `tests/jdtls/client.test.ts:179-189`):**
```typescript
// Source: tests/platform/index.test.ts:13-21 (verified by Read)
function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
    setPlatform(originalPlatform);
    process.env = { ...originalEnv };
    vi.resetModules();
});

it('Windows: ...', async () => {
    setPlatform('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    process.env.ProgramFiles = 'C:\\Program Files';
    vi.resetModules();
    const { findJdtLs } = await import('../../src/jdtls/client.js');
    // ... assertions
});
```

### Pattern 4: Mocking `globSync` and `node:fs.existsSync`

**What:** `vi.mock(module, async () => ({ ...await vi.importActual(module), namedExport: vi.fn() }))` — the codebase's canonical "mock one named export, preserve the rest" idiom.

**Example (existing `vi.mock('node:fs')` at `tests/jdtls/client.test.ts:14-20`):**
```typescript
// Source: tests/jdtls/client.test.ts:14-20 (verified by Read)
vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
    };
});

// New for Phase 38 — same shape:
vi.mock('glob', async () => {
    const actual = await vi.importActual<typeof import('glob')>('glob');
    return {
        ...actual,
        globSync: vi.fn(),
    };
});
```

### Anti-Patterns to Avoid

- **Duplicating the candidate enumeration in `findJdtLs`** — CONTEXT mandates consuming `jdtlsCandidateDirs()`. Re-listing the 4 Windows paths or 3 Unix paths inline reintroduces the v1.5 hardcoded-literal pattern Phase 35 eliminated.
- **Falling through to candidate probing when JDTLS_HOME is set but invalid** — CONTEXT D-07 explicitly requires fail-fast. An explicit override that's wrong is a user-config bug; a silent fallback masks it.
- **`async` migration without need** — `findJdtLs` is currently sync; CONTEXT D-Discretion recommends staying sync via `globSync`. `glob@^13` exports `globSync` (`[VERIFIED]`). The only async caller is already `await`-ing `initJdtLsSession`, so the ripple would still be a one-token edit, but the discretion-default is sync — preserve it.
- **Changing the `JdtLsNotFound` envelope shape** — `{ jdtlsHome: null; error: string }` (client.ts:30-33) stays. Only the `error` content becomes multi-line. CONTEXT "Code Context" §"Reusable Assets" explicitly forbids envelope changes.
- **Removing the `await glob(...)` inside `startJdtLs` at client.ts:97-100** — CONTEXT "Integration Points" notes this is redundant after Phase 38 but is cheap defense-in-depth. Planner may delete it OR leave it; do not list deletion as a hard requirement.
- **Re-importing `glob` as `globSync`** — keep the existing `import { glob } from 'glob'` at client.ts:20 (still used by `startJdtLs:97`) and ADD `globSync` to the same import statement: `import { glob, globSync } from 'glob'`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Candidate-directory list per platform | Inline literal arrays in `findJdtLs` | `jdtlsCandidateDirs()` from `src/platform/index.ts` | Phase 35 already owns this with verified tests at `tests/platform/index.test.ts:94-134` — re-implementation duplicates ordering bugs |
| Launcher-jar pattern match | Manual `readdir` + regex on entry name | `globSync('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: dir, absolute: true })` | Already used at `client.ts:97` (async sibling) for the same purpose inside `startJdtLs`; one-liner; reuses existing dep |
| Cross-platform home directory | `process.env.HOME ?? process.env.USERPROFILE ?? ''` | `homedir()` from `node:os` | Documented to use `USERPROFILE` on Windows (`[CITED: https://nodejs.org/api/os.html#oshomedir]`); always returns a value (never `''`); already the project idiom in 5 other files (CONTEXT D-10) |
| Multi-line failure-message formatter | Ad-hoc `+ '\n'` concatenation | Mirror `java-discovery.ts:438-487` formatSlotLine/formatReason structure | Phase 37 already solved this exact composition problem with a tested precedent; deviating would create inconsistent diagnostic UX between Java-not-found and JDT-LS-not-found |
| CI grep gate for `process.env.HOME` | Pre-commit shell hook | Vitest test reading `src/**/*.ts` with `readdir` recursive + string match | Lives in the same test runner everything else uses; runs in CI on every push; no shell-portability concerns |

**Key insight:** Phase 38 is almost entirely composition of pre-existing primitives. The only "new" logic is the failure-message composer, and even that is a structural copy of Phase 37's tested implementation. The implementation surface is ~50 lines of TS + ~150 lines of tests; any line count higher than that suggests the planner is re-implementing something Phase 35 or Phase 37 already owns.

## Runtime State Inventory

Not applicable. Phase 38 is a pure code refactor:
- **Stored data:** None — `findJdtLs` is stateless
- **Live service config:** None — no external service touches JDT LS discovery
- **OS-registered state:** None — no OS-level registrations created or modified
- **Secrets and env vars:** `JDTLS_HOME` env var **read-only** consumption pattern unchanged in semantics; `process.env.HOME` removed from `src/`. No env var names renamed; users who set `JDTLS_HOME` continue to have it honored.
- **Build artifacts:** None — no generated files, no compiled outputs depend on the function name or signature

## Common Pitfalls

### Pitfall 1: Cross-host test glob behavior
**What goes wrong:** `globSync` running on the host's real fs even when paths look Windows-shaped, because the path strings are Windows-flavor but the test machine is macOS/Linux.
**Why it happens:** `globSync` does real fs I/O when not mocked; Windows-flavor paths like `'C:\\Users\\test\\AppData\\Local\\jdtls'` don't exist on the test machine, so probes silently return empty.
**How to avoid:** Mock `globSync` via `vi.mock('glob', …)` and feed canned results per-test. Same pattern as the existing `vi.mock('node:fs')` block at `tests/jdtls/client.test.ts:14-20`.
**Warning signs:** A Windows-mocked test that "should find" a candidate returns the `JDT LS not found` error message instead — fs lookup hit the real macOS/Linux filesystem.

### Pitfall 2: `vi.mock` hoisting interaction with dynamic import
**What goes wrong:** A `vi.mock` declaration at the top of the file is hoisted, but module state (e.g., `process.env`, `process.platform`) read at module-evaluation time captures the value at *first import*, not at re-import after `vi.resetModules()`.
**Why it happens:** The Phase 35 pattern works because `isWindows` is captured at module-load time and `vi.resetModules()` forces re-evaluation. But mocks declared with `vi.mock` are also tied to module instances — if `vi.resetModules()` clears the cache, the next dynamic `import('glob')` may re-evaluate the mock factory.
**How to avoid:** Confirm in each Windows-mocked test that `vi.mocked(globSync).mockReset()` runs in `beforeEach`, and `mockReturnValue([...])` runs before the dynamic `import('../../src/jdtls/client.js')`. The existing `tests/jdtls/client.test.ts:182-203` Windows describe demonstrates this ordering correctly.
**Warning signs:** Mock state bleeds between tests; assertions on `mockGlobSync` call count are wrong by one.

### Pitfall 3: Forgetting that the JDTLS_HOME-set-and-valid path returns BEFORE the multi-line composer
**What goes wrong:** Tests assert multi-line format for a case where JDTLS_HOME points to a valid dir; assertion fails because the function correctly short-circuited with `{ jdtlsHome }`.
**Why it happens:** Test-writer thinks "JDTLS_HOME is in every multi-line message" — but the multi-line message is only synthesized when EVERY slot fails. A valid JDTLS_HOME returns immediately.
**How to avoid:** Structure tests by outcome category, not by env-var presence. Four categories: (a) JDTLS_HOME unset, all candidates fail → multi-line, (b) JDTLS_HOME set + dir-missing → specific terse error, (c) JDTLS_HOME set + dir-present-but-empty → specific terse error, (d) any slot succeeds → `{ jdtlsHome }`.
**Warning signs:** Test name includes "multi-line" AND `JDTLS_HOME=/some/valid/path`.

### Pitfall 4: Path-flavor mismatch between `jdtlsCandidateDirs()` and `globSync({ cwd })`
**What goes wrong:** Windows test feeds `globSync` a `path.win32`-shaped cwd like `'C:\\Users\\test\\AppData\\Local\\jdtls'`; `glob` (which is POSIX-oriented for patterns) gets confused.
**Why it happens:** `globSync` accepts a `cwd` option that's passed to fs operations as-is — but the pattern itself (`'plugins/org.eclipse.equinox.launcher_*.jar'`) is always forward-slash. On real Windows this works. On a macOS host running a Windows-mocked test, the cwd is a non-existent fake Windows path, so `globSync` returns `[]` regardless of mock state — unless `globSync` itself is mocked.
**How to avoid:** Always mock `globSync` in Windows-mocked tests; never let it hit real fs with a faked Windows cwd.
**Warning signs:** Windows test expects "found a candidate" but the function returns `JDT LS not found`. Check whether `globSync` is mocked.

### Pitfall 5: The grep regression test matching its own source
**What goes wrong:** `tests/no-process-env-home.test.ts` greps `src/**/*.ts` for `/process\.env\.HOME\b/` and fails — because the test FILE contains the literal string `process.env.HOME` (in the regex).
**Why it happens:** Test is scoped to `src/` but author later moves it under `src/` accidentally, OR the regex is defined as a string `'process.env.HOME'` somewhere in `src/` (e.g., a comment).
**How to avoid:** Scope strictly to `src/**/*.ts`; reject any matches. The test file itself lives at `tests/no-process-env-home.test.ts` (outside `src/`). Confirm `tests/` is NOT recursively scanned. Use the regex `/process\.env\.HOME\b/` with a word boundary so `process.env.HOMEDIR` (hypothetical future env var) doesn't false-positive.
**Warning signs:** Grep test fails with a match in `src/jdtls/client.ts` AFTER Phase 38 — the rewrite didn't actually remove the line at client.ts:63.

### Pitfall 6: Asserting on exact `globSync` arguments
**What goes wrong:** Test asserts `mockGlobSync.toHaveBeenCalledWith('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: expected, absolute: true })`. The implementation passes additional options (e.g., `nodir: true`) and the test fails.
**Why it happens:** Over-specific assertion couples test to implementation detail. The contract is "the glob is performed for each existing candidate"; the exact option set is not the contract.
**How to avoid:** Assert the call count and the `cwd` argument only: `expect(mockGlobSync.mock.calls[0][1].cwd).toBe(...)`.

## Code Examples

### Verified Phase 37 `formatSlotLine` (structural model for Phase 38)

```typescript
// Source: src/jdtls/java-discovery.ts:452-476 (verified by Read)
function formatSlotLine(label: string, outcome: CandidateOutcome, projectRoot: string | undefined): string {
    if (label === '--java-home') {
        if (outcome.kind === 'not-set') return '--java-home: (not set)';
        return '--java-home ' + (configuredJavaHome ?? '') + ': ' + formatReason(outcome);
    }
    if (label === 'JAVA_HOME') {
        if (outcome.kind === 'not-set') return 'JAVA_HOME: (not set)';
        const v = process.env.JAVA_HOME ?? '';
        return 'JAVA_HOME=' + v + ': ' + formatReason(outcome);
    }
    // ... other slots ...
    // Scan slot: label is a bare absolute path
    return label + ': ' + formatReason(outcome);
}

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

### Existing `findJdtLs` (the rewrite target — lines 47-80, verbatim)

```typescript
// Source: src/jdtls/client.ts:47-80 (verified by Read)
/**
 * Find the JDT LS installation directory.
 *
 * Checks JDTLS_HOME first, then common install locations.
 */
export function findJdtLs(): JdtLsFindResult {
    if (process.env.JDTLS_HOME) {
        if (existsSync(process.env.JDTLS_HOME)) {
            return { jdtlsHome: process.env.JDTLS_HOME };
        }
        return {
            jdtlsHome: null,
            error: `JDTLS_HOME is set to "${process.env.JDTLS_HOME}" but the directory does not exist.`,
        };
    }

    const home = process.env.HOME ?? '';
    const commonLocations = [
        join(home, '.local', 'share', 'jdtls'),
        '/usr/local/share/jdtls',
        join(home, 'jdtls'),
    ];

    for (const loc of commonLocations) {
        if (existsSync(loc)) {
            return { jdtlsHome: loc };
        }
    }

    return {
        jdtlsHome: null,
        error: 'JDT LS not found. Set JDTLS_HOME environment variable. Download from https://download.eclipse.org/jdtls/milestones/',
    };
}
```

### Verified `jdtlsCandidateDirs()` (Phase 35 — the source of truth)

```typescript
// Source: src/platform/index.ts:70-87 (verified by Read)
export function jdtlsCandidateDirs(): string[] {
    const home = homedir();
    if (isWindows) {
        const localAppData = process.env.LOCALAPPDATA ?? pathWin32.join(home, 'AppData', 'Local');
        const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
        return [
            pathWin32.join(localAppData, 'jdtls'),
            pathWin32.join(programFiles, 'jdtls'),
            pathWin32.join(home, 'jdtls'),
            pathWin32.join(localAppData, 'nvim-data', 'mason', 'packages', 'jdtls'),
        ];
    }
    return [
        pathPosix.join(home, '.local', 'share', 'jdtls'),
        '/usr/local/share/jdtls',
        pathPosix.join(home, 'jdtls'),
    ];
}
```

Confirms CONTEXT D-Locked items: 4-path Windows order ([LOCALAPPDATA → ProgramFiles → home → mason]), 3-path Unix order ([.local/share → /usr/local/share → ~/jdtls]). Phase 38 must NOT re-derive this list; consumption only.

### Grep regression test skeleton (D-09)

```typescript
// New file: tests/no-process-env-home.test.ts
import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

Walks `src/` (NOT `tests/`), reads each `.ts` file once, asserts the offending pattern is absent. ~20 lines. Runs in <50ms on the project's current file count.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `process.env.HOME ?? ''` inline at consumer site | `os.homedir()` from `node:os` | Project-wide: Phases 35-37 already use `homedir()`; client.ts:63 is the lone holdout (CONTEXT D-10) | Cross-platform correctness on Windows (`HOME` is typically unset there); empty-string fallback eliminated |
| Hardcoded candidate list inline in `findJdtLs` | `jdtlsCandidateDirs()` consumption | Phase 35 (shipped); Phase 38 is the consumer-side wiring | Windows support; testability; one canonical source for the list |
| `existsSync(dir)` only (v1.5) | `existsSync(dir) && globSync(launcher) > 0` | Phase 38 (D-01) | Catches the empty-dir shadow case (stale `~/jdtls/` shadowing `/usr/local/share/jdtls/`); fails fast with a clear diagnostic instead of erroring late in `startJdtLs:97` |
| Single-line "JDT LS not found. Set JDTLS_HOME environment variable. Download from …" | Multi-line `Java not found.` / `JDT LS not found.`-prefixed, per-slot rationale | Phase 37 introduced for Java; Phase 38 mirrors for JDT LS | Diagnostic actionability — user sees exactly which paths were probed and why each was rejected |
| Sync `glob.sync()` (legacy glob v7-8 API) | `globSync` named export | glob v9+ (project on v13) | API only; no behavior change |

**Deprecated/outdated:**
- `glob.sync()` function-property syntax — replaced by `globSync` named export in glob ≥ v9. (`[VERIFIED: node -e check]`) The project is on `glob@^13.0.6`, so the named-export form is canonical.
- `process.env.HOME ?? ''` defensive fallback — `os.homedir()` always returns a non-empty string per the Node docs (`[CITED: https://nodejs.org/api/os.html#oshomedir]`). The `?? ''` was a v1.5-era guard that's no longer needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `globSync` returns `string[]` (not a different shape) when `absolute: true` is passed | Pattern 2 skeleton, Pitfall 6 | LOW — verified by glob package convention; `.length > 0` check is shape-agnostic anyway |
| A2 | The 4 existing test assertions (`toContain('JDT LS not found')` ×2, `toContain('JDTLS_HOME')`, `toContain('does not exist')`) all remain satisfied under the new multi-line format | Summary, Validation Architecture | LOW — verified by inspection: new format preserves all four substrings. Planner should re-confirm before merging |
| A3 | `findJdtLs` has exactly 2 real callers (`src/jdtls/startup.ts:56` plus tests) | Summary, Architectural Responsibility Map | NONE — `[VERIFIED: grep -rn "findJdtLs" src/ tests/]` returns exactly the documented sites |

All other claims are `[VERIFIED]` or `[CITED]`. The 3 assumptions above are low-risk and self-checking at implementation time.

## Open Questions (RESOLVED)

All three are planner-discretion items per CONTEXT.md "Claude's Discretion" — none are blocking gates.

1. **Should `startJdtLs:97`'s redundant `await glob(...)` for the launcher jar be deleted?**
   - What we know: After Phase 38, every code path that calls `startJdtLs` will have already proven a launcher jar exists in `jdtlsHome/plugins/`. The check at `startJdtLs:97-104` becomes defensive duplication.
   - What's unclear: CONTEXT "Integration Points" says "cheap and serves as a defense-in-depth check; planner may leave it or delete it." This is genuinely planner-discretion.
   - RESOLVED: **Leave it.** Defense-in-depth for a sub-ms cost is fine, and removing it widens the diff for no functional gain. Document the redundancy in the new `findJdtLs` JSDoc and call it day.

2. **Where should the `composeFailureReason` helper live — top-level in `client.ts` or a private function?**
   - What we know: Phase 37's `formatSlotLine` / `formatReason` are private (non-exported) module-internal helpers in `java-discovery.ts`.
   - What's unclear: No external consumer needs the composer; testing it via `findJdtLs`'s observable output is sufficient.
   - RESOLVED: **Private function inside `client.ts`.** Match Phase 37's privacy boundary. No new exports.

3. **Should the test asserting "JDTLS_HOME line appears in multi-line message" check the line content verbatim or just `toContain('JDTLS_HOME')`?**
   - What we know: Phase 37's `tests/jdtls/java-discovery.test.ts` does both — exact-line matches for the format contract, plus substring checks for the "first line prefix" stability invariant.
   - What's unclear: Phase 38 D-02 specifies the literal format `JDTLS_HOME: (not set)` for the unset case, so exact-match is plausible.
   - RESOLVED: **Mix.** Use exact-line matching for the unset-JDTLS_HOME case (one canonical string) and `toContain(...)` for cases where JDTLS_HOME's value contains test-instance-specific paths.

## Environment Availability

Phase 38 is code-only. The only "environments" relevant:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `glob` package | `globSync` import in `findJdtLs` | ✓ | 13.0.6 (`[VERIFIED]`) | None needed |
| Node `node:os` `homedir()` | `os.homedir()` call (regression test ensures usage in `src/`) | ✓ | Node 22 LTS | None needed |
| Node `node:fs` `existsSync` | candidate-dir probe | ✓ | Node 22 LTS | None needed |
| vitest | test runner | ✓ | 4.1.4 (`[VERIFIED]`) | None needed |
| pnpm | package manager | ✓ | per project | None needed |

No external services, JDT LS installs, or Windows machines are needed for Phase 38 implementation or testing — all Windows behavior is asserted via mocking. Real-Windows validation is Phase 39's job (per ROADMAP).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest ^4.1.4` |
| Config file | `vitest.config.ts` (project root — verified by `pnpm test` script reference) |
| Quick run command | `pnpm test tests/jdtls/client.test.ts tests/no-process-env-home.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIN-02 (a) | `findJdtLs` probes 4 Windows candidate paths in fixed order | unit (Windows-mocked) | `pnpm test tests/jdtls/client.test.ts -t "Windows"` | ❌ Wave 0 — add new `describe` in client.test.ts |
| WIN-02 (b) | First-match-wins semantics (existing dir + launcher jar → return immediately) | unit (Windows + Unix mocked) | `pnpm test tests/jdtls/client.test.ts -t "first match"` | ❌ Wave 0 |
| WIN-02 (c) | Empty-dir shadow case skipped; lower-priority candidate wins | unit (Windows-mocked) | `pnpm test tests/jdtls/client.test.ts -t "shadow"` | ❌ Wave 0 |
| WIN-02 (d) | JDTLS_HOME continues to win when set + valid | unit | `pnpm test tests/jdtls/client.test.ts -t "JDTLS_HOME"` | ⚠️ Partial — existing test at client.test.ts:140 covers happy path, needs new sad-path branches |
| WIN-02 (e) | JDTLS_HOME-set-but-dir-missing returns specific error, NO fallthrough | unit | `pnpm test tests/jdtls/client.test.ts -t "JDTLS_HOME.*nonexistent"` | ⚠️ Partial — client.test.ts:148 already asserts this for the dir-missing case |
| WIN-02 (f) | JDTLS_HOME-set-but-no-launcher-jar returns specific error, NO fallthrough | unit | `pnpm test tests/jdtls/client.test.ts -t "JDTLS_HOME.*launcher"` | ❌ Wave 0 — new branch |
| WIN-02 (g) | Multi-line failure-message format (first line `JDT LS not found.`, per-candidate lines, trailing install hint) | unit (all-fail mocked) | `pnpm test tests/jdtls/client.test.ts -t "multi-line"` | ❌ Wave 0 |
| WIN-02 (h) | Unix candidate ordering byte-identical to v1.5 (UNIX-01 regression) | unit (Linux/Darwin mocked) | `pnpm test tests/jdtls/client.test.ts -t "Unix"` | ❌ Wave 0 — add new `describe` |
| WIN-02 (i) | `process.env.HOME` grep gate (`src/**/*.ts` returns no matches) | unit (fs scan) | `pnpm test tests/no-process-env-home.test.ts` | ❌ Wave 0 — new file |
| WIN-02 (j) | `logger.debug` called per-skip with `{ candidate, reason }` shape (D-05) | unit (mocked logger or spy) | `pnpm test tests/jdtls/client.test.ts -t "logger"` | ❌ Wave 0 — optional but D-05 mandates the logging behavior |
| UNIX-01 (carry-over) | All existing v1.5 tests pass unchanged after rewrite | full suite | `pnpm test` | ✅ Existing — no change needed; rerun |
| UNIX-03 (carry-over) | Full v1.5 + v1.6 suite green | full suite | `pnpm test` | ✅ Existing |

### Sampling Rate

- **Per task commit:** `pnpm test tests/jdtls/client.test.ts tests/no-process-env-home.test.ts` (quick, ~1-2s after install)
- **Per wave merge:** `pnpm test tests/jdtls/ tests/platform/ tests/no-process-env-home.test.ts` (broader, ~3-5s)
- **Phase gate:** `pnpm test` (full suite green before `/gsd:verify-work`)

### Wave 0 Gaps

- [ ] `tests/jdtls/client.test.ts` — extend existing `describe('findJdtLs', …)` (lines 133-166) with:
    - New `describe('findJdtLs on Windows', …)` block using `setPlatform('win32') + vi.resetModules + dynamic import + vi.mock('node:fs') + vi.mock('glob')` — covers WIN-02 (a)..(g), (j)
    - New `describe('findJdtLs on Unix (UNIX-01 regression)', …)` block — covers WIN-02 (h)
    - Extend the existing JDTLS_HOME test (line 148) to also cover the new launcher-jar-missing branch — covers WIN-02 (f)
- [ ] `tests/no-process-env-home.test.ts` — NEW file with the recursive `src/`-walk + regex check
- [ ] `vi.mock('glob', …)` declaration at the top of `client.test.ts` (mirroring the existing `vi.mock('node:fs')` shape at lines 14-20)
- [ ] No framework install needed — vitest already present at `^4.1.4`

## Project Constraints (from CLAUDE.md)

These constraints come from `./CLAUDE.md` and have the same authority as locked CONTEXT decisions:

| Constraint | Source | Enforcement in Phase 38 |
|------------|--------|------------------------|
| Tab indentation in all source files (not spaces) | CLAUDE.md "Conventions" | All new code in `client.ts`, `client.test.ts`, `no-process-env-home.test.ts` MUST use tabs; lift verbatim from existing files in `src/jdtls/` |
| Strongly typed: precise types on all interfaces | CLAUDE.md "Constraints" | `composeFailureReason(slots: SlotRecord[]): string`, `SkipReason` discriminated union, all per-slot helpers fully annotated |
| No nested JSON strings in MCP tool text responses | CLAUDE.md "Conventions" | N/A — `findJdtLs` returns a plain object that flows through the existing `JdtLsNotFound` envelope; no tool-response formatting changes |
| Tool response envelope `{ ok, ... }` | CLAUDE.md "Conventions" | N/A — `JdtLsFindResult` is an internal type at `client.ts:30-33`, unrelated to MCP tool envelopes. No envelope changes |
| Domain logic in `src/jdtls/` | CLAUDE.md "Architecture" | `composeFailureReason` and the rewritten `findJdtLs` body live in `src/jdtls/client.ts` — correct layer |
| Tests use vitest, located alongside source or in `tests/` directory | CLAUDE.md "Conventions" | New tests in `tests/jdtls/client.test.ts` (alongside existing) and `tests/no-process-env-home.test.ts` (top-level for cross-cutting CI gate) |
| GSD Workflow Enforcement: file changes go through GSD commands | CLAUDE.md "GSD Workflow Enforcement" | Phase 38 IS the GSD workflow — implementer will be `gsd-implementer` spawned by `/gsd:execute-phase` |
| MEMORY: VCS is git (NOT jj for this project) | `~/.claude/projects/.../MEMORY.md` (user memory) | Plans use git commands, not jj — overrides the global "use jj" rule for this repo |
| MEMORY: GNU sed on macOS — use `-i` not `-i ''` | user memory | Any planner shell snippets that use `sed -i` should drop the `''` quirk |

## Sources

### Primary (HIGH confidence)

- `[VERIFIED: Read]` `.planning/phases/38-jdt-ls-discovery-on-windows/38-CONTEXT.md` — full D-01..D-10 + canonical refs (the locked spec)
- `[VERIFIED: Read]` `src/jdtls/client.ts` (current) — confirms `findJdtLs` shape at lines 47-80, `JdtLsNotFound` envelope at 30-33, existing imports
- `[VERIFIED: Read]` `src/platform/index.ts` — confirms `jdtlsCandidateDirs()` returns 4-Windows / 3-Unix path lists per CONTEXT
- `[VERIFIED: Read]` `src/jdtls/java-discovery.ts` lines 438-487 — the Phase 37 `formatSlotLine`/`formatReason` pattern Phase 38 mirrors
- `[VERIFIED: Read]` `src/jdtls/startup.ts` lines 1-100 — confirms `findJdtLs()` call site at line 56 is inside an `async` function (zero-ripple if Phase 38 stays sync; one-token edit if async)
- `[VERIFIED: Read]` `tests/jdtls/client.test.ts` — existing `findJdtLs` describes at 133-166, `setPlatform` helper at 27-32, Windows-mocked describes for `resolveJavaExecutable` at 176-233 (templates for Phase 38 tests)
- `[VERIFIED: Read]` `tests/jdtls/startup.test.ts` lines 110-127 — assertion `toContain('JDT LS not found')` at line 124; confirmed Phase 38's multi-line format preserves this
- `[VERIFIED: Read]` `tests/platform/index.test.ts` — `jdtlsCandidateDirs` test coverage at lines 94-134 (Phase 35 already validates the ordering Phase 38 consumes)
- `[VERIFIED: Bash node -e]` `glob` package exports include `globSync` (and `streamSync`, `iterateSync`, `sync`, `globStreamSync`, `globIterateSync`); installed version `^13.0.6` per package.json
- `[VERIFIED: Bash grep]` `findJdtLs` has exactly 2 src/ callers (`client.ts:52` definition, `startup.ts:19,56` import+call) and 5 test references (4 invocations in `client.test.ts`, 1 mock in `startup.test.ts`)
- `[VERIFIED: Bash grep]` `process.env.HOME` appears exactly once in `src/`, at `src/jdtls/client.ts:63` — confirms CONTEXT D-08's "one-line replacement" claim
- `[VERIFIED: Read]` `src/logging/logger.ts` — `logger.debug(msg, data?)` method exists with `(string, unknown?)` signature, matching D-05's `logger.debug('JDT LS candidate skipped', { candidate, reason })` shape

### Secondary (MEDIUM confidence)

- `[CITED]` `https://nodejs.org/api/os.html#oshomedir` — `os.homedir()` uses `USERPROFILE` on Windows, password-entry on Unix; always returns a non-empty string
- `[CITED]` CONTEXT.md "External specs" — Eclipse JDT LS install layout, Mason.nvim layout, glob package globSync, Node os.homedir docs — these are inlined in CONTEXT and re-cited here for completeness

### Tertiary (LOW confidence)

None. Every claim in this research is traceable to either a verified file read, a verified Bash command, or an inlined CONTEXT.md citation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency verified present at the claimed version via direct package.json grep + node -e probe
- Architecture: HIGH — pattern is a structural copy of shipped Phase 37 code (verified by direct Read of java-discovery.ts:438-487)
- Pitfalls: HIGH — derived from direct inspection of test files and known mocking semantics, not speculation
- Validation Architecture: HIGH — test framework verified, file layout verified, assertions inventoried

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days — stack is stable, no fast-moving deps)
