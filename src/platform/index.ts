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

import { win32 as pathWin32, posix as pathPosix } from 'node:path';
import { homedir } from 'node:os';

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

/**
 * Absolute path to the Java launcher inside a JDK home directory.
 *
 * Uses `path.win32.join` on Windows so the function returns a backslash-
 * separated `.exe`-suffixed path even when called from a macOS/Linux test
 * host. Uses `path.posix.join` on Unix so the result is byte-identical to
 * the v1.5 `join(home, 'bin', 'java')` literal (UNIX-01).
 *
 * @param javaHome - The JDK home directory (e.g. `'C:\\Program Files\\Java\\jdk-21'` or `'/usr/lib/jvm/temurin-21'`).
 * @returns Forced-flavor joined path to the launcher binary.
 */
export function javaBinaryInHome(javaHome: string): string {
	if (isWindows) {
		return pathWin32.join(javaHome, 'bin', 'java.exe');
	}
	return pathPosix.join(javaHome, 'bin', 'java');
}

/**
 * Candidate directories that may contain a JDT LS installation.
 *
 * Windows: four paths in priority order — `%LOCALAPPDATA%\jdtls`,
 * `%PROGRAMFILES%\jdtls`, `~\jdtls`, and the Mason (nvim) package path.
 * Missing env vars fall back to fixed literals so the function never
 * returns empty-string traversals.
 *
 * Unix: three paths verbatim from v1.5 (UNIX-01) — `~/.local/share/jdtls`,
 * `/usr/local/share/jdtls`, and `~/jdtls`.
 *
 * @returns Ordered list of directories to probe (existence checks happen elsewhere).
 */
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

/**
 * Parent directories that commonly contain JDK installations.
 *
 * Phase 35 ships data only — Phase 37 consumes this list and applies its
 * own glob patterns (e.g. `jdk-*`, `zulu-*`) to enumerate concrete JDK
 * homes. No glob characters appear in the returned strings.
 *
 * Windows: at least seven Program Files / homedir-rooted parents covering
 * Eclipse Adoptium, Microsoft, Oracle Java, Amazon Corretto, Azul Zulu,
 * IntelliJ-managed `~/.jdks`, and Scoop's `~/scoop/apps`.
 *
 * Darwin: macOS-canonical `/Library/Java/JavaVirtualMachines`, the
 * per-user equivalent under `~/Library/Java`, and the Homebrew opt prefixes
 * for Apple-silicon and Intel hosts.
 *
 * Other Unix: `/usr/lib/jvm` and `/opt`.
 *
 * @returns Ordered list of parent directories (NOT glob patterns).
 */
export function commonJavaLocations(): string[] {
	const home = homedir();
	if (isWindows) {
		const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
		return [
			pathWin32.join(programFiles, 'Eclipse Adoptium'),
			pathWin32.join(programFiles, 'Microsoft'),
			pathWin32.join(programFiles, 'Java'),
			pathWin32.join(programFiles, 'Amazon Corretto'),
			pathWin32.join(programFiles, 'Zulu'),
			pathWin32.join(home, '.jdks'),
			pathWin32.join(home, 'scoop', 'apps'),
		];
	}
	if (process.platform === 'darwin') {
		return [
			'/Library/Java/JavaVirtualMachines',
			pathPosix.join(home, 'Library', 'Java', 'JavaVirtualMachines'),
			'/opt/homebrew/opt',
			'/usr/local/opt',
		];
	}
	return [
		'/usr/lib/jvm',
		'/opt',
	];
}
