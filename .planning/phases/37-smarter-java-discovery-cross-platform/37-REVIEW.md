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
  critical: 0
  warning: 6
  info: 6
  total: 12
status: issues_found
---

# Phase 37: Code Review Report (Post-Gap-Closure)

**Reviewed:** 2026-05-16
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This is the post-gap-closure review of Phase 37. The earlier review's BLOCKER
(CR-01: "rescued JDT LS session has an empty workspace") has been closed by
Plan 37-05's addition of the post-rescue workspace re-sync loop in
`src/jdtls/startup.ts:157-182`. The new loop iterates every fabric-mod child
of a successfully-rescued project, calls `syncFabricModToWorkspace` against the
freshly-assigned session, swallows per-child throws via `logger.warn` (D-04
semantics), surfaces warnings, and skips study-jar children. Four new
`it()` cases in `tests/jdtls/startup.test.ts:485-558` pin this behavior down:
sync called twice for two fabric mods, NOT called when reinit stays degraded,
per-child throws swallowed, and `result.warning` propagated to logger. The
implementation matches the test contract and the planning artifacts.

CR-01 is therefore closed. Outstanding findings from the prior review that
were NOT part of the 37-05 scope remain (the `detectJava` execSync shell-
interpolation hazard, the unanchored `parseJavaVersion` regex, the limited
`/opt` JDK prefix filter, the silently-swallowed `readdir` errors, the
unguarded concurrent-sweep mutation of `project.jdtls`, plus a handful of
dead-code / sort-key / docstring polish items). They reappear here as WR-01
through WR-05 and IN-01 through IN-04.

The gap-closure itself introduces two new items worth surfacing — a
cross-layer dependency inversion that the rescue path now formalizes
(WR-06) and a response-envelope inconsistency in `add-fabric-mod` between
`jdtlsAvailable` and `workspaceSynced` after a rescue (IN-05). Neither is a
blocker, but both are easy to land while the file is still warm.

## Warnings

### WR-01: `detectJava` shell-interpolates `javaPath` into a string command — local shell-injection if `JAVA_HOME` is attacker-controlled

**File:** `src/jdtls/java-discovery.ts:76-80`

**Issue:**
`execSync(\`"${javaPath}" --version\`, ...)` builds a shell command with the
path embedded in double-quoted form. `javaPath` ultimately derives from
`process.env.JAVA_HOME` (line 66) or `configuredJavaHome` (CLI `--java-home`).
A `JAVA_HOME` value containing `"` characters — e.g.
`'/tmp/foo" ; rm -rf ~ ; echo "'` — breaks out of the quotes and executes
arbitrary commands under the MCP server's uid. The async `discoverJava` path
is safe because it uses `execFile` with an args array; this sync path is the
leftover hazard.

This is pre-existing v1.5 behavior preserved under the UNIX-01 byte-identical
commitment, NOT new in Phase 37, but it now lives in the file under review.
The threat model is constrained (attacker already controls user env) — still
worth fixing because it's a trivial swap to `execFileSync`.

**Fix:**
```typescript
const output = execFileSync(javaPath, ['--version'], {
    encoding: 'utf-8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
});
```

### WR-02: `parseJavaVersion` regex is unanchored — first numeric token in stderr warnings can shadow the real version

**File:** `src/jdtls/java-discovery.ts:138-149`

**Issue:**
The regex `(?:version\s+")?([\d]+)(?:\.([\d]+))?` is unanchored and matches
the first digit run anywhere in the combined `stdout + stderr` (assembled
at line 296). For most JDKs `java --version` output begins with the version,
but JVMs commonly emit `Picked up JAVA_TOOL_OPTIONS: -Xmx2048m\n`,
`OpenJDK 64-Bit Server VM warning: ...`, or deprecation lines BEFORE the
version. The regex locks onto `2048` (or `64`) and rejects a fine Java 21+
JDK as `version-too-old`. Worse, on the success path a probe of an actual
Java 8 JDK whose stderr happens to contain an unrelated `21` could be
classified as Java 21 and accepted.

In `discoverJava`'s failureReason this surfaces as `Java 2048 (need 21+)` or
`Java 64 (need 21+)` — confusing nonsense the user can't act on. In the
`detectJava` sync path same effect.

**Fix:**
Match the well-known prefixes explicitly, falling back to the legacy form:
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

### WR-03: `/opt` entry filter rejects several mainstream JDK packages (SapMachine, Liberica, GraalVM, Adoptium tarballs without `-jdk`)

**File:** `src/jdtls/java-discovery.ts:253-259`

