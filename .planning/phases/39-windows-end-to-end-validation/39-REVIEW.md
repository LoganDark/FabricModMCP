---
phase: 39-windows-end-to-end-validation
reviewed: 2026-05-24T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/jdtls/uri-mapper.ts
  - tests/jdtls/uri-mapper.test.ts
  - docs/WINDOWS-SUPPORT.md
  - scripts/jdtls-trace.ts
  - scripts/matrix-runner.ts
  - scripts/matrix-row.ts
  - scripts/check-uri.mjs
findings:
  critical: 2
  warning: 6
  info: 5
  total: 13
status: issues_found
---

# Phase 39: Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

The core production change (`src/jdtls/uri-mapper.ts` 8.3 short-name canonicalization) is small, well-documented, and the test that protects against the JDT LS Location.uri shape mismatch on Windows looks sound. Two real bugs surfaced in the diagnostic tooling:

1. `scripts/matrix-row.ts` is **dead on arrival** — `readFileSync` is statically imported at line 18 and then re-declared via dynamic import at line 99, which causes `SyntaxError: Identifier 'readFileSync' has already been declared` at load time. I confirmed by attempting to load the module: it never reaches `main`. The script that was claimed to drive the 4-row matrix cannot have run in its current form.
2. The trailing-separator normalization in `uri-mapper.ts:115` strips only forward slashes, but on Windows `realpathSync.native` returns paths using backslashes. A `tempDir` of `'C:\\Users\\test\\Temp\\xyz\\'` (a trailing backslash) survives untouched, then gets URI-encoded with the trailing separator embedded into the prefix.

The production fix in `uri-mapper.ts` is otherwise solid. The diagnostic scripts have several quality issues (leaked timers, broad PATH filtering, hardcoded personal paths, swallowed errors) that are tolerable for one-off maintainer tooling but are worth recording so the next reviewer or rewriter knows what landmines are buried.

The `WINDOWS-SUPPORT.md` doc is accurate and consistent with the in-tree priority chains; no defects there beyond a couple of small Markdown-rendering quirks called out below.

---

## Critical Issues

### CR-01: `scripts/matrix-row.ts` cannot execute — duplicate `readFileSync` declaration **[BLOCKER]**

**File:** `scripts/matrix-row.ts:18` and `scripts/matrix-row.ts:99`
**Issue:**
Line 18 statically imports `readFileSync` from `node:fs`:
```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
```
Line 99 redeclares `readFileSync` via a top-level dynamic import:
```ts
const { readFileSync } = await import('node:fs');
const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as RowConfig;
```
Both declarations live at the same module scope. I confirmed empirically by attempting to load the file via `node`:
```
ERR: Identifier 'readFileSync' has already been declared
```
The script throws a `SyntaxError` at parse/link time and never reaches `main`. Whatever the Plan 04 matrix run *actually* executed, it was not this file as-shipped. Because `tsconfig.json` excludes `scripts/**`, `tsc --noEmit` does not catch this; the bug is invisible to CI but fatal at runtime.

**Fix:** Delete the dynamic import at line 99 (the static one at line 18 already provides `readFileSync`):
```ts
// REMOVE line 99:
// const { readFileSync } = await import('node:fs');
const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as RowConfig;
```
Consider adding `scripts/**` to a secondary tsconfig (or to `include`) so future redeclaration / type errors in maintainer tooling are caught by CI.

---

### CR-02: Trailing-backslash `tempDir` on Windows bypasses normalization, leaks separator into prefix **[BLOCKER]**

**File:** `src/jdtls/uri-mapper.ts:115`
**Issue:**
```ts
const normalizedTempDir = canonicalTempDir.replace(/\/+$/, '');
```
This regex only strips trailing **forward** slashes. On Windows, `realpathSync.native('C:\\foo\\')` returns `'C:\\foo\\'` (backslashes), or even if it normalizes the trailing slash, any caller that synthesizes a `tempDir` ending in `\\` (e.g., a future helper that joins with `path.win32.join` and accidentally leaves a separator) will survive this strip untouched. The result is fed to `pathToFileUri`, producing a prefix like `file:///C:/foo//` with a double-slash, which then breaks both:

