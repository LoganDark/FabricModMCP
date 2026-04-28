import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../../src/logging/logger.js';
import type { GradleConfig } from '../../src/project/types.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(),
	readdir: vi.fn(),
	access: vi.fn(),
}));

// Mock source-jar-finder
vi.mock('../../src/project/source-jar-finder.js', () => ({
	findSourcesJar: vi.fn(),
	findCompiledJar: vi.fn(),
}));

import { readFile, readdir, access } from 'node:fs/promises';
import { findSourcesJar, findCompiledJar } from '../../src/project/source-jar-finder.js';
import { discoverDependencies } from '../../src/project/dependency-discovery.js';

const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);
const mockedAccess = vi.mocked(access);
const mockedFindSourcesJar = vi.mocked(findSourcesJar);
const mockedFindCompiledJar = vi.mocked(findCompiledJar);

function makeConfig(overrides: Partial<GradleConfig> = {}): GradleConfig {
	return {
		minecraftVersion: '1.21.11',
		mappingEra: 'mapped',
		yarnMappings: '1.21.11+build.4',
		loaderVersion: '0.16.14',
		fabricApiVersion: '0.141.3+1.21.11',
		dependencies: [
			{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
			{ configuration: 'mappings', group: 'net.fabricmc', artifact: 'yarn', version: '1.21.11+build.4', raw: 'net.fabricmc:yarn:1.21.11+build.4' },
			{ configuration: 'modImplementation', group: 'net.fabricmc', artifact: 'fabric-loader', version: '0.16.14', raw: 'net.fabricmc:fabric-loader:0.16.14' },
			{ configuration: 'modImplementation', group: 'net.fabricmc.fabric-api', artifact: 'fabric-api', version: '0.141.3+1.21.11', raw: 'net.fabricmc.fabric-api:fabric-api:0.141.3+1.21.11' },
		],
		mavenRoots: [],
		...overrides,
	};
}

const FAKE_MC_SOURCES = '/fake/minecraft-sources.jar';
const MOD_NAME = 'testmod';

beforeEach(() => {
	vi.resetAllMocks();
	// Default: no files exist
	mockedReadFile.mockRejectedValue(new Error('File not found'));
	mockedReaddir.mockRejectedValue(new Error('Dir not found'));
	mockedAccess.mockRejectedValue(new Error('Not found'));
	mockedFindSourcesJar.mockResolvedValue(null);
	mockedFindCompiledJar.mockResolvedValue(null);
});

describe('discoverDependencies', () => {
	it('always includes namespaced minecraft entry with category="minecraft"', async () => {
		const result = await discoverDependencies(makeConfig(), FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
		const mc = result.dependencies.get('testmod/minecraft');
		expect(mc).toBeDefined();
		expect(mc!.id).toBe('testmod/minecraft');
		expect(mc!.category).toBe('minecraft');
		expect(mc!.group).toBe('com.mojang');
		expect(mc!.artifact).toBe('minecraft');
		expect(mc!.version).toBe('1.21.11');
		expect(mc!.sourcesJarPath).toBe(FAKE_MC_SOURCES);
		expect(mc!.available).toBe(true);
	});

	it('always includes mod-source entry keyed by modName with category="mod-source"', async () => {
		const result = await discoverDependencies(makeConfig(), FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
		const src = result.dependencies.get('testmod');
		expect(src).toBeDefined();
		expect(src!.id).toBe('testmod');
		expect(src!.category).toBe('mod-source');
		expect(src!.available).toBe(true);
		expect(src!.sourcesJarPath).toBeNull();
	});

	it('does not contain bare "minecraft" or "src" keys', async () => {
		const result = await discoverDependencies(makeConfig(), FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
		expect(result.dependencies.has('minecraft')).toBe(false);
		expect(result.dependencies.has('src')).toBe(false);
	});

	it('discovers Fabric API modules from mock POM with compile-scope filtering', async () => {
		const fabricApiPom = `
<project>
  <dependencies>
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-networking-api-v1</artifactId>
      <version>4.3.1+1.21.11</version>
      <scope>compile</scope>
    </dependency>
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-rendering-v1</artifactId>
      <version>8.0.0+1.21.11</version>
    </dependency>
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-gametest-api-v1</artifactId>
      <version>2.0.0+1.21.11</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>`;

		// Fabric API Loom cache POM
		const loomPomPath = join(homedir(), '.gradle', 'caches', 'fabric-loom', 'fabric-api', 'fabric-api-0.141.3+1.21.11.pom');
		mockedReadFile.mockImplementation(async (path: any) => {
			if (path === loomPomPath) return fabricApiPom;
			throw new Error('File not found');
		});

		mockedFindSourcesJar.mockResolvedValue('/fake/sources.jar');

		const result = await discoverDependencies(makeConfig(), FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

		// Should have networking and rendering (compile scope), NOT gametest (test scope)
		const networking = result.dependencies.get('testmod/net.fabricmc.fabric-api:fabric-networking-api-v1');
		expect(networking).toBeDefined();
		expect(networking!.category).toBe('fabric-api');
		expect(networking!.available).toBe(true);

		const rendering = result.dependencies.get('testmod/net.fabricmc.fabric-api:fabric-rendering-v1');
		expect(rendering).toBeDefined();
		expect(rendering!.category).toBe('fabric-api');

		// Test scope should be excluded
		const gametest = result.dependencies.get('testmod/net.fabricmc.fabric-api:fabric-gametest-api-v1');
		expect(gametest).toBeUndefined();
	});

	it('discovers declared dependencies with POM traversal filtering test scope', async () => {
		const config = makeConfig({
			dependencies: [
				{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
				{ configuration: 'modImplementation', group: 'com.example', artifact: 'my-lib', version: '1.0.0', raw: 'com.example:my-lib:1.0.0' },
			],
			fabricApiVersion: undefined,
		});

		const myLibPom = `
<project>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>transitive-lib</artifactId>
      <version>2.0.0</version>
      <scope>compile</scope>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>test-only</artifactId>
      <version>3.0.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>`;

		mockedFindSourcesJar.mockResolvedValue('/fake/sources.jar');

		// findPomInModules2 internal: readdir + readFile for POM
		const pomDir = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'com.example', 'my-lib', '1.0.0');
		const transitivePomDir = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'com.example', 'transitive-lib', '2.0.0');

		mockedReaddir.mockImplementation(async (path: any) => {
			if (path === pomDir) return ['abc123'] as any;
			if (path === transitivePomDir) return ['def456'] as any;
			throw new Error('Dir not found');
		});

		mockedReadFile.mockImplementation(async (path: any) => {
			if (path === join(pomDir, 'abc123', 'my-lib-1.0.0.pom')) return myLibPom;
			if (path === join(transitivePomDir, 'def456', 'transitive-lib-2.0.0.pom')) {
				return '<project><dependencies></dependencies></project>';
			}
			throw new Error('File not found');
		});

		const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

		const myLib = result.dependencies.get('testmod/com.example:my-lib');
		expect(myLib).toBeDefined();
		expect(myLib!.category).toBe('library');

		const transitive = result.dependencies.get('testmod/com.example:transitive-lib');
		expect(transitive).toBeDefined();
		expect(transitive!.category).toBe('library');

		// Test-scope dependency should NOT be followed
		const testOnly = result.dependencies.get('testmod/com.example:test-only');
		expect(testOnly).toBeUndefined();
	});

	it('detects circular dependencies and skips them', async () => {
		const config = makeConfig({
			dependencies: [
				{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
				{ configuration: 'modImplementation', group: 'circle', artifact: 'a', version: '1.0.0', raw: 'circle:a:1.0.0' },
			],
			fabricApiVersion: undefined,
		});

		const pomA = `
<project>
  <dependencies>
    <dependency>
      <groupId>circle</groupId>
      <artifactId>b</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`;

		const pomB = `
<project>
  <dependencies>
    <dependency>
      <groupId>circle</groupId>
      <artifactId>a</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`;

		const dirA = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'circle', 'a', '1.0.0');
		const dirB = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'circle', 'b', '1.0.0');

		mockedReaddir.mockImplementation(async (path: any) => {
			if (path === dirA) return ['sha1a'] as any;
			if (path === dirB) return ['sha1b'] as any;
			throw new Error('Dir not found');
		});

		mockedReadFile.mockImplementation(async (path: any) => {
			if (path === join(dirA, 'sha1a', 'a-1.0.0.pom')) return pomA;
			if (path === join(dirB, 'sha1b', 'b-1.0.0.pom')) return pomB;
			throw new Error('File not found');
		});

		mockedFindSourcesJar.mockResolvedValue(null);

		// Should not throw / infinite loop
		const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
		expect(result.dependencies.has('testmod/circle:a')).toBe(true);
		expect(result.dependencies.has('testmod/circle:b')).toBe(true);
	});

	it('respects depth limit of 5 levels', async () => {
		const config = makeConfig({
			dependencies: [
				{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
				{ configuration: 'modImplementation', group: 'deep', artifact: 'level-0', version: '1.0.0', raw: 'deep:level-0:1.0.0' },
			],
			fabricApiVersion: undefined,
		});

		// Create a chain: level-0 -> level-1 -> ... -> level-6
		mockedReaddir.mockImplementation(async (path: any) => {
			// Match any of the level directories
			if (typeof path === 'string' && path.includes('deep/level-')) {
				return ['sha1'] as any;
			}
			throw new Error('Dir not found');
		});

		mockedReadFile.mockImplementation(async (path: any) => {
			if (typeof path !== 'string') throw new Error('File not found');
			const levelMatch = path.match(/level-(\d+)-1\.0\.0\.pom$/);
			if (levelMatch) {
				const level = parseInt(levelMatch[1]);
				const nextLevel = level + 1;
				return `
<project>
  <dependencies>
    <dependency>
      <groupId>deep</groupId>
      <artifactId>level-${nextLevel}</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`;
			}
			throw new Error('File not found');
		});

		mockedFindSourcesJar.mockResolvedValue(null);

		const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

		// Should have level-0 through level-5 (depth limit 5 means 5 levels of transitive)
		expect(result.dependencies.has('testmod/deep:level-0')).toBe(true);
		expect(result.dependencies.has('testmod/deep:level-5')).toBe(true);
		// level-6 should NOT be discovered (beyond depth limit)
		expect(result.dependencies.has('testmod/deep:level-6')).toBe(false);
	});

	it('marks dependencies without source jars as available=false', async () => {
		const config = makeConfig({
			dependencies: [
				{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
				{ configuration: 'modImplementation', group: 'no.sources', artifact: 'lib', version: '1.0.0', raw: 'no.sources:lib:1.0.0' },
			],
			fabricApiVersion: undefined,
		});

		mockedFindSourcesJar.mockResolvedValue(null);

		const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

		const lib = result.dependencies.get('testmod/no.sources:lib');
		expect(lib).toBeDefined();
		expect(lib!.available).toBe(false);
		expect(lib!.sourcesJarPath).toBeNull();
	});

	describe('provenance chains', () => {
		it('seed entries (minecraft, mod-source) have empty provenanceChains', async () => {
			const result = await discoverDependencies(makeConfig(), FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
			const mc = result.dependencies.get('testmod/minecraft');
			expect(mc!.provenanceChains).toEqual([]);
			const src = result.dependencies.get('testmod');
			expect(src!.provenanceChains).toEqual([]);
		});

		it('Strategy B Fabric API modules have provenance chain from fabric-api', async () => {
			const fabricApiPom = `
<project>
  <dependencies>
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-networking-api-v1</artifactId>
      <version>4.3.1+1.21.11</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;

			const loomPomPath = join(homedir(), '.gradle', 'caches', 'fabric-loom', 'fabric-api', 'fabric-api-0.141.3+1.21.11.pom');
			mockedReadFile.mockImplementation(async (path: any) => {
				if (path === loomPomPath) return fabricApiPom;
				throw new Error('File not found');
			});
			mockedFindSourcesJar.mockResolvedValue('/fake/sources.jar');

			const result = await discoverDependencies(makeConfig(), FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
			const networking = result.dependencies.get('testmod/net.fabricmc.fabric-api:fabric-networking-api-v1');
			expect(networking!.provenanceChains).toEqual([['net.fabricmc.fabric-api:fabric-api']]);
		});

		it('transitive deps have full chain path', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'com.example', artifact: 'my-lib', version: '1.0.0', raw: 'com.example:my-lib:1.0.0' },
				],
				fabricApiVersion: undefined,
			});

			const myLibPom = `
<project>
  <dependencies>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>transitive-lib</artifactId>
      <version>2.0.0</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;

			const pomDir = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'com.example', 'my-lib', '1.0.0');
			const transitivePomDir = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'com.example', 'transitive-lib', '2.0.0');

			mockedReaddir.mockImplementation(async (path: any) => {
				if (path === pomDir) return ['abc123'] as any;
				if (path === transitivePomDir) return ['def456'] as any;
				throw new Error('Dir not found');
			});

			mockedReadFile.mockImplementation(async (path: any) => {
				if (path === join(pomDir, 'abc123', 'my-lib-1.0.0.pom')) return myLibPom;
				if (path === join(transitivePomDir, 'def456', 'transitive-lib-2.0.0.pom')) {
					return '<project><dependencies></dependencies></project>';
				}
				throw new Error('File not found');
			});

			mockedFindSourcesJar.mockResolvedValue('/fake/sources.jar');

			const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

			const myLib = result.dependencies.get('testmod/com.example:my-lib');
			expect(myLib!.provenanceChains).toEqual([['com.example:my-lib']]);

			const transitive = result.dependencies.get('testmod/com.example:transitive-lib');
			expect(transitive!.provenanceChains).toEqual([['com.example:my-lib', 'com.example:transitive-lib']]);
		});

		it('multi-path deps accumulate multiple chains', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'path', artifact: 'a', version: '1.0.0', raw: 'path:a:1.0.0' },
					{ configuration: 'modImplementation', group: 'path', artifact: 'b', version: '1.0.0', raw: 'path:b:1.0.0' },
				],
				fabricApiVersion: undefined,
			});

			const pomA = `
<project>
  <dependencies>
    <dependency>
      <groupId>shared</groupId>
      <artifactId>common</artifactId>
      <version>1.0.0</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;

			const pomB = `
<project>
  <dependencies>
    <dependency>
      <groupId>shared</groupId>
      <artifactId>common</artifactId>
      <version>1.0.0</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;

			const dirA = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'path', 'a', '1.0.0');
			const dirB = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'path', 'b', '1.0.0');

			mockedReaddir.mockImplementation(async (path: any) => {
				if (path === dirA) return ['sha1a'] as any;
				if (path === dirB) return ['sha1b'] as any;
				throw new Error('Dir not found');
			});

			mockedReadFile.mockImplementation(async (path: any) => {
				if (path === join(dirA, 'sha1a', 'a-1.0.0.pom')) return pomA;
				if (path === join(dirB, 'sha1b', 'b-1.0.0.pom')) return pomB;
				throw new Error('File not found');
			});

			mockedFindSourcesJar.mockResolvedValue(null);

			const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

			const common = result.dependencies.get('testmod/shared:common');
			expect(common).toBeDefined();
			expect(common!.provenanceChains).toHaveLength(2);
			expect(common!.provenanceChains).toContainEqual(['path:a', 'shared:common']);
			expect(common!.provenanceChains).toContainEqual(['path:b', 'shared:common']);
		});

		it('appends to existing provenanceChains when deps.has(id) is true', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'first', artifact: 'route', version: '1.0.0', raw: 'first:route:1.0.0' },
					{ configuration: 'modImplementation', group: 'second', artifact: 'route', version: '1.0.0', raw: 'second:route:1.0.0' },
				],
				fabricApiVersion: undefined,
			});

			const pomFirst = `
<project>
  <dependencies>
    <dependency>
      <groupId>shared</groupId>
      <artifactId>target</artifactId>
      <version>1.0.0</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;

			const pomSecond = `
