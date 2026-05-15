import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseJavaVersion, detectJava, setJavaHome } from '../../src/jdtls/client.js';

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

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it('returns jdtlsHome when JDTLS_HOME is set to existing directory', async () => {
		// Use /tmp which always exists
		process.env.JDTLS_HOME = '/tmp';
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
