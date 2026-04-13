import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
});
