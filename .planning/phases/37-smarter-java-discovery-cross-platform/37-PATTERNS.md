# Phase 37: Smarter Java Discovery (cross-platform) - Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** 9 (3 NEW, 6 modified)
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/jdtls/java-discovery.ts` (NEW) | domain module | async I/O orchestrator | `src/jdtls/client.ts` (lines 50–153, `setJavaHome`/`detectJava`/`parseJavaVersion`/`resolveJavaExecutable`) | exact (carved-out subset) |
| `src/jdtls/client.ts` (slimmed) | re-export shim | none | `src/platform/uri.ts` exports + `src/jdtls/types.ts` (pure re-export idiom) | role-match |
| `src/jdtls/startup.ts` (extend) | domain module | async orchestrator | `src/jdtls/startup.ts:28-91` (`initJdtLsSession` existing body — signature extension only) | exact (self) |
| `src/tools/add-fabric-mod.ts` (extend) | tool handler | request-response | self (existing handler body) — append `retryDegradedJdtLsSessions()` after `syncFabricModToWorkspace` line 72 | exact (self) |
| `src/tools/refresh-project.ts` (extend) | tool handler | request-response | self — append retry hook after the `for (const mod of mods)` loop, before `autoUnloadConflictingStudyJars` line 111 | exact (self) |
| `src/tools/refresh-project-members.ts` (extend) | tool handler | request-response | self — append retry hook after `for (const mod of modsToRefresh)` loop, before `autoUnloadConflictingStudyJarsForDeps` line 148 | exact (self) |
| `src/index.ts` (no real change) | entrypoint | startup | self — line 21 stays `await initJdtLsSession()` (D-06: zero-arg call equivalent to `{ projectRoot: undefined }`) | exact (self) |
| `tests/jdtls/java-discovery.test.ts` (NEW) | cross-platform test | request-response | `tests/jdtls/client.test.ts` (lines 1-32 boilerplate, 64-131 detectJava, 274-340 Windows-mocked detectJava) + `tests/platform/index.test.ts` (setPlatform helper) | exact (composite) |
| `tests/jdtls/startup.test.ts` (extend) | test | request-response | self — existing describes carry through; new describes mock `discoverJava` instead of `detectJava` | exact (self) |

## Pattern Assignments

### `src/jdtls/java-discovery.ts` (NEW — domain module, async I/O orchestrator)

**Analog:** `src/jdtls/client.ts` — carve out lines 50–153 (`configuredJavaHome`, `setJavaHome`, `detectJava`, `resolveJavaExecutable`, `parseJavaVersion`). New `discoverJava` joins them.

**Imports pattern** (compose from `client.ts:8-18` minus JDT LS specifics):
```typescript
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logging/logger.js';
import { javaBinaryName, javaBinaryInHome, commonJavaLocations, isWindows } from '../platform/index.js';
import { parseGradleProperties } from '../project/gradle-parser.js';

const execFileAsync = promisify(execFile);
```
Note: `execFile` is not yet used anywhere in `src/` (verified by `grep`). The `promisify(execFile)` form is the canonical async wrapper for timeout-capped child-process calls in Node.

**Module-state pattern** — copy verbatim from `client.ts:50-58`:
```typescript
let configuredJavaHome: string | undefined;

