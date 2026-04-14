import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm, utimes, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
	validateStudyJarName,
	deriveStudyJarName,
	validateStudyJarId,
	createStudyJar,
	checkAndReopenIfStale,
	studyJarToDependencyEntry,
	STUDY_JAR_NAME_PATTERN,
} from '../../src/project/study-jar.js';
import { JarReader } from '../../src/project/jar-reader.js';
import type { LoadedProject, StudyJar } from '../../src/project/types.js';

const testDir = join(tmpdir(), 'study-jar-test-' + Date.now());
const testJarPath = join(testDir, 'test-lib-1.0-sources.jar');
const testJarPath2 = join(testDir, 'second-lib.jar');

function makeProject(overrides: Partial<LoadedProject> = {}): LoadedProject {
	return {
		name: 'test-project',
		studyJars: new Map(),
		dependencyJars: new Map(),
		...overrides,
	} as unknown as LoadedProject;
}

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

describe('STUDY_JAR_NAME_PATTERN', () => {
	it('matches valid names', () => {
		expect(STUDY_JAR_NAME_PATTERN.test('my-lib.1.0')).toBe(true);
		expect(STUDY_JAR_NAME_PATTERN.test('simple')).toBe(true);
		expect(STUDY_JAR_NAME_PATTERN.test('a')).toBe(true);
		expect(STUDY_JAR_NAME_PATTERN.test('lib-1.2.3-sources')).toBe(true);
	});

	it('rejects invalid names', () => {
		expect(STUDY_JAR_NAME_PATTERN.test('')).toBe(false);
		expect(STUDY_JAR_NAME_PATTERN.test('my lib')).toBe(false);
		expect(STUDY_JAR_NAME_PATTERN.test('my:lib')).toBe(false);
		expect(STUDY_JAR_NAME_PATTERN.test('-dash-start')).toBe(false);
	});
});

describe('validateStudyJarName', () => {
	it('passes for valid names', () => {
		expect(() => validateStudyJarName('my-lib.1.0')).not.toThrow();
		expect(() => validateStudyJarName('simple')).not.toThrow();
	});

	it('throws INVALID_STUDY_JAR_NAME for names with spaces', () => {
		expect(() => validateStudyJarName('my lib')).toThrow('INVALID_STUDY_JAR_NAME');
	});

	it('throws INVALID_STUDY_JAR_NAME for names with colons', () => {
		expect(() => validateStudyJarName('my:lib')).toThrow('INVALID_STUDY_JAR_NAME');
	});

	it('throws INVALID_STUDY_JAR_NAME for empty string', () => {
		expect(() => validateStudyJarName('')).toThrow('INVALID_STUDY_JAR_NAME');
	});

	it('throws INVALID_STUDY_JAR_NAME for dash-start', () => {
		expect(() => validateStudyJarName('-dash-start')).toThrow('INVALID_STUDY_JAR_NAME');
	});
});

describe('deriveStudyJarName', () => {
	it('derives name from jar filename stripping .jar extension', () => {
		expect(deriveStudyJarName('/path/to/my-lib-1.0-sources.jar')).toBe('my-lib-1.0-sources');
	});

	it('sanitizes invalid characters to hyphens', () => {
		const result = deriveStudyJarName('/path/to/weird chars!.jar');
		expect(STUDY_JAR_NAME_PATTERN.test(result)).toBe(true);
		expect(result).not.toContain(' ');
		expect(result).not.toContain('!');
	});

	it('collapses multiple hyphens', () => {
		const result = deriveStudyJarName('/path/to/a--b---c.jar');
		expect(result).not.toContain('--');
	});

	it('returns unnamed for degenerate filenames', () => {
		expect(deriveStudyJarName('/path/to/!!!.jar')).toBe('unnamed');
	});
});

describe('validateStudyJarId', () => {
	it('passes when no collision exists', () => {
		const project = makeProject();
		expect(() => validateStudyJarId('foo', project)).not.toThrow();
	});

	it('throws STUDY_JAR_ID_COLLISION when dependency has matching study: id', () => {
		const project = makeProject({
			dependencyJars: new Map([
				['study:foo', {
					id: 'study:foo', group: 'study', artifact: 'foo', version: 'local',
					category: 'study', sourcesJarPath: '/some/path.jar', available: true, provenanceChains: [],
				}],
			]),
		});
		expect(() => validateStudyJarId('foo', project)).toThrow('STUDY_JAR_ID_COLLISION');
	});
});

