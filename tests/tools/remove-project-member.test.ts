import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase, makeFakeMultiModProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';
import type { Project, StudyJarChild } from '../../src/project/types.js';

function makeFakeProject(name: string): Project {
	return makeFakeProjectBase({ name });
}

function makeStudyJarChild(name: string, jarPath: string): StudyJarChild {
	return {
		kind: 'study-jar',
		name,
		jarPath,
		mtime: 1000,
		size: 500,
		autoInclude: false,
		stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
	};
}

describe('remove_project_member tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('removes a fabric mod child', async () => {
		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setActive('test');

		jarReader.registerProject('test', new Set([
			'/fake/minecraft-sources.jar',
		]));

		const result = await pair.client.callTool({
			name: 'remove_project_member',
			arguments: { project: 'test', names: ['mod-a'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.removed).toEqual(['mod-a']);
		expect(envelope.data.project).toBe('test');
		expect(project.children.has('mod-a')).toBe(false);
		expect(project.children.has('mod-b')).toBe(true);
	});

	it('removes a study jar child', async () => {
		const project = makeFakeProject('test');
		const studyJar = makeStudyJarChild('my-study', '/fake/study.jar');
		project.children.set('my-study', studyJar);
		projectStore.set('test', project);
		projectStore.setActive('test');

		jarReader.registerProject('test', new Set([
			'/fake/minecraft-sources.jar',
			'/fake/study.jar',
		]));

		const result = await pair.client.callTool({
			name: 'remove_project_member',
			arguments: { project: 'test', names: ['my-study'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.removed).toEqual(['my-study']);
		expect(project.children.has('my-study')).toBe(false);
	});

	it('returns error for nonexistent member name (no partial removal)', async () => {
		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'remove_project_member',
			arguments: { project: 'test', names: ['mod-a', 'nonexistent'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CHILD_NOT_FOUND');

		// mod-a should NOT have been removed (fail-fast validation)
		expect(project.children.has('mod-a')).toBe(true);
	});

	it('clears activeChild if removed member was active', async () => {
		const project = makeFakeProject('test');
		project.activeChild = 'testmod';
		projectStore.set('test', project);
		projectStore.setActive('test');

		jarReader.registerProject('test', new Set([
			'/fake/minecraft-sources.jar',
		]));

		const result = await pair.client.callTool({
			name: 'remove_project_member',
			arguments: { project: 'test', names: ['testmod'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(project.activeChild).toBeUndefined();
	});
});
