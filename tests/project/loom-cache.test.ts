import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { resolveSourcesJarPath } from '../../src/project/loom-cache.js';
import type { GradleConfig } from '../../src/project/types.js';

describe('resolveSourcesJarPath', () => {
	const base = `${homedir()}/.gradle/caches/fabric-loom/minecraftMaven/net/minecraft`;

	it('constructs correct mapped-era path', () => {
		const config: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.18.6',
			dependencies: [],
		};
		const result = resolveSourcesJarPath(config);
		expect(result).toContain('minecraft-merged/1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4/minecraft-merged-1.21.11-net.fabricmc.yarn.1_21_11.1.21.11+build.4-sources.jar');
		expect(result).toContain(base);
	});

	it('constructs correct unmapped-era path', () => {
		const config: GradleConfig = {
			minecraftVersion: '26.2-snapshot-2',
			mappingEra: 'unmapped',
			loaderVersion: '0.18.6',
			dependencies: [],
		};
		const result = resolveSourcesJarPath(config);
		expect(result).toContain('minecraft-merged-deobf/26.2-snapshot-2/minecraft-merged-deobf-26.2-snapshot-2-sources.jar');
		expect(result).toContain(base);
	});

	it('paths start with homedir gradle cache base', () => {
		const config: GradleConfig = {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			dependencies: [],
		};
		const result = resolveSourcesJarPath(config);
		expect(result.startsWith(`${homedir()}/`)).toBe(true);
	});
});