<project>
  <dependencies>
    <dependency>
      <groupId>shared</groupId>
      <artifactId>target</artifactId>
      <version>1.0.0</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;

			const dirFirst = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'first', 'route', '1.0.0');
			const dirSecond = join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'second', 'route', '1.0.0');

			mockedReaddir.mockImplementation(async (path: any) => {
				if (path === dirFirst) return ['sha1'] as any;
				if (path === dirSecond) return ['sha2'] as any;
				throw new Error('Dir not found');
			});

			mockedReadFile.mockImplementation(async (path: any) => {
				if (path === join(dirFirst, 'sha1', 'route-1.0.0.pom')) return pomFirst;
				if (path === join(dirSecond, 'sha2', 'route-1.0.0.pom')) return pomSecond;
				throw new Error('File not found');
			});

			mockedFindSourcesJar.mockResolvedValue(null);

			const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

			const target = result.dependencies.get('testmod/shared:target');
			expect(target).toBeDefined();
			// First discovery adds one chain, second discovery appends another
			expect(target!.provenanceChains).toHaveLength(2);
			expect(target!.provenanceChains[0]).toEqual(['first:route', 'shared:target']);
			expect(target!.provenanceChains[1]).toEqual(['second:route', 'shared:target']);
		});
	});

	describe('unresolved-sources warn log', () => {
		it('emits a warn log naming coord and roots tried when sources resolution returns null', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'no.sources', artifact: 'lib', version: '1.0.0', raw: 'no.sources:lib:1.0.0' },
				],
				fabricApiVersion: undefined,
				mavenRoots: ['/fake/root1', '/fake/root2'],
			});

			mockedFindSourcesJar.mockResolvedValue(null);

			const warnSpy = vi.spyOn(logger, 'warn');
			try {
				await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
			} finally {
				warnSpy.mockRestore();
			}

			const matching = warnSpy.mock.calls.find(call =>
				typeof call[0] === 'string' && call[0].includes('no.sources:lib:1.0.0'),
			);
			expect(matching).toBeDefined();
			expect(matching![0]).toContain('/fake/root1');
			expect(matching![0]).toContain('/fake/root2');
			expect(matching![0]).toContain('~/.gradle/caches/modules-2/files-2.1');
		});

		it('omits the leading comma in the warn message when mavenRoots is empty', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'no.sources', artifact: 'lib', version: '1.0.0', raw: 'no.sources:lib:1.0.0' },
				],
				fabricApiVersion: undefined,
				mavenRoots: [],
			});

			mockedFindSourcesJar.mockResolvedValue(null);

			const warnSpy = vi.spyOn(logger, 'warn');
			try {
				await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
			} finally {
				warnSpy.mockRestore();
			}

			const matching = warnSpy.mock.calls.find(call =>
				typeof call[0] === 'string' && call[0].includes('no.sources:lib:1.0.0'),
			);
			expect(matching).toBeDefined();
			// Should NOT have a leading comma -- "(tried roots: ~/.gradle..." not "(tried roots: , ~/.gradle..."
			expect(matching![0]).not.toMatch(/tried roots:\s*,/);
			expect(matching![0]).toContain('~/.gradle/caches/modules-2/files-2.1');
		});

		it('does NOT emit warn when sources resolution succeeds', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'has.sources', artifact: 'lib', version: '1.0.0', raw: 'has.sources:lib:1.0.0' },
				],
				fabricApiVersion: undefined,
				mavenRoots: [],
			});

			mockedFindSourcesJar.mockResolvedValue('/fake/sources.jar');

			const warnSpy = vi.spyOn(logger, 'warn');
			try {
				await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);
			} finally {
				warnSpy.mockRestore();
			}

			const matching = warnSpy.mock.calls.find(call =>
				typeof call[0] === 'string' && call[0].includes('has.sources:lib:1.0.0'),
			);
			expect(matching).toBeUndefined();
		});

		it('threads mavenRoots from config into findSourcesJar / findCompiledJar', async () => {
			const config = makeConfig({
				dependencies: [
					{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
					{ configuration: 'modImplementation', group: 'with.roots', artifact: 'lib', version: '1.0.0', raw: 'with.roots:lib:1.0.0' },
				],
				fabricApiVersion: undefined,
				mavenRoots: ['/maven/a', '/maven/b'],
			});

			mockedFindSourcesJar.mockResolvedValue('/fake/sources.jar');
			mockedFindCompiledJar.mockResolvedValue('/fake/compiled.jar');

			await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

			const sourcesCall = mockedFindSourcesJar.mock.calls.find(c => c[0] === 'with.roots');
			expect(sourcesCall).toBeDefined();
			expect(sourcesCall![3]).toEqual(['/maven/a', '/maven/b']);

			const compiledCall = mockedFindCompiledJar.mock.calls.find(c => c[0] === 'with.roots');
			expect(compiledCall).toBeDefined();
			expect(compiledCall![3]).toEqual(['/maven/a', '/maven/b']);
		});
	});

	it('provides correct summary excluding minecraft and mod-source', async () => {
		const config = makeConfig({
			dependencies: [
				{ configuration: 'minecraft', group: 'com.mojang', artifact: 'minecraft', version: '1.21.11', raw: 'com.mojang:minecraft:1.21.11' },
				{ configuration: 'modImplementation', group: 'with.sources', artifact: 'lib-a', version: '1.0.0', raw: 'with.sources:lib-a:1.0.0' },
				{ configuration: 'modImplementation', group: 'no.sources', artifact: 'lib-b', version: '1.0.0', raw: 'no.sources:lib-b:1.0.0' },
			],
			fabricApiVersion: undefined,
		});

		mockedFindSourcesJar.mockImplementation(async (group: string) => {
			if (group === 'with.sources') return '/fake/sources.jar';
			return null;
		});

		const result = await discoverDependencies(config, FAKE_MC_SOURCES, null, '/fake/project', MOD_NAME);

		expect(result.summary.total).toBe(2); // lib-a and lib-b, not minecraft/mod-source
		expect(result.summary.withSources).toBe(1);
		expect(result.summary.withoutSources).toBe(1);
	});
});