export function setJavaHome(javaHome: string | undefined): void {
	configuredJavaHome = javaHome;
}
```
This is the live pattern read by `src/index.ts:14` (`setJavaHome(args.javaHome)`). Move-not-rewrite; the symbol stays importable through the `client.ts` re-export shim (D-07).

**Sync `detectJava` retained byte-identically** — copy verbatim from `client.ts:67-108` (D-09). Test surface in `tests/jdtls/client.test.ts:64-131` and `:274-340` must keep passing without modification. The body uses `execSync` with `timeout: 10_000` and the 2-slot candidate list `configuredJavaHome ?? JAVA_HOME` then `javaBinaryName()`.

**`parseJavaVersion`** — copy verbatim from `client.ts:142-153`:
```typescript
export function parseJavaVersion(output: string): number | null {
	const match = output.match(/(?:version\s+")?([\d]+)(?:\.([\d]+))?/);
	if (!match) return null;

	const major = parseInt(match[1], 10);
	if (major === 1 && match[2]) {
		return parseInt(match[2], 10);
	}
	return major;
}
```

**`resolveJavaExecutable`** — copy verbatim from `client.ts:124-136`. Planner: decide whether this stays in `client.ts` or moves to `java-discovery.ts`. Recommended: move to `java-discovery.ts` and re-export from `client.ts` since `discoverJava` is its only future caller; `detectJava` keeps using it via local reference once both live in the same file.

**Result-type pattern** — copy from `client.ts:20-30`:
```typescript
export type JavaDetected = {
	javaPath: string;
	version: number;
}

export type JavaNotFound = {
	javaPath: null;
	error: string;
}

export type JavaDetectResult = JavaDetected | JavaNotFound;
```
`discoverJava` returns the same `JavaDetectResult` shape — `failureReason` from D-18 goes in the `error` field as a multi-line string.

**Async per-candidate probe pattern** (NEW — D-15 / D-22):
```typescript
type CandidateOutcome =
	| { kind: 'success'; javaPath: string; version: number }
	| { kind: 'not-set' }
	| { kind: 'file-not-found' }
	| { kind: 'version-too-old'; version: number }
	| { kind: 'timed-out' }
	| { kind: 'probe-failed'; message: string };

async function probeCandidate(candidate: string): Promise<CandidateOutcome> {
	const resolved = resolveJavaExecutable(candidate);
	if (resolved === null) return { kind: 'file-not-found' };
	try {
		const { stdout, stderr } = await execFileAsync(resolved, ['--version'], {
			timeout: 3_000,
			encoding: 'utf-8',
		});
		const output = (stdout + stderr) || '';
		const version = parseJavaVersion(output);
		if (version === null) return { kind: 'probe-failed', message: 'unparseable --version output' };
		if (version < 21) return { kind: 'version-too-old', version };
		return { kind: 'success', javaPath: resolved, version };
	} catch (err) {
		const e = err as NodeJS.ErrnoException & { signal?: string };
		// execFile timeout: signal === 'SIGTERM' (or killed === true on newer Node)
		if (e.signal === 'SIGTERM' || e.signal === 'SIGKILL' || (e as any).killed) {
			return { kind: 'timed-out' };
		}
		return { kind: 'probe-failed', message: e.message ?? String(err) };
	}
}
```
Note the `execFile` arg-array form (avoids shell quoting). 3s per-candidate timeout per D-15. The skip-reason taxonomy maps 1:1 to D-22's five outcomes.

**Per-candidate logging** — D-20:
```typescript
logger.debug('Java candidate skipped', { candidate, reason });
```
Volume bounded by candidate count; the existing logger's `debug` method takes `(msg, data?)` per `src/logging/logger.ts:29`.

**Multi-line `failureReason` synthesizer** — D-18 / D-21. The output MUST start with the literal `Java not found.` so existing tests using `toContain('Java not found')` in `tests/jdtls/startup.test.ts:78`, `tests/tools/get-project-info.test.ts:177`, and `tests/tools/create-project.test.ts:84` keep passing without edit. Slot labels per D-21:
- `--java-home: <value>` or `--java-home: (not set)`
- `org.gradle.java.home: <value> (from <projectRoot>/gradle.properties)` or `org.gradle.java.home: (not set in <projectRoot>/gradle.properties)` or `org.gradle.java.home: (not set)` when no `projectRoot`
- `JAVA_HOME=<value>: <reason>` or `JAVA_HOME: (not set)`
- `java on PATH: <reason>`
- Scan candidates: bare absolute path then `: <reason>`

**`unescapePropertiesValue` helper** — NEW, per Java Properties spec. Default placement: private to `java-discovery.ts` (CONTEXT D-12 / "Claude's Discretion" allows moving to `gradle-parser.ts`). Spec:
- `\\` → `\`
- `\:` → `:`
- `\=` → `=`
- `\t` → tab, `\n` → LF, `\r` → CR, `\f` → FF
- `\uXXXX` → UTF-16 code unit (consume exactly 4 hex digits)
- Unknown `\X` → `X` (per java.util.Properties: unrecognized escapes drop the backslash)

Applied at the consumer site to `properties.get('org.gradle.java.home')` before path resolution.

**Vendor layout map** — D-13:
```typescript
type VendorLayout = 'depth1' | 'mac-bundle' | 'homebrew' | 'scoop';

// Keys: parents returned by commonJavaLocations(). Match by exact string OR
// by suffix (Homebrew opt prefixes vary by Apple-silicon vs Intel).
function vendorLayoutFor(parent: string): VendorLayout {
	if (parent.endsWith('/scoop/apps')) return 'scoop';
	if (parent === '/opt/homebrew/opt' || parent === '/usr/local/opt') return 'homebrew';
	if (parent === '/Library/Java/JavaVirtualMachines'
		|| parent.endsWith('/Library/Java/JavaVirtualMachines')) return 'mac-bundle';
	return 'depth1';
}

function candidateFromEntry(parent: string, entry: string, layout: VendorLayout): string {
	const javaBin = javaBinaryName();  // 'java' or 'java.exe'
	switch (layout) {
		case 'depth1':       return join(parent, entry, 'bin', javaBin);
		case 'mac-bundle':   return join(parent, entry, 'Contents', 'Home', 'bin', javaBin);
		case 'homebrew':     return join(parent, entry, 'libexec', 'openjdk.jdk', 'Contents', 'Home', 'bin', javaBin);
		case 'scoop':        return join(parent, entry, 'current', 'bin', javaBin);
	}
}
```
Pure data — no I/O — so this is unit-testable in isolation (D-17).

**Vendor filters** — D-16 (`/opt`) and Homebrew (`openjdk*` only):
```typescript
function acceptEntry(parent: string, entry: string, layout: VendorLayout): boolean {
	if (parent === '/opt') {
		return /^(jdk-|.*-jdk|temurin-|zulu-|corretto-|openjdk-)/.test(entry);
	}
	if (layout === 'homebrew') return entry.startsWith('openjdk');
	return true;
}
```

**Version-hint parser** — D-14:
```typescript
function parseVersionHint(entry: string): number {
	const m = entry.match(/\b(\d+)(?:[.\d_-]+)?/);
	return m ? parseInt(m[1], 10) : 0;
}
```
Best-effort; entries with no number sort last (version 0) but are still probed. The real version comes from `--version`; the hint is purely for sort order within a parent.

**`readdir` enumeration with miss-tolerance** — D-12:
```typescript
async function enumerateParent(parent: string): Promise<string[]> {
	try {
		const entries = await readdir(parent);
		const layout = vendorLayoutFor(parent);
		return entries
			.filter(e => acceptEntry(parent, e, layout))
			.map(e => ({ entry: e, version: parseVersionHint(e) }))
			.sort((a, b) => b.version - a.version)  // newest first
			.map(({ entry }) => candidateFromEntry(parent, entry, layout));
	} catch {
		return [];  // parent doesn't exist — silently skip (D-12 step 1)
	}
}
```

**`discoverJava` orchestrator** — D-10 / D-15. Slot order locked, sequential, short-circuit on first 21+:
```typescript
export async function discoverJava(opts: { projectRoot?: string } = {}): Promise<JavaDetectResult> {
	const outcomes: Array<{ label: string; outcome: CandidateOutcome }> = [];

	// Slot 1: --java-home (configuredJavaHome module state)
	// Slot 2: org.gradle.java.home from <projectRoot>/gradle.properties (skip if no projectRoot)
	// Slot 3: JAVA_HOME env
	// Slot 4: java on PATH
	// Slot 5: scan commonJavaLocations() — for each parent, enumerateParent + probe in order

	// First success wins (short-circuit)
	// On full failure: synthesize multi-line failureReason starting "Java not found."
}
```

**Error handling pattern** — match `client.ts:104-107` shape for the single-line v1.5 fallback when this is the only candidate; otherwise multi-line per D-18. Keep `tried[]` envelope flat (D-19): bare candidate paths only.

---

### `src/jdtls/client.ts` (slimmed — re-export shim, role: pure re-export)

**Analog:** Pure ESM re-export — no direct analog in this codebase since today nothing else does this. Closest is `src/platform/uri.ts` (small focused module). Pattern from D-07:

**Re-export block** — exactly:
```typescript
export { setJavaHome, detectJava, discoverJava } from './java-discovery.js';
```
TypeScript ESM re-exports are zero-cost. Existing imports in `src/index.ts:10` (`import { setJavaHome } from './jdtls/client.js'`) and `tests/jdtls/client.test.ts:4` (`import { parseJavaVersion, detectJava, setJavaHome } from '../../src/jdtls/client.js'`) continue to work.

**Decision: `parseJavaVersion` and `resolveJavaExecutable`** — planner discretion per CONTEXT:
- Option A (recommended): move both to `java-discovery.ts`, re-export through `client.ts`. Keeps `client.ts` lean.
- Option B: keep `resolveJavaExecutable` in `client.ts` (it's the only consumer outside java-discovery would be future code), import into `java-discovery.ts`. Avoids a circular-ish dependency if `client.ts` ever needed something else from `java-discovery.ts`.

Test `tests/jdtls/client.test.ts:4` imports `parseJavaVersion, detectJava, setJavaHome` from `../../src/jdtls/client.js` — all three must remain accessible through `client.ts` regardless of physical location.

**What stays in `client.ts`:** `JavaDetectResult` / `JavaDetected` / `JavaNotFound` / `JdtLsFound` / `JdtLsNotFound` / `JdtLsFindResult` / `JdtLsStartResult` type exports, `findJdtLs`, `startJdtLs`, `waitForReady`, `shutdownJdtLs`. The result-type exports MAY also be re-exported from `java-discovery.ts` for cleaner downstream imports.

---

### `src/jdtls/startup.ts` (extend — domain orchestrator)

**Analog:** Self (lines 28–91 — the existing `initJdtLsSession` body is the analog for the extended signature).

**Existing signature** (`startup.ts:28`):
```typescript
export async function initJdtLsSession(): Promise<JdtLsSession>
```

**Extended signature** (D-02 / D-10):
```typescript
export async function initJdtLsSession(opts: { projectRoot?: string } = {}): Promise<JdtLsSession>
```
Zero-arg call at `src/index.ts:21` (`await initJdtLsSession()`) continues to work because `opts` defaults to `{}` (D-06).

**Migration of line 29** — D-10:
```typescript
// Before:
const java = detectJava();
// After:
const java = await discoverJava({ projectRoot: opts.projectRoot });
```
The early-return for `java.javaPath === null` at lines 31-40 stays byte-identical — `java.error` already carries the multi-line failureReason from `discoverJava`.

**`retryDegradedJdtLsSessions()`** — NEW free function. Per CONTEXT "Claude's Discretion" default: co-locate in `startup.ts`. Pattern:

```typescript
export async function retryDegradedJdtLsSessions(): Promise<void> {
	for (const project of projectStore.list()) {
		if (project.jdtls?.available !== false) continue;

		// Derive projectRoot from the first fabric mod child
		let projectRoot: string | undefined;
		for (const child of project.children.values()) {
			if (child.kind === 'fabric-mod') {
				projectRoot = child.rootPath;
				break;
			}
		}

		// Clean up old failed session's tempDir/dataDir before reconstructing
		const oldTempDir = project.jdtls.tempDir;
		const oldDataDir = project.jdtls.dataDir;
		// ... cleanup similar to src/index.ts:32-46 cleanupAllSessions pattern ...

		// Reconstruct (D-Discretion default: full re-init)
		try {
			const newSession = await initJdtLsSession({ projectRoot });
			project.jdtls = newSession;
			if (newSession.available) {
				logger.info(`JDT LS reinit succeeded for project '${project.name}'`);
			}
		} catch (err) {
			logger.warn(`JDT LS reinit failed for project '${project.name}'`, { error: String(err) });
		}
	}
}
```

**Project-store iteration pattern** — copy from `src/index.ts:33-46` (`cleanupAllSessions`):
```typescript
for (const project of projectStore.list()) {
	if (!project.jdtls) continue;
	// ... cleanup ...
}
```

**FabricMod rootPath access** — copy idiom from `src/tools/tool-helpers.ts:67-77` (`getRootPathForScope`):
```typescript
let rootPath: string | undefined;
for (const child of project.children.values()) {
	if (child.kind === 'fabric-mod') {
		rootPath = child.rootPath;
		break;  // First fabric mod wins per D-03
	}
}
```

**TempDir cleanup pattern** — copy from `src/index.ts:35-44`:
```typescript
if (project.jdtls.tempDir) {
	try { await cleanupTempDir(project.jdtls.tempDir); } catch (err) {
		logger.warn('Failed to clean up tempDir', { dir: project.jdtls.tempDir, error: String(err) });
	}
}
```
`cleanupTempDir` lives in `src/jdtls/workspace.ts` (imported at `src/index.ts:9`).

---

### `src/tools/add-fabric-mod.ts` (extend — tool handler, request-response)

**Analog:** Self — append after the existing `syncFabricModToWorkspace` call at line 72.

**Imports addition:**
```typescript
import { retryDegradedJdtLsSessions } from '../jdtls/startup.js';
```

**Hook placement** — D-02 / D-04 / D-Discretion default:
```typescript
const syncResult = await syncFabricModToWorkspace(fabricMod, loadedProject.jdtls, jarReader);
if (syncResult.warning) {
	logger.warn(`Workspace sync for '${fabricMod.name}': ${syncResult.warning}`);
}

// Phase 37: retry any degraded JDT LS sessions — unconditional (D-04)
await retryDegradedJdtLsSessions();
```
Unconditional invocation per D-04 — don't gate on whether the new mod's gradle.properties has `org.gradle.java.home`. The 3s per-candidate timeout caps worst-case latency.

**Error envelope pattern** — keep existing try/catch from `add-fabric-mod.ts:30-101`. The retry must NOT throw past the handler — `retryDegradedJdtLsSessions` handles its own errors internally.

**D-05 — new-project's own JDT LS spawn:** This phase's add_fabric_mod handler does NOT currently create a new project (it adds to an existing project). The "new project gets its own discoverJava call with its own projectRoot" applies to `create_project` flow — out of scope for this hook. Today's behavior: every fabric mod added joins `loadedProject` (typically `'default'`), inheriting that project's JDT LS session. The retry hook is sufficient.

---

### `src/tools/refresh-project.ts` (extend — tool handler, request-response)

**Analog:** Self — append retry hook after the `for (const mod of mods)` loop completes at line 109, before `autoUnloadConflictingStudyJars` at line 111.

**Imports addition:** Same as add-fabric-mod (`retryDegradedJdtLsSessions`).

**Hook placement** — insert between line 109 and line 110:
```typescript
combinedSummaries.push({ modName: mod.name, ...result.summary });
}  // end of for-loop on line 108

// Phase 37: retry any degraded JDT LS sessions after gradle.properties re-parse
await retryDegradedJdtLsSessions();

// Study jar collision check against ALL children's deps
const unloadedNames = await autoUnloadConflictingStudyJars(...)
```

---

### `src/tools/refresh-project-members.ts` (extend — tool handler, request-response)

**Analog:** Self — append retry hook after `for (const mod of modsToRefresh)` loop at line 138, before the `allRefreshedDeps` aggregation at line 141.

**Imports addition:** Same as above.

**Hook placement** — insert between line 138 and line 140:
```typescript
combinedSummaries.push({ modName: mod.name, ...result.summary });
}  // end of for-loop on line 138

