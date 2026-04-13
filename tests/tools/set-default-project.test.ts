import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	return (result as any).structuredContent;
}

function makeFakeProject(name: string): LoadedProject {
	return {
		name,
		rootPath: `/fake/${name}`,
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'yarn',
			yarnMappings: '1.21.11+build.4',
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
		dependencyJars: new Map(),
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}

describe('set_default_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('sets default and confirms', async () => {
		projectStore.set('my-mod', makeFakeProject('my-mod'));

		const result = await pair.client.callTool({
			name: 'set_default_project',
			arguments: { project: 'my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.defaultProject).toBe('my-mod');
		expect(projectStore.getDefault()).toBe('my-mod');
	});

	it('nonexistent project returns error', async () => {
		const result = await pair.client.callTool({
			name: 'set_default_project',
			arguments: { project: 'nope' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NOT_FOUND');
	});
});
