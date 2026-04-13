import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { JarReader } from '../../src/project/jar-reader.js';
import type { DependencyEntry } from '../../src/project/types.js';
import { extractSourcesToTemp, cleanupTempDir } from '../../src/jdtls/workspace.js';

function createMockJarReader(entries: Map<string, Map<string, Buffer>>): JarReader {
	return {
		listEntries: async (jarPath: string) => {
			const jarEntries = entries.get(jarPath);
			if (!jarEntries) return [];
			return Array.from(jarEntries.keys());
		},
		readEntry: async (jarPath: string, entryPath: string) => {
			const jarEntries = entries.get(jarPath);
			if (!jarEntries) throw new Error(`Jar not found: ${jarPath}`);
			const content = jarEntries.get(entryPath);
			if (!content) throw new Error(`Entry not found: ${entryPath}`);
			return content;
		},
	} as unknown as JarReader;
}

function createDep(id: string, jarPath: string | null, available: boolean): DependencyEntry {
	return {
		id,
		group: 'test',
		artifact: id,
		version: '1.0',
		category: 'library',
		sourcesJarPath: jarPath,
		available,
		provenanceChains: [],
	};
}

describe('extractSourcesToTemp', () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const dir of tempDirs) {
			await cleanupTempDir(dir);
		}
		tempDirs.length = 0;
	});

	it('creates temp directory with extracted .java files', async () => {
		const jarEntries = new Map<string, Buffer>();
		jarEntries.set('com/example/Foo.java', Buffer.from('public class Foo {}'));
		jarEntries.set('com/example/Bar.java', Buffer.from('public class Bar {}'));
		jarEntries.set('META-INF/MANIFEST.MF', Buffer.from('Manifest-Version: 1.0'));

		const jarReader = createMockJarReader(new Map([
			['/fake/test.jar', jarEntries],
		]));

		const deps = new Map<string, DependencyEntry>([
			['testlib', createDep('testlib', '/fake/test.jar', true)],
		]);

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		tempDirs.push(result.tempDir);

		expect(existsSync(result.tempDir)).toBe(true);

		// Check .java files were extracted
		const fooPath = join(result.tempDir, 'testlib', 'com', 'example', 'Foo.java');
		const barPath = join(result.tempDir, 'testlib', 'com', 'example', 'Bar.java');
		expect(existsSync(fooPath)).toBe(true);
		expect(existsSync(barPath)).toBe(true);

		const fooContent = await readFile(fooPath, 'utf-8');
		expect(fooContent).toBe('public class Foo {}');
	});

	it('generates .project file with java nature', async () => {
		const jarReader = createMockJarReader(new Map());
		const deps = new Map<string, DependencyEntry>();

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		tempDirs.push(result.tempDir);

		const projectFile = await readFile(join(result.tempDir, '.project'), 'utf-8');
		expect(projectFile).toContain('org.eclipse.jdt.core.javanature');
		expect(projectFile).toContain('org.eclipse.jdt.core.javabuilder');
		expect(projectFile).toContain('<name>mcp-sources</name>');
	});

	it('generates .classpath file with src entries for each extracted jar', async () => {
		const jarEntries = new Map<string, Buffer>();
		jarEntries.set('com/example/Foo.java', Buffer.from('public class Foo {}'));

		const jarReader = createMockJarReader(new Map([
			['/fake/mc.jar', jarEntries],
			['/fake/fabric.jar', jarEntries],
		]));

		const deps = new Map<string, DependencyEntry>([
			['minecraft', createDep('minecraft', '/fake/mc.jar', true)],
			['fabric-api:fabric-networking-api-v1', createDep('fabric-api:fabric-networking-api-v1', '/fake/fabric.jar', true)],
		]);

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		tempDirs.push(result.tempDir);

		const classpathFile = await readFile(join(result.tempDir, '.classpath'), 'utf-8');
		expect(classpathFile).toContain('classpathentry kind="src" path="minecraft"');
		expect(classpathFile).toContain('classpathentry kind="src" path="fabric-api__fabric-networking-api-v1"');
		expect(classpathFile).toContain('org.eclipse.jdt.launching.JRE_CONTAINER');
		expect(classpathFile).toContain('kind="output" path="bin"');
	});

	it('returns correct jarIdToDirNameMap', async () => {
		const jarEntries = new Map<string, Buffer>();
		jarEntries.set('Foo.java', Buffer.from('class Foo {}'));

		const jarReader = createMockJarReader(new Map([
			['/fake/mc.jar', jarEntries],
			['/fake/fabric.jar', jarEntries],
		]));

		const deps = new Map<string, DependencyEntry>([
			['minecraft', createDep('minecraft', '/fake/mc.jar', true)],
			['fabric-api:fabric-networking-api-v1', createDep('fabric-api:fabric-networking-api-v1', '/fake/fabric.jar', true)],
		]);

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		tempDirs.push(result.tempDir);

		expect(result.jarIdToDirNameMap.get('minecraft')).toBe('minecraft');
		expect(result.jarIdToDirNameMap.get('fabric-api:fabric-networking-api-v1'))
			.toBe('fabric-api__fabric-networking-api-v1');
	});

	it('skips unavailable dependencies', async () => {
		const jarReader = createMockJarReader(new Map());

		const deps = new Map<string, DependencyEntry>([
			['unavailable', createDep('unavailable', null, false)],
		]);

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		tempDirs.push(result.tempDir);

		expect(result.jarIdToDirNameMap.size).toBe(0);
		// Only .project and .classpath should exist
		const contents = await readdir(result.tempDir);
		expect(contents).toContain('.project');
		expect(contents).toContain('.classpath');
		expect(contents.length).toBe(2);
	});

	it('jar IDs with colons produce directory names with __', async () => {
		const jarEntries = new Map<string, Buffer>();
		jarEntries.set('Foo.java', Buffer.from('class Foo {}'));

		const jarReader = createMockJarReader(new Map([
			['/fake/lib.jar', jarEntries],
		]));

		const deps = new Map<string, DependencyEntry>([
			['com.mojang:brigadier', createDep('com.mojang:brigadier', '/fake/lib.jar', true)],
		]);

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		tempDirs.push(result.tempDir);

		const dirName = result.jarIdToDirNameMap.get('com.mojang:brigadier');
		expect(dirName).toBe('com.mojang__brigadier');
		expect(existsSync(join(result.tempDir, 'com.mojang__brigadier', 'Foo.java'))).toBe(true);
	});
});

describe('cleanupTempDir', () => {
	it('removes the temp directory and all contents', async () => {
		// Create a temp dir via extraction, then clean it up
		const jarEntries = new Map<string, Buffer>();
		jarEntries.set('Foo.java', Buffer.from('class Foo {}'));

		const jarReader = createMockJarReader(new Map([
			['/fake/test.jar', jarEntries],
		]));

		const deps = new Map<string, DependencyEntry>([
			['test', createDep('test', '/fake/test.jar', true)],
		]);

		const result = await extractSourcesToTemp(deps, '/fake/root', jarReader);
		expect(existsSync(result.tempDir)).toBe(true);

		await cleanupTempDir(result.tempDir);
		expect(existsSync(result.tempDir)).toBe(false);
	});

	it('does not throw if directory does not exist', async () => {
		await expect(cleanupTempDir('/nonexistent/path/that/does/not/exist'))
			.resolves.toBeUndefined();
	});
});
