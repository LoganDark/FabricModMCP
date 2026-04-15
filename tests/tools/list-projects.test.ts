import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricMod } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { DependencyEntry, Project } from '../../src/project/types.js';

function makeFakeProject(name: string, mcVersion: string = '1.21.11'): Project {
	const mod = makeFakeFabricMod({
		gradleConfig: {
			minecraftVersion: mcVersion,
			mappingEra: 'mapped',
			yarnMappings: `${mcVersion}+build.4`,
			loaderVersion: '0.16.14',
			fabricApiVersion: '0.119.5+1.21.11',
			dependencies: [],
		},
		dependencyJars: new Map<string, DependencyEntry>([
			['minecraft', { id: 'minecraft', group: 'net.minecraft', artifact: 'minecraft', version: mcVersion, category: 'minecraft' as const, sourcesJarPath: '/fake/mc.jar', available: true, provenanceChains: [] }],
		]),
	});
	return {
		name,
		children: new Map([[mod.name, mod]]),
	};
}

describe('list_projects tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns all loaded projects with metadata', async () => {
		projectStore.set('mod-a', makeFakeProject('mod-a', '1.21.11'));
		projectStore.set('mod-b', makeFakeProject('mod-b', '1.20.4'));
		projectStore.setDefault('mod-a');

		const result = await pair.client.callTool({
			name: 'list_projects',
			arguments: {},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.count).toBe(2);
		expect(envelope.data.projects).toHaveLength(2);

		const projA = envelope.data.projects.find((p: any) => p.name === 'mod-a');
		expect(projA).toBeDefined();
		expect(projA.minecraftVersion).toBe('1.21.11');
		expect(projA.mappingEra).toBe('mapped');
		expect(projA.dependencyCount).toBe(1);
		expect(projA.isDefault).toBe(true);

		const projB = envelope.data.projects.find((p: any) => p.name === 'mod-b');
		expect(projB).toBeDefined();
		expect(projB.isDefault).toBe(false);
	});

	it('empty when no projects loaded', async () => {
		const result = await pair.client.callTool({
			name: 'list_projects',
			arguments: {},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.projects).toHaveLength(0);
		expect(envelope.data.count).toBe(0);
	});
});
