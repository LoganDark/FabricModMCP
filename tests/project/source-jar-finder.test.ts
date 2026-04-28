import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSourcesJar, findCompiledJar } from '../../src/project/source-jar-finder.js';

// These tests build real on-disk fixtures under os.tmpdir() so the resolver's
// readdir/access calls hit a real filesystem. We intentionally avoid mocking
// fs because the modules-2 vs Maven layout distinction is the whole point of
// the new probe ordering -- mocks would risk papering over path-shape bugs.

const GROUP = 'net.example';
const ARTIFACT = 'lib';
const VERSION = '1.0.0';
const SOURCES_NAME = `${ARTIFACT}-${VERSION}-sources.jar`;
const JAR_NAME = `${ARTIFACT}-${VERSION}.jar`;

async function makeMavenLayout(root: string): Promise<string> {
	// Maven layout: <root>/<group-as-path>/<artifact>/<version>/<artifact>-<version>-sources.jar
	const dir = join(root, ...GROUP.split('.'), ARTIFACT, VERSION);
	await mkdir(dir, { recursive: true });
	const sourcesPath = join(dir, SOURCES_NAME);
	const jarPath = join(dir, JAR_NAME);
	await writeFile(sourcesPath, 'fake sources');
	await writeFile(jarPath, 'fake jar');
	return dir;
}

async function makeModules2Layout(base: string): Promise<{ sourcesPath: string; jarPath: string }> {
	// Modules-2 layout: <base>/<group-with-dots>/<artifact>/<version>/<sha1>/<file>
	const dir = join(base, GROUP, ARTIFACT, VERSION, 'abc123sha');
	await mkdir(dir, { recursive: true });
	const sourcesPath = join(dir, SOURCES_NAME);
	const jarPath = join(dir, JAR_NAME);
	await writeFile(sourcesPath, 'fake modules-2 sources');
	await writeFile(jarPath, 'fake modules-2 jar');
	return { sourcesPath, jarPath };
}

describe('findSourcesJar with mavenRoots', () => {
	let tmpRoot: string;

	beforeAll(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), 'fmm-sjf-'));
	});

	afterAll(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	it('returns null when neither Maven roots nor modules-2 contain the artifact', async () => {
		const result = await findSourcesJar('not.a.real', 'thing', '99.0.0', []);
		expect(result).toBeNull();
	});

	it('finds sources jar in a Maven-layout root (group-as-path with slashes)', async () => {
		const mavenRoot = join(tmpRoot, 'maven-only');
		await makeMavenLayout(mavenRoot);
		const result = await findSourcesJar(GROUP, ARTIFACT, VERSION, [mavenRoot]);
		expect(result).toBe(join(mavenRoot, ...GROUP.split('.'), ARTIFACT, VERSION, SOURCES_NAME));
	});

	it('returns the FIRST declared Maven root that contains the artifact (declaration order)', async () => {
		const firstRoot = join(tmpRoot, 'maven-first');
		const secondRoot = join(tmpRoot, 'maven-second');
		await makeMavenLayout(firstRoot);
		await makeMavenLayout(secondRoot);
		const result = await findSourcesJar(GROUP, ARTIFACT, VERSION, [firstRoot, secondRoot]);
		expect(result).toContain('maven-first');
	});

	it('falls through to subsequent Maven root when first does not contain artifact', async () => {
		const emptyRoot = join(tmpRoot, 'empty-first');
		await mkdir(emptyRoot, { recursive: true });
		const populatedRoot = join(tmpRoot, 'populated-second');
		await makeMavenLayout(populatedRoot);
		const result = await findSourcesJar(GROUP, ARTIFACT, VERSION, [emptyRoot, populatedRoot]);
		expect(result).toContain('populated-second');
	});

	it('uses group-as-path (slashes) for Maven layout, NOT literal dots', async () => {
		// Place a dotted-name dir in a Maven root and confirm it is NOT matched.
		// (This is the modules-2 shape -- the resolver must not regress.)
		const mavenRoot = join(tmpRoot, 'maven-shape');
		const wrongDir = join(mavenRoot, GROUP /* literal "net.example" */, ARTIFACT, VERSION);
		await mkdir(wrongDir, { recursive: true });
		await writeFile(join(wrongDir, SOURCES_NAME), 'should not match');

		const result = await findSourcesJar(GROUP, ARTIFACT, VERSION, [mavenRoot]);
		expect(result).toBeNull();
	});
});

