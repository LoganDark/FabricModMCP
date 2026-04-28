import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolveSourcesJarPath, resolveCompiledJarPath, resolveLoomRemappedJarPath } from '../../src/project/loom-cache.js';
import type { GradleConfig } from '../../src/project/types.js';

describe('resolveSourcesJarPath', () => {
	const base = `${homedir()}/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft`;

	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), 'loom-cache-test-'));
	});

	afterEach(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	it('constructs correct mapped-era path (global cache fallback)', async () => {
		const config: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.18.6',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		expect(result).toContain('minecraft-merged/1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/minecraft-merged-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4-sources.jar');
		expect(result).toContain(base);
	});

	it('constructs correct unmapped-era path (global cache fallback)', async () => {
		const config: GradleConfig = {
			minecraftVersion: '26.2-snapshot-2',
			mappingEra: 'unmapped',
			loaderVersion: '0.18.6',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		expect(result).toContain('minecraft-merged-deobf/26.2-snapshot-2/minecraft-merged-deobf-26.2-snapshot-2-sources.jar');
		expect(result).toContain(base);
	});

	it('paths start with homedir gradle cache base when project-local probe misses', async () => {
		const config: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		expect(result.startsWith(`${homedir()}/`)).toBe(true);
	});

	it('returns project-local path when mapped-era jar exists in <projectRoot>/.gradle/loom-cache', async () => {
		const version = '1.19-net.fabricmc.yarn.1_19.1.19+build.4';
		const artifactDir = 'minecraft-merged-deadbeef00';
		const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
		await mkdir(versionDir, { recursive: true });
		const expectedJar = join(versionDir, `${artifactDir}-${version}-sources.jar`);
		await writeFile(expectedJar, '');

		const config: GradleConfig = {
			minecraftVersion: '1.19',
			mappingEra: 'mapped',
			yarnMappings: '1.19+build.4',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		expect(result).toBe(expectedJar);
		expect(result).toContain('loom-cache');
		expect(result).toContain('minecraft-merged-deadbeef00');
	});

	it('returns project-local path when unmapped-era jar exists with deobf prefix + hash', async () => {
		const version = '26.2-snapshot-2';
		const artifactDir = 'minecraft-merged-deobf-cafebabe11';
		const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
		await mkdir(versionDir, { recursive: true });
		const expectedJar = join(versionDir, `${artifactDir}-${version}-sources.jar`);
		await writeFile(expectedJar, '');

		const config: GradleConfig = {
			minecraftVersion: '26.2-snapshot-2',
			mappingEra: 'unmapped',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		expect(result).toBe(expectedJar);
		expect(result).toContain('minecraft-merged-deobf-cafebabe11');
	});

	it('returns project-local path when unmapped-era jar exists under bare minecraft-merged-<hash> with bare version (newer Loom)', async () => {
		const version = '26.1';
		const artifactDir = 'minecraft-merged-374c84699f';
		const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
		await mkdir(versionDir, { recursive: true });
		const expectedJar = join(versionDir, `${artifactDir}-${version}-sources.jar`);
		await writeFile(expectedJar, '');

		const config: GradleConfig = {
			minecraftVersion: '26.1',
			mappingEra: 'unmapped',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		expect(result).toBe(expectedJar);
		expect(result).toContain('minecraft-merged-374c84699f');
		expect(result).not.toContain('minecraft-merged-deobf');
	});

	it('does not match minecraft-merged-deobf-* when looking for minecraft-merged-* (mapped era)', async () => {
		// Set up a deobf dir that should NOT match the mapped query.
		const version = '1.19-net.fabricmc.yarn.1_19.1.19+build.4';
		const wrongDir = 'minecraft-merged-deobf-deadbeef00';
		const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', wrongDir, version);
		await mkdir(versionDir, { recursive: true });
		await writeFile(join(versionDir, `${wrongDir}-${version}-sources.jar`), '');

		const config: GradleConfig = {
			minecraftVersion: '1.19',
			mappingEra: 'mapped',
			yarnMappings: '1.19+build.4',
			dependencies: [],
		};
		const result = await resolveSourcesJarPath(config, tmpRoot);
		// Should fall through to global path since no `minecraft-merged-<hex>` matched.
		expect(result.startsWith(`${homedir()}/`)).toBe(true);
		expect(result).not.toContain('loom-cache');
	});
});

describe('resolveCompiledJarPath', () => {
	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), 'loom-cache-test-'));
	});

	afterEach(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	it('returns project-local compiled jar path (no -sources suffix) when present', async () => {
		const version = '1.19-net.fabricmc.yarn.1_19.1.19+build.4';
		const artifactDir = 'minecraft-merged-deadbeef00';
		const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
		await mkdir(versionDir, { recursive: true });
		const expectedJar = join(versionDir, `${artifactDir}-${version}.jar`);
		await writeFile(expectedJar, '');

		const config: GradleConfig = {
			minecraftVersion: '1.19',
			mappingEra: 'mapped',
			yarnMappings: '1.19+build.4',
			dependencies: [],
		};
		const result = await resolveCompiledJarPath(config, tmpRoot);
		expect(result).toBe(expectedJar);
		expect(result).not.toContain('-sources.jar');
	});

	it('returns project-local compiled jar under bare minecraft-merged-<hash> for unmapped era (newer Loom)', async () => {
		const version = '26.1';
		const artifactDir = 'minecraft-merged-374c84699f';
		const versionDir = join(tmpRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft', artifactDir, version);
		await mkdir(versionDir, { recursive: true });
		const expectedJar = join(versionDir, `${artifactDir}-${version}.jar`);
		await writeFile(expectedJar, '');

		const config: GradleConfig = {
			minecraftVersion: '26.1',
			mappingEra: 'unmapped',
			dependencies: [],
		};
		const result = await resolveCompiledJarPath(config, tmpRoot);
		expect(result).toBe(expectedJar);
		expect(result).not.toContain('-sources.jar');
		expect(result).not.toContain('minecraft-merged-deobf');
	});

	it('falls back to global cache compiled path when project-local probe misses', async () => {
		const config: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			dependencies: [],
		};
		const result = await resolveCompiledJarPath(config, tmpRoot);
		expect(result.startsWith(`${homedir()}/`)).toBe(true);
		expect(result).toContain('minecraft-merged/1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/minecraft-merged-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4.jar');
	});
});

