---
phase: 38-jdt-ls-discovery-on-windows
reviewed: 2026-05-24T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/jdtls/client.ts
  - tests/jdtls/client.test.ts
  - tests/no-process-env-home.test.ts
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 38: Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

The Phase 38 refactor of `findJdtLs()` cleanly consumes `jdtlsCandidateDirs()`, implements the deep-probe contract, fail-fast JDTLS_HOME branches with no fall-through, the multi-line failure composer, and the `process.env.HOME` regression gate. The plan's locked decisions (D-01 through D-09) appear to be implemented as specified.

However, several quality and robustness defects survive the review:

- The two `/tmp`-based JDTLS_HOME tests are silently host-coupled and will break on a Windows CI runner (`/tmp` does not exist).
- `findJdtLs`'s JDTLS_HOME branch does not defend against `envHome` being a file (not a directory) or a path containing unsupported characters — the resulting `globSync` call may throw an unhandled `ENOTDIR`/EACCES that escapes the function, breaking the documented `JdtLsFindResult` contract.
- `startJdtLs` re-runs the launcher-jar glob async (line 168) instead of using the same `globSync` helper now imported at line 20. The comment justifies the duplication for "defense-in-depth", but the duplicated string literal `'plugins/org.eclipse.equinox.launcher_*.jar'` is the exact `LAUNCHER_GLOB` const declared at line 54. The const is unused at the very site whose error message the discoverer is supposed to mirror.

The new `no-process-env-home.test.ts` gate is well-scoped and uses the `\b` word boundary correctly. Its only weakness is silent dependency on `process.cwd()` being the repo root, which is conventional but worth flagging.

## Warnings

### WR-01: `findJdtLs` JDTLS_HOME branch leaks unhandled `globSync` errors

**File:** `src/jdtls/client.ts:125`
**Issue:** `globSync(LAUNCHER_GLOB, { cwd: envHome, absolute: true })` is called without a try/catch. If `envHome` passes `existsSync(envHome) === true` but is a regular file (not a directory), or is a directory the process lacks read permission on, `globSync` can throw `ENOTDIR` / `EACCES`. The exception escapes `findJdtLs` synchronously, violating the documented `JdtLsFindResult` return contract — callers expecting `{ jdtlsHome: null, error }` instead see a raw thrown error and crash. The same hazard applies to the candidate loop at line 142. A user passing `JDTLS_HOME=/etc/passwd` would crash the MCP server at startup instead of seeing a clean error message.
**Fix:** Wrap both `globSync` invocations in try/catch and treat thrown errors as a launcher-missing skip with the error message included:
```ts
let matches: string[];
try {
    matches = globSync(LAUNCHER_GLOB, { cwd: envHome, absolute: true });
} catch (err) {
    return {
        jdtlsHome: null,
        error: `JDTLS_HOME is set to "${envHome}" but probing for the launcher jar failed: ${(err as Error).message}`,
    };
}
if (matches.length === 0) {
    return { jdtlsHome: null, error: `JDTLS_HOME is set to "${envHome}" but no JDT LS launcher jar was found in plugins/.` };
}
```
Apply the analogous pattern in the candidate loop — convert a thrown error into a skip-with-reason rather than a process-level crash.

### WR-02: JDTLS_HOME tests are silently coupled to Unix-only `/tmp`

**File:** `tests/jdtls/client.test.ts:167, 185`
**Issue:** Two tests in the `describe('findJdtLs', ...)` block hard-code `process.env.JDTLS_HOME = '/tmp'` and rely on real-fs `existsSync('/tmp') === true`. On a Windows host, `/tmp` does not exist, so `existsSync('/tmp')` returns false, and the first test (`returns jdtlsHome when JDTLS_HOME is set to existing directory with a launcher jar`) would silently swap into the "directory does not exist" branch, producing `result.jdtlsHome === null` and failing the `expect(result.jdtlsHome).toBe('/tmp')` assertion. The second test (`returns specific error when JDTLS_HOME exists but no launcher jar`) would emit the wrong error message — `"directory does not exist"` instead of `"no JDT LS launcher jar was found"` — and the `expect(... ).toContain('launcher jar')` assertion would fail. Both tests pass today on the macOS dev host but the Phase 38 stated goal is Windows support; the lack of `setPlatform()` + mocked `existsSync` here is a CI gap. Phase 39 (real-Windows verification) will trip over this.
**Fix:** Mock `existsSync` instead of depending on real `/tmp`:
```ts
process.env.JDTLS_HOME = '/fake/jdtls';
vi.mocked(existsSync).mockReturnValueOnce(true);
vi.mocked(globSync).mockReturnValueOnce(['/fake/jdtls/plugins/org.eclipse.equinox.launcher_1.6.900.jar']);
```
This is the same "fully synthetic" alternative the plan calls out at Task 2 step 2 — adopt it for both tests so the suite is cross-host.

### WR-03: `LAUNCHER_GLOB` const is declared but `startJdtLs` still uses a duplicated string literal