// Phase 37: retry any degraded JDT LS sessions after gradle.properties re-parse
await retryDegradedJdtLsSessions();

// Study jar collision check: only against the refreshed members' deps
const allRefreshedDeps = new Map<string, DependencyEntry>();
```

---

### `tests/jdtls/java-discovery.test.ts` (NEW — cross-platform test)

**Analog:** Composite of `tests/jdtls/client.test.ts:1-340` (mock setup, detectJava describes, Windows-mocked describes) + `tests/platform/index.test.ts:1-44` (setPlatform helper).

**File-header boilerplate** — copy from `tests/jdtls/client.test.ts:1-32`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';

vi.mock('node:child_process', async () => {
	const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
	return {
		...actual,
		execFile: vi.fn(),
	};
});

vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
	};
});

vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	return {
		...actual,
		readdir: vi.fn(),
		readFile: vi.fn(actual.readFile),
	};
});

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
```
**Critical reuse note (Pitfall 6 from Phase 35/36 patterns):** `{ ...actual, readdir: vi.fn() }` — the spread is MANDATORY, otherwise every other fs/promises function (`mkdir`, `writeFile`, etc. used elsewhere in tests transitively) becomes undefined.

**Platform-mocked describe pattern** — copy from `tests/jdtls/client.test.ts:176-189` and `tests/platform/index.test.ts:23-29`. Every test that flips platform MUST:
1. `setPlatform('win32')` (or `'linux'` / `'darwin'`)
2. `vi.resetModules()`
3. `await import('../../src/jdtls/java-discovery.js')` — dynamic import AFTER reset

