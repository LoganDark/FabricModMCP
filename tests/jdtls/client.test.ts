import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix as pathPosix, win32 as pathWin32 } from 'node:path';
import { globSync } from 'glob';
import { parseJavaVersion, detectJava, setJavaHome } from '../../src/jdtls/client.js';
import { logger } from '../../src/logging/logger.js';

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

vi.mock('glob', async () => {
	const actual = await vi.importActual<typeof import('glob')>('glob');
	return {
		...actual,
		// Default to empty array so tests that don't explicitly mock the return
		// value still get a sane "no matches" result rather than `undefined`.
		globSync: vi.fn(() => [] as string[]),
	};
});

// Capture host environment once so each new platform-mocking describe can
// restore it. `isWindows` in src/platform/index.ts is a module-load-time const,
// so any test that flips the platform MUST call vi.resetModules() and
// dynamically re-import src/jdtls/client.js (which transitively re-evaluates
// the platform module) AFTER setPlatform() has run.
const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

describe('parseJavaVersion', () => {
	it('parses OpenJDK 21 output', () => {
		const output = 'openjdk 21.0.1 2023-10-17\nOpenJDK Runtime Environment (build 21.0.1+12-29)\nOpenJDK 64-Bit Server VM (build 21.0.1+12-29, mixed mode, sharing)';
		expect(parseJavaVersion(output)).toBe(21);
	});

	it('parses OpenJDK 17 output', () => {
		const output = 'openjdk 17.0.8 2023-07-18\nOpenJDK Runtime Environment (build 17.0.8+7)\nOpenJDK 64-Bit Server VM (build 17.0.8+7, mixed mode)';
		expect(parseJavaVersion(output)).toBe(17);
	});

	it('parses Java 23 output', () => {
		const output = 'java 23 2024-09-17\nJava(TM) SE Runtime Environment (build 23+37-2369)\nJava HotSpot(TM) 64-Bit Server VM (build 23+37-2369, mixed mode, sharing)';
		expect(parseJavaVersion(output)).toBe(23);
	});

	it('handles legacy 1.8 versioning', () => {
		const output = 'java version "1.8.0_381"';
		expect(parseJavaVersion(output)).toBe(8);
	});

	it('returns null for unparseable output', () => {
		expect(parseJavaVersion('not a java version')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseJavaVersion('')).toBeNull();
	});
});

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

	it('is exported as a function', async () => {
		const mod = await import('../../src/jdtls/client.js');
		expect(typeof mod.detectJava).toBe('function');
	});

	it('uses setJavaHome override before JAVA_HOME', () => {
		process.env.JAVA_HOME = '/env/java';
		setJavaHome('/cli/java');

		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const result = detectJava();

		expect(result.javaPath).toBe('/cli/java/bin/java');
		expect((result as any).version).toBe(21);
		const firstCall = mockExecSync.mock.calls[0][0] as string;
		expect(firstCall).toContain('/cli/java/bin/java');
	});

	it('falls back to JAVA_HOME when no override is set', () => {
		process.env.JAVA_HOME = '/env/java';
		setJavaHome(undefined);

		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const result = detectJava();

		expect(result.javaPath).toBe('/env/java/bin/java');
		expect((result as any).version).toBe(21);
	});

	it('falls back to java on PATH when neither override nor JAVA_HOME is set', () => {
		delete process.env.JAVA_HOME;
		setJavaHome(undefined);

		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const result = detectJava();

		expect(result.javaPath).toBe('java');
	});

	it('setJavaHome(undefined) clears a previous override', () => {
		process.env.JAVA_HOME = '/env/java';
		setJavaHome('/cli/java');
		setJavaHome(undefined);

		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const result = detectJava();

		expect(result.javaPath).toBe('/env/java/bin/java');
	});
});

