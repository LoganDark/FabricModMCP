import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../logging/logger.js';
import { parsePomDependencies } from './pom-parser.js';
import { findSourcesJar, findCompiledJar } from './source-jar-finder.js';
import type { GradleConfig, DependencyEntry } from './types.js';

export type DiscoveryResult = {
	dependencies: Map<string, DependencyEntry>;
	summary: {
		total: number;
		withSources: number;
		withoutSources: number;
	};
}

async function findPomInModules2(
	group: string,
	artifact: string,
	version: string,
): Promise<string | null> {
	const versionDir = join(
		homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1',
		group, artifact, version,
	);
	const expectedName = `${artifact}-${version}.pom`;

	try {
		const sha1Dirs = await readdir(versionDir);
		for (const sha1 of sha1Dirs) {
			const candidate = join(versionDir, sha1, expectedName);
			try {
				await readFile(candidate, 'utf-8');
				return candidate;
			} catch {
				continue;
			}
		}
	} catch {
		// Version directory doesn't exist
	}

	return null;
}

async function addDependencyEntry(
	deps: Map<string, DependencyEntry>,
	modName: string,
	group: string,
	artifact: string,
	version: string,
	category: DependencyEntry['category'],
	chain: string[] = [],
): Promise<void> {
	const id = `${modName}/${group}:${artifact}`;
	const existing = deps.get(id);
	if (existing) {
		if (chain.length > 0) {
			existing.provenanceChains.push(chain);
		}
		return;
	}

	const sourcesJarPath = await findSourcesJar(group, artifact, version);
	const compiledJarPath = await findCompiledJar(group, artifact, version);
	deps.set(id, {
		id,
		group,
		artifact,
		version,
		category,
		sourcesJarPath,
		compiledJarPath,
		available: sourcesJarPath !== null,
		provenanceChains: chain.length > 0 ? [chain] : [],
	});
}

async function followTransitiveDeps(
	deps: Map<string, DependencyEntry>,
	modName: string,
	group: string,
	artifact: string,
	version: string,
	visited: Set<string>,
	depth: number,
	chain: string[],
): Promise<void> {
	if (depth > 5) return;

	const coordKey = `${group}:${artifact}:${version}`;
	if (visited.has(coordKey)) return;
	visited.add(coordKey);

	const pomPath = await findPomInModules2(group, artifact, version);
	if (!pomPath) return;

	try {
		const pomContent = await readFile(pomPath, 'utf-8');
		const pomDeps = parsePomDependencies(pomContent);

		for (const dep of pomDeps) {
			if (dep.scope !== 'compile') continue;
			if (!dep.version) continue;

			const depId = `${dep.groupId}:${dep.artifactId}`;
			const newChain = [...chain, depId];
			await addDependencyEntry(deps, modName, dep.groupId, dep.artifactId, dep.version, 'library', newChain);
			await followTransitiveDeps(deps, modName, dep.groupId, dep.artifactId, dep.version, visited, depth + 1, newChain);
		}
	} catch {
		// Malformed POM or read error -- skip
	}
}