**Issue:**
The regex `^(jdk-|.*-jdk|temurin-|zulu-|corretto-|openjdk-)` accepts only
those six shapes. Packages like `liberica-21`, `sapmachine-21`,
`graalvm-21`, `bellsoft-liberica-21`, `adoptium-21` would be rejected
from `/opt` even though they ARE JDKs (the `-jdk` literal saves
`liberica-jdk-21`, `microsoft-jdk-21`, etc., but the bare-vendor-name
shape is common and is dropped silently).

A user with SapMachine in `/opt/sapmachine-21` will see `Java not found`
even though it's right there.

**Fix:**
Either expand the alternation, or probe everything in `/opt` and let the
`--version` probe reject non-Java binaries — the 3s timeout caps the cost,
and Windows skip-on-fail / Linux ENOENT both resolve cheaply. Recommended:
```typescript
function acceptEntry(parent: string, entry: string, layout: VendorLayout): boolean {
    if (layout === 'homebrew') return entry.startsWith('openjdk');
    if (parent === '/opt') {
        return /jdk|jre|temurin|zulu|corretto|liberica|sapmachine|adoptium|microsoft|graalvm/i.test(entry);
    }
    return true;
}
```

### WR-04: Scan-slot `readdir` swallows every error — `EACCES` / `EIO` / etc. produce no diagnostic

**File:** `src/jdtls/java-discovery.ts:317-323`

**Issue:**
```typescript
try {
    entries = await readdir(parent);
} catch {
    return [];
}
```
Catches every error and returns empty. If `/opt` is mode-700 owned by root,
or `~/.jdks` exists on a permission-restricted filesystem, the sweep
silently skips it. The failureReason synthesizer never mentions these
parents because the scan slot only records outcomes when `enumerateParent`
yields candidates. Net effect: users on misconfigured boxes get `Java not
found` with no breadcrumb about the permission issue.

**Fix:**
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

### WR-05: Concurrent retry sweeps can interleave and double-create JDT LS processes / tempDirs

**File:** `src/jdtls/startup.ts:125-190`

**Issue:**
`retryDegradedJdtLsSessions` walks every project, awaits `cleanupTempDir`,
`cleanupTempDir` (dataDir), `initJdtLsSession`, and finally a chain of
`syncFabricModToWorkspace` calls — five-plus yield points per project.
Claude can call multiple tools in a single assistant turn (e.g.
`add_fabric_mod` followed immediately by `refresh_project`), and the MCP
server processes them concurrently. Sweep A reads
`project.jdtls.available === false`, awaits init; sweep B reads the same
stale `false`, awaits init too; both reassign `project.jdtls`. The session
A wrote is now orphaned — its JDT LS JVM process keeps running with a
tempDir nobody references, leaking until process exit. Sweep A's post-rescue
sync loop will also race with sweep B's: both call
`syncFabricModToWorkspace(child, project.jdtls, ...)` where
`project.jdtls` has been swapped under A's feet, so A's sync writes to B's
brand-new session.

The pre-existing cleanup at lines 144-152 also runs unguarded — if A
cleaned `oldTempDir`, B will try to clean the SAME path (idempotent, fine),
but B reads `oldTempDir` from the SAME degraded session object A reads
from, so B's `oldTempDir` value is whatever A's was. The race is most
visible in the JVM process leak.

**Fix:**
Add a per-project reentrancy guard:
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

### WR-06: `startup.ts` now imports `tools/shared-jar-reader.js` — domain layer reaching back into the tools layer (architecture inversion)

**File:** `src/jdtls/startup.ts:25`

