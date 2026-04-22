import type { TestPair } from './client.js';
import type { Project, FabricModChild, DependencyEntry } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

export function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	return (result as any).structuredContent;
}

export function makeFakeFabricMod(overrides: Partial<FabricModChild> = {}): FabricModChild {
	return {
		kind: 'fabric-mod',
		name: 'testmod',
		rootPath: '/fake/path',
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.16.14',
			fabricApiVersion: '0.119.5+1.21.11',
			dependencies: [],
		},
		sourcesJar: { path: '/fake/sources.jar', exists: true },
		compiledJar: { path: '/fake/compiled.jar', exists: true },
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
		dependencyJars: new Map<string, DependencyEntry>([
			['testmod/minecraft', {
				id: 'testmod/minecraft',
				group: 'net.minecraft',
				artifact: 'minecraft-merged',
				version: '1.21.11',
				category: 'minecraft' as const,
				sourcesJarPath: '/fake/minecraft-sources.jar',
				compiledJarPath: null,
				available: true,
				provenanceChains: [],
			}],
			['testmod', {
				id: 'testmod',
				group: '',
				artifact: '',
				version: '',
				category: 'mod-source' as const,
				sourcesJarPath: null,
				compiledJarPath: null,
				available: true,
				provenanceChains: [],
			}],
		]),
		filterConfig: { mode: 'include-all', patterns: [] },
		...overrides,
	};
}

export function makeFakeProject(overrides: Partial<Project> = {}): Project {
	const mod = makeFakeFabricMod();
	return {
		name: 'test',
		children: new Map([[mod.name, mod]]),
		...overrides,
	};
}

export function makeFakeFabricModNamed(name: string, overrides: Partial<FabricModChild> = {}): FabricModChild {
	return makeFakeFabricMod({
		name,
		rootPath: `/fake/${name}`,
		fabricMod: {
			schemaVersion: 1,
			id: name,
			version: '1.0.0',
			name,
			description: `A ${name} mod`,
			authors: ['Test'],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: new Map<string, DependencyEntry>([
			[`${name}/minecraft`, {
				id: `${name}/minecraft`,
				group: 'net.minecraft',
				artifact: 'minecraft-merged',
				version: '1.21.11',
				category: 'minecraft' as const,
				sourcesJarPath: '/fake/minecraft-sources.jar',
				compiledJarPath: null,
				available: true,
				provenanceChains: [],
			}],
			[name, {
				id: name,
				group: '',
				artifact: '',
				version: '',
				category: 'mod-source' as const,
				sourcesJarPath: null,
				compiledJarPath: null,
				available: true,
				provenanceChains: [],
			}],
		]),
		...overrides,
	});
}

export function makeFakeMultiModProject(modNames: string[], overrides: Partial<Project> = {}): Project {
	const children = new Map<string, FabricModChild>();
	for (const name of modNames) {
		children.set(name, makeFakeFabricModNamed(name));
	}
	return {
		name: 'test',
		children,
		...overrides,
	};
}

export function makeJdtlsSession(client: any, overrides: Partial<JdtLsSession> = {}): JdtLsSession {
	return {
		available: true,
		tempDir: '/tmp/test-jdtls',
		dataDir: '/tmp/test-jdtls-data',
		jarIdToDirName: new Map([['testmod/minecraft', 'minecraft']]),
		client,
		...overrides,
	};
}
