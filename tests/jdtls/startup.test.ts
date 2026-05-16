import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { LspClient, JSONRPCEndpoint } from 'ts-lsp-client';

// Mock the client module before importing startup. The client.ts shim
// re-exports discoverJava from java-discovery.ts, so the mock target is still
// the client.js import path (which is what startup.ts imports from).
vi.mock('../../src/jdtls/client.js', () => ({
	detectJava: vi.fn(),
	discoverJava: vi.fn(),
	findJdtLs: vi.fn(),
	startJdtLs: vi.fn(),
}));

// Mock workspace-sync so we can assert post-rescue syncFabricModToWorkspace
// invocations without running the real sync (which would touch fs / ZIPs).
vi.mock('../../src/jdtls/workspace-sync.js', () => ({
	syncFabricModToWorkspace: vi.fn(),
}));

// Mock the shared jarReader singleton — startup.ts only forwards the
// reference to syncFabricModToWorkspace (mocked above), so an opaque stub
// is sufficient. No methods are called on it from within the sweep.
vi.mock('../../src/tools/shared-jar-reader.js', () => ({
	jarReader: {},
}));

// Mock logger to suppress output
vi.mock('../../src/logging/logger.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { initJdtLsSession, retryDegradedJdtLsSessions } from '../../src/jdtls/startup.js';
import { detectJava, discoverJava, findJdtLs, startJdtLs } from '../../src/jdtls/client.js';
import { syncFabricModToWorkspace } from '../../src/jdtls/workspace-sync.js';
import { projectStore } from '../../src/state/project-store.js';
import { logger } from '../../src/logging/logger.js';
import type { Project, FabricModChild, StudyJarChild } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

// `mockDetectJava` retained for backward compatibility with tests that have
// not yet been converted (none after this plan, but harmless to keep).
const mockDetectJava = vi.mocked(detectJava);
const mockDiscoverJava = vi.mocked(discoverJava);
const mockFindJdtLs = vi.mocked(findJdtLs);
const mockStartJdtLs = vi.mocked(startJdtLs);
const mockLoggerWarn = vi.mocked(logger.warn);
const mockSyncFabricModToWorkspace = vi.mocked(syncFabricModToWorkspace);

function createMockProcess(): ChildProcess {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		stdin: null,
		stdout: null,
		stderr: null,
		stdio: [null, null, null, null, null] as any,
		pid: 12345,
		exitCode: null,
		signalCode: null,
		killed: false,
		connected: true,
		channel: undefined,
		send: vi.fn(),
		disconnect: vi.fn(),
		kill: vi.fn(),
		ref: vi.fn(),
		unref: vi.fn(),
		[Symbol.dispose]: vi.fn(),
	}) as unknown as ChildProcess;
}