- `toFileUri` — emits `file:///C:/foo//<dirname>/<entry>` with a double slash that JDT LS won't reproduce on the wire.
- `fromFileUri` — the `prefixMatches` check fails against the JDT LS-returned single-slash URI, returning `null` (the exact symptom the 8.3 fix was meant to eliminate).

The test at line 129–133 covers the Unix forward-slash case (`'/tmp/jdtls-test/'`) but there is no Windows-mocked test for `'C:\\Users\\test\\Temp\\xyz\\'`.

**Fix:** Strip both forward and back slashes on Windows; do it after canonicalization so any host-native separator is handled:
```ts
const normalizedTempDir = canonicalTempDir.replace(/[\\/]+$/, '');
```
Then add a regression test under the Windows describe blocks:
```ts
it('handles tempDir with trailing backslash on Windows', async () => {
    setPlatform('win32');
    vi.resetModules();
    const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
    const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz\\', new Map([['mc', 'mc']]));
    expect(mapper.toFileUri('mc', 'foo/Bar.java'))
        .toBe('file:///C:/Users/test/Temp/xyz/mc/foo/Bar.java');
});
```

---

## Warnings

### WR-01: Silent fallback when `realpathSync.native` throws can mask the very bug the canonicalization was added to fix

**File:** `src/jdtls/uri-mapper.ts:107-114`
**Issue:**
```ts
try {
    canonicalTempDir = realpathSync.native(tempDir);
} catch {
    canonicalTempDir = tempDir;
}
```
The empty catch swallows every error class — permission denied, EIO, ELOOP, EACCES — and silently falls back to the uncanonicalized path. On a Windows host where the *correct* canonicalization would have produced the long-name form, a transient EACCES (antivirus scanner holding a handle, common on Windows during workspace extraction) produces the same JDT LS prefix mismatch the fix was designed to prevent, with **no diagnostic signal** to the operator. The mapper just silently returns `null` for every URI for the lifetime of the session.

The comment claims "shouldn't happen in production but unit tests sometimes pass synthetic paths" — but the production path is exactly the path where this matters, and unit tests should mock `realpathSync.native` rather than rely on a silent fallback in production code.

**Fix:** Discriminate on error code; rethrow unexpected errors, fall back only on ENOENT (which is the unit-test case):
```ts
try {
    canonicalTempDir = realpathSync.native(tempDir);
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`uri-mapper: realpath failed for ${tempDir}: ${String(err)} — JDT LS replies may mismatch the prefix and fromFileUri may return null for every URI`);
    }
    canonicalTempDir = tempDir;
}
```
At minimum, log the failure at warn level so the operator sees a breadcrumb when `find_definition` mysteriously returns empty.

---

### WR-02: `Promise.race` against `sleep(30_000)` leaks the timer when definition wins

**File:** `scripts/matrix-runner.ts:209-215`
**Issue:**
```ts
const defResult = await Promise.race([
    session.client.definition({ ... }),
    sleep(30_000).then(() => 'TIMEOUT' as const),
]);
```
`setTimeout` from `node:timers/promises` produces a `Promise` whose underlying timer remains active for the full 30 s even after the race resolves. The process now stays alive 30 s longer than expected per row (4 rows × 30 s = up to 2 min of zombie timer time), and the `'TIMEOUT'` resolution still fires after the row has moved on, potentially confusing later code that observes process state. For a one-shot script this is annoying rather than fatal, but the leak makes "did the matrix run wedge or is it a leaked timer" hard to tell from the outside.

**Fix:** Use an `AbortController` so the timer is cancelable, or use `unref` on the underlying timer:
```ts
const ac = new AbortController();
try {
    const defResult = await Promise.race([
        session.client.definition({ ... }),
        sleep(30_000, undefined, { signal: ac.signal }).then(() => 'TIMEOUT' as const).catch(() => 'TIMEOUT' as const),
    ]);
    ac.abort();
    // ...
} finally {
    ac.abort();
}
```

