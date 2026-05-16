# Phase 36: Path / URI Handling Audit — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 11 (2 NEW, 9 MODIFIED)
**Analogs found:** 11 / 11

This map is the planner's concrete-citation source. Every `<action>` in the upcoming PLAN.md files should cite a section here for the verbatim "before" code, the analog to copy from, and the "after" shape implied by Phase 36's decisions.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/platform/uri.ts` (NEW) | utility (pure helper module) | transform (string ↔ URI string) | `src/platform/index.ts` (Phase 35 sibling) | exact (same module slot, same pure-no-I/O contract, same JSDoc shape) |
| `tests/platform/uri.test.ts` (NEW) | test (unit, platform-mocked) | request-response | `tests/platform/index.test.ts` (Phase 35) | exact (verbatim scaffolding reuse per D-21) |
| `src/jdtls/client.ts` (MODIFY) | service (LSP client) | event-driven (LSP send) | self (in-place edit at lines 245, 278) | self |
| `src/jdtls/workspace-sync.ts` (MODIFY) | service (filesystem + LSP notifier) | streaming (ZIP extract) + event-driven (LSP notify) + file-I/O (rm) | self (in-place edits at 11 sites) | self |
| `src/jdtls/uri-mapper.ts` (MODIFY) | utility (URI ↔ jar-entry mapper) | transform | self (in-place edit on `fromFileUri`) | self |
| `src/tools/remove-project-member.ts` (MODIFY) | tool (MCP handler) | event-driven (LSP notify) | self (in-place edit at line 83) | self |
| `src/tools/tool-helpers.ts` (MODIFY) | utility (shared tool helpers) | transform (LSP `Location.uri` → file path) | self (in-place edit at line 350) | self |
| `tests/jdtls/uri-mapper.test.ts` (MODIFY) | test (unit, platform-mocked add) | request-response | `tests/platform/index.test.ts` (for the new Windows-mocked describes) + self (existing structure) | exact for new describes |
| `tests/jdtls/workspace-sync.test.ts` (MODIFY) | test (unit, fs-mocked) | request-response | `tests/jdtls/client.test.ts` (for `vi.mock('node:fs/promises')` pattern) + self | exact for new describes |
| `tests/jdtls/client.test.ts` (MODIFY — optional) | test (unit) | request-response | self | self |

## Pattern Assignments

---

### `src/platform/uri.ts` (NEW — utility, transform)

**Analog:** `src/platform/index.ts` lines 1-28 (Phase 35 sibling pure-helper module).

**File-header pattern to copy** (from `src/platform/index.ts:1-18`):

```typescript
/**
 * Platform helpers — branched on `process.platform === 'win32'`.
 *
 * Pure module: no fs I/O, no child_process, no side effects. The only runtime
 * reads are `process.platform` (captured once at import time into `isWindows`)
 * and `process.env` lookups inside the directory helpers.
 *
 * Consumed by:
 *   - Phase 35 (this phase): `javaBinaryName` / `javaBinaryInHome` from `src/jdtls/client.ts`
 *   - Phase 36: file:// URI sweep helpers reuse `isWindows` for separator handling
 *   - Phase 37: `commonJavaLocations` + `javaBinaryName` for JDK auto-discovery globbing
 *   - Phase 38: `jdtlsCandidateDirs` for Windows JDT LS install probing
 *
 * Windows branches use `path.win32.join` so cross-host tests can assert exact
 * Windows-shaped strings even when running on macOS/Linux CI. Unix branches use
 * `path.posix.join` and are required to return the v1.5 literals verbatim
 * (UNIX-01 byte-identical commitment).
 */
```

**Pure-import pattern** (from `src/platform/index.ts:20-21`): single `import` block from `node:*` only — no `fs`, no `child_process`, no project imports.

**Named-const + helper-function pattern** (from `src/platform/index.ts:23-37`):

```typescript
/**
 * `true` when running on Windows (`process.platform === 'win32'`). Captured
 * once at module import; tests that need to flip platforms must call
 * `vi.resetModules()` and dynamically re-import this module.
 */
