import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricModNamed, makeFakeMultiModProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';
import type { DependencyEntry, Project } from '../../src/project/types.js';

vi.mock('../../src/project/dependency-discovery.js', () => ({
	discoverDependencies: vi.fn(),
}));

function makeDiscoveryResult(modName: string, extraDeps: Map<string, DependencyEntry> = new Map()) {
	const deps = new Map<string, DependencyEntry>([
		[`${modName}/minecraft`, {
			id: `${modName}/minecraft`,
			group: 'net.minecraft',
			artifact: 'minecraft-merged',
			version: '1.21.11',
			category: 'minecraft' as const,
			sourcesJarPath: '/fake/minecraft-sources.jar',
			available: true,
			provenanceChains: [],
		}],
		[modName, {
			id: modName,
			group: '',
			artifact: '',
			version: '',
			category: 'mod-source' as const,
			sourcesJarPath: null,
			available: true,
			provenanceChains: [],
		}],
		...extraDeps,
	]);

	return {
		dependencies: deps,
		summary: {
			total: extraDeps.size,
			withSources: [...extraDeps.values()].filter(d => d.available).length,
			withoutSources: [...extraDeps.values()].filter(d => !d.available).length,
		},
	};
}

describe('refresh_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('refreshes all fabric mod children', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setActive('test');
		jarReader.registerProject('test', new Set(['/fake/minecraft-sources.jar']));

		vi.mocked(discoverDependencies)
			.mockResolvedValueOnce(makeDiscoveryResult('mod-a'))
			.mockResolvedValueOnce(makeDiscoveryResult('mod-b'));

		const result = await pair.client.callTool({
			name: 'refresh_project',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshedChildren).toContain('mod-a');
		expect(envelope.data.refreshedChildren).toContain('mod-b');
	});

	it('refreshes single mod project', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const mod = makeFakeFabricModNamed('solo-mod');
		const project: Project = {
			name: 'test',
			children: new Map([['solo-mod', mod]]),
		};
		projectStore.set('test', project);
		projectStore.setActive('test');
		jarReader.registerProject('test', new Set(['/fake/minecraft-sources.jar']));

		vi.mocked(discoverDependencies).mockResolvedValue(makeDiscoveryResult('solo-mod'));

		const result = await pair.client.callTool({
			name: 'refresh_project',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshedChildren).toEqual(['solo-mod']);
	});

	it('returns error when no fabric mods exist', async () => {
		const project: Project = {
			name: 'test',
			children: new Map(),
		};
		projectStore.set('test', project);

		const result = await pair.client.callTool({
			name: 'refresh_project',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('NO_FABRIC_MOD');
	});
});
