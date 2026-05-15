import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { parseJavaVersion, detectJava, setJavaHome } from '../../src/jdtls/client.js';

vi.mock('node:child_process', async () => {
	const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
	return {
		...actual,
		execSync: vi.fn(),
	};
});

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