export const isWindows: boolean = process.platform === 'win32';

/**
 * Filename of the Java launcher on the current platform.
 *
 * @returns `'java.exe'` on Windows, `'java'` on every other platform.
 */
export function javaBinaryName(): string {
	return isWindows ? 'java.exe' : 'java';
}
```

**Apply to `src/platform/uri.ts`:** keep the same docstring shape (purpose + pure-module declaration + consumer enumeration + per-function JSDoc with @param/@returns); two exported helpers (`pathToFileUri`, `fileUriToPath`) wrapping `node:url`'s `pathToFileURL(p).href` and `fileURLToPath(u)`. Body of each function is one expression. Per RESEARCH.md §"Pattern 1" lines 612-645 (full canonical code already supplied there — planner cites verbatim into the action block). Tab indentation. Per D-01: do NOT add convenience helpers (`isFileUri`, `windows: true` option) unless a callsite requires it.

**What NOT to copy from `src/platform/index.ts`:** the `homedir` import (uri.ts has no env reads), the `path.win32`/`path.posix` flavor split (uri.ts has no branches), the `commonJavaLocations`/`jdtlsCandidateDirs` shape (different concern).

---

### `tests/platform/uri.test.ts` (NEW — test, unit, platform-mocked)

**Analog:** `tests/platform/index.test.ts` lines 1-21 + lines 23-66 (verbatim scaffolding reuse per D-21).

**Scaffolding pattern to copy verbatim** (from `tests/platform/index.test.ts:1-21`):

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { posix as pathPosix } from 'node:path';

// Capture host environment once so afterEach can restore it. `isWindows` in
// src/platform/index.ts is a module-load-time const, so every test that flips
// the platform MUST call vi.resetModules() and dynamically re-import the
// module AFTER setPlatform() has run.

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
	setPlatform(originalPlatform);
	process.env = { ...originalEnv };
	vi.resetModules();
});
```

**Per-test shape** (from `tests/platform/index.test.ts:24-29`):

```typescript
it('Windows: isWindows is true under win32', async () => {
	setPlatform('win32');
	vi.resetModules();
	const { isWindows } = await import('../../src/platform/index.js');
	expect(isWindows).toBe(true);
});
```

**Apply to `tests/platform/uri.test.ts`:**
- Drop the `homedir` / `pathPosix` imports (not needed for uri.test.ts; uri.ts has no env reads or path-flavor split).
- Substitute the dynamic import target: `await import('../../src/platform/uri.js')`.
- Test bodies follow REQ-ID mapping from RESEARCH.md §"REQ-ID → Test Mapping" lines 425-441 (WIN-03 three-slash form + `%20` for spaces; UNIX-02 round-trip identity for `/private/var/folders/x y/file.java`, `/tmp/foo`, `/tmp/path%with#odd$chars`, `/foo%2520bar`).
- WIN-03 test must use `setPlatform('win32') + vi.resetModules() + await import(...)` and assert `pathToFileUri('C:\\path\\to\\file').startsWith('file:///C:')`. NOTE Pitfall 5 (RESEARCH.md line 787): `pathToFileURL` on darwin host with `setPlatform('win32')` does NOT switch URL flavor — if the test needs Windows-shaped URLs from a non-Windows host, prefer asserting only on the helper-output shape that doesn't depend on `path.win32` semantics, OR (per Open Landmine 7) decide whether `pathToFileUri` should expose `{ windows: true }`. Planner: surface this in the test-plan section if implementation hits a snag.

---

### `src/jdtls/client.ts` lines 245, 278 (MODIFY — service, event-driven LSP send)

**Analog:** self (in-place edit).

**Current "before" code** (verbatim from `src/jdtls/client.ts:243-279`, F1 + F2):

```typescript
		// Send initialize request
		await client.initialize({
			processId: process.pid,
			rootUri: 'file://' + workspaceDir,
			capabilities: {
				textDocument: {
					definition: { dynamicRegistration: false },
					// ... (truncated for brevity — preserved unchanged)
				},
			},
			initializationOptions: { /* ... unchanged ... */ },
			workspaceFolders: [{ uri: 'file://' + workspaceDir, name: 'sources' }],
		});
```

