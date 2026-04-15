import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricMod, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project } from '../../src/project/types.js';

vi.mock('../../src/project/loader.js', () => ({
	loadFabricMod: vi.fn(),
}));

function makeFakeProject(name: string): Project {
	return makeFakeProjectBase({ name });
}

describe('add_fabric_mod tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('adds fabric mod to existing project', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod', name: 'my-mod' });
		fakeMod.fabricMod = { ...fakeMod.fabricMod, id: 'my-mod' };
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		// Create empty project first
		const project: Project = { name: 'test', children: new Map() };
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'add_fabric_mod',
			arguments: { project: 'test', path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('test');
		expect(envelope.data.child).toBe('my-mod');
		expect(envelope.data.minecraftVersion).toBe('1.21.11');
		expect(project.children.has('my-mod')).toBe(true);
	});

	it('returns error when project does not exist', async () => {
		const result = await pair.client.callTool({
			name: 'add_fabric_mod',
			arguments: { project: 'nonexistent', path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NOT_FOUND');
	});

	it('handles name collision with auto-suffix', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');

		// Create project with existing child named 'testmod'
		const project = makeFakeProject('test');
		projectStore.set('test', project);
		projectStore.setActive('test');

		// New mod has same fabric.mod.json id as existing child
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/mod-b' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		const result = await pair.client.callTool({
			name: 'add_fabric_mod',
			arguments: { project: 'test', path: '/home/user/mod-b' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.child).toBe('testmod-2');
		expect(envelope.data.autoSuffixed).toBe(true);
		expect(envelope.data.originalName).toBe('testmod');
		expect(project.children.has('testmod')).toBe(true);
		expect(project.children.has('testmod-2')).toBe(true);
	});
});