describe('createStudyJar', () => {
	it('creates a StudyJar from a valid ZIP file', async () => {
		const project = makeProject();
		const result = await createStudyJar(testJarPath, 'test-lib', project);
		expect(result.name).toBe('test-lib');
		expect(result.jarPath).toContain('test-lib-1.0-sources.jar');
		expect(result.mtime).toBeGreaterThan(0);
		expect(result.size).toBeGreaterThan(0);
		expect(result.autoInclude).toBe(false);
		expect(result.stats.totalEntries).toBeGreaterThan(0);
		expect(result.stats.classCount).toBe(2); // Foo and Bar
		expect(result.stats.packageCount).toBe(1); // com.example
	});

	it('auto-derives name from filename when name is undefined', async () => {
		const project = makeProject();
		const result = await createStudyJar(testJarPath, undefined, project);
		expect(result.name).toBe('test-lib-1.0-sources');
	});

	it('throws STUDY_JAR_FILE_NOT_FOUND for nonexistent path', async () => {
		const project = makeProject();
		await expect(
			createStudyJar('/nonexistent/path/fake.jar', 'fake', project),
		).rejects.toThrow('STUDY_JAR_FILE_NOT_FOUND');
	});

	it('throws STUDY_JAR_NAME_EXISTS for duplicate name', async () => {
		const existingJar: StudyJar = {
			name: 'test-lib', jarPath: '/old/path.jar', mtime: 0, size: 0,
			autoInclude: false, stats: { totalEntries: 0, packageCount: 0, classCount: 0 },
		};
		const project = makeProject({
			studyJars: new Map([['test-lib', existingJar]]),
		});
		await expect(
			createStudyJar(testJarPath, 'test-lib', project),
		).rejects.toThrow('STUDY_JAR_NAME_EXISTS');
	});

	it('throws STUDY_JAR_INVALID_ZIP for non-zip file', async () => {
		const badFile = join(testDir, 'not-a-zip.jar');
		await writeFile(badFile, 'this is not a zip file');
		const project = makeProject();
		await expect(
			createStudyJar(badFile, 'bad', project),
		).rejects.toThrow('STUDY_JAR_INVALID_ZIP');
	});
});

describe('checkAndReopenIfStale', () => {
	it('returns false when mtime and size are unchanged', async () => {
		const fileStat = await stat(testJarPath);
		const studyJar: StudyJar = {
			name: 'test-lib', jarPath: testJarPath,
			mtime: fileStat.mtimeMs, size: fileStat.size,
			autoInclude: false, stats: { totalEntries: 0, packageCount: 0, classCount: 0 },
		};
		const reader = new JarReader();
		reader.registerProject('test', new Set([testJarPath]));

		const result = await checkAndReopenIfStale(studyJar, reader);
		expect(result).toBe(false);
		await reader.closeAll();
	});

	it('returns true and evicts cache when file changed', async () => {
		const fileStat = await stat(testJarPath2);
		const studyJar: StudyJar = {
			name: 'second-lib', jarPath: testJarPath2,
			mtime: fileStat.mtimeMs - 1000, // pretend old mtime
			size: fileStat.size,
			autoInclude: false, stats: { totalEntries: 0, packageCount: 0, classCount: 0 },
		};
		const reader = new JarReader();
		reader.registerProject('test', new Set([testJarPath2]));
		// Open a handle so close() has something to close
		await reader.listEntries(testJarPath2);

		const result = await checkAndReopenIfStale(studyJar, reader);
		expect(result).toBe(true);
		// mtime should be updated on the study jar object
		expect(studyJar.mtime).toBe(fileStat.mtimeMs);
		await reader.closeAll();
	});

	it('returns false when file no longer exists', async () => {
		const studyJar: StudyJar = {
			name: 'gone', jarPath: '/nonexistent/gone.jar',
			mtime: 0, size: 0,
			autoInclude: false, stats: { totalEntries: 0, packageCount: 0, classCount: 0 },
		};
		const reader = new JarReader();
		const result = await checkAndReopenIfStale(studyJar, reader);
		expect(result).toBe(false);
	});
});

describe('studyJarToDependencyEntry', () => {
	it('returns DependencyEntry with study: prefix and correct fields', () => {
		const studyJar: StudyJar = {
			name: 'my-lib', jarPath: '/path/to/my-lib.jar',
			mtime: 123, size: 456,
			autoInclude: false, stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
		};
		const entry = studyJarToDependencyEntry(studyJar);
		expect(entry.id).toBe('study:my-lib');
		expect(entry.group).toBe('study');
		expect(entry.artifact).toBe('my-lib');
		expect(entry.version).toBe('local');
		expect(entry.category).toBe('study');
		expect(entry.sourcesJarPath).toBe('/path/to/my-lib.jar');
		expect(entry.available).toBe(true);
		expect(entry.provenanceChains).toEqual([]);
	});
});