```typescript
describe('discoverJava on Linux', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReaddir = vi.mocked(readdir);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReaddir.mockReset();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('priority order: --java-home wins over JAVA_HOME', async () => {
		process.env.JAVA_HOME = '/env/java';
		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome('/cli/java');

		mockExecFile.mockImplementation((file, args, opts, cb) => {
			// promisify(execFile) callback signature: (err, { stdout, stderr })
			(cb as any)(null, { stdout: 'openjdk 21.0.1 2023-10-17', stderr: '' });
			return {} as any;
		});

		const result = await discoverJava({});
		expect(result.javaPath).toBe('/cli/java/bin/java');
		const firstCall = mockExecFile.mock.calls[0];
		expect(firstCall[0]).toContain('/cli/java/bin/java');
	});
});
```

**`execFile`-callback mocking pattern** — `promisify(execFile)` wraps the standard callback form. To mock, intercept the callback-style signature: `mockImplementation((file, args, opts, cb) => cb(null, { stdout, stderr }))`. For timeout simulation, invoke `cb(new Error('killed'), null)` with `{ signal: 'SIGTERM' }` or `{ killed: true }` annotated.

**Test coverage required** (per CONTEXT `Files this phase modifies / creates`):
1. Priority order: 5 slots in correct sequence
2. Version-skip continuation: version-too-old does NOT short-circuit
3. Backslash unescape: `C:\\Users\\foo` and `C:/Users/foo` and `\\u0043:\\Users` (UTF-16 escape) all parse to the same path
4. Per-candidate 3s timeout: simulated `SIGTERM` produces `timed out after 3s` in failureReason
5. Vendor enumeration: macOS bundle layout, Homebrew openjdk* filter, Scoop current/, `/opt` filter
6. Version-hint sort: within a parent, `temurin-21.jdk` probed before `temurin-17.jdk`
7. Multi-line error message: starts with `Java not found.`, contains each slot label