**"After" shape (D-03, F1 + F2):**

```typescript
		rootUri: pathToFileUri(workspaceDir),
		// ...
		workspaceFolders: [{ uri: pathToFileUri(workspaceDir), name: 'sources' }],
```

**Import to add** (top of file): `import { pathToFileUri } from '../platform/uri.js';`

**Action block guidance:** Two single-token replacements (`'file://' + workspaceDir` → `pathToFileUri(workspaceDir)`) plus one new import. Keep all surrounding object-literal structure byte-identical.

---

### `src/jdtls/workspace-sync.ts` lines 103, 141, 206, 255 (MODIFY — 4 forward URI sites F3–F6)

**Analog:** self (in-place edit). All four sites have **identical** code shape — same one-line transformation.

**Current "before" code** (verbatim from `src/jdtls/workspace-sync.ts:102-104`, exemplar — sites 141, 206, 255 are byte-identical except for surrounding function context):

```typescript
		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
		});
```

**"After" shape (D-03):**

```typescript
		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: pathToFileUri(join(resolvedTempDir, '.classpath')), type: 2 }],
		});
```

**Why `join(resolvedTempDir, '.classpath')` instead of `resolvedTempDir + '/.classpath'`:** `pathToFileURL` takes a filesystem path, not a string with embedded `/`. On Windows, `resolvedTempDir + '/.classpath'` is a mixed-separator string that `pathToFileURL` would treat as one segment; `join(resolvedTempDir, '.classpath')` produces a platform-native path (backslashes on Windows, forward slashes on Unix) which `pathToFileURL` correctly transforms. `join` is already imported at `src/jdtls/workspace-sync.ts:11`.

**Import to add** (top of file): `import { pathToFileUri } from '../platform/uri.js';`

**CONTEXT.md discrepancy resolved:** CONTEXT.md `<canonical_refs>` line 110 says line 252 for the 4th site; **HEAD says line 255** and ROADMAP also says 255. RESEARCH.md §"Site List Verification" line 194 confirms 255 via `grep -n`. **Planner MUST use line 255 in the action block.**

---

### `src/jdtls/workspace-sync.ts` lines 40, 184 (MODIFY — 2 ZIP-extraction sites Z1, Z2)

**Analog:** self (in-place edit) + RESEARCH.md §"ZIP-Slip Canonical Pattern" lines 263-296.

**Current "before" code** (verbatim from `src/jdtls/workspace-sync.ts:39-44`, Z1 — Z2 at 183-188 is byte-identical except for surrounding loop variables):

```typescript
		for (const entryPath of entries) {
			const targetPath = join(depDir, entryPath);
			await mkdir(dirname(targetPath), { recursive: true });
			const content = await adapter.readEntry(entryPath);
			await writeFile(targetPath, content);
		}
```

**"After" shape (D-12, D-13, D-14, D-15):**

```typescript
		for (const entryPath of entries) {
			const segments = entryPath.split('/');
			const targetPath = join(depDir, ...segments);
			const resolvedTarget = resolve(targetPath);
			const resolvedRoot = resolve(depDir) + sep;
			if (!resolvedTarget.startsWith(resolvedRoot)) {
				logger.warn('ZIP traversal rejected', { depDir, entryPath });
				throw new Error(`ZIP entry path escapes extraction root: ${entryPath}`);
			}
			await mkdir(dirname(targetPath), { recursive: true });
			const content = await adapter.readEntry(entryPath);
			await writeFile(targetPath, content);
		}
```

**Imports to add** (top of file):
- Update existing `node:path` import: `import { join, dirname, resolve, sep } from 'node:path';` (currently `import { join, dirname } from 'node:path';` at line 11)
- Add `logger` import: `import { logger } from '../logging/logger.js';` (workspace-sync.ts does not currently import logger — verify against existing logger import convention seen in `src/tools/remove-project-member.ts:7`: `import { logger } from '../logging/logger.js';`)

