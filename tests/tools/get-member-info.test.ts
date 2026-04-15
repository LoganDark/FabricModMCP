import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricMod } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project, FabricModChild, DependencyEntry, StudyJarChild } from '../../src/project/types.js';

vi.mock('../../src/project/loader.js', () => ({
	loadFabricMod: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...original,
		stat: vi.fn().mockResolvedValue({ size: 12345 }),
	};
});

function makeFakeProject(modOverrides: Partial<FabricModChild> = {}): Project {
	const deps = new Map<string, DependencyEntry>();
	deps.set('testmod/minecraft', {
		id: 'testmod/minecraft',
		group: 'net.minecraft',
		artifact: 'minecraft-merged',
		version: '1.21.11',
		category: 'minecraft',
		sourcesJarPath: '/fake/minecraft-sources.jar',
		available: true,
		provenanceChains: [],
	});
	deps.set('testmod', {
		id: 'testmod',
		group: 'testmod',
		artifact: 'testmod',
		version: '1.0.0',
		category: 'mod-source',
		sourcesJarPath: '/fake/mod-sources.jar',
		available: true,
		provenanceChains: [],
	});
	const mod = makeFakeFabricMod({
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
		...modOverrides,
	});
	return {
		name: 'test',
		children: new Map([[mod.name, mod]]),
	};
}

describe('get_member_info tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns detailed info for a fabric mod member', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_member_info',
			arguments: { project: 'test', member: 'testmod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('testmod');
		expect(envelope.data.kind).toBe('fabric-mod');

		// projectInfo section
		expect(envelope.data.projectInfo).toBeDefined();
		expect(envelope.data.projectInfo.minecraftVersion).toBe('1.21.11');
		expect(envelope.data.projectInfo.mappingEra).toBe('mapped');
		expect(envelope.data.projectInfo.yarnMappings).toBe('1.21.11+build.4');
		expect(envelope.data.projectInfo.loaderVersion).toBe('0.16.14');
		expect(envelope.data.projectInfo.fabricApiVersion).toBe('0.119.5+1.21.11');

		// modInfo section
		expect(envelope.data.modInfo).toBeDefined();
		expect(envelope.data.modInfo.id).toBe('testmod');
		expect(envelope.data.modInfo.name).toBe('Test Mod');
		expect(envelope.data.modInfo.mixins).toEqual(['testmod.mixins.json']);
		expect(envelope.data.modInfo.depends).toEqual({ fabricloader: '>=0.16.0', minecraft: '~1.21.11' });

		// jarInventory section
		expect(envelope.data.jarInventory).toBeDefined();
		expect(envelope.data.jarInventory).toHaveLength(2);
	});

	it('jar entries have required fields', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_member_info',
			arguments: { project: 'test', member: 'testmod' },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.jarInventory.find((e: any) => e.id === 'testmod/minecraft');
		expect(mc).toBeDefined();
		expect(mc.category).toBe('minecraft');
		expect(mc.group).toBe('net.minecraft');
		expect(mc.artifact).toBe('minecraft-merged');
		expect(mc.version).toBe('1.21.11');
		expect(mc.available).toBe(true);
		expect(mc.sizeBytes).toBe(12345);
		expect(mc.provenanceChains).toEqual([]);
	});

	it('returns study jar info for study jar members', async () => {
		const studyJar: StudyJarChild = {
			kind: 'study-jar',
			name: 'extra-lib',
			jarPath: '/path/to/extra-lib-sources.jar',
			mtime: 1000,
			size: 500,
			autoInclude: true,
			stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
		};

		const mod = makeFakeFabricMod();
		const project: Project = {
			name: 'test',
			children: new Map([
				[mod.name, mod],
				['extra-lib', studyJar],
			]),
		};
		projectStore.set('test', project);

		const result = await pair.client.callTool({
			name: 'get_member_info',
			arguments: { project: 'test', member: 'extra-lib' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('extra-lib');
		expect(envelope.data.kind).toBe('study-jar');
		expect(envelope.data.jarPath).toBe('/path/to/extra-lib-sources.jar');
		expect(envelope.data.autoInclude).toBe(true);
		expect(envelope.data.stats).toBeDefined();
		expect(envelope.data.stats.classCount).toBe(5);
	});

	it('returns error for nonexistent member', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'get_member_info',
			arguments: { project: 'test', member: 'nonexistent' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CHILD_NOT_FOUND');
	});

	it('returns error for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'get_member_info',
			arguments: { project: 'nonexistent', member: 'testmod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});
});
