---
phase: 37-smarter-java-discovery-cross-platform
reviewed: 2026-05-16T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/jdtls/java-discovery.ts
  - src/jdtls/client.ts
  - src/jdtls/startup.ts
  - src/tools/add-fabric-mod.ts
  - src/tools/refresh-project.ts
  - src/tools/refresh-project-members.ts
  - tests/jdtls/java-discovery.test.ts
  - tests/jdtls/startup.test.ts
findings:
  critical: 1
  warning: 5
  info: 6
  total: 12
status: issues_found
---

# Phase 37: Code Review Report

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 37 carves Java discovery out of `client.ts` into a dedicated `java-discovery.ts`, introduces an async priority-chain `discoverJava({ projectRoot? })` API with vendor-aware scanning of common JDK install locations, and wires `retryDegradedJdtLsSessions()` into three tool handlers. The carve-out itself is clean, well-tested, and respects the v1.5 byte-identical `detectJava` commitment. The new vendor-aware scan, `unescapePropertiesValue` single-pass scanner, and per-slot failure-reason synthesis are all sound.

However, the retry-sweep integration has a real behavioral gap: when `retryDegradedJdtLsSessions()` successfully rescues a degraded JDT LS session, **the new session has an empty workspace** — no fabric mod sources are re-synced into it. Callers report `jdtlsAvailable: true` but JDT LS has nothing to index, so navigation tools silently return empty results until the user manually calls `refresh_project` again. This is a BLOCKER for the user-visible workflow Phase 37 advertises ("newly-installed Java unlocks previously-degraded JDT LS sessions").

The pre-existing `detectJava` shell-interpolation pattern (carried into `java-discovery.ts` verbatim under UNIX-01) is a latent local-shell-injection vector worth noting but not introduced by this phase.

## Critical Issues

### CR-01: `retryDegradedJdtLsSessions` rescues the session but never re-syncs workspace; navigation appears broken after retry succeeds

**File:** `src/jdtls/startup.ts:123-164`, also `src/tools/add-fabric-mod.ts:73-80`, `src/tools/refresh-project.ts:99-113`, `src/tools/refresh-project-members.ts:127-143`

**Issue:**
The sweep replaces `project.jdtls` with a freshly-`init`'d session (line 154: `project.jdtls = newSession`). The new session's `tempDir` is brand-new (created at `startup.ts:66`) and contains only an empty `.classpath` (line 69). Crucially, the sweep does NOT call `syncFabricModToWorkspace` for any of the project's fabric-mod children after the retry succeeds.

Trace through `add-fabric-mod` for a degraded project:
1. Line 73: `syncFabricModToWorkspace(fabricMod, loadedProject.jdtls, jarReader)` runs while `loadedProject.jdtls.available === false`. Workspace sync degrades to a no-op for the degraded session.
2. Line 80: `retryDegradedJdtLsSessions()` replaces `loadedProject.jdtls` with a fresh, available session. The fresh session's `tempDir` has empty `.classpath` and no extracted sources.
3. Line 89: response reports `jdtlsAvailable: loadedProject.jdtls?.available ?? false` → `true`.

Result: user sees a success envelope claiming JDT LS is available, but `find_definition`/`find_references`/etc. produce empty results because JDT LS has indexed nothing. Same path in `refresh-project.ts:99-113` (re-sync runs against the OLD degraded session, then the session is replaced) and `refresh-project-members.ts:127-143`.

This directly undermines Phase 37's stated value — "newly-installed Java unlocks previously-degraded JDT LS sessions." It "unlocks" them only in the sense of marking `available: true`; users still must call `refresh_project` a second time before the workspace is usable.

The startup-test file confirms the gap: every assertion in `tests/jdtls/startup.test.ts:434-445` checks only `project.jdtls?.available === true`; none of the retry-sweep tests assert workspace sync occurred for the rescued session's fabric-mod children.

**Fix:**
After `project.jdtls = newSession` and confirming `newSession.available === true`, re-sync every fabric-mod child in the project against the new session. Either inline in `retryDegradedJdtLsSessions` (preferred — keeps the contract in one place) or via a callback passed by the tool handlers.

