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

	it('loads project and returns name, MC version', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

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
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

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
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod = makeFakeFabricMod({ rootPath: '/home/user/my-mod' });
		vi.mocked(loadFabricMod).mockResolvedValue(fakeMod);

		const result = await pair.client.callTool({
			name: 'load_project',
			arguments: { path: '/home/user/my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('my-mod');
	});

	it('collision with explicit name returns error', async () => {
		const { loadFabricMod } = await import('../../src/project/loader.js');
		const fakeMod1 = makeFakeFabricMod({ rootPath: '/home/user/mod-a' });
		const fakeMod2 = makeFakeFabricMod({ rootPath: '/home/user/mod-b' });
		vi.mocked(loadFabricMod).mockResolvedValueOnce(fakeMod1).mockResolvedValueOnce(fakeMod2);

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