describe('resolveLoomRemappedJarPath', () => {
	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), 'loom-remap-'));
	});

	afterEach(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	function remappedRoot(root: string): string {
		return join(root, '.gradle', 'loom-cache', 'remapped_mods', 'remapped');
	}

	it('returns the sources jar when present under <artifact>-<hex> dir', async () => {
		const versionDir = join(remappedRoot(tmpRoot), 'net', 'example', 'lib-abc1234567', '1.0.0');
		await mkdir(versionDir, { recursive: true });
		const expected = join(versionDir, 'lib-abc1234567-1.0.0-sources.jar');
		await writeFile(expected, '');

		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.example', 'lib', '1.0.0', '-sources.jar');
		expect(result).toBe(expected);
	});

	it('returns the compiled jar when present under <artifact>-<hex> dir', async () => {
		const versionDir = join(remappedRoot(tmpRoot), 'net', 'example', 'lib-abc1234567', '1.0.0');
		await mkdir(versionDir, { recursive: true });
		const expected = join(versionDir, 'lib-abc1234567-1.0.0.jar');
		await writeFile(expected, '');

		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.example', 'lib', '1.0.0', '.jar');
		expect(result).toBe(expected);
	});

	it('uses group-as-path (slashes), NOT a literal dotted directory', async () => {
		// Place a fixture under a literal "net.example" dir (modules-2 shape).
		// The resolver MUST split on '.' and use slashes, so this should NOT match.
		const versionDir = join(remappedRoot(tmpRoot), 'net.example', 'lib-abc1234567', '1.0.0');
		await mkdir(versionDir, { recursive: true });
		await writeFile(join(versionDir, 'lib-abc1234567-1.0.0-sources.jar'), '');

		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.example', 'lib', '1.0.0', '-sources.jar');
		expect(result).toBeNull();
	});

	it('returns null without throwing when remapped_mods dir is absent', async () => {
		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.example', 'lib', '1.0.0', '-sources.jar');
		expect(result).toBeNull();
	});

	it('returns null when the group/artifact subtree does not exist', async () => {
		// Create remapped_mods/remapped/ but no group dirs underneath.
		await mkdir(remappedRoot(tmpRoot), { recursive: true });
		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.logandark', 'auxcommands', '1.0.0+1.21.11', '-sources.jar');
		expect(result).toBeNull();
	});

	it('does not match a bare <artifact> dir without a -<hex> hash suffix', async () => {
		// Loom-remapped artifacts always have a hash. A bare-artifact dir would
		// not be Loom output and must be rejected.
		const versionDir = join(remappedRoot(tmpRoot), 'net', 'example', 'lib', '1.0.0');
		await mkdir(versionDir, { recursive: true });
		await writeFile(join(versionDir, 'lib-1.0.0-sources.jar'), '');

		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.example', 'lib', '1.0.0', '-sources.jar');
		expect(result).toBeNull();
	});

	it('returns one of the matching dirs when multiple <artifact>-<hex> siblings exist', async () => {
		const groupDir = join(remappedRoot(tmpRoot), 'net', 'example');
		const dirA = join(groupDir, 'lib-abc1234567', '1.0.0');
		const dirB = join(groupDir, 'lib-deadbeef00', '1.0.0');
		await mkdir(dirA, { recursive: true });
		await mkdir(dirB, { recursive: true });
		const jarA = join(dirA, 'lib-abc1234567-1.0.0-sources.jar');
		const jarB = join(dirB, 'lib-deadbeef00-1.0.0-sources.jar');
		await writeFile(jarA, '');
		await writeFile(jarB, '');

		const result = await resolveLoomRemappedJarPath(tmpRoot, 'net.example', 'lib', '1.0.0', '-sources.jar');
		// Don't over-specify which one (readdir order is not stable across platforms).
		expect([jarA, jarB]).toContain(result);
	});

	it('resolves the verbatim CreatorCore/Claude auxcommands shape', async () => {
		const versionDir = join(
			remappedRoot(tmpRoot),
			'net', 'logandark', 'auxcommands-12761da6', '1.0.0+1.21.11',
		);
		await mkdir(versionDir, { recursive: true });
		const expected = join(versionDir, 'auxcommands-12761da6-1.0.0+1.21.11-sources.jar');
		await writeFile(expected, '');

		const result = await resolveLoomRemappedJarPath(
			tmpRoot, 'net.logandark', 'auxcommands', '1.0.0+1.21.11', '-sources.jar',
		);
		expect(result).toBe(expected);
	});
});