**Cleanup reuse (D-14):** The existing `try/catch` at `workspace-sync.ts:35-50` (extractStudyJarToWorkspace) and `:170-221` (syncFabricModToWorkspace) already runs `await rm(depDir, { recursive: true, force: true })` in the catch path — the new `throw` flows through unchanged. No new error handling.

---

### `src/jdtls/workspace-sync.ts` lines 48, 62, 215, 245 (MODIFY — 4 `rm` retry sites M1–M4)

**Analog:** self (in-place edit). All four sites are single-line `await rm(...)` calls with the same option-object pattern.

**Current "before" code** (verbatim from each site):

- M1 (`workspace-sync.ts:48`, inside `extractStudyJarToWorkspace` catch):
  ```typescript
  		} catch (err) {
  			await rm(depDir, { recursive: true, force: true });
  			throw err;
  		}
  ```
- M2 (`workspace-sync.ts:62`, inside `removeStudyJarFromWorkspace`):
  ```typescript
  	const depDir = join(tempDir, dirName);
  	await rm(depDir, { recursive: true, force: true });
  }
  ```
- M3 (`workspace-sync.ts:215`, inside `syncFabricModToWorkspace` catch loop):
  ```typescript
  		for (const dir of createdDirs) {
  			try { await rm(dir, { recursive: true, force: true }); } catch {}
  		}
  ```
- M4 (`workspace-sync.ts:245`, inside `unsyncFabricModFromWorkspace` for-loop):
  ```typescript
  	for (const depId of keysToRemove) {
  		const dirName = jarIdToDirName(depId);
  		await rm(join(jdtls.tempDir, dirName), { recursive: true, force: true });
  		jdtls.jarIdToDirName.delete(depId);
  	}
  ```

**"After" shape (D-17, D-18, D-19 — single-line option-object expansion at each site):**

```typescript
await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
```

No `isWindows` guard (D-19). No new imports. No restructuring of surrounding try/catch (D-20).

---

### `src/jdtls/uri-mapper.ts` lines 75-103 (MODIFY — drive-letter case-fold in `fromFileUri`)

**Analog:** self (in-place edit) + RESEARCH.md §"Pattern 2: Drive-letter case-fold" lines 650-696 + §"State Machine" lines 322-364.

**Current "before" code** (verbatim from `src/jdtls/uri-mapper.ts:74-103`):

```typescript
	return {
		toFileUri(jarId: string, entryPath: string): string {
			const dirName = jarIdToDirNameMap.get(jarId) ?? jarIdToDirName(jarId);
			return `file://${normalizedTempDir}/${dirName}/${entryPath}`;
		},

		fromFileUri(uri: string): UriMapping | null {
			const prefix = `file://${normalizedTempDir}/`;
			if (!uri.startsWith(prefix)) {
				return null;
			}

			const rest = uri.slice(prefix.length);
			const slashIndex = rest.indexOf('/');
			if (slashIndex === -1) {
				return null;
			}

			const dirName = rest.slice(0, slashIndex);
			const entryPath = rest.slice(slashIndex + 1);

			// Cross-check against the known jar ID map
			const jarId = dirNameToJarIdMap.get(dirName);
			if (jarId === undefined) {
				return null;
			}

			return { jar: jarId, entryPath };
		},
	};
```

**"After" shape (D-08, D-09, D-10, D-11):** replace the `if (!uri.startsWith(prefix)) return null;` check with the surgical `prefixMatches(uri, prefix)` state machine. Keep the rest of the slice/parse logic byte-identical. Full canonical body in RESEARCH.md lines 652-695.

**Imports to add** (top of file): `import { isWindows } from '../platform/index.js';`

**Open Landmine 8 decision (RESEARCH.md lines 1032-1040):** the planner must decide whether `toFileUri` ALSO migrates internally to `pathToFileUri(normalizedTempDir)` to emit three-slash URIs. D-02 says it MAY use the helpers as building blocks; RESEARCH.md recommends doing so to keep the case-fold regex matching the emitted shape. Otherwise `toFileUri` still emits the broken two-slash `file://C:\…` form on Windows and the case-fold never sees a drive-letter-shaped URI to fold.

