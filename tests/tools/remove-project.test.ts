import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project } from '../../src/project/types.js';

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