---

### WR-03: `clearJavaFromPath` filters by case-insensitive substring "java" — too aggressive

**File:** `scripts/matrix-runner.ts:83-87`
**Issue:**
```ts
function clearJavaFromPath(): void {
    const filtered = ORIG_PATH.split(';').filter(p => !p.toLowerCase().includes('java')).join(';');
    ...
}
```
This filters out **any** PATH entry whose lowercased form contains the substring `java`. That correctly removes `C:\Program Files\Java\jdk-21\bin`, but it also removes:
- `C:\Tools\JavaScript-utils\bin` (a JS toolchain, unrelated to JDK)
- `C:\Users\X\AppData\Roaming\nvm\v22.0.0\node_modules\jsr-cli\bin` if a future Java-themed package name appears
- any "Javascript" directories, "Javadoc" tool dirs, etc.

For row 2 ("clear PATH so slot 2 wins") the test wants to *prove* that gradle.properties is consulted in the absence of Java on PATH, but if `clearJavaFromPath` accidentally drops a non-Java PATH entry it could perturb subprocesses that the matrix expects to find. Acceptable for diagnostic tooling but worth flagging.

**Fix:** Filter by directory-segment match instead of substring, or by exact basename:
```ts
const filtered = ORIG_PATH.split(';').filter(p => {
    const segs = p.toLowerCase().split(/[\\/]/);
    return !segs.includes('java') && !segs.some(s => /^jdk(-|$)/.test(s));
}).join(';');
```

---

### WR-04: Hardcoded personal username path in committed source

**File:** `scripts/jdtls-trace.ts:29` and `scripts/matrix-runner.ts:43`
**Issue:**
```ts
const MOD_ROOT = 'C:\\Users\\LoganDark\\Downloads\\fabric-mod';
```
Personal username `LoganDark` is hardcoded into committed source. Beyond the privacy-leak smell, this means the next maintainer cannot run the script without first editing the source. The whole point of the 8.3-short-name fix is to test on long-username hosts — a hardcoded long username makes the script unreusable on the *exact* class of host the fix targets.

**Fix:** Read from an env var with a usage error if missing:
```ts
const MOD_ROOT = process.env.MATRIX_MOD_ROOT;
if (!MOD_ROOT) {
    console.error('Set MATRIX_MOD_ROOT to your Fabric mod project root');
    process.exit(2);
}
```

---

### WR-05: `setGradleProperty` writes LF line endings unconditionally; Windows files often use CRLF

**File:** `scripts/matrix-runner.ts:111-125`
**Issue:**
```ts
const lines = content.split(/\r?\n/);
// ...
writeFileSync(PROPS_PATH, lines.join('\n'));
```
The read tolerates CRLF; the write always uses LF. On Windows, a `gradle.properties` that came in CRLF will be silently rewritten in LF after `runRow`, even after the restore step copies it back (the backup was taken before mutation, so the restore is fine — but if the backup step ever fails midway, the project file is left in mixed/foreign line endings). Defensive: detect and preserve.

**Fix:** Detect the original line-ending and preserve it:
```ts
const eol = content.includes('\r\n') ? '\r\n' : '\n';
// ...
writeFileSync(PROPS_PATH, lines.join(eol));
```

---

### WR-06: `await import('node:fs')` at top level shadows static import (matrix-row.ts secondary)

**File:** `scripts/matrix-row.ts:99`
**Issue:** Separate from CR-01 above, even ignoring the redeclaration error, the *style* of mixing static-then-dynamic imports for a Node builtin is gratuitous: the dynamic import buys nothing (no lazy loading benefit, no conditional path), only confusion. The pattern was likely copy-pasted from `jdtls-trace.ts` which legitimately uses dynamic imports for `node:fs/promises` etc. inside the `runIf` test, where the laziness matters.

**Fix:** Delete the dynamic import line; rely on the static one at line 18. (Same change as CR-01; recording the smell separately so the rewrite catches both.)

---

## Info

### IN-01: Test re-imports the module 8× via `vi.resetModules()` — slow and brittle

