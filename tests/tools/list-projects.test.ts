import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricModNamed } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project, StudyJarChild } from '../../src/project/types.js';

function makeFakeProject(name: string, modNames: string[] = ['testmod']): Project {
	const children = new Map<string, any>();
	for (const modName of modNames) {
		children.set(modName, makeFakeFabricModNamed(modName));
	}
	return { name, children };
}

describe('list_projects tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns simplified output with name, memberCount, activeChild, isActive', async () => {
		projectStore.set('mod-a', makeFakeProject('mod-a'));
		projectStore.set('mod-b', makeFakeProject('mod-b', ['alpha', 'beta']));
		projectStore.setActive('mod-a');

		const result = await pair.client.callTool({
			name: 'list_projects',
			arguments: {},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.projects).toHaveLength(2);

		const projA = envelope.data.projects.find((p: any) => p.name === 'mod-a');
		expect(projA).toBeDefined();
		expect(projA.memberCount).toBe(1);
		expect(projA.activeChild).toBeNull();
		expect(projA.isActive).toBe(true);

		const projB = envelope.data.projects.find((p: any) => p.name === 'mod-b');
		expect(projB).toBeDefined();
		expect(projB.memberCount).toBe(2);
		expect(projB.isActive).toBe(false);
	});

	it('does not include MC version, rootPath, or gradle config', async () => {
		projectStore.set('test', makeFakeProject('test'));

		const result = await pair.client.callTool({
			name: 'list_projects',
			arguments: {},
		});

		const envelope = parseEnvelope(result);
		const proj = envelope.data.projects[0];
		expect(proj.minecraftVersion).toBeUndefined();
		expect(proj.rootPath).toBeUndefined();
		expect(proj.mappingEra).toBeUndefined();
		expect(proj.dependencyCount).toBeUndefined();
	});

	it('empty when no projects loaded', async () => {
		const result = await pair.client.callTool({
			name: 'list_projects',
			arguments: {},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.projects).toHaveLength(0);
	});

	it('includes activeChild when set on project', async () => {
		const project = makeFakeProject('test');
		project.activeChild = 'testmod';
		projectStore.set('test', project);

		const result = await pair.client.callTool({
			name: 'list_projects',
			arguments: {},
		});

		const envelope = parseEnvelope(result);
		const proj = envelope.data.projects[0];
		expect(proj.activeChild).toBe('testmod');
	});
});
