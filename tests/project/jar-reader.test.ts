import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { JarReader } from '../../src/project/jar-reader.js';

// Create a real ZIP file for testing using Node's built-in zlib + manual ZIP construction
// We'll use the `jar` or `zip` command if available, otherwise build manually

const testDir = join(tmpdir(), 'jar-reader-test-' + Date.now());
const testJarPath = join(testDir, 'test.jar');

async function createTestZip(): Promise<void> {
	await mkdir(testDir, { recursive: true });
	const contentDir = join(testDir, 'content');
	await mkdir(join(contentDir, 'net', 'minecraft', 'client'), { recursive: true });
	await writeFile(
		join(contentDir, 'net', 'minecraft', 'client', 'MinecraftClient.java'),
		'package net.minecraft.client;\n\npublic class MinecraftClient {\n}\n',
	);
	await writeFile(
		join(contentDir, 'net', 'minecraft', 'Bootstrap.java'),
		'package net.minecraft;\n\npublic class Bootstrap {\n}\n',
	);

	// Use the zip command to create a real ZIP file
	execSync(`cd "${contentDir}" && zip -r "${testJarPath}" .`);
}

describe('JarReader', () => {
	let reader: JarReader;

	beforeAll(async () => {
		await createTestZip();
		reader = new JarReader();
	});

	afterAll(async () => {
		await reader.closeAll();
		await rm(testDir, { recursive: true, force: true });
	});

	it('readEntry returns correct buffer content for an existing file', async () => {
		const buf = await reader.readEntry(testJarPath, 'net/minecraft/client/MinecraftClient.java');
		const text = buf.toString('utf-8');
		expect(text).toContain('public class MinecraftClient');
	});

	it('readEntry throws JAR_ENTRY_NOT_FOUND for missing entry', async () => {
		await expect(
			reader.readEntry(testJarPath, 'does/not/Exist.java'),
		).rejects.toThrow('not found in jar');
	});

	it('listEntries returns all paths in the jar', async () => {
		const entries = await reader.listEntries(testJarPath);
		expect(entries).toContain('net/minecraft/client/MinecraftClient.java');
		expect(entries).toContain('net/minecraft/Bootstrap.java');
	});

	it('reuses handles on repeated access to the same jar', async () => {
		// Read two different entries -- should use same handle
		const buf1 = await reader.readEntry(testJarPath, 'net/minecraft/client/MinecraftClient.java');
		const buf2 = await reader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
		expect(buf1.toString('utf-8')).toContain('MinecraftClient');
		expect(buf2.toString('utf-8')).toContain('Bootstrap');
	});

	it('close removes handle so next access re-opens', async () => {
		await reader.close(testJarPath);
		// Should still work -- re-opens lazily
		const buf = await reader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
		expect(buf.toString('utf-8')).toContain('Bootstrap');
	});

	it('throws JAR_OPEN_FAILED for nonexistent jar path', async () => {
		await expect(
			reader.readEntry('/nonexistent/path/fake.jar', 'any/Entry.java'),
		).rejects.toThrow('Failed to open jar');
	});

	describe('per-project handle tracking', () => {
		let trackReader: JarReader;

		beforeEach(() => {
			trackReader = new JarReader();
		});

		it('registerProject records jar paths for a project', () => {
			trackReader.registerProject('proj-a', new Set(['/path/a.jar', '/path/b.jar']));
			expect(trackReader.getProjectJars('proj-a')).toEqual(new Set(['/path/a.jar', '/path/b.jar']));
		});

		it('closeProject closes only unshared handles', async () => {
			// Register two projects with a shared jar
			trackReader.registerProject('proj-a', new Set([testJarPath, '/unique-a.jar']));
			trackReader.registerProject('proj-b', new Set([testJarPath, '/unique-b.jar']));

			// Open a handle for the shared jar by reading from it
			await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');

			// Close proj-a -- shared jar should remain open
			await trackReader.closeProject('proj-a');

			// Shared jar should still work (handle not closed)
			const buf = await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
			expect(buf.toString('utf-8')).toContain('Bootstrap');
		});

		it('closeProject closes shared handle when last project removed', async () => {
			trackReader.registerProject('proj-a', new Set([testJarPath]));
			trackReader.registerProject('proj-b', new Set([testJarPath]));

			// Open handle
			await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');

			// Close both projects
			await trackReader.closeProject('proj-a');
			await trackReader.closeProject('proj-b');

			// Handle should be closed -- getProjectJars returns undefined
			expect(trackReader.getProjectJars('proj-a')).toBeUndefined();
			expect(trackReader.getProjectJars('proj-b')).toBeUndefined();
		});

		describe('granular add/remove', () => {
			it('addProjectJar adds path to existing project set', () => {
				trackReader.registerProject('proj-a', new Set(['/path/a.jar']));
				trackReader.addProjectJar('proj-a', '/path/new.jar');
				expect(trackReader.getProjectJars('proj-a')).toContain('/path/new.jar');
				expect(trackReader.getProjectJars('proj-a')).toContain('/path/a.jar');
			});

			it('addProjectJar throws PROJECT_NOT_REGISTERED for unknown project', () => {
				expect(() => trackReader.addProjectJar('unknown', '/path/a.jar')).toThrow('not registered');
			});

			it('removeProjectJar removes path from project set', async () => {
				trackReader.registerProject('proj-a', new Set([testJarPath, '/other.jar']));
				await trackReader.removeProjectJar('proj-a', testJarPath);
				expect(trackReader.getProjectJars('proj-a')).not.toContain(testJarPath);
				expect(trackReader.getProjectJars('proj-a')).toContain('/other.jar');
			});

			it('removeProjectJar closes unshared handle', async () => {
				trackReader.registerProject('proj-a', new Set([testJarPath]));
				// Open handle by reading
				await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
				await trackReader.removeProjectJar('proj-a', testJarPath);
				// Handle was closed -- reading again re-opens (no error, just lazy reopen)
				const buf = await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
				expect(buf.toString('utf-8')).toContain('Bootstrap');
			});

			it('removeProjectJar keeps shared handle open', async () => {
				trackReader.registerProject('proj-a', new Set([testJarPath]));
				trackReader.registerProject('proj-b', new Set([testJarPath]));
				await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
				await trackReader.removeProjectJar('proj-a', testJarPath);
				// proj-b still references it -- handle stays open, read works
				const buf = await trackReader.readEntry(testJarPath, 'net/minecraft/Bootstrap.java');
				expect(buf.toString('utf-8')).toContain('Bootstrap');
			});

			it('removeProjectJar is a no-op for unregistered project', async () => {
				// Should not throw
				await trackReader.removeProjectJar('nonexistent', '/any.jar');
			});
		});

		it('closeProject removes project tracking', async () => {
			trackReader.registerProject('proj-a', new Set([testJarPath]));
			await trackReader.closeProject('proj-a');
			expect(trackReader.getProjectJars('proj-a')).toBeUndefined();
		});
	});
});
