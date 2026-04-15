import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { LspClient, JSONRPCEndpoint } from 'ts-lsp-client';

// Mock the client module before importing startup
vi.mock('../../src/jdtls/client.js', () => ({
	detectJava: vi.fn(),
	findJdtLs: vi.fn(),
	startJdtLs: vi.fn(),
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

import { initJdtLsSession } from '../../src/jdtls/startup.js';
import { detectJava, findJdtLs, startJdtLs } from '../../src/jdtls/client.js';

const mockDetectJava = vi.mocked(detectJava);
const mockFindJdtLs = vi.mocked(findJdtLs);
const mockStartJdtLs = vi.mocked(startJdtLs);

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
		mockDetectJava.mockReturnValue({
			javaPath: null,
			error: 'Java not found. Set JAVA_HOME or add java to PATH.',
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
		mockDetectJava.mockReturnValue({
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
		mockDetectJava.mockReturnValue({
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
		mockDetectJava.mockReturnValue({
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
		mockDetectJava.mockReturnValue({
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
		mockDetectJava.mockReturnValue({
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