**Recommendation for planner:** Yes, migrate `toFileUri` internally — change line 77 from `\`file://${normalizedTempDir}/${dirName}/${entryPath}\`` to `\`${pathToFileUri(normalizedTempDir)}/${dirName}/${entryPath}\`` (or rebuild the prefix at mapper-creation time once via `const prefix = pathToFileUri(normalizedTempDir) + '/';`). This is the only way the drive-letter case-fold matters: the `DRIVE_LETTER_URI` regex requires three-slash shape (`/^file:\/\/\/[A-Za-z]:/`), and Windows `normalizedTempDir` is a `C:\…` Windows path that the two-slash concatenation would emit as `file://C:\…` (no drive-letter-shaped URI in sight).

**Drive-letter constant (RESEARCH.md line 658):**

```typescript
const DRIVE_LETTER_URI = /^file:\/\/\/[A-Za-z]:/;
```

**Helper function shape (RESEARCH.md lines 660-675):**

```typescript
function prefixMatches(uri: string, prefix: string): boolean {
	if (isWindows && DRIVE_LETTER_URI.test(uri) && DRIVE_LETTER_URI.test(prefix)) {
		if (uri.length < prefix.length) return false;
		if (uri.slice(0, 8) !== prefix.slice(0, 8)) return false;
		if (uri[8].toLowerCase() !== prefix[8].toLowerCase()) return false;
		if (uri.slice(9, prefix.length) !== prefix.slice(9)) return false;
		return true;
	}
	return uri.startsWith(prefix);
}
```

---

### `src/tools/remove-project-member.ts` line 83 (MODIFY — forward URI site F7)

**Analog:** self (in-place edit).

**Current "before" code** (verbatim from `src/tools/remove-project-member.ts:80-87`):

```typescript
								if (jdtls.endpoint) {
									jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
										changes: [{
											uri: 'file://' + resolvedTempDir + '/.classpath',
											type: 2,
										}],
									});
								}
```

**"After" shape (D-03, F7):**

```typescript
									uri: pathToFileUri(join(resolvedTempDir, '.classpath')),
```

**Import to add** (top of file): `import { pathToFileUri } from '../platform/uri.js';`

**Note:** `join` is already imported at `src/tools/remove-project-member.ts:13` (`import { join } from 'node:path';`). No path-import change needed.

**OUT OF SCOPE here:** `src/tools/remove-project-member.ts` has 2 additional `rm` calls at lines 96 and 104 that would benefit from retry options. **CONTEXT.md D-17 does NOT include these** (the locked set is the 4 in workspace-sync.ts). RESEARCH.md §"`rm` retry sites" line 250 flags this; Open Question 3 (RESEARCH.md lines 1087-1093) confirms it. **Planner: do NOT add retry options to lines 96/104 of remove-project-member.ts in this phase. Surface as deferred follow-up.**

---

### `src/tools/tool-helpers.ts` line 350 (MODIFY — reverse consumer R1)

**Analog:** self (in-place edit).

**Current "before" code** (verbatim from `src/tools/tool-helpers.ts:346-358`):

```typescript
	for (const loc of locations) {
		const mapping = uriMapper.fromFileUri(loc.uri);
		if (!mapping) continue;

		const filePath = loc.uri.replace('file://', '');
		let source = sourceCache.get(filePath);
		if (source === undefined) {
			try {
				source = await readFile(filePath, 'utf-8');
				sourceCache.set(filePath, source);
			} catch {
				continue;
			}
		}
```

**"After" shape (D-03, R1):**

```typescript
		const filePath = fileUriToPath(loc.uri);
```

**Import to add** (top of file): `import { fileUriToPath } from '../platform/uri.js';`

**Open Landmine 2 / Open Question 4 decision (RESEARCH.md lines 1004-1008, 1093-1099):** `fileURLToPath` throws `TypeError` on malformed input. JDT LS is the only source of `loc.uri` here and emits well-formed URIs, so a try/catch around `fileUriToPath(loc.uri)` is not required. **Planner recommendation:** no try/catch; if a malformed URI ever appears it surfaces as a tool error which is the correct loud-failure behavior. Defer hardening if a real-world bug surfaces.

