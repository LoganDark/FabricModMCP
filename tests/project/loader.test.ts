import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadProject } from '../../src/project/loader.js';
import { ProjectStore } from '../../src/state/project-store.js';
import { DomainError } from '../../src/errors/domain-error.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const YARN_ERA_DIR = join(FIXTURES_DIR, 'yarn-era');

describe('loadProject', () => {
	it('throws PROJECT_NOT_FOUND for non-existent directory', async () => {
		const fakePath = join(FIXTURES_DIR, 'does-not-exist');
		await expect(loadProject(fakePath)).rejects.toThrow(DomainError);
		try {
			await loadProject(fakePath);
		} catch (error) {
			expect(error).toBeInstanceOf(DomainError);
			expect((error as DomainError).code).toBe('PROJECT_NOT_FOUND');
			expect((error as DomainError).tried).toContain(fakePath);
		}
	});

	it('throws GRADLE_PROPERTIES_NOT_FOUND for directory without gradle.properties', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'loader-test-'));
		try {
			await expect(loadProject(tempDir)).rejects.toThrow(DomainError);
			try {
				await loadProject(tempDir);
			} catch (error) {
				expect(error).toBeInstanceOf(DomainError);
				expect((error as DomainError).code).toBe('GRADLE_PROPERTIES_NOT_FOUND');
			}
		} finally {
			await rmdir(tempDir);
		}
	});

	it('loads yarn-era fixture project or throws SOURCES_JAR_NOT_FOUND', async () => {
		// The sources jar may or may not exist depending on the machine.
		// If it exists, we get a successful LoadedProject; if not, SOURCES_JAR_NOT_FOUND.
		try {
			const project = await loadProject(YARN_ERA_DIR);
			// Happy path: sources jar exists on this machine
			expect(project.name).toBe('yarn-era');
			expect(project.rootPath).toMatch(/tests\/fixtures\/yarn-era$/);
			expect(project.gradleConfig.mappingEra).toBe('yarn');
			expect(project.gradleConfig.minecraftVersion).toBe('1.21.11');
			expect(project.fabricMod.id).toBe('testmod');
			expect(project.sourcesJar.exists).toBe(true);
			expect(project.sourcesJar.path).toContain('fabric-loom');
			expect(project.dependencyJars).toBeInstanceOf(Map);
		} catch (error) {
			// Error path: no Loom cache on this machine
			expect(error).toBeInstanceOf(DomainError);
			const domainError = error as DomainError;
			expect(domainError.code).toBe('SOURCES_JAR_NOT_FOUND');
			expect(domainError.tried.length).toBeGreaterThan(0);
			expect(domainError.tried[0]).toContain('fabric-loom');
			expect(domainError.tried[0]).toContain('minecraft-merged');
			expect(domainError.suggestions).toContain('Run ./gradlew genSources in your project directory');
		}
	});
});

describe('ProjectStore', () => {
	it('stores and retrieves projects by name', () => {
		const store = new ProjectStore();
		const project = {
			name: 'test-mod',
			rootPath: '/fake/path',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'yarn' as const,
				yarnMappings: '1.21.11+build.4',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/jar.jar', exists: true },
			fabricMod: {
				schemaVersion: 1,
				id: 'testmod',
				version: '1.0.0',
				name: 'Test Mod',
				description: '',
				authors: [],
				license: 'MIT',
				environment: '*',
				mixins: [],
				depends: {},
			},
			dependencyJars: new Map(),
		};

		expect(store.has('test-mod')).toBe(false);
		expect(store.size).toBe(0);

		store.set('test-mod', project);

		expect(store.has('test-mod')).toBe(true);
		expect(store.get('test-mod')).toBe(project);
		expect(store.size).toBe(1);
		expect(store.list()).toEqual([project]);

		expect(store.delete('test-mod')).toBe(true);
		expect(store.has('test-mod')).toBe(false);
		expect(store.size).toBe(0);
	});

	it('returns undefined for missing projects', () => {
		const store = new ProjectStore();
		expect(store.get('nonexistent')).toBeUndefined();
	});
});