describe('findJdtLs', () => {
	const originalEnv = { ...process.env };
	const mockGlobSync = vi.mocked(globSync);

	beforeEach(() => {
		// Reset and restore the file-level default ([]) — mockReset wipes the
		// factory implementation, so individual tests that need a non-empty
		// match must call mockReturnValueOnce.
		mockGlobSync.mockReset();
		mockGlobSync.mockReturnValue([]);
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		mockGlobSync.mockReset();
		mockGlobSync.mockReturnValue([]);
	});

	it('returns jdtlsHome when JDTLS_HOME is set to existing directory with a launcher jar', async () => {
		// /tmp exists on the real fs; mock globSync to fake the launcher-jar check.
		process.env.JDTLS_HOME = '/tmp';
		mockGlobSync.mockReturnValueOnce(['/tmp/plugins/org.eclipse.equinox.launcher_1.6.900.jar']);
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBe('/tmp');
	});

	it('returns error when JDTLS_HOME points to nonexistent directory', async () => {
		process.env.JDTLS_HOME = '/nonexistent/jdtls/path/that/does/not/exist';
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBeNull();
		expect((result as any).error).toContain('does not exist');
		// D-07: single-line error, no fall-through to candidate probing
		expect((result as any).error).not.toContain('Tried:');
	});

	it('returns specific error when JDTLS_HOME exists but no launcher jar', async () => {
		process.env.JDTLS_HOME = '/tmp';  // dir exists on real fs
		mockGlobSync.mockReturnValueOnce([]);  // no launcher jar
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBeNull();
		expect((result as { error: string }).error).toContain('JDTLS_HOME');
		expect((result as { error: string }).error).toContain('launcher jar');
		// D-07: NO fall-through — single-line error, not multi-line composer output
		expect((result as { error: string }).error).not.toContain('Tried:');
	});

	it('returns error when JDTLS_HOME not set and no common locations exist', async () => {
		delete process.env.JDTLS_HOME;
		// Mock HOME to a nonexistent directory so common locations don't exist
		process.env.HOME = '/nonexistent/home/that/does/not/exist';
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBeNull();
		expect((result as any).error).toContain('JDT LS not found');
		expect((result as any).error).toContain('JDTLS_HOME');
	});
});

describe('startJdtLs and shutdownJdtLs', () => {
	it('are exported as functions', async () => {
		const mod = await import('../../src/jdtls/client.js');
		expect(typeof mod.startJdtLs).toBe('function');
		expect(typeof mod.shutdownJdtLs).toBe('function');
	});
});

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

	it('returns the candidate unchanged when existsSync(candidate) is true', async () => {
		mockExistsSync.mockReturnValue(true);
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		const result = resolveJavaExecutable('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
		expect(result).toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
	});

	it('appends .exe when bare path is missing but .exe variant exists', async () => {
		mockExistsSync.mockImplementation((p) => String(p).toLowerCase().endsWith('.exe'));
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		const result = resolveJavaExecutable('C:\\Program Files\\Java\\jdk-21\\bin\\java');
		expect(result).toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
	});

	it('returns null when neither bare path nor .exe variant exists', async () => {
		mockExistsSync.mockReturnValue(false);
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		const result = resolveJavaExecutable('C:\\Program Files\\Java\\jdk-21\\bin\\java');
		expect(result).toBeNull();
	});

	it('passes bare names through without calling existsSync (codifies Assumption A1)', async () => {
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		const result = resolveJavaExecutable('java');
		expect(result).toBe('java');
		expect(mockExistsSync).not.toHaveBeenCalled();
	});

	it('does not double-suffix when candidate already ends in .exe (case-insensitive)', async () => {
		mockExistsSync.mockReturnValue(false);
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		// Lower-case .exe
		expect(resolveJavaExecutable('C:\\bin\\java.exe')).toBeNull();
		// Upper-case .EXE
		expect(resolveJavaExecutable('C:\\bin\\java.EXE')).toBeNull();
		// Mixed-case .Exe
		expect(resolveJavaExecutable('C:\\bin\\java.Exe')).toBeNull();
		// Confirm we never tried `.exe.exe`
		for (const call of mockExistsSync.mock.calls) {
			expect(String(call[0]).toLowerCase()).not.toMatch(/\.exe\.exe$/);
		}
	});
});

describe('resolveJavaExecutable on Unix', () => {
	const mockExistsSync = vi.mocked(existsSync);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExistsSync.mockReset();
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		mockExistsSync.mockReset();
	});

	it('returns absolute Unix paths unchanged without calling existsSync', async () => {
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		expect(resolveJavaExecutable('/usr/lib/jvm/temurin-21/bin/java')).toBe('/usr/lib/jvm/temurin-21/bin/java');
		expect(mockExistsSync).not.toHaveBeenCalled();
	});

	it('returns bare java unchanged without calling existsSync', async () => {
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		expect(resolveJavaExecutable('java')).toBe('java');
		expect(mockExistsSync).not.toHaveBeenCalled();
	});

	it('returns fake paths unchanged without calling existsSync (UNIX-01 critical invariant)', async () => {
		const { resolveJavaExecutable } = await import('../../src/jdtls/client.js');
		// These fake paths intentionally do NOT exist on disk; the v1.5 detectJava
		// tests at lines 62-109 above rely on this passthrough so they can assert
		// '/cli/java/bin/java' / '/env/java/bin/java' exact-string equality.
		expect(resolveJavaExecutable('/nonexistent/path')).toBe('/nonexistent/path');
		expect(resolveJavaExecutable('/cli/java/bin/java')).toBe('/cli/java/bin/java');
		expect(resolveJavaExecutable('/env/java/bin/java')).toBe('/env/java/bin/java');
		expect(mockExistsSync).not.toHaveBeenCalled();
	});
});