**`detectJava` parity tests** — re-import from `client.ts` (post-shim) and verify all five existing tests in `tests/jdtls/client.test.ts:64-131` still pass (D-09: byte-identical surface). These do NOT need to be duplicated — the shim re-export guarantees they keep working.

**`unescapePropertiesValue` unit tests** — pure function, no fs/platform mocking needed:
```typescript
describe('unescapePropertiesValue', () => {
	it('unescapes double backslash', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('C:\\\\Users\\\\foo')).toBe('C:\\Users\\foo');
	});
	it('unescapes UTF-16 hex sequences', async () => {
		// ...
	});
});
```

---

### `tests/jdtls/startup.test.ts` (extend — test)

**Analog:** Self — extend existing describes at lines 55-231.

**Existing mock at lines 10-14** must add `discoverJava`:
```typescript
vi.mock('../../src/jdtls/client.js', () => ({
	detectJava: vi.fn(),
	discoverJava: vi.fn(),  // NEW
	findJdtLs: vi.fn(),
	startJdtLs: vi.fn(),
}));
```
Note: `client.ts` is now a re-export shim, so mocking `client.js` still intercepts the symbols (vitest hoist works against the import path the SUT uses).

**Existing 5 tests at lines 69-230** — convert `mockDetectJava.mockReturnValue(...)` to `mockDiscoverJava.mockResolvedValue(...)` since `discoverJava` is async. The shape stays identical (`{ javaPath, version }` or `{ javaPath: null, error }`). The first test at line 69 (`returns available=false with failureReason when Java not found`) keeps its `toContain('Java not found')` assertion — D-18 guarantees the prefix.

