import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	const content = result.content as Array<{ type: string; text: string }>;
	return JSON.parse(content[0].text);
}

function makeFakeProject(name: string, mcVersion: string = '1.21.11'): LoadedProject {
	return {
		name,
		rootPath: `/fake/${name}`,
		gradleConfig: {
			minecraftVersion: mcVersion,
			mappingEra: 'yarn',
			yarnMappings: `${mcVersion}+build.4`,
			loaderVersion: '0.16.14',
			fabricApiVersion: '0.119.5+1.21.11',
			dependencies: [],
		},
		sourcesJar: { path: '/fake/sources.jar', exists: true },
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
		dependencyJars: new Map([
			['minecraft', { id: 'minecraft', group: 'net.minecraft', artifact: 'minecraft', version: mcVersion, category: 'minecraft' as const, sourcesJarPath: '/fake/mc.jar', available: true }],
		]),
		filterConfig: { mode: 'include-all', patterns: [] },
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
		expect(projA.mappingEra).toBe('yarn');
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
