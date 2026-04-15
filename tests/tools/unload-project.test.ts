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

	it('scoped unload removes child jar registrations', async () => {
		const project = makeFakeMultiModProject(['mod-a', 'mod-b']);
		projectStore.set('test', project);
		projectStore.setDefault('test');

		// Register project jars (mod-a uses minecraft-sources.jar, mod-b uses it too)
		jarReader.registerProject('test', new Set([
			'/fake/minecraft-sources.jar',
			'/fake/mod-b-extra.jar',
		]));

		const modB = project.children.get('mod-b')!;
		if (modB.kind === 'fabric-mod') {
			modB.dependencyJars.set('mod-b/extra-lib', {
				id: 'mod-b/extra-lib',
				group: 'org.test',
				artifact: 'extra-lib',
				version: '1.0',
				category: 'library' as const,
				sourcesJarPath: '/fake/mod-b-extra.jar',
				available: true,
				provenanceChains: [],
			});
		}

		const result = await pair.client.callTool({
			name: 'unload_project',
			arguments: { project: 'test', scope: 'mod-a' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.child).toBe('mod-a');

		// mod-a should be removed
		expect(project.children.has('mod-a')).toBe(false);
		// mod-b should still exist
		expect(project.children.has('mod-b')).toBe(true);

		// mod-b's extra jar should still be registered
		const projectJars = jarReader.getProjectJars('test');
		expect(projectJars).toBeDefined();
		expect(projectJars!.has('/fake/mod-b-extra.jar')).toBe(true);
	});

	it('scoped unload of study jar removes its jar path', async () => {
		const project = makeFakeProject('test');
		const studyJar = makeStudyJarChild('my-study', '/fake/study.jar');
		project.children.set('my-study', studyJar);
		projectStore.set('test', project);
		projectStore.setDefault('test');

		// Register jar paths including the study jar
		jarReader.registerProject('test', new Set([
			'/fake/minecraft-sources.jar',
			'/fake/study.jar',
		]));

		const result = await pair.client.callTool({
			name: 'unload_project',
			arguments: { project: 'test', scope: 'my-study' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.child).toBe('my-study');

		// Study jar should be removed from children
		expect(project.children.has('my-study')).toBe(false);

		// Study jar path should be removed from jar reader
		const projectJars = jarReader.getProjectJars('test');
		expect(projectJars).toBeDefined();
		expect(projectJars!.has('/fake/study.jar')).toBe(false);
		// But the fabric mod's jar should still be there
		expect(projectJars!.has('/fake/minecraft-sources.jar')).toBe(true);
	});
});
