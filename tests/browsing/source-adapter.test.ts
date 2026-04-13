import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJarAdapter, createFsAdapter, createSourceAdapter } from '../../src/browsing/source-adapter.js';
import type { DependencyEntry } from '../../src/project/types.js';

// Mock JarReader for jar adapter tests
function createMockJarReader(entries: string[], entryData: Record<string, Buffer>) {
	return {
		async listEntries(_jarPath: string): Promise<string[]> {
			return entries;
		},
		async readEntry(_jarPath: string, entryPath: string): Promise<Buffer> {
			const data = entryData[entryPath];
			if (!data) throw new Error(`Entry '${entryPath}' not found`);
			return data;
		},
	};
}

describe('createJarAdapter', () => {
	it('listJavaEntries filters non-java entries', async () => {
		const reader = createMockJarReader(
			[
				'net/minecraft/client/Foo.java',
				'net/minecraft/Bootstrap.java',
				'META-INF/MANIFEST.MF',
				'net/minecraft/data.json',
				'net/minecraft/client/Bar.java',
			],
			{},
		);
		const adapter = createJarAdapter(reader as any, '/path/to/test.jar');
		const entries = await adapter.listJavaEntries();
		expect(entries).toEqual([
			'net/minecraft/client/Foo.java',
			'net/minecraft/Bootstrap.java',
			'net/minecraft/client/Bar.java',
		]);
	});

	it('readEntry delegates to jarReader.readEntry', async () => {
		const content = Buffer.from('public class Foo {}');
		const reader = createMockJarReader([], {
			'net/minecraft/Foo.java': content,
		});
		const adapter = createJarAdapter(reader as any, '/path/to/test.jar');
		const result = await adapter.readEntry('net/minecraft/Foo.java');
		expect(result).toEqual(content);
	});
});

describe('createFsAdapter', () => {
	const testDir = join(tmpdir(), 'source-adapter-test-' + Date.now());
	const srcDir = join(testDir, 'src', 'main', 'java');

	beforeAll(async () => {
		await mkdir(join(srcDir, 'com', 'example'), { recursive: true });
		await writeFile(
			join(srcDir, 'com', 'example', 'MyMod.java'),
			'package com.example;\n\npublic class MyMod {}\n',
		);
		await writeFile(
			join(srcDir, 'com', 'example', 'Helper.java'),
			'package com.example;\n\nclass Helper {}\n',
		);
	});

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it('listJavaEntries returns .java files with normalized paths', async () => {
		const adapter = createFsAdapter(testDir);
		const entries = await adapter.listJavaEntries();
		expect(entries).toContain('com/example/MyMod.java');
		expect(entries).toContain('com/example/Helper.java');
		expect(entries).toHaveLength(2);
	});

	it('readEntry reads file content from correct path', async () => {
		const adapter = createFsAdapter(testDir);
		const buf = await adapter.readEntry('com/example/MyMod.java');
		const text = buf.toString('utf-8');
		expect(text).toContain('public class MyMod');
	});

	it('listJavaEntries returns [] on ENOENT (missing src/main/java)', async () => {
		const adapter = createFsAdapter('/nonexistent/path/to/project');
		const entries = await adapter.listJavaEntries();
		expect(entries).toEqual([]);
	});

	it('readEntry throws DomainError for missing file', async () => {
		const adapter = createFsAdapter(testDir);
		await expect(
			adapter.readEntry('com/example/DoesNotExist.java'),
		).rejects.toThrow('Source file not found');
	});
});

describe('createSourceAdapter', () => {
	it('returns jar adapter for non-src dep with sourcesJarPath', () => {
		const reader = createMockJarReader([], {});
		const dep: DependencyEntry = {
			id: 'com.mojang:math',
			group: 'com.mojang',
			artifact: 'math',
			version: '1.0',
			category: 'library',
			sourcesJarPath: '/path/to/math-sources.jar',
			available: true,
			provenanceChains: [],
		};
		const adapter = createSourceAdapter(reader as any, dep, '/project');
		expect(adapter).toBeDefined();
		// Should be a jar adapter, not an fs adapter
		expect(adapter.listJavaEntries).toBeTypeOf('function');
		expect(adapter.readEntry).toBeTypeOf('function');
	});

	it('returns fs adapter for src dep', () => {
		const reader = createMockJarReader([], {});
		const dep: DependencyEntry = {
			id: 'src',
			group: '',
			artifact: '',
			version: '',
			category: 'mod-source',
			sourcesJarPath: null,
			available: true,
			provenanceChains: [],
		};
		const adapter = createSourceAdapter(reader as any, dep, '/project');
		expect(adapter).toBeDefined();
	});

	it('throws DomainError for unavailable dep (sourcesJarPath null, not src)', () => {
		const reader = createMockJarReader([], {});
		const dep: DependencyEntry = {
			id: 'com.mojang:math',
			group: 'com.mojang',
			artifact: 'math',
			version: '1.0',
			category: 'library',
			sourcesJarPath: null,
			available: false,
			provenanceChains: [],
		};
		expect(() => createSourceAdapter(reader as any, dep, '/project')).toThrow('Sources jar not available');
	});
});
