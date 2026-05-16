/**
 * Java Discovery tests — locks down JAVA-01..JAVA-05 unit behaviors.
 *
 * Mocks `node:child_process.execFile`, `node:fs/promises.readdir`/`readFile`,
 * and `node:fs.existsSync` per the Phase 35 Pitfall 6 spread idiom. Every
 * platform-flipping describe pairs `setPlatform(...)` with `vi.resetModules()`
 * and a fresh dynamic `import('../../src/jdtls/java-discovery.js')` so the
 * post-reset module state is the one under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
		readFile: vi.fn(),
	};
});

vi.mock('../../src/logging/logger.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

/**
 * Build a fake execFile callback-mock that returns the given `--version`
 * output (combined into stdout) for any candidate path. `promisify(execFile)`
 * wraps the standard (file, args, opts, cb) callback signature, so this
 * intercepts at the underlying mock implementation.
 */
function mockVersionOutputFor(
	mockExecFile: ReturnType<typeof vi.mocked<typeof execFile>>,
	resolver: (candidate: string) => { stdout?: string; stderr?: string; error?: NodeJS.ErrnoException & { signal?: string; killed?: boolean } },
): void {
	mockExecFile.mockImplementation(((file: string, _args: string[], _opts: unknown, cb: unknown) => {
		const out = resolver(file);
		if (out.error) {
			(cb as (e: Error | null, r?: { stdout: string; stderr: string }) => void)(out.error);
		} else {
			(cb as (e: Error | null, r: { stdout: string; stderr: string }) => void)(
				null,
				{ stdout: out.stdout ?? '', stderr: out.stderr ?? '' },
			);
		}
		return {} as unknown as ReturnType<typeof execFile>;
	}) as unknown as Parameters<typeof mockExecFile.mockImplementation>[0]);
}

describe('unescapePropertiesValue', () => {
	it('unescapes double backslash', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		// JS source: 'C:\\\\Users\\\\foo' is the 12-char string 'C:\\Users\\foo' at runtime.
		expect(unescapePropertiesValue('C:\\\\Users\\\\foo')).toBe('C:\\Users\\foo');
	});

	it('unescapes \\u0043 → C (UTF-16 hex, exactly 4 digits)', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('\\u0043:')).toBe('C:');
	});

	it('unescapes \\: → : and \\= → =', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('jdk\\:21')).toBe('jdk:21');
		expect(unescapePropertiesValue('foo\\=bar')).toBe('foo=bar');
	});

	it('unescapes \\t, \\n, \\r, \\f to control characters', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('a\\tb')).toBe('a\tb');
		expect(unescapePropertiesValue('a\\nb')).toBe('a\nb');
		expect(unescapePropertiesValue('a\\rb')).toBe('a\rb');
		expect(unescapePropertiesValue('a\\fb')).toBe('a\fb');
	});

	it('drops backslash for unknown escape \\q → q', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('\\q')).toBe('q');
	});

	it('literal backslash-u-0043 (\\\\u0043) → literal \\u0043 (NOT C)', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		// JS source '\\\\u0043' is runtime '\\u0043' (7 chars). The scanner
		// sees '\\' first → emits a single backslash and skips ahead, leaving
		// 'u0043' as literal characters. Single-pass guarantee per D-12.
		expect(unescapePropertiesValue('\\\\u0043')).toBe('\\u0043');
	});

	it('empty string returns empty string', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('')).toBe('');
	});

	it('string with no backslashes returns identical content', async () => {
		const { unescapePropertiesValue } = await import('../../src/jdtls/java-discovery.js');
		expect(unescapePropertiesValue('/usr/lib/jvm/temurin-21')).toBe('/usr/lib/jvm/temurin-21');
	});
});

