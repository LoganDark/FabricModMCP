import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadFabricMod, reloadFabricModConfig } from '../../src/project/loader.js';
import { ProjectStore } from '../../src/state/project-store.js';
import { DomainError } from '../../src/errors/domain-error.js';
import type { FabricModChild, GradleConfig, FabricModJson } from '../../src/project/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const YARN_ERA_DIR = join(FIXTURES_DIR, 'yarn-era');

describe('loadFabricMod', () => {
	it('throws PROJECT_NOT_FOUND for non-existent directory', async () => {
		const fakePath = join(FIXTURES_DIR, 'does-not-exist');
		await expect(loadFabricMod(fakePath)).rejects.toThrow(DomainError);
		try {
			await loadFabricMod(fakePath);
		} catch (error) {
			expect(error).toBeInstanceOf(DomainError);
			expect((error as DomainError).code).toBe('PROJECT_NOT_FOUND');
			expect((error as DomainError).tried).toContain(fakePath);
		}
	});

	it('throws GRADLE_PROPERTIES_NOT_FOUND for directory without gradle.properties', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'loader-test-'));
		try {
			await expect(loadFabricMod(tempDir)).rejects.toThrow(DomainError);
			try {
				await loadFabricMod(tempDir);
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
		// If it exists, we get a successful FabricModChild; if not, SOURCES_JAR_NOT_FOUND.
		try {
			const project = await loadFabricMod(YARN_ERA_DIR);
			// Happy path: sources jar exists on this machine
			expect(project.name).toBe('testmod');
			expect(project.rootPath).toMatch(/tests\/fixtures\/yarn-era$/);
			expect(project.gradleConfig.mappingEra).toBe('mapped');
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
		const mod = {
			kind: 'fabric-mod' as const,
			name: 'test-mod',
			rootPath: '/fake/path',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
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
			filterConfig: { mode: 'include-all' as const, patterns: [] },
		};
		const project = {
			name: 'test-mod',
			children: new Map([['test-mod', mod]]),
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

// Mock fs/promises for reloadFabricModConfig tests
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		readFile: vi.fn(actual.readFile),
		access: vi.fn(actual.access),
		stat: vi.fn(actual.stat),
	};
});

// Mock parsers so we control what they return
vi.mock('../../src/project/gradle-parser.js', () => ({
	parseGradleProperties: vi.fn(),
	parseBuildGradle: vi.fn(),
}));

vi.mock('../../src/project/loom-cache.js', () => ({
	resolveSourcesJarPath: vi.fn(),
}));

vi.mock('../../src/project/fabric-mod.js', () => ({
	parseFabricMod: vi.fn(),
}));

function makeFakeMod(overrides: Partial<FabricModChild> = {}): FabricModChild {
	return {
		kind: 'fabric-mod',
		name: 'testmod',
		rootPath: '/fake/project',
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped' as const,
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.16.14',
			fabricApiVersion: '0.119.5+1.21.11',
			dependencies: [],
		},
		sourcesJar: { path: '/fake/old-sources.jar', exists: true },
		fabricMod: {
			schemaVersion: 1,
			id: 'testmod',
			version: '1.0.0',
			name: 'Test Mod',
			description: 'A test mod',
			authors: ['Test'],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: new Map(),
		filterConfig: { mode: 'include-all' as const, patterns: [] },
		...overrides,
	};
}

describe('reloadFabricModConfig', () => {
	let mockReadFile: ReturnType<typeof vi.fn>;
	let mockAccess: ReturnType<typeof vi.fn>;
	let mockParseGradleProperties: ReturnType<typeof vi.fn>;
	let mockParseBuildGradle: ReturnType<typeof vi.fn>;
	let mockResolveSourcesJarPath: ReturnType<typeof vi.fn>;
	let mockParseFabricMod: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetAllMocks();

		const fs = await import('node:fs/promises');
		mockReadFile = vi.mocked(fs.readFile);
		mockAccess = vi.mocked(fs.access);

		const gradleParser = await import('../../src/project/gradle-parser.js');
		mockParseGradleProperties = vi.mocked(gradleParser.parseGradleProperties);
		mockParseBuildGradle = vi.mocked(gradleParser.parseBuildGradle);

		const loomCache = await import('../../src/project/loom-cache.js');
		mockResolveSourcesJarPath = vi.mocked(loomCache.resolveSourcesJarPath);

		const fabricMod = await import('../../src/project/fabric-mod.js');
		mockParseFabricMod = vi.mocked(fabricMod.parseFabricMod);
	});

	function setupDefaultMocks(newConfig?: Partial<GradleConfig>, newFabricMod?: Partial<FabricModJson>) {
		const newGradle: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped' as const,
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.16.14',
			fabricApiVersion: '0.119.5+1.21.11',
			dependencies: [],
			...newConfig,
		};

		const newFabric: FabricModJson = {
			schemaVersion: 1,
			id: 'testmod',
			version: '1.0.0',
			name: 'Test Mod',
			description: 'A test mod',
			authors: ['Test'],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
			...newFabricMod,
		};

		mockReadFile.mockImplementation(async (path: string) => {
			if (path.endsWith('gradle.properties')) return 'fake-gradle-props';
			if (path.endsWith('build.gradle.kts')) return 'fake-build-gradle';
			if (path.endsWith('fabric.mod.json')) return JSON.stringify(newFabric);
			throw new Error(`ENOENT: no such file: ${path}`);
		});

		mockParseGradleProperties.mockReturnValue(new Map([['minecraft_version', newGradle.minecraftVersion]]));
		mockParseBuildGradle.mockReturnValue(newGradle);
		mockResolveSourcesJarPath.mockReturnValue('/fake/new-sources.jar');
		mockParseFabricMod.mockReturnValue(newFabric);
		mockAccess.mockResolvedValue(undefined); // sources jar exists
	}

	it('re-reads gradle.properties and build.gradle.kts, updates mod.gradleConfig', async () => {
		const newConfig: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped' as const,
			yarnMappings: '1.21.11+build.5',
			loaderVersion: '0.16.15',
			fabricApiVersion: '0.120.0+1.21.11',
			dependencies: [],
		};
		setupDefaultMocks(newConfig);

		const mod = makeFakeMod();
		const result = await reloadFabricModConfig(mod);

		expect(mockReadFile).toHaveBeenCalledWith(join('/fake/project', 'gradle.properties'), 'utf-8');
		expect(mockReadFile).toHaveBeenCalledWith(join('/fake/project', 'build.gradle.kts'), 'utf-8');
		expect(mod.gradleConfig).toEqual(newConfig);
		expect(result.warnings).toEqual([]);
	});

	it('resolves new sources jar path and updates mod.sourcesJar', async () => {
		setupDefaultMocks();

		const mod = makeFakeMod();
		await reloadFabricModConfig(mod);

		expect(mockResolveSourcesJarPath).toHaveBeenCalled();
		expect(mod.sourcesJar.path).toBe('/fake/new-sources.jar');
		expect(mod.sourcesJar.exists).toBe(true);
	});

	it('re-reads fabric.mod.json and updates mod.fabricMod', async () => {
		const newFabric: FabricModJson = {
			schemaVersion: 1,
			id: 'testmod',
			version: '2.0.0',
			name: 'Updated Mod',
			description: 'Updated',
			authors: ['Author'],
			license: 'Apache-2.0',
			environment: '*',
			mixins: ['test.mixins.json'],
			depends: { fabricloader: '>=0.16' },
		};
		setupDefaultMocks(undefined, newFabric);

		const mod = makeFakeMod();
		await reloadFabricModConfig(mod);

		expect(mockReadFile).toHaveBeenCalledWith(
			join('/fake/project', 'src', 'main', 'resources', 'fabric.mod.json'),
			'utf-8',
		);
		expect(mod.fabricMod).toEqual(newFabric);
	});

	it('returns version change warning when minecraftVersion changes', async () => {
		setupDefaultMocks({ minecraftVersion: '1.22.0', mappingEra: 'unobfuscated' as const });

		const mod = makeFakeMod();
		const result = await reloadFabricModConfig(mod);

		expect(result.warnings).toContainEqual(
			expect.stringContaining('Minecraft version changed from 1.21.11 to 1.22.0'),
		);
	});

	it('returns mod ID change warning and keeps mod.name unchanged', async () => {
		setupDefaultMocks(undefined, { id: 'newmodid' });

		const mod = makeFakeMod();
		const originalName = mod.name;
		const result = await reloadFabricModConfig(mod);

		expect(result.warnings).toContainEqual(
			expect.stringContaining("fabric.mod.json id changed from 'testmod' to 'newmodid'"),
		);
		expect(mod.name).toBe(originalName);
		expect(mod.fabricMod.id).toBe('newmodid');
	});

	it('sets sourcesJar.exists=false and warns when sources jar missing', async () => {
		setupDefaultMocks();
		mockAccess.mockRejectedValue(new Error('ENOENT'));

		const mod = makeFakeMod();
		const result = await reloadFabricModConfig(mod);

		expect(mod.sourcesJar.exists).toBe(false);
		expect(result.warnings).toContainEqual(
			expect.stringContaining('Run ./gradlew genSources'),
		);
	});

	it('throws DomainError when gradle.properties is missing', async () => {
		setupDefaultMocks();
		mockReadFile.mockImplementation(async (path: string) => {
			if (path.endsWith('gradle.properties')) throw new Error('ENOENT');
			if (path.endsWith('build.gradle.kts')) return 'fake-build-gradle';
			if (path.endsWith('fabric.mod.json')) return '{}';
			throw new Error('ENOENT');
		});

		const mod = makeFakeMod();
		await expect(reloadFabricModConfig(mod)).rejects.toThrow(DomainError);
		try {
			await reloadFabricModConfig(mod);
		} catch (error) {
			expect((error as DomainError).code).toBe('GRADLE_PROPERTIES_NOT_FOUND');
		}
	});

	it('throws DomainError when build.gradle.kts is missing', async () => {
		setupDefaultMocks();
		mockReadFile.mockImplementation(async (path: string) => {
			if (path.endsWith('gradle.properties')) return 'fake-props';
			if (path.endsWith('build.gradle.kts')) throw new Error('ENOENT');
			if (path.endsWith('fabric.mod.json')) return '{}';
			throw new Error('ENOENT');
		});

		const mod = makeFakeMod();
		await expect(reloadFabricModConfig(mod)).rejects.toThrow(DomainError);
		try {
			await reloadFabricModConfig(mod);
		} catch (error) {
			expect((error as DomainError).code).toBe('BUILD_GRADLE_NOT_FOUND');
		}
	});
});