describe('findCompiledJar with mavenRoots', () => {
	let tmpRoot: string;

	beforeAll(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), 'fmm-cjf-'));
	});

	afterAll(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	it('returns null when neither Maven roots nor modules-2 contain the artifact', async () => {
		const result = await findCompiledJar('not.a.real', 'thing', '99.0.0', []);
		expect(result).toBeNull();
	});

	it('finds compiled jar in a Maven-layout root', async () => {
		const mavenRoot = join(tmpRoot, 'maven-only');
		await makeMavenLayout(mavenRoot);
		const result = await findCompiledJar(GROUP, ARTIFACT, VERSION, [mavenRoot]);
		expect(result).toBe(join(mavenRoot, ...GROUP.split('.'), ARTIFACT, VERSION, JAR_NAME));
	});

	it('returns first declared Maven root in declaration order', async () => {
		const firstRoot = join(tmpRoot, 'maven-first');
		const secondRoot = join(tmpRoot, 'maven-second');
		await makeMavenLayout(firstRoot);
		await makeMavenLayout(secondRoot);
		const result = await findCompiledJar(GROUP, ARTIFACT, VERSION, [firstRoot, secondRoot]);
		expect(result).toContain('maven-first');
	});
});

describe('findSourcesJar default modules-2 path', () => {
	// Without mavenRoots, behaviour must be identical to the prior implementation.
	// We can't assemble a synthetic ~/.gradle without mucking with HOME, so we
	// only assert the no-roots, missing-artifact case returns null without throwing.
	it('returns null with empty mavenRoots and a non-existent coord (regression check)', async () => {
		const result = await findSourcesJar('absolutely.not.real', 'no-such-artifact', '0.0.0-never', []);
		expect(result).toBeNull();
	});

	it('returns null with the default mavenRoots arg (omitted) and a non-existent coord', async () => {
		const result = await findSourcesJar('absolutely.not.real', 'no-such-artifact', '0.0.0-never');
		expect(result).toBeNull();
	});

	it('returns null when projectRoot is null and Maven roots / modules-2 do not match', async () => {
		const result = await findSourcesJar('absolutely.not.real', 'no-such-artifact', '0.0.0-never', [], null);
		expect(result).toBeNull();
	});
});