describe('initJdtLsSession', () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		for (const dir of tempDirs) {
			if (dir) await rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it('returns available=false with failureReason when Java not found', async () => {
		mockDiscoverJava.mockResolvedValue({
			javaPath: null,
			error: 'Java not found. Tried:\n  JAVA_HOME: (not set)\n  java on PATH: (file not found)\nInstall Java 21+ (Adoptium / Microsoft / Zulu) or set JAVA_HOME / --java-home.',
		});

		const session = await initJdtLsSession();

		expect(session.available).toBe(false);
		expect(session.failureReason).toContain('Java not found');
		expect(session.tempDir).toBe('');
		expect(session.dataDir).toBe('');
		expect(session.jarIdToDirName).toBeInstanceOf(Map);
		expect(session.jarIdToDirName.size).toBe(0);
	});

	it('returns available=false with failureReason when JDT LS not found', async () => {
		mockDiscoverJava.mockResolvedValue({
			javaPath: '/usr/bin/java',
			version: 21,
		});
		mockFindJdtLs.mockReturnValue({
			jdtlsHome: null,
			error: 'JDT LS not found. Set JDTLS_HOME environment variable.',
		});

		const session = await initJdtLsSession();

		expect(session.available).toBe(false);
		expect(session.failureReason).toContain('JDT LS not found');
		expect(session.tempDir).toBe('');
	});

	it('creates tempDir with .project and .classpath, starts JDT LS, returns available session', async () => {
		mockDiscoverJava.mockResolvedValue({
			javaPath: '/usr/bin/java',
			version: 21,
		});
		mockFindJdtLs.mockReturnValue({
			jdtlsHome: '/opt/jdtls',
		});

		const mockProc = createMockProcess();
		const mockClient = {} as LspClient;
		const mockEndpoint = { notify: vi.fn() } as unknown as JSONRPCEndpoint;

		mockStartJdtLs.mockImplementation(async (_java, _jdtls, workspaceDir) => {
			// Track tempDir for cleanup
			tempDirs.push(workspaceDir);
			return {
				process: mockProc,
				client: mockClient,
				endpoint: mockEndpoint,
				dataDir: '/tmp/data',
			};
		});

		const session = await initJdtLsSession();

		expect(session.available).toBe(true);
		expect(session.tempDir).toBeTruthy();
		expect(session.dataDir).toBe('/tmp/data');
		expect(session.client).toBe(mockClient);
		expect(session.endpoint).toBe(mockEndpoint);
		expect(session.process).toBe(mockProc);
		expect(session.jarIdToDirName).toBeInstanceOf(Map);
		expect(session.jarIdToDirName.size).toBe(0);

		// Verify .project and .classpath were created
		expect(existsSync(join(session.tempDir, '.project'))).toBe(true);
		expect(existsSync(join(session.tempDir, '.classpath'))).toBe(true);

		const projectContent = await readFile(join(session.tempDir, '.project'), 'utf-8');
		expect(projectContent).toContain('mcp-sources');

		const classpathContent = await readFile(join(session.tempDir, '.classpath'), 'utf-8');
		expect(classpathContent).toContain('classpath');
	});

	it('sets up process exit handler that marks session unavailable on non-zero exit', async () => {
		mockDiscoverJava.mockResolvedValue({
			javaPath: '/usr/bin/java',
			version: 21,
		});
		mockFindJdtLs.mockReturnValue({
			jdtlsHome: '/opt/jdtls',
		});

		const mockProc = createMockProcess();

		mockStartJdtLs.mockImplementation(async (_java, _jdtls, workspaceDir) => {
			tempDirs.push(workspaceDir);
			return {
				process: mockProc,
				client: {} as LspClient,
				endpoint: { notify: vi.fn() } as unknown as JSONRPCEndpoint,
				dataDir: '/tmp/data',
			};
		});

		const session = await initJdtLsSession();
		expect(session.available).toBe(true);

		// Simulate process exit with non-zero code
		mockProc.emit('exit', 1);

		expect(session.available).toBe(false);
		expect(session.failureReason).toContain('exited with code 1');
	});

	it('does not mark session unavailable on clean exit (code 0)', async () => {
		mockDiscoverJava.mockResolvedValue({
			javaPath: '/usr/bin/java',
			version: 21,
		});
		mockFindJdtLs.mockReturnValue({
			jdtlsHome: '/opt/jdtls',
		});

		const mockProc = createMockProcess();

		mockStartJdtLs.mockImplementation(async (_java, _jdtls, workspaceDir) => {
			tempDirs.push(workspaceDir);
			return {
				process: mockProc,
				client: {} as LspClient,
				endpoint: { notify: vi.fn() } as unknown as JSONRPCEndpoint,
				dataDir: '/tmp/data',
			};
		});

		const session = await initJdtLsSession();
		expect(session.available).toBe(true);

		// Simulate clean exit
		mockProc.emit('exit', 0);

		expect(session.available).toBe(true);
		expect(session.failureReason).toBeUndefined();
	});

	it('returns available=false when startJdtLs throws', async () => {
		mockDiscoverJava.mockResolvedValue({
			javaPath: '/usr/bin/java',
			version: 21,
		});
		mockFindJdtLs.mockReturnValue({
			jdtlsHome: '/opt/jdtls',
		});

		mockStartJdtLs.mockImplementation(async (_java, _jdtls, workspaceDir) => {
			tempDirs.push(workspaceDir);
			throw new Error('Launcher jar not found');
		});

		const session = await initJdtLsSession();

		expect(session.available).toBe(false);
		expect(session.failureReason).toContain('Launcher jar not found');
		expect(session.tempDir).toBeTruthy(); // tempDir was created before the error
		expect(session.dataDir).toBe('');
	});
});

