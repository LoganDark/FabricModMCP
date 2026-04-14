import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/jdtls/workspace-sync.js', () => ({
	syncStudyJarToWorkspace: vi.fn().mockResolvedValue({ synced: true }),
	unsyncStudyJarFromWorkspace: vi.fn().mockResolvedValue({ synced: true }),
	isWorkspaceSynced: vi.fn().mockReturnValue(false),
}));
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import { jarReader } from '../../src/tools/shared-jar-reader.js';
import { syncStudyJarToWorkspace } from '../../src/jdtls/workspace-sync.js';

const testDir = join(tmpdir(), 'add-study-jar-test-' + Date.now());
const testJarPath = join(testDir, 'test-lib-1.0-sources.jar');
const testJarPath2 = join(testDir, 'another-lib-sources.jar');

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

describe('add_study_jar tool', () => {
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

	it('adds a study jar with explicit name', async () => {
		const result = await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'my-lib' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('my-lib');
		expect(envelope.data.stats.classCount).toBe(2);
		expect(envelope.data.stats.packageCount).toBe(1);
		expect(envelope.data.autoInclude).toBe(false);
	});

	it('adds a study jar with auto-derived name', async () => {
		const result = await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.name).toBe('test-lib-1.0-sources');
	});

	it('returns error for nonexistent path', async () => {
		const result = await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: '/nonexistent/foo.jar', name: 'bad' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('STUDY_JAR_FILE_NOT_FOUND');
	});

	it('returns error for non-ZIP file', async () => {
		const badFile = join(testDir, 'not-a-zip.jar');
		await writeFile(badFile, 'this is not a zip file');

		const result = await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: badFile, name: 'bad-zip' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('STUDY_JAR_INVALID_ZIP');
	});

	it('returns error for duplicate name', async () => {
		// Add the first jar
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'dupe' },
		});

		// Try to add another jar with the same name
		const result = await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath2, name: 'dupe' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('STUDY_JAR_NAME_EXISTS');
	});

	it('jar appears in list_study_jars after add', async () => {
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'visible-lib' },
		});

		const result = await pair.client.callTool({
			name: 'list_study_jars',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.count).toBe(1);
		expect(envelope.data.jars[0].name).toBe('visible-lib');
	});

	describe('workspace sync', () => {
		beforeEach(() => {
			vi.mocked(syncStudyJarToWorkspace).mockResolvedValue({ synced: true });
		});

		it('triggers workspace sync after adding jar', async () => {
			const result = await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'synced-lib' },
			});

			const textContent = (result as any).content[0].text;
			expect(textContent).not.toContain('JDT LS');
			expect(textContent).not.toContain('sync failed');
			expect(textContent).not.toContain('warning');
			expect(syncStudyJarToWorkspace).toHaveBeenCalled();
		});

		it('includes warning when JDT LS is unavailable', async () => {
			vi.mocked(syncStudyJarToWorkspace).mockResolvedValue({
				synced: false,
				warning: 'Note: JDT LS unavailable -- semantic navigation disabled',
			});

			const result = await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'no-jdtls-lib' },
			});

			const textContent = (result as any).content[0].text;
			expect(textContent).toContain('Note: JDT LS unavailable -- semantic navigation disabled');
		});

		it('includes warning when workspace sync fails', async () => {
			vi.mocked(syncStudyJarToWorkspace).mockResolvedValue({
				synced: false,
				warning: 'Workspace sync failed: timeout',
			});

			const result = await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'sync-fail-lib' },
			});

			const textContent = (result as any).content[0].text;
			expect(textContent).toContain('Workspace sync failed');
		});

		it('succeeds even when workspace sync fails', async () => {
			vi.mocked(syncStudyJarToWorkspace).mockResolvedValue({
				synced: false,
				warning: 'Workspace sync failed: timeout',
			});

			const result = await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'still-ok-lib' },
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.name).toBe('still-ok-lib');
		});
	});
});