describe('detectJava on Windows', () => {
	const mockExecSync = vi.mocked(execSync);
	const mockExistsSync = vi.mocked(existsSync);

	beforeEach(() => {
		setPlatform('win32');
		vi.resetModules();
		mockExecSync.mockReset();
		mockExistsSync.mockReset();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		mockExecSync.mockReset();
		mockExistsSync.mockReset();
		process.env = { ...originalEnv };
	});

	it('returns a .exe-suffixed javaPath when JAVA_HOME is set and the .exe exists', async () => {
		process.env.JAVA_HOME = 'C:\\Program Files\\Java\\jdk-21';
		mockExistsSync.mockImplementation((p) => String(p).toLowerCase().endsWith('.exe'));
		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const { detectJava, setJavaHome } = await import('../../src/jdtls/client.js');
		setJavaHome(undefined);
		const result = detectJava();

		expect(result.javaPath).toMatch(/\\bin\\java\.exe$/);
		expect((result as { javaPath: string; version: number }).version).toBe(21);
		expect(result.javaPath).toContain('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
	});

	it('falls through to the bare java.exe PATH candidate when JAVA_HOME path does not exist on disk', async () => {
		process.env.JAVA_HOME = 'C:\\Bogus\\NoJdk';
		// JAVA_HOME-derived absolute path: existsSync returns false even for the .exe variant
		mockExistsSync.mockReturnValue(false);
		// Only the bare 'java.exe' (no separator → passthrough → reaches execSync) succeeds
		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const { detectJava, setJavaHome } = await import('../../src/jdtls/client.js');
		setJavaHome(undefined);
		const result = detectJava();

		expect(result.javaPath).toBe('java.exe');
		expect((result as { javaPath: string; version: number }).version).toBe(21);
		// execSync was invoked exactly once with the bare 'java.exe' candidate —
		// the JAVA_HOME-derived candidate was skipped before reaching execSync.
		expect(mockExecSync).toHaveBeenCalledTimes(1);
		const firstCall = mockExecSync.mock.calls[0][0] as string;
		expect(firstCall).toContain('java.exe');
		expect(firstCall).not.toContain('Bogus');
	});

	it('passes bare java.exe through resolveJavaExecutable unchanged with NO existsSync call (Assumption A1)', async () => {
		delete process.env.JAVA_HOME;
		mockExecSync.mockReturnValueOnce('openjdk 21.0.1 2023-10-17');

		const { detectJava, setJavaHome } = await import('../../src/jdtls/client.js');
		setJavaHome(undefined);
		const result = detectJava();

		expect(result.javaPath).toBe('java.exe');
		expect(mockExistsSync).not.toHaveBeenCalled();
	});
});

describe('findJdtLs on Windows', () => {
	const mockExistsSync = vi.mocked(existsSync);
	const mockGlobSync = vi.mocked(globSync);

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

	it('returns the first Windows candidate when LOCALAPPDATA\\jdtls is valid', async () => {
		mockExistsSync.mockReturnValue(true);
		mockGlobSync.mockReturnValue(['C:\\Users\\test\\AppData\\Local\\jdtls\\plugins\\org.eclipse.equinox.launcher_1.6.900.jar']);
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBe('C:\\Users\\test\\AppData\\Local\\jdtls');
	});

	it('skips empty-dir shadow case — LOCALAPPDATA\\jdtls exists but has no launcher jar, ProgramFiles\\jdtls wins', async () => {
		mockExistsSync.mockReturnValue(true);
		mockGlobSync.mockImplementation((_pattern, opts) => {
			const cwd = String((opts as { cwd?: unknown } | undefined)?.cwd ?? '');
			if (cwd.includes('Program Files')) {
				return ['C:\\Program Files\\jdtls\\plugins\\org.eclipse.equinox.launcher_1.6.900.jar'];
			}
			return [];
		});
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBe('C:\\Program Files\\jdtls');
	});

	it('probes Windows candidates in jdtlsCandidateDirs() order', async () => {
		mockExistsSync.mockReturnValue(true);
		mockGlobSync.mockReturnValue([]);  // force every candidate to fail launcher check
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		findJdtLs();
		expect(mockGlobSync.mock.calls.length).toBe(4);
		const probedCwds = mockGlobSync.mock.calls.map(c => String((c[1] as { cwd: unknown }).cwd));
		const home = homedir();
		expect(probedCwds).toEqual([
			'C:\\Users\\test\\AppData\\Local\\jdtls',
			'C:\\Program Files\\jdtls',
			pathWin32.join(home, 'jdtls'),
			'C:\\Users\\test\\AppData\\Local\\nvim-data\\mason\\packages\\jdtls',
		]);
	});

	it('composes multi-line failureReason when every Windows candidate fails', async () => {
		// Only ProgramFiles dir "exists" — mix of skip reasons.
		mockExistsSync.mockImplementation((p) => String(p).includes('Program Files'));
		mockGlobSync.mockReturnValue([]);  // the existing dir still has no launcher
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBeNull();
		const err = (result as { error: string }).error;
		expect(err.split('\n')[0]).toBe('JDT LS not found. Tried:');
		expect(err).toContain('JDTLS_HOME: (not set)');
		expect(err).toContain('C:\\Users\\test\\AppData\\Local\\jdtls: directory does not exist');
		expect(err).toContain('C:\\Program Files\\jdtls: exists but no launcher jar in plugins/');
		expect(err).toContain('Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.');
	});

	it('emits logger.debug for every skipped candidate (D-05)', async () => {
		mockExistsSync.mockReturnValue(false);  // every candidate dir missing
		mockGlobSync.mockReturnValue([]);
		// vi.resetModules() in beforeEach means findJdtLs will import a fresh
		// logger module instance — spy on THAT instance, not the top-of-file
		// import, so the call sites are observed.
		const freshLogger = await import('../../src/logging/logger.js');
		const debugSpy = vi.spyOn(freshLogger.logger, 'debug').mockImplementation(() => {});
		try {
			const { findJdtLs } = await import('../../src/jdtls/client.js');
			findJdtLs();
			const skipCalls = debugSpy.mock.calls.filter(c => c[0] === 'JDT LS candidate skipped');
			expect(skipCalls.length).toBe(4);
			for (const call of skipCalls) {
				const data = call[1] as { candidate: string; reason: string };
				expect(typeof data.candidate).toBe('string');
				expect(typeof data.reason).toBe('string');
			}
		} finally {
			debugSpy.mockRestore();
		}
	});
});

describe('findJdtLs on Unix (UNIX-01 regression)', () => {
	const mockExistsSync = vi.mocked(existsSync);
	const mockGlobSync = vi.mocked(globSync);

	beforeEach(() => {
		setPlatform('linux');
		process.env = { ...originalEnv };
		delete process.env.JDTLS_HOME;
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

	it('Linux: returns the first valid v1.5 candidate, byte-identical ordering', async () => {
		mockExistsSync.mockReturnValue(true);
		mockGlobSync.mockReturnValue([pathPosix.join(homedir(), '.local', 'share', 'jdtls', 'plugins', 'org.eclipse.equinox.launcher_1.6.900.jar')]);
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		const result = findJdtLs();
		expect(result.jdtlsHome).toBe(pathPosix.join(homedir(), '.local', 'share', 'jdtls'));
	});

	it('Linux: probes the three v1.5 candidates in order (~/.local/share/jdtls, /usr/local/share/jdtls, ~/jdtls)', async () => {
		mockExistsSync.mockReturnValue(true);
		mockGlobSync.mockReturnValue([]);  // force every candidate to fail launcher
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		findJdtLs();
		expect(mockGlobSync.mock.calls.length).toBe(3);
		const probedCwds = mockGlobSync.mock.calls.map(c => String((c[1] as { cwd: unknown }).cwd));
		const home = homedir();
		expect(probedCwds).toEqual([
			pathPosix.join(home, '.local', 'share', 'jdtls'),
			'/usr/local/share/jdtls',
			pathPosix.join(home, 'jdtls'),
		]);
	});

	it('Darwin: same three Unix candidates as Linux', async () => {
		setPlatform('darwin');
		vi.resetModules();
		mockExistsSync.mockReturnValue(true);
		mockGlobSync.mockReturnValue([]);
		const { findJdtLs } = await import('../../src/jdtls/client.js');
		findJdtLs();
		expect(mockGlobSync.mock.calls.length).toBe(3);
		const probedCwds = mockGlobSync.mock.calls.map(c => String((c[1] as { cwd: unknown }).cwd));
		const home = homedir();
		expect(probedCwds).toEqual([
			pathPosix.join(home, '.local', 'share', 'jdtls'),
			'/usr/local/share/jdtls',
			pathPosix.join(home, 'jdtls'),
		]);
	});
});
