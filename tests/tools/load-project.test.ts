import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricMod } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';

vi.mock('../../src/project/loader.js', () => ({
	loadFabricMod: vi.fn(),
}));

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

	it('loads project and returns project and child names', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('default');
		expect(envelope.data.child).toBe('testmod');
		expect(envelope.data.name).toBe('default'); // backward compat
		expect(envelope.data.minecraftVersion).toBe('1.21.11');
	});

	it('adds child to default project on second load', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod1 = makeFakeFabricMod({ rootPath: '/home/user/mod-a', name: 'mod-a' });
		fakeMod1.fabricMod = { ...fakeMod1.fabricMod, id: 'mod-a' };
		const fakeMod2 = makeFakeFabricMod({ rootPath: '/home/user/mod-b', name: 'mod-b' });
		fakeMod2.fabricMod = { ...fakeMod2.fabricMod, id: 'mod-b' };
		vi.mocked(loadFabricMod).mockResolvedValueOnce(fakeMod1).mockResolvedValueOnce(fakeMod2);

		await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-a' },
		});

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-b' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('default');
		expect(envelope.data.child).toBe('mod-b');

		// Both children exist in the same project
		const project = projectStore.get('default')!;
		expect(project.children.has('mod-a')).toBe(true);
		expect(project.children.has('mod-b')).toBe(true);
	});

	it('adds child to named project', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod', project: 'custom' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('custom');
		expect(envelope.data.name).toBe('custom');
		expect(projectStore.has('custom')).toBe(true);
	});

	it('creates new project when named project does not exist', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod', project: 'new-proj' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('new-proj');
		expect(projectStore.has('new-proj')).toBe(true);
	});

	it('auto-suffixes on child name collision', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		// Both mods have same fabric.mod.json id
		const fakeMod1 = makeFakeFabricMod({ rootPath: '/home/user/mod-a' });
		const fakeMod2 = makeFakeFabricMod({ rootPath: '/home/user/mod-b' });
		vi.mocked(loadFabricMod).mockResolvedValueOnce(fakeMod1).mockResolvedValueOnce(fakeMod2);

		await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-a' },
		});

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-b' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.child).toBe('testmod-2');
		expect(envelope.data.autoSuffixed).toBe(true);
		expect(envelope.data.originalName).toBe('testmod');

		const project = projectStore.get('default')!;
		expect(project.children.has('testmod')).toBe(true);
		expect(project.children.has('testmod-2')).toBe(true);
	});

	it('tool result includes child and project name', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data).toHaveProperty('child');
		expect(envelope.data).toHaveProperty('project');
		expect(envelope.data).toHaveProperty('name'); // backward compat
	});

	it('adds child to existing named project', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod1 = makeFakeFabricMod({ rootPath: '/home/user/mod-a', name: 'mod-a' });
		fakeMod1.fabricMod = { ...fakeMod1.fabricMod, id: 'mod-a' };
		const fakeMod2 = makeFakeFabricMod({ rootPath: '/home/user/mod-b', name: 'mod-b' });
		fakeMod2.fabricMod = { ...fakeMod2.fabricMod, id: 'mod-b' };
		vi.mocked(loadFabricMod).mockResolvedValueOnce(fakeMod1).mockResolvedValueOnce(fakeMod2);

		await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-a', project: 'custom' },
		});

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/mod-b', project: 'custom' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('custom');
		expect(envelope.data.child).toBe('mod-b');

		const project = projectStore.get('custom')!;
		expect(project.children.has('mod-a')).toBe(true);
		expect(project.children.has('mod-b')).toBe(true);
	});
});
