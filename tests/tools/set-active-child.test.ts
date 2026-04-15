import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
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

describe('set_active_child tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('sets active child on a project with a fabric mod', async () => {
		const project = makeFakeProject('test');
		projectStore.set('test', project);
		projectStore.setActive('test');

		// The project has a 'testmod' fabric mod child from the factory
		const result = await pair.client.callTool({
			name: 'set_active_child',
			arguments: { project: 'test', child: 'testmod' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('test');
		expect(envelope.data.activeChild).toBe('testmod');
		expect(project.activeChild).toBe('testmod');
	});

	it('returns error for nonexistent child name', async () => {
		const project = makeFakeProject('test');
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'set_active_child',
			arguments: { project: 'test', child: 'nonexistent' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CHILD_NOT_FOUND');
	});

	it('returns error for study jar child (not fabric mod)', async () => {
		const project = makeFakeProject('test');
		const studyJar = makeStudyJarChild('my-study', '/fake/study.jar');
		project.children.set('my-study', studyJar);
		projectStore.set('test', project);
		projectStore.setActive('test');

		const result = await pair.client.callTool({
			name: 'set_active_child',
			arguments: { project: 'test', child: 'my-study' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('INVALID_CHILD_TYPE');
	});
});