---

### `tests/jdtls/uri-mapper.test.ts` (MODIFY — add Windows-mocked describe block)

**Analog for new describes:** `tests/platform/index.test.ts:1-21` (scaffolding) + RESEARCH.md §"Code Examples → Drive-letter case-fold test (WIN-05 / D-23)" lines 854-924.

**Existing structure to preserve** (from `tests/jdtls/uri-mapper.test.ts:1-7`):

```typescript
import { describe, it, expect } from 'vitest';
import {
	jarIdToDirName,
	dirNameToJarId,
	entryPathToClassName,
	createUriMapper,
} from '../../src/jdtls/uri-mapper.js';
```

The existing 8+ describes (jarIdToDirName, dirNameToJarId, round-trip, createUriMapper → toFileUri, fromFileUri, round-trip) at lines 9-170+ stay unchanged.

**New describes to add** (per RESEARCH.md REQ-ID mapping lines 429-432):
1. `'Windows: fromFileUri accepts uppercase or lowercase drive letter'` — `setPlatform('win32') + vi.resetModules() + await import(...)`; `normalizedTempDir='C:\\Users\\test\\Temp\\xyz'`; assert both `file:///C:/...` and `file:///c:/...` return the same mapping.
2. `'Windows: fromFileUri rejects different drive letter'` — same setup; `file:///D:/...` → `null`.
3. `'Windows: fromFileUri does NOT case-fold UNC URIs'` — UNC `normalizedTempDir`; `file://SERVER/...` vs stored `file://server/...` → `null`.
4. `'Windows: fromFileUri preserves jar-entry tail case'` — assert returned `entryPath` is byte-exact with inbound URI tail.

**Scaffolding to add** (verbatim from `tests/platform/index.test.ts:10-21`, top of file):

```typescript
import { vi, afterEach } from 'vitest'; // augment existing vitest import

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
	setPlatform(originalPlatform);
	vi.resetModules();
});
```

**Per-test pattern** (mirror `tests/platform/index.test.ts:24-29`):

```typescript
it('Windows: fromFileUri accepts uppercase or lowercase drive letter', async () => {
	setPlatform('win32');
	vi.resetModules();
	const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
	// ... mapper setup + assertions
});
```

---

### `tests/jdtls/workspace-sync.test.ts` (MODIFY — add traversal-rejection + rm-options describes)

**Analog for `vi.mock('node:fs/promises')` pattern:** `tests/jdtls/client.test.ts:6-20` (existing `vi.mock('node:fs')` pattern — copy the shape, swap `node:fs` for `node:fs/promises`).

