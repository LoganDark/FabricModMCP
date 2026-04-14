import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';

vi.mock('../../src/project/loader.js', () => ({
	loadProject: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...original,
		stat: vi.fn().mockResolvedValue({ size: 12345 }),
	};
});

function makeFakeProject(overrides: Partial<LoadedProject> = {}): LoadedProject {
	const deps = new Map<string, DependencyEntry>();
	deps.set('minecraft', {
		id: 'minecraft',
		group: 'net.minecraft',
		artifact: 'minecraft-merged',
		version: '1.21.11',
		category: 'minecraft',
		sourcesJarPath: '/fake/minecraft-sources.jar',
		available: true,
		provenanceChains: [],
	});
	deps.set('src', {
		id: 'src',
		group: 'testmod',
		artifact: 'testmod',
		version: '1.0.0',
		category: 'mod-source',
		sourcesJarPath: '/fake/mod-sources.jar',
		available: true,
		provenanceChains: [],
	});
	deps.set('net.fabricmc.fabric-api:fabric-resource-loader-v0', {
		id: 'net.fabricmc.fabric-api:fabric-resource-loader-v0',
		group: 'net.fabricmc.fabric-api',
		artifact: 'fabric-resource-loader-v0',
		version: '1.2.3',
		category: 'fabric-api',
		sourcesJarPath: '/fake/dep-sources.jar',
		available: true,
		provenanceChains: [['net.fabricmc.fabric-api:fabric-api']],
	});
	deps.set('com.example:unavailable-lib', {
		id: 'com.example:unavailable-lib',
		group: 'com.example',
		artifact: 'unavailable-lib',
		version: '0.1.0',
		category: 'library',
		sourcesJarPath: null,
		available: false,
		provenanceChains: [],
	});
	return makeFakeProjectBase({
		fabricMod: {
			schemaVersion: 1,
			id: 'testmod',
			version: '1.0.0',
			name: 'Test Mod',
			description: 'A test mod',
			authors: ['Test'],
			license: 'MIT',
			environment: '*',
			mixins: ['testmod.mixins.json'],
			depends: { fabricloader: '>=0.16.0', minecraft: '~1.21.11' },
		},
		dependencyJars: deps,
		...overrides,
	});
}

describe('get_project_metadata tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns all three categories when no flags specified', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.projectInfo).toBeDefined();
		expect(envelope.data.modInfo).toBeDefined();
		expect(envelope.data.jarInventory).toBeDefined();
	});

	it('projectInfo contains version, mappings, era, loader, fabricApi', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		const pi = envelope.data.projectInfo;
		expect(pi.minecraftVersion).toBe('1.21.11');
		expect(pi.mappingEra).toBe('yarn');
		expect(pi.yarnMappings).toBe('1.21.11+build.4');
		expect(pi.loaderVersion).toBe('0.16.14');
		expect(pi.fabricApiVersion).toBe('0.119.5+1.21.11');
	});

	it('modInfo contains all fabric.mod.json fields', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		const mi = envelope.data.modInfo;
		expect(mi.id).toBe('testmod');
		expect(mi.name).toBe('Test Mod');
		expect(mi.version).toBe('1.0.0');
		expect(mi.description).toBe('A test mod');
		expect(mi.authors).toEqual(['Test']);
		expect(mi.license).toBe('MIT');
		expect(mi.environment).toBe('*');
		expect(mi.mixins).toEqual(['testmod.mixins.json']);
		expect(mi.depends).toEqual({ fabricloader: '>=0.16.0', minecraft: '~1.21.11' });
	});

	it('modInfo includes extra field when fabric.mod.json has additional keys', async () => {
		const fake = makeFakeProject({
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
				customKey: 'custom-value',
			} as any,
		});
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.modInfo.extra).toBeDefined();
		expect(envelope.data.modInfo.extra.customKey).toBe('custom-value');
	});

	it('modInfo omits extra field when no extra keys exist', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.modInfo.extra).toBeUndefined();
	});

	it('jarInventory lists all entries from dependencyJars', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.jarInventory).toHaveLength(4);
	});

	it('jar entries have required fields', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.jarInventory.find((e: any) => e.id === 'minecraft');
		expect(mc).toBeDefined();
		expect(mc.category).toBe('minecraft');
		expect(mc.group).toBe('net.minecraft');
		expect(mc.artifact).toBe('minecraft-merged');
		expect(mc.version).toBe('1.21.11');
		expect(mc.available).toBe(true);
		expect(mc.sizeBytes).toBe(12345);
		expect(mc.provenanceChains).toEqual([]);
	});

	it('include_paths=true adds sourcesJarPath to jar entries', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test', include_paths: true },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.jarInventory.find((e: any) => e.id === 'minecraft');
		expect(mc.sourcesJarPath).toBe('/fake/minecraft-sources.jar');
	});

	it('include_paths absent does NOT include sourcesJarPath', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.jarInventory.find((e: any) => e.id === 'minecraft');
		expect(mc.sourcesJarPath).toBeUndefined();
	});

	it('unavailable jars have sizeBytes as null', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		const unavail = envelope.data.jarInventory.find((e: any) => e.id === 'com.example:unavailable-lib');
		expect(unavail).toBeDefined();
		expect(unavail.sizeBytes).toBeNull();
		expect(unavail.available).toBe(false);
	});

	it('include_project_info=true with other flags false returns only projectInfo', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: {
				project: 'test',
				include_project_info: true,
				include_mod_info: false,
				include_jar_inventory: false,
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.projectInfo).toBeDefined();
		expect(envelope.data.modInfo).toBeUndefined();
		expect(envelope.data.jarInventory).toBeUndefined();
	});

	it('DomainError from resolveProject returns structured error', async () => {
		// No project loaded -- resolveProject will throw DomainError
		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'nonexistent' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});

	it('mappingEra is present in projectInfo (META-05)', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_project_metadata',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.projectInfo.mappingEra).toBe('yarn');
	});
});