**New describes for `initJdtLsSession({ projectRoot })`**:
```typescript
describe('initJdtLsSession with projectRoot', () => {
	it('passes projectRoot through to discoverJava', async () => {
		mockDiscoverJava.mockResolvedValue({ javaPath: '/usr/bin/java', version: 21 });
		mockFindJdtLs.mockReturnValue({ jdtlsHome: '/opt/jdtls' });
		// ... mock startJdtLs setup from existing test at line 115 ...

		await initJdtLsSession({ projectRoot: '/work/my-mod' });

		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: '/work/my-mod' });
	});

	it('zero-arg call passes projectRoot: undefined (D-06)', async () => {
		mockDiscoverJava.mockResolvedValue({ javaPath: '/usr/bin/java', version: 21 });
		// ...
		await initJdtLsSession();
		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: undefined });
	});
});
```

**New describes for `retryDegradedJdtLsSessions()`**:
```typescript
describe('retryDegradedJdtLsSessions', () => {
	it('sweeps all projects with jdtls.available === false', async () => {
		// Seed projectStore with two projects, one degraded
		// Call retryDegradedJdtLsSessions()
		// Assert discoverJava called once per degraded project with correct projectRoot
	});

	it('skips projects with available=true', async () => {
		// ...
	});

	it('uses first fabric mod child rootPath as projectRoot (D-03)', async () => {
		// ...
	});

	it('replaces project.jdtls atomically on retry success', async () => {
		// ...
	});

	it('logs warning but does not throw on retry failure', async () => {
		// ...
	});
});
```