**Existing structure to preserve** (from `tests/jdtls/workspace-sync.test.ts:1-18`):

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
// ... existing imports + helper factories (createMockJarReader, createMockStudyJar, etc.)
```

**vi.mock pattern to copy** (analog from `tests/jdtls/client.test.ts:14-20`):

```typescript
vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
	};
});
```

**Apply to `workspace-sync.test.ts`:** wrap `node:fs/promises` with `...actual` spread plus a `rm: vi.fn(actual.rm)` to capture call args for the WIN-06 retry-options assertion. Pitfall 6 (RESEARCH.md line 794-811) warns about layered mocks — read it before writing.

**New describes to add** (per RESEARCH.md REQ-ID mapping lines 433-438):
- WIN-06: `'rm called with maxRetries: 3, retryDelay: 100 at every site'` — assert all 4 `rm` invocations received the retry options.
- WIN-07: 5 traversal-rejection tests (`..` segments, absolute Unix `/etc/passwd`, absolute Windows `C:/Windows/System32/calc.exe` Windows-mocked, `\\`-separator traversal Windows-mocked, trailing-prefix bypass `foo-attack` vs `foo`).

**Mock-entries pattern:** the existing `createMockJarReader(entries: Map<string, Map<string, Buffer>>)` factory at `tests/jdtls/workspace-sync.test.ts:20-35` already supports arbitrary entry paths — pass `new Map([['../etc/passwd', Buffer.from('x')]])` etc. No new factory needed.

---

### `tests/jdtls/client.test.ts` (MODIFY — optional snapshot for `rootUri` shape)

**Analog:** self (existing structure).

**Optional new describe** (per RESEARCH.md REQ-ID mapping line 427): `'rootUri uses three-slash file:/// on Windows'` — mock `LspClient.initialize` to capture args; assert `rootUri.match(/^file:\/\/\//)`. Reuse the existing `vi.mock('node:child_process')` and `setPlatform`/`originalPlatform` scaffolding already in place at lines 6-32.

**Planner discretion:** This test is optional (RESEARCH.md line 392 marks it as MODIFIED — optional). The core WIN-03 assertion is already covered by `tests/platform/uri.test.ts`'s direct `pathToFileUri` round-trip. Adding the client.test.ts snapshot is belt-and-suspenders integration coverage; defer if the planner wants a smaller wave.

---

## Shared Patterns

### Shared Pattern 1: ESM `.js`-suffixed imports

**Source:** every file in `src/` (e.g., `src/jdtls/workspace-sync.ts:12-17` — `import { jarIdToDirName } from './uri-mapper.js';`).

**Apply to:** every new and modified file in this phase. The new `src/platform/uri.ts` imports from `node:url` (no `.js` suffix needed for built-ins) and is imported from consumers as `'../platform/uri.js'` (with `.js`).

```typescript
// CORRECT
import { pathToFileUri } from '../platform/uri.js';
import { isWindows } from '../platform/index.js';

// WRONG
import { pathToFileUri } from '../platform/uri';      // no .js — breaks Node ESM resolution
import { pathToFileUri } from '../platform/uri.ts';   // .ts — TypeScript never emits this
```

### Shared Pattern 2: Tab indentation

**Source:** CLAUDE.md + every source file in the repo.

**Apply to:** every new and modified file. No spaces. The Write tool preserves whatever indentation the planner supplies in the action block — planner must use literal tab characters.

### Shared Pattern 3: Platform-flip test scaffolding (D-21)

**Source:** `tests/platform/index.test.ts:10-21` (verbatim — already shown in "tests/platform/uri.test.ts" pattern assignment above).

**Apply to:** every new Windows-mocked test in `tests/platform/uri.test.ts`, `tests/jdtls/uri-mapper.test.ts`, `tests/jdtls/workspace-sync.test.ts`, `tests/jdtls/client.test.ts`. Pattern: capture `originalPlatform`, define `setPlatform()`, restore in `afterEach`, always pair `setPlatform('win32')` with `vi.resetModules()` and dynamic `await import(...)`.

### Shared Pattern 4: Mocking a single named export of a `node:` built-in (carry-forward from Phase 35)

**Source:** `tests/jdtls/client.test.ts:14-20` (existing `vi.mock('node:fs')` pattern):

```typescript
vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
	};
});
```

**Apply to:** WIN-06 retry-options assertion in `tests/jdtls/workspace-sync.test.ts`. Swap `'node:fs'` for `'node:fs/promises'` and `existsSync` for `rm`. The `...actual` spread is mandatory — partial mocks of `node:fs/promises` that omit other exports (`mkdir`, `writeFile`, `readFile`) will break unrelated tests in the same file. See RESEARCH.md Pitfall 6 (lines 794-811) for the full interaction-with-existing-mocks discussion.

### Shared Pattern 5: Response envelope is NOT touched by this phase

**Source:** `src/types/envelope.ts` + CLAUDE.md "Tool response envelope" line.

**Apply to:** every modified tool file. Phase 36 does not change any `makeSuccess` / `makeError` call. The URI conversion happens in the body, not at the response boundary. No envelope-shape concerns.

### Shared Pattern 6: Logger import path

**Source:** `src/tools/remove-project-member.ts:7` — `import { logger } from '../logging/logger.js';`.

**Apply to:** `src/jdtls/workspace-sync.ts` (ZIP traversal warn log per D-15). The file does not currently import logger; add the import at the top.

---

## Cross-Cutting Notes for the Planner

### Note 1: Wave splitting (D-Discretion, CONTEXT.md line 84)

The planner decides how to split the work into plans. RESEARCH.md does not lock a wave structure. Suggested split (planner free to override):

1. **Wave A — new helper module + tests.** `src/platform/uri.ts` + `tests/platform/uri.test.ts`. Tiny, independently verifiable.
2. **Wave B — forward sweep (7 sites).** `src/jdtls/client.ts` (F1, F2) + `src/jdtls/workspace-sync.ts` (F3-F6) + `src/tools/remove-project-member.ts` (F7). All depend on Wave A. Add `tests/jdtls/client.test.ts` optional snapshot here.
3. **Wave C — reverse sweep (1 site).** `src/tools/tool-helpers.ts` (R1). Depends on Wave A. Trivial.
4. **Wave D — uri-mapper case-fold.** `src/jdtls/uri-mapper.ts` (`fromFileUri` state machine + internal `toFileUri` migration to `pathToFileUri`) + `tests/jdtls/uri-mapper.test.ts` (Windows-mocked describes). Depends on Wave A.
5. **Wave E — ZIP-extraction hardening (2 sites).** `src/jdtls/workspace-sync.ts` (Z1, Z2) + `tests/jdtls/workspace-sync.test.ts` (traversal-rejection describes).
6. **Wave F — `rm` retry hardening (4 sites).** `src/jdtls/workspace-sync.ts` (M1-M4) + `tests/jdtls/workspace-sync.test.ts` (rm-options describe). Independent of B/C/D/E.

Wave E and Wave F can run in parallel with B/C/D after A lands. Planner may also choose to merge E + F into a single "workspace-sync.ts hardening" plan since they touch the same file.

### Note 2: Open Landmine 8 (RESEARCH.md lines 1032-1040) — `uri-mapper.ts` internal migration

This is the most consequential planner decision. **Recommendation: yes, migrate `toFileUri` internally** (rebuild `prefix` at mapper-creation via `pathToFileUri(normalizedTempDir)`). Without this, the drive-letter case-fold has nothing to fold against on Windows because `toFileUri` still emits the broken `file://C:\…` two-slash form. See uri-mapper.ts pattern assignment above for the exact transformation.

### Note 3: Out-of-scope discipline

- `src/project/gradle-parser.ts:36` local `fileUriToPath` — divergent Gradle-DSL semantics; **do not touch.**
- `src/tools/remove-project-member.ts:96, 104` `rm` calls — NOT in CONTEXT.md D-17 locked set; **do not add retry options.** Surface as deferred follow-up in SUMMARY.md.
- `src/platform/index.ts` — Phase 35's pure-no-I/O contract; **do not modify.** New helpers live in sibling `src/platform/uri.ts`.

---

## No Analog Found

None. Every file has either a direct self-analog (in-place edits) or a Phase 35 sibling-module analog (the new files).

## Metadata

**Analog search scope:** `src/platform/`, `src/jdtls/`, `src/tools/`, `tests/platform/`, `tests/jdtls/`, `tests/tools/`.
**Files read this session:** `src/platform/index.ts` (1-60), `src/jdtls/client.ts` (235-294), `src/jdtls/uri-mapper.ts` (1-105 full), `src/jdtls/workspace-sync.ts` (1-260 sampled), `src/tools/remove-project-member.ts` (1-30 + 70-108), `src/tools/tool-helpers.ts` (1-25 + 340-370), `tests/platform/index.test.ts` (1-80), `tests/jdtls/uri-mapper.test.ts` (1-60), `tests/jdtls/workspace-sync.test.ts` (1-60), `tests/jdtls/client.test.ts` (1-60). Plus CONTEXT.md (full) and RESEARCH.md (§"Site List Verification", §"Recommended Project Structure", §"Pattern 1-4", §"REQ-ID → Test Mapping", §"Drive-Letter Case-Fold Logic").
**Pattern extraction date:** 2026-05-15.