/**
 * Wire a successful initJdtLsSession path: discoverJava → findJdtLs → startJdtLs
 * all succeed. Used by the new describes below so each test focuses on the
 * argument-passthrough or projectStore behavior under test.
 */
function wireSuccessfulInit(tempDirs: string[]): { mockProc: ChildProcess } {
	mockDiscoverJava.mockResolvedValue({ javaPath: '/usr/bin/java', version: 21 });
	mockFindJdtLs.mockReturnValue({ jdtlsHome: '/opt/jdtls' });

	const mockProc = createMockProcess();
	mockStartJdtLs.mockImplementation(async (_java, _jdtls, workspaceDir) => {
		tempDirs.push(workspaceDir);
		return {
			process: mockProc,
			client: {} as LspClient,
			endpoint: { notify: vi.fn() } as unknown as JSONRPCEndpoint,
			dataDir: '/tmp/data',
		};
	});
	return { mockProc };
}

describe('initJdtLsSession with projectRoot', () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		for (const dir of tempDirs) {
			if (dir) await rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it('passes projectRoot through to discoverJava', async () => {
		wireSuccessfulInit(tempDirs);

		await initJdtLsSession({ projectRoot: '/work/my-mod' });

		expect(mockDiscoverJava).toHaveBeenCalledTimes(1);
		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: '/work/my-mod' });
	});

	it('zero-arg call passes projectRoot: undefined (D-06)', async () => {
		wireSuccessfulInit(tempDirs);

		await initJdtLsSession();

		expect(mockDiscoverJava).toHaveBeenCalledTimes(1);
		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: undefined });
	});
});

/**
 * Build a stub FabricModChild fixture with the minimum fields needed for
 * retryDegradedJdtLsSessions iteration. The sweep reads `kind` and `rootPath`
 * only — every other field is filled with a type-correct dummy so the
 * compiler is satisfied without requiring full domain construction.
 */
