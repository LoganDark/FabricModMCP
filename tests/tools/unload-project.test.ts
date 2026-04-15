import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project } from '../../src/project/types.js';

function makeFakeProject(name: string): Project {
	return makeFakeProjectBase({ name });
}

describe('unload_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('removes project and returns confirmation', async () => {
		const fake = makeFakeProject('test-mod');
		projectStore.set('test-mod', fake);

		const result = await pair.client.callTool({
			name: 'unload_project',
			arguments: { project: 'test-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('test-mod');
		expect(projectStore.has('test-mod')).toBe(false);
	});

	it('nonexistent project returns error', async () => {
		const result = await pair.client.callTool({
			name: 'unload_project',
			arguments: { project: 'nope' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NOT_FOUND');
	});
});
