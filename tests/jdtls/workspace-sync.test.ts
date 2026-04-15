import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { JarReader } from '../../src/project/jar-reader.js';
import type { StudyJar, StudyJarStats } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';
import type { JSONRPCEndpoint } from 'ts-lsp-client';
import {
	extractStudyJarToWorkspace,
	removeStudyJarFromWorkspace,
	isWorkspaceSynced,
	syncStudyJarToWorkspace,
	unsyncStudyJarFromWorkspace,
} from '../../src/jdtls/workspace-sync.js';

function createMockJarReader(entries: Map<string, Map<string, Buffer>>): JarReader {
	return {
		listEntries: async (jarPath: string) => {
			const jarEntries = entries.get(jarPath);
			if (!jarEntries) return [];
			return Array.from(jarEntries.keys());
		},
		readEntry: async (jarPath: string, entryPath: string) => {
			const jarEntries = entries.get(jarPath);
			if (!jarEntries) throw new Error(`Jar not found: ${jarPath}`);
			const content = jarEntries.get(entryPath);
			if (!content) throw new Error(`Entry not found: ${entryPath}`);
			return content;
		},
	} as unknown as JarReader;
}

function createMockStudyJar(name: string, jarPath: string): StudyJar {
	return {
		name,
		jarPath,
		mtime: 0,
		size: 0,
		autoInclude: false,
		stats: { totalEntries: 1, packageCount: 1, classCount: 1 } as StudyJarStats,
	};
}

function createMockEndpoint(): JSONRPCEndpoint {
	return {
		notify: vi.fn(),
		send: vi.fn().mockResolvedValue([]),
	} as unknown as JSONRPCEndpoint;
}

function createMockJdtLsSession(tempDir: string, overrides?: Partial<JdtLsSession>): JdtLsSession {
	return {
		available: true,
		tempDir,
		dataDir: '/tmp/data',
		jarIdToDirName: new Map(),
		endpoint: createMockEndpoint(),
		client: {} as any,
		process: {} as any,
		...overrides,
	};
}

describe('workspace-sync', () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const dir of tempDirs) {
			await rm(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	describe('extractStudyJarToWorkspace', () => {
		it('creates directory and extracts .java files', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const jarEntries = new Map<string, Buffer>();
			jarEntries.set('com/example/Foo.java', Buffer.from('public class Foo {}'));
			jarEntries.set('META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0'));

			const jarReader = createMockJarReader(new Map([
				['/fake/study.jar', jarEntries],
			]));

			const studyJar = createMockStudyJar('myjar', '/fake/study.jar');
			const dirName = await extractStudyJarToWorkspace(studyJar, tempDir, jarReader);

			expect(dirName).toBe('myjar');
			expect(existsSync(join(tempDir, 'myjar'))).toBe(true);
			expect(existsSync(join(tempDir, 'myjar', 'com', 'example', 'Foo.java'))).toBe(true);

			const content = await readFile(join(tempDir, 'myjar', 'com', 'example', 'Foo.java'), 'utf-8');
			expect(content).toBe('public class Foo {}');
		});

		it('cleans up extracted directory on error and rethrows', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			// Mock that lists entries but throws on readEntry
			const failingReader = {
				listEntries: async () => ['com/example/Foo.java'],
				readEntry: async () => { throw new Error('read failed'); },
			} as unknown as JarReader;

			const studyJar = createMockStudyJar('badjar', '/fake/bad.jar');

			await expect(extractStudyJarToWorkspace(studyJar, tempDir, failingReader))
				.rejects.toThrow('read failed');

			expect(existsSync(join(tempDir, 'badjar'))).toBe(false);
		});
	});

	describe('removeStudyJarFromWorkspace', () => {
		it('removes the extracted directory', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const studyDir = join(tempDir, 'myjar');
			await mkdir(studyDir, { recursive: true });
			await writeFile(join(studyDir, 'Foo.java'), 'class Foo {}');
			expect(existsSync(studyDir)).toBe(true);

			await removeStudyJarFromWorkspace('myjar', tempDir);
			expect(existsSync(studyDir)).toBe(false);
		});

		it('does not throw for non-existent directory', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			await expect(removeStudyJarFromWorkspace('nonexistent', tempDir))
				.resolves.toBeUndefined();
		});
	});