**File:** `src/jdtls/client.ts:54, 168`
**Issue:** Line 54 defines `const LAUNCHER_GLOB = 'plugins/org.eclipse.equinox.launcher_*.jar'` with a JSDoc explicitly stating it is "Used by both `findJdtLs` (depth probe — D-01) and `startJdtLs` (defense-in-depth re-check before spawning the JVM)." But at line 168, `startJdtLs` still hard-codes the same literal `'plugins/org.eclipse.equinox.launcher_*.jar'`. The JSDoc is now lying about the second consumer, and the very purpose of the const — single source of truth — is defeated. If the launcher jar naming convention changes, the two sites will drift.
**Fix:** Replace the literal at line 168 with `LAUNCHER_GLOB`:
```ts
const launcherJars = await glob(LAUNCHER_GLOB, {
    cwd: jdtlsHome,
    absolute: true,
});
```

## Info

### IN-01: `formatSlotLine` has a structurally dead branch for the JDTLS_HOME label

**File:** `src/jdtls/client.ts:83-88`
**Issue:** The condition `label === 'JDTLS_HOME' && reason.kind === 'not-set'` is the only path under D-07's fail-fast contract that ever produces a JDTLS_HOME slot in the composed failure message. The implicit "else" branch handles `label === 'JDTLS_HOME'` with `reason.kind !== 'not-set'`, which is unreachable in current control flow (those cases return early in `findJdtLs`). The current implementation defensively handles it via the fall-through `label + ': ' + formatReason(reason)`, which is fine, but the JSDoc on `SlotRecord` (lines 70-73) does not document that the JDTLS_HOME label is always paired with `'not-set'` under D-07.
**Fix:** Either tighten the type so JDTLS_HOME-with-non-`not-set`-reason is unrepresentable, or add a one-line comment to `formatSlotLine` clarifying that the second branch is purely defensive given D-07's fail-fast on JDTLS_HOME.

### IN-02: `findJdtLs` JDTLS_HOME branches do not emit `logger.debug`

**File:** `src/jdtls/client.ts:119-130`
**Issue:** Per D-05, the candidate loop emits `logger.debug('JDT LS candidate skipped', { candidate, reason })` for every skipped slot. The two JDTLS_HOME sad-path branches (lines 119-124 and 125-129) return immediately without logging — so a user debugging "why didn't JDT LS start" with debug-level logging sees nothing about the JDTLS_HOME failure beyond the returned error string. The plan explicitly excludes JDTLS_HOME from `logger.debug` (Behavior 7 says "JDTLS_HOME slot is NOT logged via this path"), so this is per-spec, but the asymmetry creates a discoverability gap: a JDTLS_HOME misconfiguration is the most likely failure mode and emits the fewest signals.
**Fix:** Optional. If the team wants symmetric logging, add a single `logger.debug('JDT LS JDTLS_HOME invalid', { envHome, reason: '...' })` before each early return. Otherwise document the asymmetry in the JSDoc.

### IN-03: `waitForReady` ServiceReady detection has overlapping branches

**File:** `src/jdtls/client.ts:277-285`
**Issue:** The handler first computes `message = params.message ?? params.type ?? ''` and tests `String(message).includes('ServiceReady')`. The second clause `|| String(params?.type).includes('Started')` re-evaluates `params.type` independently. When `params.message` exists and contains `'Started'` but `params.type` also exists with `'Started'`, both branches contribute redundantly. When `params` is `null`/`undefined`, `String(undefined)` is `'undefined'` which contains neither substring — safe. When `params.type` is a non-string (e.g., a number), `String(N).includes('Started')` returns false — safe. Not a bug, but the logic could be simplified to a single check over the merged candidate set.
**Fix:** Optional cleanup:
```ts
const text = String(params?.message ?? params?.type ?? '');
if (text.includes('ServiceReady') || text.includes('Started')) { ... }
```

### IN-04: `no-process-env-home.test.ts` walker does not filter `.d.ts`

**File:** `tests/no-process-env-home.test.ts:19`
**Issue:** The filter `p.endsWith('.ts')` also matches `.d.ts` declaration files. The comment in the plan notes "there are no `.d.ts` files in `src/`" today, but if a future contributor adds one and includes the literal `process.env.HOME` in a JSDoc comment block (e.g., documenting a removed deprecation), the regression gate would false-positive on what is purely documentation. The current behavior of scanning declarations is defensible but the comment in the test file would be a good place to record the choice.
**Fix:** Either explicitly include `.d.ts` (`endsWith('.ts')` — current behavior, no change) and document it, or filter:
```ts
} else if (entry.isFile() && p.endsWith('.ts') && !p.endsWith('.d.ts')) {
```

### IN-05: `no-process-env-home.test.ts` silently assumes `process.cwd()` is the repo root

**File:** `tests/no-process-env-home.test.ts:29`
**Issue:** `walk('src')` is a relative path. If the test is invoked from any other directory (e.g., `cd tests && vitest run no-process-env-home.test.ts`), `readdir('src', ...)` throws `ENOENT`. The convention in this project is `pnpm test` from the repo root, but the test would be more robust against future tooling changes by anchoring the path.
**Fix:** Use an anchored path:
```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// then walk(resolve(repoRoot, 'src'))
```

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
