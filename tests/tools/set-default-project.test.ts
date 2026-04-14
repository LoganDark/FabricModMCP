import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

function makeFakeProject(name: string): LoadedProject {
	return makeFakeProjectBase({ name, rootPath: `/fake/${name}`, dependencyJars: new Map() });
}

describe('set_default_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('sets default and confirms', async () => {
		projectStore.set('my-mod', makeFakeProject('my-mod'));

		const result = await pair.client.callTool({
			name: 'set_default_project',
			arguments: { project: 'my-mod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.defaultProject).toBe('my-mod');
		expect(projectStore.getDefault()).toBe('my-mod');
	});

	it('nonexistent project returns error', async () => {
		const result = await pair.client.callTool({
			name: 'set_default_project',
			arguments: { project: 'nope' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NOT_FOUND');
	});
});