describe('isWorkspaceSynced', () => {
		it('returns false when jdtls is undefined', () => {
			expect(isWorkspaceSynced('myjar', undefined)).toBe(false);
		});

		it('returns false when jdtls.available is false', () => {
			const jdtls = createMockJdtLsSession('/tmp/test', { available: false });
			expect(isWorkspaceSynced('myjar', jdtls)).toBe(false);
		});

		it('returns true when jarIdToDirName has the study jar entry', () => {
			const jdtls = createMockJdtLsSession('/tmp/test');
			jdtls.jarIdToDirName.set('myjar', 'myjar');
			expect(isWorkspaceSynced('myjar', jdtls)).toBe(true);
		});

		it('returns false when jarIdToDirName does not have the study jar entry', () => {
			const jdtls = createMockJdtLsSession('/tmp/test');
			expect(isWorkspaceSynced('myjar', jdtls)).toBe(false);
		});
	});

	describe('syncStudyJarToWorkspace', () => {
		it('returns synced=false with warning when jdtls is undefined', async () => {
			const studyJar = createMockStudyJar('myjar', '/fake/study.jar');
			const jarReader = createMockJarReader(new Map());

			const result = await syncStudyJarToWorkspace(studyJar, undefined, jarReader);
			expect(result.synced).toBe(false);
			expect(result.warning).toContain('JDT LS unavailable');
		});

		it('extracts sources, updates jarIdToDirName, writes .classpath, notifies JDT LS', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const jarEntries = new Map<string, Buffer>();
			jarEntries.set('com/example/Foo.java', Buffer.from('public class Foo {}'));

			const jarReader = createMockJarReader(new Map([
				['/fake/study.jar', jarEntries],
			]));

			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });

			const studyJar = createMockStudyJar('myjar', '/fake/study.jar');
			const result = await syncStudyJarToWorkspace(studyJar, jdtls, jarReader);

			expect(result.synced).toBe(true);
			expect(result.warning).toBeUndefined();

			// Check extraction happened
			expect(existsSync(join(tempDir, 'myjar', 'com', 'example', 'Foo.java'))).toBe(true);

			// Check jarIdToDirName updated
			expect(jdtls.jarIdToDirName.get('myjar')).toBe('myjar');

			// Check .classpath written (use realpath since the function resolves symlinks)
			const { realpathSync } = await import('node:fs');
			const resolvedTempDir = realpathSync(tempDir);
			const classpathContent = await readFile(join(resolvedTempDir, '.classpath'), 'utf-8');
			expect(classpathContent).toContain('myjar');

			// Check endpoint notified
			expect(endpoint.notify).toHaveBeenCalledWith(
				'workspace/didChangeWatchedFiles',
				expect.objectContaining({
					changes: expect.arrayContaining([
						expect.objectContaining({ type: 2 }),
					]),
				}),
			);

		});

		it('rolls back jarIdToDirName on failure and returns synced=false with warning', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const jarEntries = new Map<string, Buffer>();
			jarEntries.set('com/example/Foo.java', Buffer.from('public class Foo {}'));

			const jarReader = createMockJarReader(new Map([
				['/fake/study.jar', jarEntries],
			]));

			// Endpoint that always rejects send (making waitForWorkspaceSync timeout)
			const endpoint = {
				notify: vi.fn(),
				send: vi.fn().mockRejectedValue(new Error('not ready')),
			} as unknown as JSONRPCEndpoint;

			const jdtls = createMockJdtLsSession(tempDir, { endpoint });

			const studyJar = createMockStudyJar('failjar', '/fake/study.jar');

			// Override the timeout to be short for this test
			// We can't easily override the hardcoded 120_000 timeout, so we test
			// the rollback behavior by making extraction itself fail
			const failReader = {
				listEntries: async () => { throw new Error('extraction failed'); },
				readEntry: async () => Buffer.alloc(0),
			} as unknown as JarReader;

			const result = await syncStudyJarToWorkspace(
				createMockStudyJar('failjar', '/fake/bad.jar'),
				jdtls,
				failReader,
			);

			expect(result.synced).toBe(false);
			expect(result.warning).toContain('sync failed');
			expect(jdtls.jarIdToDirName.has('failjar')).toBe(false);
		});
	});

	describe('unsyncStudyJarFromWorkspace', () => {
		it('returns synced=false when jdtls is undefined', async () => {
			const result = await unsyncStudyJarFromWorkspace('myjar', undefined);
			expect(result.synced).toBe(false);
		});

		it('deletes extracted dir, removes from jarIdToDirName, regenerates .classpath, notifies', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			// Set up extracted dir
			const studyDir = join(tempDir, 'myjar');
			await mkdir(studyDir, { recursive: true });
			await writeFile(join(studyDir, 'Foo.java'), 'class Foo {}');

			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });
			jdtls.jarIdToDirName.set('myjar', 'myjar');
			jdtls.jarIdToDirName.set('minecraft', 'minecraft');

			const result = await unsyncStudyJarFromWorkspace('myjar', jdtls);

			expect(result.synced).toBe(true);

			// Dir deleted
			expect(existsSync(studyDir)).toBe(false);

			// Map cleaned
			expect(jdtls.jarIdToDirName.has('myjar')).toBe(false);
			expect(jdtls.jarIdToDirName.has('minecraft')).toBe(true);

			// .classpath regenerated without myjar
			const { realpathSync } = await import('node:fs');
			const resolvedTempDir = realpathSync(tempDir);
			const classpathContent = await readFile(join(resolvedTempDir, '.classpath'), 'utf-8');
			expect(classpathContent).not.toContain('myjar');
			expect(classpathContent).toContain('minecraft');

			// Endpoint notified
			expect(endpoint.notify).toHaveBeenCalledWith(
				'workspace/didChangeWatchedFiles',
				expect.objectContaining({
					changes: expect.arrayContaining([
						expect.objectContaining({ type: 2 }),
					]),
				}),
			);
		});

		it('still cleans up jarIdToDirName even when notification fails', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const endpoint = {
				notify: vi.fn().mockImplementation(() => { throw new Error('notify failed'); }),
				send: vi.fn().mockResolvedValue([]),
			} as unknown as JSONRPCEndpoint;

			const jdtls = createMockJdtLsSession(tempDir, { endpoint });
			jdtls.jarIdToDirName.set('myjar', 'myjar');

			const result = await unsyncStudyJarFromWorkspace('myjar', jdtls);

			expect(result.synced).toBe(false);
			expect(jdtls.jarIdToDirName.has('myjar')).toBe(false);
		});
	});
});
