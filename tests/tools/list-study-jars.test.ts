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
import { isWorkspaceSynced } from '../../src/jdtls/workspace-sync.js';

const testDir = join(tmpdir(), 'list-study-jars-test-' + Date.now());
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

describe('list_study_jars tool', () => {
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

	it('returns empty array when no study jars exist', async () => {
		const result = await pair.client.callTool({
			name: 'list_study_jars',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.jars).toEqual([]);
		expect(envelope.data.count).toBe(0);
	});

	it('returns all study jars with details', async () => {
		// Add two study jars
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'lib-a' },
		});
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath2, name: 'lib-b' },
		});

		const result = await pair.client.callTool({
			name: 'list_study_jars',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.count).toBe(2);

		const names = envelope.data.jars.map((j: any) => j.name).sort();
		expect(names).toEqual(['lib-a', 'lib-b']);

		for (const jar of envelope.data.jars) {
			expect(jar).toHaveProperty('name');
			expect(jar).toHaveProperty('path');
			expect(jar).toHaveProperty('autoInclude');
			expect(jar).toHaveProperty('stats');
		}
	});

	it('text content is human-readable', async () => {
		await pair.client.callTool({
			name: 'add_study_jar',
			arguments: { project: 'test', path: testJarPath, name: 'readable-lib' },
		});

		const result = await pair.client.callTool({
			name: 'list_study_jars',
			arguments: { project: 'test' },
		});

		const textContent = (result as any).content[0].text;
		expect(typeof textContent).toBe('string');
		expect(textContent).toContain('readable-lib');
	});

	describe('workspaceSynced field', () => {
		it('includes workspaceSynced field per jar', async () => {
			vi.mocked(isWorkspaceSynced).mockReturnValue(false);

			await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'field-check-lib' },
			});

			const result = await pair.client.callTool({
				name: 'list_study_jars',
				arguments: { project: 'test' },
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			for (const jar of envelope.data.jars) {
				expect(jar).toHaveProperty('workspaceSynced');
				expect(typeof jar.workspaceSynced).toBe('boolean');
			}
		});

		it('shows workspaceSynced=false when JDT LS unavailable', async () => {
			vi.mocked(isWorkspaceSynced).mockReturnValue(false);

			await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'unsynced-lib' },
			});

			const result = await pair.client.callTool({
				name: 'list_study_jars',
				arguments: { project: 'test' },
			});

			const envelope = parseEnvelope(result);
			expect(envelope.data.jars[0].workspaceSynced).toBe(false);
		});

		it('shows workspaceSynced=true when jar is synced', async () => {
			vi.mocked(isWorkspaceSynced).mockReturnValue(true);

			await pair.client.callTool({
				name: 'add_study_jar',
				arguments: { project: 'test', path: testJarPath, name: 'synced-lib' },
			});

			const result = await pair.client.callTool({
				name: 'list_study_jars',
				arguments: { project: 'test' },
			});

			const envelope = parseEnvelope(result);
			expect(envelope.data.jars[0].workspaceSynced).toBe(true);
		});
	});
});
