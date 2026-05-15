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

describe('isWindows', () => {
	it('Windows: isWindows is true under win32', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { isWindows } = await import('../../src/platform/index.js');
		expect(isWindows).toBe(true);
	});

	it('Linux: isWindows is false under linux', async () => {
		setPlatform('linux');
		vi.resetModules();
		const { isWindows } = await import('../../src/platform/index.js');
		expect(isWindows).toBe(false);
	});

	it('Darwin: isWindows is false under darwin', async () => {
		setPlatform('darwin');
		vi.resetModules();
		const { isWindows } = await import('../../src/platform/index.js');
		expect(isWindows).toBe(false);
	});
});

describe('javaBinaryName', () => {
	it('Windows: returns java.exe', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { javaBinaryName } = await import('../../src/platform/index.js');
		expect(javaBinaryName()).toBe('java.exe');
	});

	it('Linux: returns java (UNIX-01)', async () => {
		setPlatform('linux');
		vi.resetModules();
		const { javaBinaryName } = await import('../../src/platform/index.js');
		expect(javaBinaryName()).toBe('java');
	});

	it('Darwin: returns java (UNIX-01)', async () => {
		setPlatform('darwin');
		vi.resetModules();
		const { javaBinaryName } = await import('../../src/platform/index.js');
		expect(javaBinaryName()).toBe('java');
	});
});

describe('javaBinaryInHome', () => {
	it('Windows: appends bin\\java.exe via path.win32.join', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { javaBinaryInHome } = await import('../../src/platform/index.js');
		expect(javaBinaryInHome('C:\\Program Files\\Java\\jdk-21'))
			.toBe('C:\\Program Files\\Java\\jdk-21\\bin\\java.exe');
	});

	it('Linux: returns join(home, "bin", "java") byte-identical to v1.5 (UNIX-01)', async () => {
		setPlatform('linux');
		vi.resetModules();
		const { javaBinaryInHome } = await import('../../src/platform/index.js');
		expect(javaBinaryInHome('/usr/lib/jvm/temurin-21')).toBe('/usr/lib/jvm/temurin-21/bin/java');
	});

	it('Darwin: returns join(home, "bin", "java") byte-identical to v1.5 (UNIX-01)', async () => {
		setPlatform('darwin');
		vi.resetModules();
		const { javaBinaryInHome } = await import('../../src/platform/index.js');
		expect(javaBinaryInHome('/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home'))
			.toBe('/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java');
	});
});

describe('jdtlsCandidateDirs', () => {
	it('Windows: returns 4 jdtls-bearing paths with env-derived prefixes', async () => {
		setPlatform('win32');
		process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
		process.env.ProgramFiles = 'C:\\Program Files';
		vi.resetModules();
		const { jdtlsCandidateDirs } = await import('../../src/platform/index.js');
		const dirs = jdtlsCandidateDirs();
		expect(dirs).toHaveLength(4);
		for (const dir of dirs) {
			expect(dir).toContain('jdtls');
		}
		expect(dirs[0]).toContain('C:\\Users\\test\\AppData\\Local');
		expect(dirs[1]).toContain('C:\\Program Files');
		expect(dirs[3]).toContain('mason');
	});

	it('Linux: returns the three v1.5 literal paths byte-identical (UNIX-01)', async () => {
		setPlatform('linux');
		vi.resetModules();
		const { jdtlsCandidateDirs } = await import('../../src/platform/index.js');
		const home = homedir();
		expect(jdtlsCandidateDirs()).toEqual([
			pathPosix.join(home, '.local', 'share', 'jdtls'),
			'/usr/local/share/jdtls',
			pathPosix.join(home, 'jdtls'),
		]);
	});

	it('Darwin: returns the three v1.5 literal paths byte-identical (UNIX-01)', async () => {
		setPlatform('darwin');
		vi.resetModules();
		const { jdtlsCandidateDirs } = await import('../../src/platform/index.js');
		const home = homedir();
		expect(jdtlsCandidateDirs()).toEqual([
			pathPosix.join(home, '.local', 'share', 'jdtls'),
			'/usr/local/share/jdtls',
			pathPosix.join(home, 'jdtls'),
		]);
	});
});

describe('commonJavaLocations', () => {
	it('Windows: returns >=7 parent dirs covering known JDK vendors', async () => {
		setPlatform('win32');
		process.env.ProgramFiles = 'C:\\Program Files';
		vi.resetModules();
		const { commonJavaLocations } = await import('../../src/platform/index.js');
		const locations = commonJavaLocations();
		expect(locations.length).toBeGreaterThanOrEqual(7);
		const joined = locations.join('\n');
		expect(joined).toContain('Adoptium');
		expect(joined).toContain('Microsoft');
		expect(joined).toContain('Corretto');
		expect(joined).toContain('Zulu');
		expect(joined).toContain('.jdks');
		expect(joined).toContain('scoop');
	});

	it('Darwin: contains /Library/Java/JavaVirtualMachines and /opt/homebrew/opt', async () => {
		setPlatform('darwin');
		vi.resetModules();
		const { commonJavaLocations } = await import('../../src/platform/index.js');
		const locations = commonJavaLocations();
		expect(locations).toContain('/Library/Java/JavaVirtualMachines');
		expect(locations).toContain('/opt/homebrew/opt');
	});

	it('Linux: contains /usr/lib/jvm and /opt', async () => {
		setPlatform('linux');
		vi.resetModules();
		const { commonJavaLocations } = await import('../../src/platform/index.js');
		const locations = commonJavaLocations();
		expect(locations).toContain('/usr/lib/jvm');
		expect(locations).toContain('/opt');
	});
});