**File:** `tests/jdtls/uri-mapper.test.ts:212-323`
**Issue:** Every Windows-flavor test individually calls `setPlatform('win32'); vi.resetModules(); const { createUriMapper } = await import(...);`. That's 8 module re-imports per test run, each of which reparses `src/jdtls/uri-mapper.ts`, `src/platform/index.ts`, and `src/platform/uri.ts`. Not a correctness issue, just slow.

**Fix:** Extract a `withWindowsPlatform` helper that wraps the boilerplate:
```ts
async function withWindowsPlatform<T>(fn: (createUriMapper: typeof import('../../src/jdtls/uri-mapper.js')['createUriMapper']) => Promise<T>): Promise<T> {
    setPlatform('win32');
    vi.resetModules();
    const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
    return fn(createUriMapper);
}
```

### IN-02: `entryPathToClassName` regex `/\.java$/` only strips the trailing `.java`, but the implicit assumption is the input ends in `.java`

**File:** `src/jdtls/uri-mapper.ts:64-66`
**Issue:** If callers pass `'Foo.class'` (compiled class file rather than source), the result is `'Foo.class'` literal — no rejection, just silent wrong output. There's no validation. This is the documented behavior, and the codebase always passes `.java` paths, but a type-level guarantee or runtime assertion would help.

**Fix:** Either rename the function to make the precondition explicit, or assert it:
```ts
export function entryPathToClassName(entryPath: string): string {
    if (!entryPath.endsWith('.java')) {
        throw new Error(`entryPathToClassName: expected .java entry path, got '${entryPath}'`);
    }
    return entryPath.replace(/\.java$/, '').replace(/\//g, '.');
}
```

### IN-03: `jdtls-trace.ts` swallows every cleanup error

**File:** `scripts/jdtls-trace.ts:207-212`
**Issue:**
```ts
try {
    await session.client.shutdown();
    session.client.exit();
} catch {}
```
Empty catch in cleanup. Acceptable for a diagnostic script, but at minimum log to stderr so a hung shutdown isn't invisible:
```ts
try {
    await session.client.shutdown();
    session.client.exit();
} catch (err) {
    console.error('Cleanup failed:', String(err));
}
```

### IN-04: `scripts/check-uri.mjs` is undocumented and lacks usage

**File:** `scripts/check-uri.mjs:1-19`
**Issue:** The file has no header comment explaining purpose, no `#!/usr/bin/env node` shebang, and prints results to stdout (violating the user's global zsh convention "all status prints go to stderr, only main output goes to stdout" — though the file is `.mjs` so the rule is loose here). The hardcoded test reads `tmpdir()` and prints what `realpathSync.native` returns; obviously a one-shot debugging aid, but a one-line header comment would help the next reader.

**Fix:** Add a header:
```js
/**
 * scripts/check-uri.mjs — one-shot diagnostic for verifying that
 * realpathSync.native canonicalizes 8.3 short names on the current host.
 * Run: node scripts/check-uri.mjs
 */
```

### IN-05: `WINDOWS-SUPPORT.md` mentions "the registry value" without naming which API checks it

**File:** `docs/WINDOWS-SUPPORT.md:70`
**Issue:**
> Node.js 22 honors the registry flag automatically when set — no FabricModMCP-side code change is required. The MCP server does not probe the registry value itself, so if extraction failures appear without an obvious cause...

The phrasing "honors the registry flag automatically" is correct but readers may interpret it as "Node will tell us if long paths are off" — Node silently uses long-path semantics on its own syscalls, but the user-visible error (ENAMETOOLONG) is not labeled "long paths are disabled." Consider adding a one-line sample of the expected error so users can grep for it.

**Fix:** Append:
> When extraction fails with `ENAMETOOLONG` against `%TEMP%\mcp-jdtls-*\dep-<id>\<long\package\path>\X.java`, the registry flag is the most likely cause.

---

## Structural Findings (fallow)

No `<structural_findings>` block was provided with this review request — no pre-pass substrate to integrate. All findings above are from direct narrative review.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