```typescript
// In src/jdtls/startup.ts, after line 156:
if (newSession.available === true) {
    // Re-sync every fabric-mod child into the freshly-rescued workspace,
    // otherwise the new session has an empty .classpath and navigation
    // silently returns empty results.
    for (const child of project.children.values()) {
        if (child.kind === 'fabric-mod') {
            try {
                const result = await syncFabricModToWorkspace(child, newSession, jarReader);
                if (result.warning) {
                    logger.warn(`Workspace re-sync after JDT LS rescue for '${child.name}': ${result.warning}`);
                }
            } catch (err) {
                logger.warn(`Workspace re-sync failed after JDT LS rescue`, { project: project.name, child: child.name, error: String(err) });
            }
        }
    }
    logger.info(`JDT LS reinit succeeded for project '${project.name}'`);
}
```

(The `jarReader` is the module singleton `./shared-jar-reader.js` already used by the same tool handlers — `startup.ts` would need to import it, or accept it as a parameter.)

## Warnings

### WR-01: `detectJava` shell-interpolates `javaPath` into a string command — local shell-injection if `JAVA_HOME` is attacker-controlled

**File:** `src/jdtls/java-discovery.ts:76-80`

**Issue:**
`execSync(\`"${javaPath}" --version\`, ...)` builds a shell command with the path embedded in double-quoted form. `javaPath` ultimately derives from `process.env.JAVA_HOME` (line 66) or `configuredJavaHome` (CLI `--java-home`). A `JAVA_HOME` value containing `"` characters — e.g. `'/tmp/foo" ; rm -rf ~ ; echo "'` — breaks out of the quotes and executes arbitrary commands under the MCP server's uid. The async `discoverJava` path is safe because it uses `execFile` with an args array; this sync path is the leftover hazard.

This is pre-existing v1.5 behavior preserved under the UNIX-01 byte-identical commitment, NOT new in Phase 37, but it now lives in the file under review. The threat model is constrained (attacker already controls user env) — still worth fixing because it's a trivial swap to `execFileSync`.

**Fix:**
```typescript
const output = execFileSync(javaPath, ['--version'], {
    encoding: 'utf-8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
});
```
This breaks UNIX-01's literal-command commitment but produces the same stdout. If existing tests rely on `execSync` mocking, update them to mock `execFileSync` (which is what `detectJava`'s async sibling already uses).

### WR-02: `parseJavaVersion` regex is unanchored — first numeric token in stderr warnings could shadow the real version

**File:** `src/jdtls/java-discovery.ts:138-149`

**Issue:**
The regex `(?:version\s+")?([\d]+)(?:\.([\d]+))?` is unanchored and matches the first digit run anywhere in the combined `stdout + stderr` (line 296). For most JDKs `java --version` output begins with the version, but JVMs commonly emit `Picked up JAVA_TOOL_OPTIONS: -Xmx2048m\n` or deprecation warnings BEFORE the version line — the regex would lock onto `2048` and reject a fine Java 21+ JDK as version-too-old, OR more dangerously latch onto a 21+-looking number in a license string and accept a Java 8 JDK as 21+.

In the `discoverJava` path this manifests as a confusing `Java 2048 (need 21+)` slot reason — degraded session with a nonsense version. In the `detectJava` sync path same effect.

**Fix:**
Match the well-known prefixes explicitly, falling back to the legacy `version "X.Y"` form:
```typescript
export function parseJavaVersion(output: string): number | null {
    // Modern: "openjdk 21.0.1 2023-10-17", "java 21 2023-09-19"
    const modern = output.match(/^(?:openjdk|java)\s+(\d+)(?:\.(\d+))?/m);
    if (modern) {
        const major = parseInt(modern[1], 10);
        if (major === 1 && modern[2]) return parseInt(modern[2], 10);
        return major;
    }
    // Legacy: openjdk version "1.8.0_381"
    const legacy = output.match(/version\s+"(\d+)(?:\.(\d+))?/);
    if (legacy) {
        const major = parseInt(legacy[1], 10);
        if (major === 1 && legacy[2]) return parseInt(legacy[2], 10);
        return major;
    }
    return null;
}
```

### WR-03: `acceptEntry` regex for `/opt` rejects common-but-not-listed JDK package names (Microsoft, Liberica, Adoptium, SapMachine)

**File:** `src/jdtls/java-discovery.ts:253-259`