**Issue:**
The CLAUDE.md layering model (Layer 2: tools → Layer 3: domain
[`jdtls/`, `project/`, `browsing/`]) is now violated: `src/jdtls/startup.ts`
imports from `src/tools/shared-jar-reader.js`. The rescue-sync loop needs a
`JarReader` to pass to `syncFabricModToWorkspace`, and the simplest wire-up
grabbed the tools-layer singleton. This breaks the dependency direction the
project sets in CLAUDE.md ("Domain logic in `src/browsing/`, `src/project/`,
`src/jdtls/` — tools in `src/tools/` are thin wrappers").

Functionally it works because `shared-jar-reader.ts` is a pure module-level
singleton with no MCP-server coupling, but the import path lies about
ownership: a future reader will assume `tools/` is a leaf, only to find
domain code dragging it back up the stack.

**Fix:**
Either (a) move `shared-jar-reader.ts` down to `src/project/` (or a new
`src/state/`) so the singleton lives in a domain layer, or (b) inject the
`JarReader` into `retryDegradedJdtLsSessions` as a parameter and let each
tool handler pass `jarReader` explicitly — same pattern as
`syncFabricModToWorkspace` itself:
```typescript
export async function retryDegradedJdtLsSessions(jarReader: JarReader): Promise<void> { ... }
```
Each call site (`add-fabric-mod.ts:80`, `refresh-project.ts:113`,
`refresh-project-members.ts:143`) already has `jarReader` in scope.

## Info

### IN-01: `formatSlotLine` `'java on PATH'` `not-set` branch is unreachable

**File:** `src/jdtls/java-discovery.ts:470-473`

**Issue:**
Slot 4 (`java on PATH`) always invokes `probeCandidate(javaBinaryName())`
unconditionally at `discoverJava` line 422-425 — there is no `if (...) else
record(..., {kind: 'not-set'})` guard like slots 1-3 have. So the
`if (outcome.kind === 'not-set') return 'java on PATH: (not set)'` branch
on line 471 is unreachable.

**Fix:** Remove the dead branch or document it as defensive coding for a
future slot-semantics change.

### IN-02: Redundant disjunction in `vendorLayoutFor`

**File:** `src/jdtls/java-discovery.ts:229-230`

**Issue:**
```typescript
if (parent === '/Library/Java/JavaVirtualMachines'
    || parent.endsWith('/Library/Java/JavaVirtualMachines')) return 'mac-bundle';
```
A string equal to `/Library/...` also `endsWith` it — the first disjunct
is fully covered by the second.

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
Cleaner shape with the same effect:
```typescript
if (outcome.kind === 'success') return;
logger.debug('Java candidate skipped', {
    candidate: candidate ?? label,
    reason: outcome.kind,
});
```

### IN-04: `parseVersionHint` misclassifies legacy `1.x` entries — `corretto-1.8.0_381` sorts as version 1, not 8

**File:** `src/jdtls/java-discovery.ts:268-271`

**Issue:**
For `corretto-1.8.0_381` the regex `\b(\d+)` matches `1`. Real version 8
sorts BELOW any `\d+`-prefixed Java 2+ entry, which is the desired order
in practice, but the version hint is wrong and the sort tie-break against
other `1.x` entries is arbitrary. Hint accuracy affects probe order, not
correctness — the `--version` probe still rejects sub-21 JDKs.

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

### IN-05: `add-fabric-mod` response inconsistent — reports `jdtlsAvailable: true` but `workspaceSynced: false` after a successful retry rescue

**File:** `src/tools/add-fabric-mod.ts:73-94`

**Issue:**
The handler calls `syncFabricModToWorkspace` at line 73 against
`loadedProject.jdtls` — which may still be the OLD degraded session at
that point. Sync returns `{synced: false, warning: 'JDT LS unavailable'}`.
Then line 80 calls `retryDegradedJdtLsSessions`, which (per Plan 37-05's
new behavior) rescues the session AND re-syncs all fabric-mod children
including the just-added one. After retry returns, `loadedProject.jdtls`
is fresh and available, AND its `.classpath` contains the new mod's deps.

But the response on line 89-91 reads:
- `jdtlsAvailable: loadedProject.jdtls?.available ?? false` → `true` (post-retry)
- `workspaceSynced: syncResult.synced` → `false` (captured pre-retry)

The user sees an envelope claiming "JDT LS is available but the workspace
was not synced" — internally inconsistent and misleading. The mod's
sources actually ARE indexed (the retry sweep took care of it).

**Fix:** Re-evaluate `workspaceSynced` after the retry, e.g.
```typescript
await retryDegradedJdtLsSessions();
const finalSynced = syncResult.synced
    || (loadedProject.jdtls?.available === true && loadedProject.jdtls.jarIdToDirName.has(fabricMod.name));
// ...
workspaceSynced: finalSynced,
```
Or — cleaner — drop `workspaceSynced` from the envelope entirely and rely
on `jdtlsAvailable`, since the post-retry sweep guarantees workspace state
matches session state. The other two tool handlers
(`refresh-project.ts`, `refresh-project-members.ts`) already omit this
field from their envelopes.

### IN-06: Scoop test comment claims "firefox is accepted" but no assertion verifies it

**File:** `tests/jdtls/java-discovery.test.ts:466-472`

**Issue:**
The test comment on line 466-468 says "both adoptium and firefox are
accepted (no scoop-specific filter)" but the assertions only verify
`adoptium-jdk-21` was probed and that `current\bin\java.exe` shape
appears. If a future change adds a scoop-specific JDK-name filter, the
firefox case would be silently regressed.

**Fix:**
```typescript
expect(scoopCandidates.some(c => c.includes('firefox'))).toBe(true);
```

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
