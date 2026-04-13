import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

vi.mock('../../src/project/loader.js', () => ({
	loadProject: vi.fn(),
}));

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	const content = result.content as Array<{ type: string; text: string }>;
	return JSON.parse(content[0].text);
}

function makeFakeProject(overrides: Partial<LoadedProject> = {}): LoadedProject {
	return {
		name: 'test',
		rootPath: '/fake/path',
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
		...overrides,
	};
}

describe('load_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('loads project and returns name, MC version', async () => {
		const { loadProject } = await import('../../src/project/loader.js');
		const fake = makeFakeProject({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadProject).mockResolvedValue(fake);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('my-mod');
		expect(envelope.data.minecraftVersion).toBe('1.21.11');
	});

	it('uses custom name when provided', async () => {
		const { loadProject } = await import('../../src/project/loader.js');
		const fake = makeFakeProject({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadProject).mockResolvedValue(fake);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod', name: 'custom' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('custom');
		expect(projectStore.has('custom')).toBe(true);
	});

	it('auto-generates name from basename', async () => {
		const { loadProject } = await import('../../src/project/loader.js');
		const fake = makeFakeProject({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadProject).mockResolvedValue(fake);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('my-mod');
	});

	it('collision with explicit name returns error', async () => {
		const { loadProject } = await import('../../src/project/loader.js');
		const fake1 = makeFakeProject({ rootPath: '/home/user/mod-a' });
		const fake2 = makeFakeProject({ rootPath: '/home/user/mod-b' });
		vi.mocked(loadProject).mockResolvedValueOnce(fake1).mockResolvedValueOnce(fake2);

		await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-a', name: 'same-name' },
		});

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-b', name: 'same-name' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NAME_COLLISION');
	});
});