**Issue:**
The regex `^(jdk-|.*-jdk|temurin-|zulu-|corretto-|openjdk-)` accepts only those six prefixes. Packages like `liberica-jdk-21`, `microsoft-jdk-21`, `sapmachine-21`, `bellsoft-liberica-jdk-21`, `eclipse-adoptium-21` would be rejected from `/opt` even though they ARE JDKs. Note: `microsoft-jdk-21` actually DOES match `.*-jdk` (because of the `-jdk` literal), but `microsoft-jdk-21.0.1` also matches; `sapmachine-21` and `bellsoft-21` would NOT match because they lack the `-jdk` suffix.

This converts "scan /opt" into a silently-incomplete vendor matrix. A user with SapMachine in `/opt/sapmachine-21` will see `Java not found` even though it's right there.

**Fix:**
Either expand the prefix alternation, or invert the filter — reject only well-known non-JDK packages (which doesn't scale either). Better: probe everything under `/opt` but rely on the `--version` probe to reject non-Java binaries. The 3s timeout caps the cost of probing N entries, and the probe of a missing `bin/java` resolves via `file-not-found` cheaply (no execFile, just `existsSync` on Windows; on Linux the bare path is passed straight to execFile which returns ENOENT fast).

```typescript
function acceptEntry(parent: string, entry: string, layout: VendorLayout): boolean {
    // Homebrew filter stays — opt prefixes mix many formulae.
    if (layout === 'homebrew') return entry.startsWith('openjdk');
    // /opt: accept anything that LOOKS like a JDK; rely on probe to reject the rest.
    if (parent === '/opt') {
        return /jdk|jre|temurin|zulu|corretto|liberica|sapmachine|adoptium|microsoft|graalvm/i.test(entry);
    }
    return true;
}
```

### WR-04: `mockReaddir` / scan-slot enumeration does not handle `EACCES` / non-`ENOENT` errors distinctly

**File:** `src/jdtls/java-discovery.ts:317-323`

**Issue:**
```typescript
try {
    entries = await readdir(parent);
} catch {
    return [];
}
```
Catches every error and returns `[]`. If the user has `/opt` but it's mode-700 owned by root (rare but possible on locked-down systems), the sweep silently skips it. The failure-reason synthesizer never mentions `/opt` because the scan slot only records outcomes when `enumerateParent` returns candidates. Net effect: users on misconfigured boxes get `Java not found` with no hint about the permission issue.

**Fix:**
Log a debug line on non-ENOENT errors so operators have a breadcrumb:
```typescript
try {
    entries = await readdir(parent);
} catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
        logger.debug('Java scan parent unreadable', { parent, code: e.code, message: e.message });
    }
    return [];
}
```

### WR-05: Retry sweep iterates `projectStore.list()` while reassigning `project.jdtls` — no concurrency guard against parallel tool invocations

**File:** `src/jdtls/startup.ts:123-164`

**Issue:**
`retryDegradedJdtLsSessions` walks every project, awaits `initJdtLsSession`, and then mutates `project.jdtls`. The `await` points (cleanupTempDir, cleanupDataDir, initJdtLsSession) yield to the event loop. If a user invokes `add_fabric_mod` and `refresh_project` near-simultaneously (Claude can call multiple tools in one assistant turn), TWO sweeps can interleave: sweep A reads `project.jdtls.available === false`, awaits init; sweep B reads the same stale `false`, awaits init too; both reassign `project.jdtls`, double-creating tempDirs and leaking one JDT LS process.

The pre-existing tempDir cleanup at lines 138-150 also runs unguarded — sweep B can read the SAME `oldTempDir` value as A, both `cleanupTempDir` it, both succeed (cleanup is idempotent via `rm --force`), but the SECOND `initJdtLsSession` will silently steal ownership of the new tempDir A wrote into `project.jdtls`.

**Fix:**
Add a per-project (or process-wide) reentrancy guard:
```typescript
const retryInFlight = new Set<string>();
export async function retryDegradedJdtLsSessions(): Promise<void> {
    for (const project of projectStore.list()) {
        if (project.jdtls?.available !== false) continue;
        if (retryInFlight.has(project.name)) continue;
        retryInFlight.add(project.name);
        try {
            // ...existing body
        } finally {
            retryInFlight.delete(project.name);
        }
    }
}
```

## Info

### IN-01: `formatSlotLine` `'java on PATH'` `not-set` branch is dead code

**File:** `src/jdtls/java-discovery.ts:470-473`

**Issue:**
Slot 4 (`java on PATH`) always invokes `probeCandidate(javaBinaryName())` unconditionally (no `if (...) else record(..., 'not-set')` guard like slots 1-3 have). So `outcome.kind === 'not-set'` is never reached for this label, making the `if (outcome.kind === 'not-set') return 'java on PATH: (not set)'` branch unreachable.

**Fix:** Remove the dead branch, or document why it exists (defensive coding for future slot semantics).

### IN-02: Redundant disjunction in `vendorLayoutFor`

**File:** `src/jdtls/java-discovery.ts:229-230`

**Issue:**
```typescript
if (parent === '/Library/Java/JavaVirtualMachines'
    || parent.endsWith('/Library/Java/JavaVirtualMachines')) return 'mac-bundle';
```
The first disjunct is implied by the second — any string equal to `/Library/...` also `endsWith` it.

**Fix:** Drop the equality check.

### IN-03: `record()` else-if branch is logically redundant

**File:** `src/jdtls/java-discovery.ts:365-372`

**Issue:**
```typescript
if (outcome.kind !== 'success' && candidate !== null) {
    logger.debug('Java candidate skipped', { candidate, reason: outcome.kind });
} else if (outcome.kind !== 'success') {
    logger.debug('Java candidate skipped', { candidate: label, reason: outcome.kind });
}
```
The else-if's second check (`outcome.kind !== 'success'`) is implied (else of `A && B` is `!A || !B`; combined with the outer being non-success this collapses to `candidate === null`). Not wrong, just busier than necessary.

**Fix:**
```typescript
if (outcome.kind === 'success') return;
logger.debug('Java candidate skipped', {
    candidate: candidate ?? label,
    reason: outcome.kind,
});
```

### IN-04: `parseVersionHint` matches `1` in `corretto-1.8.0_381` and sorts a Java 8 JDK ahead of a Java 21 sibling

**File:** `src/jdtls/java-discovery.ts:268-271`

**Issue:**
For an entry like `corretto-1.8.0_381`, the regex `\b(\d+)` matches `1`. Sort order would place this AFTER `corretto-21` (correct), but tie-breaking against other `1.x` legacy entries places them in arbitrary order. The downstream `--version` probe still rejects them, so this is a perf-only concern (out of v1 scope) — but version-hint accuracy for legacy 1.x JDKs is also broken (a `1.8` entry sorts as version 1, not version 8).

**Fix:** Mirror `parseJavaVersion`'s 1.x handling:
```typescript
function parseVersionHint(entry: string): number {
    const m = entry.match(/\b(\d+)(?:\.(\d+))?/);
    if (!m) return 0;
    const major = parseInt(m[1], 10);
    if (major === 1 && m[2]) return parseInt(m[2], 10);
    return major;
}
```

### IN-05: Test coverage gap — no test asserts workspace re-sync after `retryDegradedJdtLsSessions` rescues a session

**File:** `tests/jdtls/startup.test.ts:377-468`

**Issue:**
Every retry-sweep test asserts only `project.jdtls?.available === true` or that `discoverJava` was called with the right `projectRoot`. There's no test that asserts the rescued session's `.classpath` was repopulated, or that `syncFabricModToWorkspace` was invoked after the retry. This is the test gap that hid CR-01.

**Fix:** Add a test that mocks `syncFabricModToWorkspace` and asserts it's called after a successful retry, once for each fabric-mod child of the rescued project.

### IN-06: Test comment-vs-assertion mismatch in scoop test

**File:** `tests/jdtls/java-discovery.test.ts:466-468`

**Issue:**
Test comment says `"both adoptium and firefox are accepted (no scoop-specific filter)"` but the assertion only verifies that `adoptium-jdk-21` is probed and that `current\bin\java.exe` shape appears. The "firefox is also accepted" branch is asserted only by absence of a filter — there's no positive assertion that `firefox` was probed. If the implementation grew a `scoop`-specific filter the test would silently pass.

**Fix:**
```typescript
expect(scoopCandidates.some(c => c.includes('firefox'))).toBe(true);
```

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
