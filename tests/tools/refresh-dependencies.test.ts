import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricModNamed, makeFakeMultiModProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';
import type { DependencyEntry, Project, StudyJarChild } from '../../src/project/types.js';

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

describe('refresh_dependencies tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('scoped refresh refreshes only the targeted child', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setDefault('test');
		// Register project jars so removeProjectJar doesn't fail
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
			name: 'refresh_dependencies',
			arguments: { project: 'test', scope: 'mod-a' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshedChildren).toEqual(['mod-a']);

		// mod-a should have new deps
		const modA = project.children.get('mod-a')!;
		expect(modA.kind).toBe('fabric-mod');
		if (modA.kind === 'fabric-mod') {
			expect(modA.dependencyJars.has('mod-a/some-lib:new-dep')).toBe(true);
		}

		// mod-b should be unchanged
		const modB = project.children.get('mod-b')!;
		expect(modB.kind).toBe('fabric-mod');
		if (modB.kind === 'fabric-mod') {
			expect(modB.dependencyJars.has('mod-a/some-lib:new-dep')).toBe(false);
			expect(modB.dependencyJars.has('mod-b/minecraft')).toBe(true);
		}
	});

	it('unscoped refresh with one mod refreshes that mod', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const mod = makeFakeFabricModNamed('solo-mod');
		const project: Project = {
			name: 'test',
			children: new Map([['solo-mod', mod]]),
		};
		projectStore.set('test', project);
		projectStore.setDefault('test');
		jarReader.registerProject('test', new Set(['/fake/minecraft-sources.jar']));

		vi.mocked(discoverDependencies).mockResolvedValue(makeDiscoveryResult('solo-mod'));

		const result = await pair.client.callTool({
			name: 'refresh_dependencies',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshedChildren).toEqual(['solo-mod']);
	});

	it('unscoped refresh with multiple mods refreshes all', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setDefault('test');
		jarReader.registerProject('test', new Set(['/fake/minecraft-sources.jar']));

		vi.mocked(discoverDependencies)
			.mockResolvedValueOnce(makeDiscoveryResult('mod-a'))
			.mockResolvedValueOnce(makeDiscoveryResult('mod-b'));

		const result = await pair.client.callTool({
			name: 'refresh_dependencies',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.refreshedChildren).toContain('mod-a');
		expect(envelope.data.refreshedChildren).toContain('mod-b');
	});

	it('scope pointing to non-existent child returns error', async () => {
		const project = makeFakeMultiModProject(['mod-a']);
		projectStore.set('test', project);
		projectStore.setDefault('test');

		const result = await pair.client.callTool({
			name: 'refresh_dependencies',
			arguments: { project: 'test', scope: 'nonexistent' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CHILD_NOT_FOUND');
	});

	it('scoped refresh preserves other child jar registrations', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setDefault('test');
		// Register both mods' jars
		jarReader.registerProject('test', new Set(['/fake/minecraft-sources.jar']));

		vi.mocked(discoverDependencies).mockResolvedValue(makeDiscoveryResult('mod-a'));

		await pair.client.callTool({
			name: 'refresh_dependencies',
			arguments: { project: 'test', scope: 'mod-a' },
		});

		// mod-b's jar should still be registered
		const projectJars = jarReader.getProjectJars('test');
		expect(projectJars).toBeDefined();
		expect(projectJars!.has('/fake/minecraft-sources.jar')).toBe(true);
	});

	it('scoped refresh only checks study jar conflicts against scoped child deps', async () => {
		const { discoverDependencies } = await import('../../src/project/dependency-discovery.js');

		// mod-b has a dep named "conflicting-jar"
		const modB = makeFakeFabricModNamed('mod-b');
		modB.dependencyJars.set('conflicting-jar', {
			id: 'conflicting-jar',
			group: 'org.test',
			artifact: 'conflicting-jar',
			version: '1.0',
			category: 'library' as const,
			sourcesJarPath: '/fake/conflicting-sources.jar',
			available: true,
			provenanceChains: [],
		});

		const modA = makeFakeFabricModNamed('mod-a');
		const studyJar = makeStudyJarChild('conflicting-jar', '/fake/study-conflicting.jar');

		const project: Project = {
			name: 'test',
			children: new Map([
				['mod-a', modA],
				['mod-b', modB],
				['conflicting-jar', studyJar],
			]),
		};
		projectStore.set('test', project);
		projectStore.setDefault('test');
		jarReader.registerProject('test', new Set([
			'/fake/minecraft-sources.jar',
			'/fake/conflicting-sources.jar',
			'/fake/study-conflicting.jar',
		]));

		// Scoped refresh of mod-a (which does NOT have 'conflicting-jar' dep)
		vi.mocked(discoverDependencies).mockResolvedValue(makeDiscoveryResult('mod-a'));

		await pair.client.callTool({
			name: 'refresh_dependencies',
			arguments: { project: 'test', scope: 'mod-a' },
		});

		// Study jar should NOT be unloaded since mod-a doesn't have 'conflicting-jar' dep
		expect(project.children.has('conflicting-jar')).toBe(true);

		// Now do scoped refresh of mod-b (which DOES have 'conflicting-jar' dep)
		vi.mocked(discoverDependencies).mockResolvedValue(
			makeDiscoveryResult('mod-b', new Map([
				['conflicting-jar', {
					id: 'conflicting-jar',
					group: 'org.test',
					artifact: 'conflicting-jar',
					version: '1.0',
					category: 'library' as const,
					sourcesJarPath: '/fake/conflicting-sources.jar',
					available: true,
					provenanceChains: [],
				}],
			])),
		);

		await pair.client.callTool({
			name: 'refresh_dependencies',
			arguments: { project: 'test', scope: 'mod-b' },
		});

		// Study jar SHOULD be unloaded since mod-b has 'conflicting-jar' dep
		expect(project.children.has('conflicting-jar')).toBe(false);
	});
});