**`createMockProcess` helper** — copy verbatim from `tests/jdtls/startup.test.ts:33-53`. Reused for retry-success tests that need a fake ChildProcess.

---

## Shared Patterns

### Tab Indentation, ESM with `.js` Extensions
**Source:** `CLAUDE.md` Conventions section + every file in the codebase
**Apply to:** Every new and modified file
- Tabs for indentation, never spaces
- All relative imports end in `.js` even though the source is `.ts` (ESM ts-node convention)
- All cross-module imports use the explicit extension

### Logger Pattern
**Source:** `src/logging/logger.ts:29-32`
**Apply to:** Per-candidate skip logging (D-20), retry success/failure (`retryDegradedJdtLsSessions`)
```typescript
logger.debug('Java candidate skipped', { candidate, reason });
logger.info(`JDT LS reinit succeeded for project '${project.name}'`);
logger.warn(`JDT LS reinit failed for project '${project.name}'`, { error: String(err) });
```
The `data?` arg is JSON-stringified for non-string values (`logger.ts:23`). Don't pre-stringify; just pass an object.

### Error / Result Envelope
**Source:** `src/jdtls/client.ts:20-30` (`JavaDetectResult` discriminated union)
**Apply to:** `discoverJava` return type — keep flat `{ javaPath, error }` shape per D-19. Do NOT widen `tried[]` to structured `{candidate, reason}[]`. The detailed per-candidate outcomes live in the human-readable `error` (failureReason) string and in `logger.debug` audit trail only.