export async function discoverDependencies(
	config: GradleConfig,
	sourcesJarPath: string,
	compiledJarPath: string | null,
	projectRootPath: string,
	modName: string,
): Promise<DiscoveryResult> {
	const deps = new Map<string, DependencyEntry>();

	// Step 0: Seed entries
	deps.set(`${modName}/minecraft`, {
		id: `${modName}/minecraft`,
		group: 'com.mojang',
		artifact: 'minecraft',
		version: config.minecraftVersion,
		category: 'minecraft',
		sourcesJarPath,
		compiledJarPath,
		available: true,
		provenanceChains: [],
	});

	deps.set(modName, {
		id: modName,
		group: '',
		artifact: '',
		version: '',
		category: 'mod-source',
		sourcesJarPath: null,
		compiledJarPath: null,
		available: true,
		provenanceChains: [],
	});

	// Step 1: Strategy A -- Minecraft Libraries (mojang_minecraft_info.json)
	const mojangInfoPath = join(
		homedir(), '.gradle', 'caches', 'fabric-loom',
		config.minecraftVersion, 'mojang_minecraft_info.json',
	);

	try {
		const mojangContent = await readFile(mojangInfoPath, 'utf-8');
		const mojangInfo = JSON.parse(mojangContent as string);

		if (Array.isArray(mojangInfo.libraries)) {
			for (const lib of mojangInfo.libraries) {
				const parts = (lib.name as string).split(':');
				if (parts.length >= 3) {
					await addDependencyEntry(deps, modName, parts[0], parts[1], parts[2], 'library', ['minecraft']);
				}
			}
		}
	} catch {
		logger.warn('Could not read mojang_minecraft_info.json -- Minecraft library discovery skipped');
	}

	// Step 2: Strategy B -- Fabric API Modules
	if (config.fabricApiVersion) {
		let fabricPomContent: string | null = null;

		// Try Loom cache POM first
		const loomPomPath = join(
			homedir(), '.gradle', 'caches', 'fabric-loom', 'fabric-api',
			`fabric-api-${config.fabricApiVersion}.pom`,
		);

		try {
			fabricPomContent = await readFile(loomPomPath, 'utf-8') as string;
		} catch {
			// Fallback: try modules-2 cache
			const fallbackPath = await findPomInModules2(
				'net.fabricmc.fabric-api', 'fabric-api', config.fabricApiVersion,
			);
			if (fallbackPath) {
				try {
					fabricPomContent = await readFile(fallbackPath, 'utf-8') as string;
				} catch {
					// Give up
				}
			}
		}

		if (fabricPomContent) {
			const fabricDeps = parsePomDependencies(fabricPomContent);
			for (const dep of fabricDeps) {
				if (dep.scope !== 'compile') continue;
				await addDependencyEntry(deps, modName, dep.groupId, dep.artifactId, dep.version, 'fabric-api', ['net.fabricmc.fabric-api:fabric-api']);
			}
		} else {
			// Could not find Fabric API POM -- add single entry
			deps.set(`${modName}/net.fabricmc.fabric-api:fabric-api`, {
				id: `${modName}/net.fabricmc.fabric-api:fabric-api`,
				group: 'net.fabricmc.fabric-api',
				artifact: 'fabric-api',
				version: config.fabricApiVersion,
				category: 'fabric-api',
				sourcesJarPath: null,
				compiledJarPath: null,
				available: false,
				provenanceChains: [],
			});
			logger.warn('Could not find Fabric API POM -- module discovery skipped');
		}
	}

	// Step 3: Strategy C -- Other Declared Dependencies
	const visited = new Set<string>();
	const skipConfigurations = new Set(['minecraft', 'mappings']);
	const skipArtifacts = new Set(['fabric-api', 'fabric-loader']);

	for (const dep of config.dependencies) {
		if (skipConfigurations.has(dep.configuration)) continue;
		if (skipArtifacts.has(dep.artifact)) continue;

		const depId = `${dep.group}:${dep.artifact}`;
		await addDependencyEntry(deps, modName, dep.group, dep.artifact, dep.version, 'library', [depId]);
		await followTransitiveDeps(deps, modName, dep.group, dep.artifact, dep.version, visited, 1, [depId]);
	}

	// Calculate summary (excluding minecraft and mod-source)
	let withSources = 0;
	let withoutSources = 0;
	for (const [id, entry] of deps) {
		if (entry.category === 'minecraft' || entry.category === 'mod-source') continue;
		if (entry.available) {
			withSources++;
		} else {
			withoutSources++;
		}
	}

	return {
		dependencies: deps,
		summary: {
			total: withSources + withoutSources,
			withSources,
			withoutSources,
		},
	};
}
