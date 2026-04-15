import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricModNamed, makeFakeMultiModProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';
import type { DependencyEntry, StudyJarChild } from '../../src/project/types.js';

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

function makeStudyJarChild(name: string, jarPath: string): StudyJarChild {
	return {
		kind: 'study-jar',
		name,
		jarPath,
		mtime: 1000,
		size: 500,
		autoInclude: false,
		stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
	};
}

describe('refresh_project_members tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('refreshes only the specified members', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setActive('test');
		jarReader.registerProject('test', new Set(['/fake/minecraft-sources.jar']));

		const newDeps = new Map<string, DependencyEntry>([
			['mod-a/some-lib:new-dep', {
				id: 'mod-a/some-lib:new-dep',
				group: 'some-lib',
				artifact: 'new-dep',
				version: '1.0',
				category: 'library' as const,
				sourcesJarPath: '/fake/new-dep-sources.jar',
				available: true,
				provenanceChains: [],
			}],
		]);

		vi.mocked(discoverDependencies).mockResolvedValue(makeDiscoveryResult('mod-a', newDeps));

		const result = await pair.client.callTool({
			name: 'refresh_project_members',
			arguments: { project: 'test', members: ['mod-a'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshedChildren).toEqual(['mod-a']);

		// mod-a should have new deps
		const modA = project.children.get('mod-a')!;
		if (modA.kind === 'fabric-mod') {
			expect(modA.dependencyJars.has('mod-a/some-lib:new-dep')).toBe(true);
		}

		// mod-b should be unchanged
		const modB = project.children.get('mod-b')!;
		if (modB.kind === 'fabric-mod') {
			expect(modB.dependencyJars.has('mod-a/some-lib:new-dep')).toBe(false);
			expect(modB.dependencyJars.has('mod-b/minecraft')).toBe(true);
		}
	});

	it('empty members array returns nothing changed', async () => {
		const project = makeFakeMultiModProject(['mod-a']);
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'refresh_project_members',
			arguments: { project: 'test', members: [] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshed).toEqual([]);
		expect(envelope.data.message).toBe('Nothing changed');
	});

	it('nonexistent member returns error', async () => {
		const project = makeFakeMultiModProject(['mod-a']);
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'refresh_project_members',
			arguments: { project: 'test', members: ['nonexistent'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CHILD_NOT_FOUND');
	});

	it('study jar member returns INVALID_CHILD_TYPE error', async () => {
		const mod = makeFakeFabricModNamed('mod-a');
		const studyJar = makeStudyJarChild('my-study', '/fake/study.jar');
		const project = {
			name: 'test',
			children: new Map([
				['mod-a', mod],
				['my-study', studyJar],
			]),
		};
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'refresh_project_members',
			arguments: { project: 'test', members: ['my-study'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('INVALID_CHILD_TYPE');
	});
});
