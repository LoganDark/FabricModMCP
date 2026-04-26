import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolveSourcesJarPath, resolveCompiledJarPath } from '../../src/project/loom-cache.js';
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
