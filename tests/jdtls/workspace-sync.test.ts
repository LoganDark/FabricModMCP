import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { JarReader } from '../../src/project/jar-reader.js';
import type { StudyJar, StudyJarStats, FabricModChild, DependencyEntry, GradleConfig, FabricModJson, ResolvedJar, FilterConfig } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';
import type { JSONRPCEndpoint } from 'ts-lsp-client';
import {
	extractStudyJarToWorkspace,
	removeStudyJarFromWorkspace,
	isWorkspaceSynced,
	syncStudyJarToWorkspace,
	unsyncStudyJarFromWorkspace,
	syncFabricModToWorkspace,
	unsyncFabricModFromWorkspace,
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

	function createMockFabricMod(overrides?: {
		name?: string;
		rootPath?: string;
		deps?: Map<string, DependencyEntry>;
		sourcesJarExists?: boolean;
	}): FabricModChild {
		const name = overrides?.name ?? 'testmod';
		const deps = overrides?.deps ?? new Map<string, DependencyEntry>([
			[`${name}/minecraft`, {
				id: `${name}/minecraft`,
				group: 'com.mojang',
				artifact: 'minecraft',
				version: '1.21.11',
				category: 'minecraft',
				sourcesJarPath: '/fake/minecraft-sources.jar',
				available: true,
				provenanceChains: [],
			}],
			[`${name}/${name}`, {
				id: `${name}/${name}`,
				group: 'com.example',
				artifact: name,
				version: '1.0.0',
				category: 'mod-source',
				sourcesJarPath: null,
				available: true,
				provenanceChains: [],
			}],
		]);

		return {
			kind: 'fabric-mod',
			name,
			rootPath: overrides?.rootPath ?? '/fake/mod-root',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'unmapped',
				dependencies: [],
			} as GradleConfig,
			sourcesJar: {
				path: '/fake/sources.jar',
				exists: overrides?.sourcesJarExists ?? true,
			} as ResolvedJar,
			fabricMod: {
				schemaVersion: 1,
				id: name,
				version: '1.0.0',
				name,
				description: 'Test mod',
				authors: [],
				license: 'MIT',
				environment: '*',
				mixins: [],
				depends: {},
			} as FabricModJson,
			dependencyJars: deps,
			filterConfig: {
				mode: 'include-all',
				patterns: [],
			} as FilterConfig,
		};
	}

	describe('syncFabricModToWorkspace', () => {
		it('returns synced=false with warning when jdtls is undefined', async () => {
			const mod = createMockFabricMod();
			const jarReader = createMockJarReader(new Map());

			const result = await syncFabricModToWorkspace(mod, undefined, jarReader);
			expect(result.synced).toBe(false);
			expect(result.warning).toContain('JDT LS unavailable');
		});

		it('returns synced=false with warning when jdtls.available is false', async () => {
			const mod = createMockFabricMod();
			const jarReader = createMockJarReader(new Map());
			const jdtls = createMockJdtLsSession('/tmp/test', { available: false });

			const result = await syncFabricModToWorkspace(mod, jdtls, jarReader);
			expect(result.synced).toBe(false);
			expect(result.warning).toContain('JDT LS unavailable');
		});

		it('extracts each dependency into namespaced dirs and updates jarIdToDirName', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const mcEntries = new Map<string, Buffer>();
			mcEntries.set('net/minecraft/Client.java', Buffer.from('public class Client {}'));

			const jarReader = createMockJarReader(new Map([
				['/fake/minecraft-sources.jar', mcEntries],
			]));

			// Create a mod with only the minecraft dep (no mod-source, to test jar deps)
			const deps = new Map<string, DependencyEntry>([
				['testmod/minecraft', {
					id: 'testmod/minecraft',
					group: 'com.mojang',
					artifact: 'minecraft',
					version: '1.21.11',
					category: 'minecraft',
					sourcesJarPath: '/fake/minecraft-sources.jar',
					available: true,
					provenanceChains: [],
				}],
			]);

			const mod = createMockFabricMod({ deps, sourcesJarExists: false });
			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });

			const result = await syncFabricModToWorkspace(mod, jdtls, jarReader);

			expect(result.synced).toBe(true);

			// Check extraction happened under namespaced dir
			expect(existsSync(join(tempDir, 'testmod--minecraft', 'net', 'minecraft', 'Client.java'))).toBe(true);

			// Check jarIdToDirName updated
			expect(jdtls.jarIdToDirName.get('testmod/minecraft')).toBe('testmod--minecraft');
		});

		it('extracts mod own source under fabricMod.name and updates jarIdToDirName', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			// Create mod source directory structure on disk
			const modSrcDir = join(tempDir, 'mod-root', 'src', 'main', 'java');
			await mkdir(join(modSrcDir, 'com', 'example'), { recursive: true });
			await writeFile(join(modSrcDir, 'com', 'example', 'MyMod.java'), 'public class MyMod {}');

			const deps = new Map<string, DependencyEntry>([
				['testmod/testmod', {
					id: 'testmod/testmod',
					group: 'com.example',
					artifact: 'testmod',
					version: '1.0.0',
					category: 'mod-source',
					sourcesJarPath: null,
					available: true,
					provenanceChains: [],
				}],
			]);

			const jarReader = createMockJarReader(new Map());
			const mod = createMockFabricMod({ deps, rootPath: join(tempDir, 'mod-root') });
			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });

			const result = await syncFabricModToWorkspace(mod, jdtls, jarReader);

			expect(result.synced).toBe(true);

			// Mod source extracted under fabricMod.name
			expect(existsSync(join(tempDir, 'testmod', 'com', 'example', 'MyMod.java'))).toBe(true);

			// jarIdToDirName updated for mod source using fabricMod.name
			expect(jdtls.jarIdToDirName.get('testmod')).toBe('testmod');
		});

		it('regenerates .classpath with all dirs and notifies JDT LS endpoint', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const mcEntries = new Map<string, Buffer>();
			mcEntries.set('net/minecraft/Client.java', Buffer.from('public class Client {}'));

			const jarReader = createMockJarReader(new Map([
				['/fake/minecraft-sources.jar', mcEntries],
			]));

			const deps = new Map<string, DependencyEntry>([
				['testmod/minecraft', {
					id: 'testmod/minecraft',
					group: 'com.mojang',
					artifact: 'minecraft',
					version: '1.21.11',
					category: 'minecraft',
					sourcesJarPath: '/fake/minecraft-sources.jar',
					available: true,
					provenanceChains: [],
				}],
			]);

			const mod = createMockFabricMod({ deps, sourcesJarExists: false });
			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });
			// Pre-existing entry from a study jar
			jdtls.jarIdToDirName.set('my-study', 'my-study');

			const result = await syncFabricModToWorkspace(mod, jdtls, jarReader);

			expect(result.synced).toBe(true);

			// .classpath should contain both old and new dirs
			const { realpathSync } = await import('node:fs');
			const resolvedTempDir = realpathSync(tempDir);
			const classpathContent = await readFile(join(resolvedTempDir, '.classpath'), 'utf-8');
			expect(classpathContent).toContain('testmod--minecraft');
			expect(classpathContent).toContain('my-study');

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

		it('rolls back jarIdToDirName entries on extraction failure', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const failReader = {
				listEntries: async () => { throw new Error('extraction failed'); },
				readEntry: async () => Buffer.alloc(0),
			} as unknown as JarReader;

			const mod = createMockFabricMod();
			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });

			const result = await syncFabricModToWorkspace(mod, jdtls, failReader);

			expect(result.synced).toBe(false);
			expect(result.warning).toBeDefined();
			// All entries for this mod should be rolled back
			expect(jdtls.jarIdToDirName.has('testmod/minecraft')).toBe(false);
			expect(jdtls.jarIdToDirName.has('testmod')).toBe(false);
		});
	});

	describe('unsyncFabricModFromWorkspace', () => {
		it('returns synced=false when jdtls is undefined', async () => {
			const mod = createMockFabricMod();
			const result = await unsyncFabricModFromWorkspace(mod, undefined);
			expect(result.synced).toBe(false);
		});

		it('returns synced=false when jdtls.available is false', async () => {
			const mod = createMockFabricMod();
			const jdtls = createMockJdtLsSession('/tmp/test', { available: false });
			const result = await unsyncFabricModFromWorkspace(mod, jdtls);
			expect(result.synced).toBe(false);
		});

		it('deletes extracted dirs, removes from jarIdToDirName, regenerates .classpath, notifies', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			// Set up extracted dirs
			const mcDir = join(tempDir, 'testmod--minecraft');
			await mkdir(mcDir, { recursive: true });
			await writeFile(join(mcDir, 'Client.java'), 'class Client {}');
			const modDir = join(tempDir, 'testmod');
			await mkdir(modDir, { recursive: true });
			await writeFile(join(modDir, 'MyMod.java'), 'class MyMod {}');

			const endpoint = createMockEndpoint();
			const jdtls = createMockJdtLsSession(tempDir, { endpoint });
			jdtls.jarIdToDirName.set('testmod/minecraft', 'testmod--minecraft');
			jdtls.jarIdToDirName.set('testmod', 'testmod');
			jdtls.jarIdToDirName.set('other-study', 'other-study'); // should survive

			const mod = createMockFabricMod();
			const result = await unsyncFabricModFromWorkspace(mod, jdtls);

			expect(result.synced).toBe(true);

			// Dirs deleted
			expect(existsSync(mcDir)).toBe(false);
			expect(existsSync(modDir)).toBe(false);

			// Map cleaned for mod's entries only
			expect(jdtls.jarIdToDirName.has('testmod/minecraft')).toBe(false);
			expect(jdtls.jarIdToDirName.has('testmod')).toBe(false);
			expect(jdtls.jarIdToDirName.has('other-study')).toBe(true);

			// .classpath regenerated
			const { realpathSync } = await import('node:fs');
			const resolvedTempDir = realpathSync(tempDir);
			const classpathContent = await readFile(join(resolvedTempDir, '.classpath'), 'utf-8');
			expect(classpathContent).not.toContain('testmod--minecraft');
			expect(classpathContent).not.toContain('"testmod"');
			expect(classpathContent).toContain('other-study');

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

		it('still cleans up jarIdToDirName entries even when rm fails', async () => {
			const tempDir = await mkdtemp(join(tmpdir(), 'test-ws-sync-'));
			tempDirs.push(tempDir);

			const endpoint = {
				notify: vi.fn().mockImplementation(() => { throw new Error('notify failed'); }),
				send: vi.fn().mockResolvedValue([]),
			} as unknown as JSONRPCEndpoint;

			const jdtls = createMockJdtLsSession(tempDir, { endpoint });
			jdtls.jarIdToDirName.set('testmod/minecraft', 'testmod--minecraft');
			jdtls.jarIdToDirName.set('testmod', 'testmod');

			const mod = createMockFabricMod();
			const result = await unsyncFabricModFromWorkspace(mod, jdtls);

			expect(result.synced).toBe(false);
			expect(jdtls.jarIdToDirName.has('testmod/minecraft')).toBe(false);
			expect(jdtls.jarIdToDirName.has('testmod')).toBe(false);
		});
	});
});
