import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project } from '../../src/project/types.js';

vi.mock('../../src/jdtls/startup.js', () => ({
	initJdtLsSession: vi.fn().mockResolvedValue({
		available: false,
		failureReason: 'Java not found',
		tempDir: '',
		dataDir: '',
		jarIdToDirName: new Map(),
	}),
}));

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

	it('stores jdtls session on project', async () => {
		await pair.client.callTool({
			name: 'create_project',
			arguments: { name: 'jdtls-test' },
		});

		const project = projectStore.get('jdtls-test')!;
		expect(project.jdtls).toBeDefined();
		expect(project.jdtls!.available).toBe(false);
		expect(project.jdtls!.failureReason).toBe('Java not found');
	});

	it('includes jdtlsAvailable in response', async () => {
		const result = await pair.client.callTool({
			name: 'create_project',
			arguments: { name: 'jdtls-response' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.jdtlsAvailable).toBe(false);
		expect(envelope.data.jdtlsWarning).toBe('Java not found');
	});
});

describe('default project JDT LS', () => {
	it('default project gets a JDT LS session at startup', async () => {
		const { initJdtLsSession } = await import('../../src/jdtls/startup.js');

		// Replicate the startup sequence from index.ts
		projectStore.clear();
		const initialProject: Project = {
			name: 'default',
			children: new Map(),
		};
		projectStore.set('default', initialProject);
		initialProject.jdtls = await initJdtLsSession();

		const project = projectStore.get('default')!;
		expect(project.jdtls).toBeDefined();
		expect(project.jdtls!.available).toBe(false);
		expect(project.jdtls!.failureReason).toBe('Java not found');
	});
});
