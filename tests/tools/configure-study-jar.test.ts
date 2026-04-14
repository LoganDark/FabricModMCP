import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';

const testDir = join(tmpdir(), 'configure-study-jar-test-' + Date.now());
const testJarPath = join(testDir, 'lib-a-sources.jar');
const testJarPath2 = join(testDir, 'lib-b-sources.jar');

async function createTestZip(outputPath: string): Promise<void> {
	const contentDir = join(testDir, 'content-' + Math.random().toString(36).slice(2));
	await mkdir(join(contentDir, 'com', 'example'), { recursive: true });
	await writeFile(
		join(contentDir, 'com', 'example', 'Foo.java'),
		'package com.example;\n\npublic class Foo {\n}\n',
	);
	await writeFile(
		join(contentDir, 'com', 'example', 'Bar.java'),
		'package com.example;\n\npublic class Bar {\n}\n',
	);
	execSync(`cd "${contentDir}" && zip -r "${outputPath}" .`);
}

beforeAll(async () => {
	await mkdir(testDir, { recursive: true });
	await createTestZip(testJarPath);
	await createTestZip(testJarPath2);
});

afterAll(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe('configure_study_jar tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		pair = await createTestPair();
		const project = makeFakeProject({ name: 'test' });
		projectStore.set('test', project);
		jarReader.registerProject('test', new Set());
	});

	afterEach(async () => {
		projectStore.clear();
		await jarReader.closeAll();
		await pair.cleanup();
	});

	it('toggles auto-include on', async () => {
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'cfg-lib' },
		});

		const result = await pair.client.callTool({
			name: 'configure_study_jar',
			arguments: { project: 'test', names: ['cfg-lib'], autoInclude: true },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.updated[0].name).toBe('cfg-lib');
		expect(envelope.data.updated[0].autoInclude).toBe(true);

		// Verify via list
		const listResult = await pair.client.callTool({
			name: 'list_study_jars',
			arguments: { project: 'test' },
		});
		const listEnvelope = parseEnvelope(listResult);
		expect(listEnvelope.data.jars[0].autoInclude).toBe(true);
	});

	it('toggles auto-include off', async () => {
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'toggle-lib' },
		});

		// Turn on
		await pair.client.callTool({
			name: 'configure_study_jar',
			arguments: { project: 'test', names: ['toggle-lib'], autoInclude: true },
		});

		// Turn off
		const result = await pair.client.callTool({
			name: 'configure_study_jar',
			arguments: { project: 'test', names: ['toggle-lib'], autoInclude: false },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.updated[0].autoInclude).toBe(false);
	});

	it('configures multiple jars in batch', async () => {
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'batch-a' },
		});
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath2, name: 'batch-b' },
		});

		const result = await pair.client.callTool({
			name: 'configure_study_jar',
			arguments: { project: 'test', names: ['batch-a', 'batch-b'], autoInclude: true },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.updated).toHaveLength(2);
		for (const entry of envelope.data.updated) {
			expect(entry.autoInclude).toBe(true);
		}
	});

	it('returns error for nonexistent name', async () => {
		const result = await pair.client.callTool({
			name: 'configure_study_jar',
			arguments: { project: 'test', names: ['nonexistent'], autoInclude: true },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('STUDY_JAR_NOT_FOUND');
	});

	it('fails on first nonexistent in batch with no partial update', async () => {
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'a' },
		});

		const result = await pair.client.callTool({
			name: 'configure_study_jar',
			arguments: { project: 'test', names: ['a', 'nonexistent'], autoInclude: true },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);

		// Verify jar 'a' was NOT updated (fail-fast, no partial mutation)
		const listResult = await pair.client.callTool({
			name: 'list_study_jars',
			arguments: { project: 'test' },
		});
		const listEnvelope = parseEnvelope(listResult);
		expect(listEnvelope.data.jars[0].autoInclude).toBe(false);
	});
});