function makeFabricModChild(name: string, rootPath: string): FabricModChild {
	return {
		kind: 'fabric-mod',
		name,
		rootPath,
		gradleConfig: {
			minecraftVersion: '1.21.1',
			mappingEra: 'mapped',
			yarnMappings: undefined,
			loaderVersion: undefined,
			fabricApiVersion: undefined,
			dependencies: [],
			mavenRoots: [],
		},
		sourcesJar: { path: '', exists: false },
		compiledJar: { path: '', exists: false },
		fabricMod: {
			schemaVersion: 1,
			id: name,
			version: '1.0.0',
			name,
			description: '',
			authors: [],
			license: '',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: new Map(),
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}

function makeStudyJarChild(name: string): StudyJarChild {
	return {
		kind: 'study-jar',
		name,
		jarPath: '/tmp/' + name + '.jar',
		mtime: 0,
		size: 0,
		autoInclude: false,
		stats: { totalEntries: 0, packageCount: 0, classCount: 0 },
	};
}

function makeDegradedSession(): JdtLsSession {
	return {
		available: false,
		failureReason: 'Java not found.',
		tempDir: '',
		dataDir: '',
		jarIdToDirName: new Map(),
	};
}

function makeAvailableSession(): JdtLsSession {
	return {
		available: true,
		tempDir: '/tmp/healthy-temp',
		dataDir: '/tmp/healthy-data',
		jarIdToDirName: new Map(),
	};
}

function seedProject(name: string, jdtls: JdtLsSession | undefined, children: (FabricModChild | StudyJarChild)[]): Project {
	const childMap = new Map<string, FabricModChild | StudyJarChild>();
	for (const c of children) childMap.set(c.name, c);
	const project: Project = { name, children: childMap, jdtls };
	projectStore.set(name, project);
	return project;
}

describe('retryDegradedJdtLsSessions', () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
	});

	afterEach(async () => {
		projectStore.clear();
		for (const dir of tempDirs) {
			if (dir) await rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it('sweeps all projects with jdtls.available === false (healthy projects skipped)', async () => {
		wireSuccessfulInit(tempDirs);
		seedProject('degraded', makeDegradedSession(), [makeFabricModChild('mod', '/work/mod')]);
		seedProject('healthy', makeAvailableSession(), [makeFabricModChild('mod2', '/work/mod2')]);

		await retryDegradedJdtLsSessions();

		expect(mockDiscoverJava).toHaveBeenCalledTimes(1);
		// And only the degraded project's root was used
		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: '/work/mod' });
	});

	it('uses first fabric mod child rootPath as projectRoot (D-03)', async () => {
		wireSuccessfulInit(tempDirs);
		// Children order: fabric-mod first, then study-jar — the sweep should
		// pick the fabric-mod's rootPath.
		seedProject('p', makeDegradedSession(), [
			makeFabricModChild('mod-a', '/work/mod-a'),
			makeStudyJarChild('study'),
		]);

		await retryDegradedJdtLsSessions();

		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: '/work/mod-a' });
	});

	it('passes each degraded project its own projectRoot (D-03/D-05 per-iteration scope)', async () => {
		wireSuccessfulInit(tempDirs);
		seedProject('a', makeDegradedSession(), [makeFabricModChild('mod-a', '/work/mod-a')]);
		seedProject('b', makeDegradedSession(), [makeFabricModChild('mod-b', '/work/mod-b')]);

		await retryDegradedJdtLsSessions();

		expect(mockDiscoverJava).toHaveBeenCalledTimes(2);
		const callArgs = mockDiscoverJava.mock.calls.map(c => c[0]);
		expect(callArgs).toEqual(expect.arrayContaining([
			{ projectRoot: '/work/mod-a' },
			{ projectRoot: '/work/mod-b' },
		]));
	});

	it('replaces project.jdtls atomically on retry success', async () => {
		wireSuccessfulInit(tempDirs);
		// Project with NO fabric mod children → projectRoot is undefined,
		// discoverJava still succeeds via the mock, and the sweep should
		// atomically replace project.jdtls with the new available session.
		const project = seedProject('p', makeDegradedSession(), []);

		await retryDegradedJdtLsSessions();

		expect(project.jdtls?.available).toBe(true);
		expect(mockDiscoverJava).toHaveBeenCalledWith({ projectRoot: undefined });
	});

	it('logs warning but does not throw on retry failure', async () => {
		// discoverJava itself throws (synthetic) — sweep must swallow + log.
		mockDiscoverJava.mockRejectedValueOnce(new Error('synthetic discovery failure'));
		seedProject('p', makeDegradedSession(), [makeFabricModChild('m', '/work/m')]);

		await expect(retryDegradedJdtLsSessions()).resolves.toBeUndefined();

		// The sweep's catch-block logs a warn with a "reinit failed" message.
		const warnCalls = mockLoggerWarn.mock.calls.map(c => String(c[0]));
		expect(warnCalls.some(m => m.includes('reinit failed'))).toBe(true);
	});

	it('skips projects with no jdtls field', async () => {
		wireSuccessfulInit(tempDirs);
		// project.jdtls === undefined — sweep filter `?.available !== false` is
		// true for undefined, so the project must be skipped entirely.
		seedProject('p', undefined, [makeFabricModChild('m', '/work/m')]);

		await retryDegradedJdtLsSessions();

		expect(mockDiscoverJava).not.toHaveBeenCalled();
	});

	it('re-syncs every fabric-mod child after a successful rescue (CR-01)', async () => {
		wireSuccessfulInit(tempDirs);
		mockSyncFabricModToWorkspace.mockResolvedValue({ synced: true });
		const project = seedProject('p', makeDegradedSession(), [
			makeFabricModChild('mod-a', '/work/mod-a'),
			makeFabricModChild('mod-b', '/work/mod-b'),
			makeStudyJarChild('study'),
		]);

		await retryDegradedJdtLsSessions();

		// Exactly two invocations — one per fabric-mod child, never for the
		// study-jar.
		expect(mockSyncFabricModToWorkspace).toHaveBeenCalledTimes(2);
		const childNames = mockSyncFabricModToWorkspace.mock.calls.map(c => c[0].name);
		expect(childNames).toEqual(expect.arrayContaining(['mod-a', 'mod-b']));
		// The newSession passed to each call must be the SAME reference — the
		// freshly-assigned project.jdtls post-rescue.
		expect(mockSyncFabricModToWorkspace.mock.calls[0][1]).toBe(project.jdtls);
		expect(mockSyncFabricModToWorkspace.mock.calls[1][1]).toBe(project.jdtls);
	});

	it('does NOT call syncFabricModToWorkspace when reinit stays degraded', async () => {
		// discoverJava returns null → initJdtLsSession short-circuits to a
		// degraded session, so the sync loop must be skipped entirely.
		mockDiscoverJava.mockResolvedValue({
			javaPath: null,
			error: 'Java not found. Tried: ...',
		});
		mockSyncFabricModToWorkspace.mockResolvedValue({ synced: true });
		seedProject('p', makeDegradedSession(), [
			makeFabricModChild('mod-a', '/work/mod-a'),
		]);

		await retryDegradedJdtLsSessions();

		expect(mockSyncFabricModToWorkspace).not.toHaveBeenCalled();
	});

	it('swallows a per-child sync throw via logger.warn and continues to the next child (D-04)', async () => {
		wireSuccessfulInit(tempDirs);
		// First fabric-mod child throws; second still resolves successfully.
		mockSyncFabricModToWorkspace
			.mockRejectedValueOnce(new Error('synthetic sync failure'))
			.mockResolvedValue({ synced: true });
		seedProject('p', makeDegradedSession(), [
			makeFabricModChild('mod-a', '/work/mod-a'),
			makeFabricModChild('mod-b', '/work/mod-b'),
		]);

		await expect(retryDegradedJdtLsSessions()).resolves.toBeUndefined();

		// Both children attempted despite the first throwing.
		expect(mockSyncFabricModToWorkspace).toHaveBeenCalledTimes(2);
		// And the throw was logged via logger.warn with a "re-sync" message.
		const warnFirstArgs = mockLoggerWarn.mock.calls.map(c => String(c[0]));
		expect(warnFirstArgs.some(m => m.toLowerCase().includes('re-sync'))).toBe(true);
	});

	it('surfaces syncFabricModToWorkspace warnings via logger.warn', async () => {
		wireSuccessfulInit(tempDirs);
		mockSyncFabricModToWorkspace.mockResolvedValue({
			synced: true,
			warning: 'partial extraction skipped 2 entries',
		});
		seedProject('p', makeDegradedSession(), [
			makeFabricModChild('mod-a', '/work/mod-a'),
		]);

		await retryDegradedJdtLsSessions();

		const warnFirstArgs = mockLoggerWarn.mock.calls.map(c => String(c[0]));
		expect(warnFirstArgs.some(m => m.includes('partial extraction skipped 2 entries'))).toBe(true);
	});
});