### Tool Error Envelope (for tool handlers)
**Source:** `src/tools/tool-helpers.ts:179-185` (`returnError`) and `src/types/envelope.ts:31-39` (`makeError`)
**Apply to:** Retry hooks must NOT throw past the tool handler. Wrap `retryDegradedJdtLsSessions` errors internally with `logger.warn`. The tool handler's existing `makeSuccess` envelope is unaffected.

### `setPlatform + vi.resetModules + dynamic import` Test Pattern
**Source:** `tests/platform/index.test.ts:10-22` (helper definition), `tests/jdtls/client.test.ts:27-32, 176-189` (platform-mocked describes)
**Apply to:** Every new test in `tests/jdtls/java-discovery.test.ts` that asserts behavior under a specific `process.platform`. The platform-dependent module reads `process.platform` at module-load time into `isWindows`, so every flip MUST be followed by `vi.resetModules()` and a fresh dynamic `import()`.

### `{ ...actual, named: vi.fn() }` Mock Pattern
**Source:** `tests/jdtls/client.test.ts:6-20`, `tests/jdtls/workspace-sync.test.ts:27-33` (Pitfall 6 documented inline)
**Apply to:** Every `vi.mock('node:fs')` / `vi.mock('node:fs/promises')` / `vi.mock('node:child_process')` in `tests/jdtls/java-discovery.test.ts`. **MANDATORY spread** — without it, untouched named exports vanish.

### Project-Store Iteration
**Source:** `src/index.ts:33` (`for (const project of projectStore.list())`)
**Apply to:** `retryDegradedJdtLsSessions` — iterate every project, check `project.jdtls?.available === false`.

### FabricMod `rootPath` Lookup
**Source:** `src/tools/tool-helpers.ts:67-77` (`getRootPathForScope`)
**Apply to:** `retryDegradedJdtLsSessions` — for each degraded project, scan children for the first `kind === 'fabric-mod'` and use its `rootPath`. If none, `projectRoot = undefined` (project stays degraded; nothing new is reachable).

### TempDir Cleanup on Reconstruct
**Source:** `src/index.ts:33-46` (`cleanupAllSessions`)
**Apply to:** `retryDegradedJdtLsSessions` reconstruct path — before replacing the degraded session, `cleanupTempDir(oldSession.tempDir)` and `cleanupTempDir(oldSession.dataDir)`. Wrap in try/catch + `logger.warn` per the existing pattern.

---

## No Analog Found

None. Every file Phase 37 touches has a strong existing analog in the codebase, either:
- Carved-out subset of `client.ts` (java-discovery.ts)
- Self-extension (startup.ts, three tool handlers, tests)
- Composite of existing test patterns (java-discovery.test.ts)

The only genuinely new mechanic — async `execFile` with per-candidate timeout — has no existing usage in `src/` but the Node.js stdlib pattern (`promisify(execFile)` + `{ timeout: 3_000 }`) is canonical and well-documented.

---

## Metadata

**Analog search scope:**
- `src/jdtls/` — client.ts, startup.ts, types.ts, workspace.ts
- `src/tools/` — add-fabric-mod.ts, refresh-project.ts, refresh-project-members.ts, tool-helpers.ts
- `src/platform/` — index.ts (carry-forward source)
- `src/project/` — gradle-parser.ts, loader.ts, types.ts
- `src/state/` — project-store.ts
- `src/types/` — envelope.ts
- `src/logging/` — logger.ts
- `src/index.ts`
- `tests/jdtls/` — client.test.ts, startup.test.ts, workspace-sync.test.ts
- `tests/platform/` — index.test.ts, uri.test.ts

**Files scanned:** ~20 (focused on Phase 37's modify-list and the Phase 35/36 carry-forward dependencies named in CONTEXT)

**Pattern extraction date:** 2026-05-16