describe('findSourcesJar / findCompiledJar with projectRoot (loom-cache probe)', () => {
	let tmpRoot: string;

	beforeAll(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), 'fmm-loomprobe-'));
	});

	afterAll(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	const LOOM_GROUP = 'net.example';
	const LOOM_ARTIFACT = 'mod';
	const LOOM_VERSION = '1.0.0';
	const LOOM_HASH = 'abc1234567';
	const LOOM_DIR_NAME = `${LOOM_ARTIFACT}-${LOOM_HASH}`;
	const LOOM_SOURCES = `${LOOM_DIR_NAME}-${LOOM_VERSION}-sources.jar`;
	const LOOM_JAR = `${LOOM_DIR_NAME}-${LOOM_VERSION}.jar`;

	async function makeLoomLayout(projectRoot: string): Promise<{ sourcesPath: string; jarPath: string }> {
		const dir = join(
			projectRoot, '.gradle', 'loom-cache', 'remapped_mods', 'remapped',
			...LOOM_GROUP.split('.'), LOOM_DIR_NAME, LOOM_VERSION,
		);
		await mkdir(dir, { recursive: true });
		const sourcesPath = join(dir, LOOM_SOURCES);
		const jarPath = join(dir, LOOM_JAR);
		await writeFile(sourcesPath, 'fake loom-remapped sources');
		await writeFile(jarPath, 'fake loom-remapped jar');
		return { sourcesPath, jarPath };
	}

	it('Test A: findSourcesJar returns the loom-cache path even when a Maven root also has it', async () => {
		const projectRoot = join(tmpRoot, 'projA');
		const mavenRoot = join(tmpRoot, 'maven-A');
		// Maven layout for the same coord (using Loom's group/artifact/version).
		const mavenDir = join(mavenRoot, ...LOOM_GROUP.split('.'), LOOM_ARTIFACT, LOOM_VERSION);
		await mkdir(mavenDir, { recursive: true });
		await writeFile(join(mavenDir, `${LOOM_ARTIFACT}-${LOOM_VERSION}-sources.jar`), 'maven sources');

		const { sourcesPath } = await makeLoomLayout(projectRoot);

		const result = await findSourcesJar(LOOM_GROUP, LOOM_ARTIFACT, LOOM_VERSION, [mavenRoot], projectRoot);
		expect(result).toBe(sourcesPath);
		expect(result).toContain('loom-cache/remapped_mods/remapped');
	});

	it('Test B: findCompiledJar returns the loom-cache path when both loom and Maven have it', async () => {
		const projectRoot = join(tmpRoot, 'projB');
		const mavenRoot = join(tmpRoot, 'maven-B');
		const mavenDir = join(mavenRoot, ...LOOM_GROUP.split('.'), LOOM_ARTIFACT, LOOM_VERSION);
		await mkdir(mavenDir, { recursive: true });
		await writeFile(join(mavenDir, `${LOOM_ARTIFACT}-${LOOM_VERSION}.jar`), 'maven jar');

		const { jarPath } = await makeLoomLayout(projectRoot);

		const result = await findCompiledJar(LOOM_GROUP, LOOM_ARTIFACT, LOOM_VERSION, [mavenRoot], projectRoot);
		expect(result).toBe(jarPath);
		expect(result).toContain('loom-cache/remapped_mods/remapped');
	});

	it('Test C: falls through to Maven roots when projectRoot has no loom-remapped fixture', async () => {
		const projectRoot = join(tmpRoot, 'projC');
		await mkdir(projectRoot, { recursive: true }); // exists, but no .gradle/loom-cache
		const mavenRoot = join(tmpRoot, 'maven-C');
		const mavenDir = join(mavenRoot, ...LOOM_GROUP.split('.'), LOOM_ARTIFACT, LOOM_VERSION);
		await mkdir(mavenDir, { recursive: true });
		const expected = join(mavenDir, `${LOOM_ARTIFACT}-${LOOM_VERSION}-sources.jar`);
		await writeFile(expected, 'maven sources');

		const result = await findSourcesJar(LOOM_GROUP, LOOM_ARTIFACT, LOOM_VERSION, [mavenRoot], projectRoot);
		expect(result).toBe(expected);
	});

	it('Test D: returns null when neither loom-cache nor Maven roots nor modules-2 has the coord', async () => {
		const projectRoot = join(tmpRoot, 'projD');
		await mkdir(projectRoot, { recursive: true });
		const result = await findSourcesJar('absolutely.not.real', 'no-such-artifact', '0.0.0-never', [], projectRoot);
		expect(result).toBeNull();
	});

	it('Test E: when projectRoot is null, behaviour matches the existing implementation (Maven root then modules-2)', async () => {
		const mavenRoot = join(tmpRoot, 'maven-E');
		const mavenDir = join(mavenRoot, ...LOOM_GROUP.split('.'), LOOM_ARTIFACT, LOOM_VERSION);
		await mkdir(mavenDir, { recursive: true });
		const expected = join(mavenDir, `${LOOM_ARTIFACT}-${LOOM_VERSION}-sources.jar`);
		await writeFile(expected, 'maven sources');

		const result = await findSourcesJar(LOOM_GROUP, LOOM_ARTIFACT, LOOM_VERSION, [mavenRoot], null);
		expect(result).toBe(expected);
	});
});
