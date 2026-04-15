import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';

describe('create_project tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('creates a new project successfully', async () => {
		const result = await pair.client.callTool({
			name: 'create_project',
			arguments: { name: 'my-project' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('my-project');
		expect(projectStore.has('my-project')).toBe(true);

		const project = projectStore.get('my-project')!;
		expect(project.children.size).toBe(0);
	});

	it('returns error for duplicate project name', async () => {
		// Create first project
		await pair.client.callTool({
			name: 'create_project',
			arguments: { name: 'dupe' },
		});

		// Try to create again with same name
		const result = await pair.client.callTool({
			name: 'create_project',
			arguments: { name: 'dupe' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('PROJECT_NAME_COLLISION');
	});
});
