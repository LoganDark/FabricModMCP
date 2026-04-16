import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase, makeFakeFabricModNamed } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { entryIndexCache, evictEntryIndex } from '../../src/browsing/entry-index-cache.js';
import { EntryIndex } from '../../src/browsing/entry-index.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';
import type { Project, StudyJarChild } from '../../src/project/types.js';

function makeFakeProject(name: string): Project {
	return makeFakeProjectBase({ name });
}

describe('remove_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('removes a project successfully', async () => {
		projectStore.set('test-mod', makeFakeProject('test-mod'));

		const result = await pair.client.callTool({
			name: 'remove_project',
			arguments: { project: 'test-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.removed).toBe('test-mod');
		expect(projectStore.has('test-mod')).toBe(false);
	});

	it('returns error for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'remove_project',
			arguments: { project: 'nope' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NOT_FOUND');
	});

	it('evicts entryIndexCache for each jar path before closeProject', async () => {
		const mod = makeFakeFabricModNamed('mymod', {
			sourcesJar: { path: '/fake/minecraft-sources.jar', exists: true },
			dependencyJars: new Map([
				['mymod/minecraft', {
					id: 'mymod/minecraft',
					group: 'net.minecraft',
					artifact: 'minecraft-merged',
					version: '1.21.11',
					category: 'minecraft' as const,
					sourcesJarPath: '/fake/minecraft-sources.jar',
					available: true,
					provenanceChains: [],
				}],
				['mymod/fabric-api', {
					id: 'mymod/fabric-api',
					group: 'net.fabricmc.fabric-api',
					artifact: 'fabric-api',
					version: '0.119.5',
					category: 'library' as const,
					sourcesJarPath: '/fake/fabric-api-sources.jar',
					available: true,
					provenanceChains: [],
				}],
			]),
		});

		const proj: Project = {
			name: 'evict-test',
			children: new Map([['mymod', mod]]),
		};
		projectStore.set('evict-test', proj);
		jarReader.registerProject('evict-test', new Set(['/fake/minecraft-sources.jar', '/fake/fabric-api-sources.jar']));

		// Seed cache entries that should be evicted
		entryIndexCache.set('/fake/minecraft-sources.jar', new EntryIndex([]));
		entryIndexCache.set('/fake/fabric-api-sources.jar', new EntryIndex([]));

		const result = await pair.client.callTool({
			name: 'remove_project',
			arguments: { project: 'evict-test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		// Cache entries should have been evicted
		expect(entryIndexCache.has('/fake/minecraft-sources.jar')).toBe(false);
		expect(entryIndexCache.has('/fake/fabric-api-sources.jar')).toBe(false);
	});

	it('evicts entryIndexCache before closeProject (order matters)', async () => {
		const proj = makeFakeProject('order-test');
		projectStore.set('order-test', proj);
		jarReader.registerProject('order-test', new Set(['/fake/minecraft-sources.jar']));

		// Seed a cache entry
		entryIndexCache.set('/fake/minecraft-sources.jar', new EntryIndex([]));

		// Spy on closeProject to verify eviction happened before it's called
		const originalCloseProject = jarReader.closeProject.bind(jarReader);
		let cacheWasEvictedBeforeClose = false;
		vi.spyOn(jarReader, 'closeProject').mockImplementation(async (name: string) => {
			// At this point, the cache should already be evicted
			cacheWasEvictedBeforeClose = !entryIndexCache.has('/fake/minecraft-sources.jar');
			return originalCloseProject(name);
		});

		await pair.client.callTool({
			name: 'remove_project',
			arguments: { project: 'order-test' },
		});

		expect(cacheWasEvictedBeforeClose).toBe(true);
		vi.restoreAllMocks();
	});

	it('clears active project if removed project was active', async () => {
		projectStore.set('active-mod', makeFakeProject('active-mod'));
		projectStore.setActive('active-mod');
		expect(projectStore.getActive()).toBe('active-mod');

		const result = await pair.client.callTool({
			name: 'remove_project',
			arguments: { project: 'active-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(projectStore.getActive()).toBeUndefined();
	});
});