describe('discoverJava priority order', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReaddir = vi.mocked(readdir);
	const mockReadFile = vi.mocked(readFile);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReaddir.mockReset();
		mockReadFile.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('Slot 1 (--java-home) wins over Slot 3 (JAVA_HOME)', async () => {
		process.env.JAVA_HOME = '/env/java';
		mockVersionOutputFor(mockExecFile, () => ({ stdout: 'openjdk 21.0.1 2023-10-17' }));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome('/cli/java');

		const result = await discoverJava();
		expect(result.javaPath).toBe('/cli/java/bin/java');
		// First execFile call was on the --java-home candidate
		const firstCallTarget = mockExecFile.mock.calls[0][0];
		expect(firstCallTarget).toContain('/cli/java/bin/java');
		setJavaHome(undefined);
	});

	it('Slot 2 (org.gradle.java.home) wins when Slot 1 absent', async () => {
		// readFile for gradle.properties returns a Java home line
		mockReadFile.mockResolvedValue('org.gradle.java.home=/gradle/java\n' as unknown as string);
		mockVersionOutputFor(mockExecFile, () => ({ stdout: 'openjdk 21.0.1 2023-10-17' }));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava({ projectRoot: '/work/proj' });
		expect(result.javaPath).toBe('/gradle/java/bin/java');
	});

	it('Slot 3 (JAVA_HOME) wins when slots 1+2 absent', async () => {
		process.env.JAVA_HOME = '/env/java';
		mockVersionOutputFor(mockExecFile, () => ({ stdout: 'openjdk 21.0.1 2023-10-17' }));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava();
		expect(result.javaPath).toBe('/env/java/bin/java');
	});

	it('Slot 4 (java on PATH) wins when slots 1-3 absent', async () => {
		mockVersionOutputFor(mockExecFile, () => ({ stdout: 'openjdk 21.0.1 2023-10-17' }));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava();
		expect(result.javaPath).toBe('java');
	});

	it('Slot 5 (scan commonJavaLocations) wins when slots 1-4 absent', async () => {
		// Slots 1-4: --java-home unset, gradle.properties unreadable, JAVA_HOME unset,
		// PATH "java" probe fails as not-installed → slot 5 enumerates and finds one.
		mockReaddir.mockImplementation(async (parent) => {
			if (String(parent) === '/usr/lib/jvm') {
				return ['temurin-21'] as unknown as Awaited<ReturnType<typeof readdir>>;
			}
			return [] as unknown as Awaited<ReturnType<typeof readdir>>;
		});
		mockVersionOutputFor(mockExecFile, (candidate) => {
			if (candidate === 'java') {
				return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
			}
			return { stdout: 'openjdk 21.0.1 2023-10-17' };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava();
		expect(result.javaPath).toBe('/usr/lib/jvm/temurin-21/bin/java');
	});
});

describe('discoverJava JAVA-02 version skip continuation', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReadFile = vi.mocked(readFile);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReadFile.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('Java 17 in slot 1 does NOT short-circuit; slot 3 with Java 21 still probed', async () => {
		process.env.JAVA_HOME = '/env/java';
		mockVersionOutputFor(mockExecFile, (candidate) => {
			if (candidate === '/cli/java/bin/java') return { stdout: 'openjdk 17.0.8 2023-07-18' };
			if (candidate === '/env/java/bin/java') return { stdout: 'openjdk 21.0.1 2023-10-17' };
			return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome('/cli/java');

		const result = await discoverJava();
		expect(result.javaPath).toBe('/env/java/bin/java');
		expect((result as { version: number }).version).toBe(21);

		// Both --java-home AND JAVA_HOME candidates were probed: Slot-2 is gradle.properties,
		// which is silently skipped when projectRoot is undefined (no execFile call).
		const probedTargets = mockExecFile.mock.calls.map(c => c[0]);
		expect(probedTargets).toContain('/cli/java/bin/java');
		expect(probedTargets).toContain('/env/java/bin/java');
		setJavaHome(undefined);
	});
});

describe('discoverJava JAVA-03 backslash unescape end-to-end', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReadFile = vi.mocked(readFile);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReadFile.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('decodes \\: in org.gradle.java.home before path resolution', async () => {
		// gradle.properties value uses '\:' to escape the colon (legal under Java
		// Properties spec). After unescape, the resolved Java home is '/opt/jdk:21'.
		mockReadFile.mockResolvedValue('org.gradle.java.home=/opt/jdk\\:21\n' as unknown as string);
		mockVersionOutputFor(mockExecFile, (candidate) => {
			if (candidate === '/opt/jdk:21/bin/java') return { stdout: 'openjdk 21.0.1 2023-10-17' };
			return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava({ projectRoot: '/work/proj' });
		expect(result.javaPath).toBe('/opt/jdk:21/bin/java');
	});
});

describe('discoverJava JAVA-05 per-candidate 3s timeout', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReadFile = vi.mocked(readFile);
	const mockReaddir = vi.mocked(readdir);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReadFile.mockReset();
		mockReaddir.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('SIGTERM-killed candidate produces "timed out after 3s" in failureReason', async () => {
		process.env.JAVA_HOME = '/env/java';
		mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
		mockVersionOutputFor(mockExecFile, () => ({
			error: Object.assign(new Error('killed') as NodeJS.ErrnoException, { signal: 'SIGTERM' as NodeJS.Signals }),
		}));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava();
		expect(result.javaPath).toBeNull();
		expect((result as { error: string }).error).toContain('timed out after 3s');

		// Verify the timeout option was passed to execFile
		const firstOpts = mockExecFile.mock.calls[0][2] as { timeout?: number };
		expect(firstOpts.timeout).toBe(3_000);
	});

	it('classifies killed=true errors as timed-out', async () => {
		process.env.JAVA_HOME = '/env/java';
		mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
		mockVersionOutputFor(mockExecFile, () => ({
			error: Object.assign(new Error('process killed') as NodeJS.ErrnoException, { killed: true }),
		}));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava();
		expect((result as { error: string }).error).toContain('timed out after 3s');
	});
});

describe('discoverJava JAVA-04 vendor enumeration', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReaddir = vi.mocked(readdir);
	const mockReadFile = vi.mocked(readFile);

	beforeEach(() => {
		vi.resetModules();
		mockExecFile.mockReset();
		mockReaddir.mockReset();
		mockReadFile.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('macOS bundle layout: temurin-21 probed before temurin-17 (version-hint sort)', async () => {
		setPlatform('darwin');
		vi.resetModules();
		mockReaddir.mockImplementation(async (parent) => {
			if (String(parent) === '/Library/Java/JavaVirtualMachines') {
				return ['temurin-21.jdk', 'temurin-17.jdk'] as unknown as Awaited<ReturnType<typeof readdir>>;
			}
			return [] as unknown as Awaited<ReturnType<typeof readdir>>;
		});

		const probedTargets: string[] = [];
		mockVersionOutputFor(mockExecFile, (candidate) => {
			probedTargets.push(candidate);
			// Both candidates fail so we observe order
			return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);
		await discoverJava();

		// macOS-bundle layout: <entry>/Contents/Home/bin/java
		const t21 = '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java';
		const t17 = '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java';
		expect(probedTargets).toContain(t21);
		expect(probedTargets).toContain(t17);
		const idx21 = probedTargets.indexOf(t21);
		const idx17 = probedTargets.indexOf(t17);
		expect(idx21).toBeLessThan(idx17);
	});

	it('Homebrew openjdk filter: only openjdk@* entries become candidates', async () => {
		setPlatform('darwin');
		vi.resetModules();
		mockReaddir.mockImplementation(async (parent) => {
			if (String(parent) === '/opt/homebrew/opt') {
				return ['openjdk@21', 'postgresql@16', 'openssl@3'] as unknown as Awaited<ReturnType<typeof readdir>>;
			}
			return [] as unknown as Awaited<ReturnType<typeof readdir>>;
		});

		const probedTargets: string[] = [];
		mockVersionOutputFor(mockExecFile, (candidate) => {
			probedTargets.push(candidate);
			return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);
		await discoverJava();

		// Homebrew layout: <entry>/libexec/openjdk.jdk/Contents/Home/bin/java
		const homebrewCandidates = probedTargets.filter(t => t.startsWith('/opt/homebrew/opt/'));
		expect(homebrewCandidates.some(c => c.includes('openjdk@21'))).toBe(true);
		expect(homebrewCandidates.some(c => c.includes('postgresql'))).toBe(false);
		expect(homebrewCandidates.some(c => c.includes('openssl'))).toBe(false);
		// And the path shape:
		expect(homebrewCandidates.some(c => c.includes('libexec/openjdk.jdk/Contents/Home/bin/java'))).toBe(true);
	});

	it('Scoop layout (win32): <entry>/current/bin/java.exe', async () => {
		setPlatform('win32');
		vi.resetModules();
		// On Windows, resolveJavaExecutable gates absolute candidates by
		// existsSync. Mock it to accept every probed path so scan-slot
		// candidates reach the execFile probe stage.
		const mockExistsSync = vi.mocked(existsSync);
		mockExistsSync.mockReset();
		mockExistsSync.mockReturnValue(true);

		mockReaddir.mockImplementation(async (parent) => {
			// Match any path that ends with scoop\apps OR scoop/apps
			const p = String(parent);
			if (p.endsWith('\\scoop\\apps') || p.endsWith('/scoop/apps')) {
				return ['adoptium-jdk-21', 'firefox'] as unknown as Awaited<ReturnType<typeof readdir>>;
			}
			return [] as unknown as Awaited<ReturnType<typeof readdir>>;
		});

		const probedTargets: string[] = [];
		mockVersionOutputFor(mockExecFile, (candidate) => {
			probedTargets.push(candidate);
			return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);
		await discoverJava();

		// Scoop layout: <entry>\current\bin\java.exe — both adoptium and firefox
		// are accepted (no scoop-specific filter); both should be probed under
		// the scoop layout (not depth1).
		const scoopCandidates = probedTargets.filter(t => t.includes('scoop'));
		expect(scoopCandidates.some(c => c.includes('current') && c.endsWith('java.exe'))).toBe(true);
		expect(scoopCandidates.some(c => c.includes('adoptium-jdk-21'))).toBe(true);
		mockExistsSync.mockReset();
	});

	it('Linux /opt prefix filter: only JDK-named entries are probed', async () => {
		setPlatform('linux');
		vi.resetModules();
		mockReaddir.mockImplementation(async (parent) => {
			if (String(parent) === '/opt') {
				return ['jdk-21', 'temurin-17', 'postgres', 'intellij-idea-community', 'corretto-21'] as unknown as Awaited<ReturnType<typeof readdir>>;
			}
			return [] as unknown as Awaited<ReturnType<typeof readdir>>;
		});

		const probedTargets: string[] = [];
		mockVersionOutputFor(mockExecFile, (candidate) => {
			probedTargets.push(candidate);
			return { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) };
		});

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);
		await discoverJava();

		const optCandidates = probedTargets.filter(t => t.startsWith('/opt/'));
		expect(optCandidates.some(c => c.startsWith('/opt/jdk-21/'))).toBe(true);
		expect(optCandidates.some(c => c.startsWith('/opt/temurin-17/'))).toBe(true);
		expect(optCandidates.some(c => c.startsWith('/opt/corretto-21/'))).toBe(true);
		// Filtered out:
		expect(optCandidates.some(c => c.startsWith('/opt/postgres/'))).toBe(false);
		expect(optCandidates.some(c => c.startsWith('/opt/intellij-idea-community/'))).toBe(false);
	});
});

describe('discoverJava failureReason multi-line format', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReaddir = vi.mocked(readdir);
	const mockReadFile = vi.mocked(readFile);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReaddir.mockReset();
		mockReadFile.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('produces a multi-line "Java not found." message with per-slot reasons', async () => {
		process.env.JAVA_HOME = '/some/path';
		// gradle.properties readable but no org.gradle.java.home key
		mockReadFile.mockResolvedValue('minecraft_version=1.21.1\n' as unknown as string);
		// Scan dirs empty
		mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
		// JAVA_HOME and PATH both report Java 17
		mockVersionOutputFor(mockExecFile, () => ({ stdout: 'openjdk 17.0.8 2023-07-18' }));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava({ projectRoot: '/work/proj' });
		expect(result.javaPath).toBeNull();
		const error = (result as { error: string }).error;
		expect(error.startsWith('Java not found. Tried:')).toBe(true);
		expect(error).toContain('--java-home: (not set)');
		expect(error).toContain('org.gradle.java.home: (not set in /work/proj/gradle.properties)');
		expect(error).toContain('JAVA_HOME=/some/path');
		expect(error).toContain('Java 17 (need 21+)');
		expect(error).toContain('java on PATH:');
		expect(error.trimEnd().endsWith('Install Java 21+ (Adoptium / Microsoft / Zulu) or set JAVA_HOME / --java-home.')).toBe(true);
	});
});

describe('discoverJava JAVA-05 zero-arg call', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockReaddir = vi.mocked(readdir);
	const mockReadFile = vi.mocked(readFile);

	beforeEach(() => {
		setPlatform('linux');
		vi.resetModules();
		mockExecFile.mockReset();
		mockReaddir.mockReset();
		mockReadFile.mockReset();
		process.env = { ...originalEnv };
		delete process.env.JAVA_HOME;
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	it('zero-arg call: gradle.properties slot silently skipped (no readFile call) and failureReason shows "(not set)"', async () => {
		mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
		// PATH probe fails so we end up in the failure synthesizer
		mockVersionOutputFor(mockExecFile, () => ({
			error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
		}));

		const { setJavaHome, discoverJava } = await import('../../src/jdtls/java-discovery.js');
		setJavaHome(undefined);

		const result = await discoverJava();
		expect(result.javaPath).toBeNull();
		// readFile should NOT have been called for any gradle.properties path
		const readFileCalls = mockReadFile.mock.calls;
		const calledForGradleProps = readFileCalls.some(call => String(call[0]).includes('gradle.properties'));
		expect(calledForGradleProps).toBe(false);
		// Failure message uses the no-projectRoot "(not set)" form
		expect((result as { error: string }).error).toContain('org.gradle.java.home: (not set)');
		// And NOT the with-projectRoot "(not set in ...)" form
		expect((result as { error: string }).error).not.toContain('(not set in');
	});
});
