import { readFile, readdir, access } from 'node:fs/promises';
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

/**
 * Locate a POM for the given coordinate. Probes the supplied Maven roots
 * (standard layout, group-as-path) first in declaration order, then falls
 * back to the Gradle modules-2 sha1-bucketed cache.
 *
 * Note: findPom intentionally does NOT probe the Loom remapped_mods cache.
 * The .pom files Loom emits there are byproducts of the remapping pipeline
 * and are not authoritative for transitive resolution -- the original POMs
 * from the upstream repos (Maven roots / modules-2) carry the correct
 * dependency-tree metadata. Loom-cache-first ordering only applies to the
 * jars themselves (sources + compiled), which the IDE displays and the
 * project compiles against.
 */
async function findPom(
	group: string,
	artifact: string,
	version: string,
	mavenRoots: readonly string[] = [],
): Promise<string | null> {
	const expectedName = `${artifact}-${version}.pom`;

	// Maven layout probe: <root>/<group-as-path>/<artifact>/<version>/<expectedName>
	for (const root of mavenRoots) {
		const candidate = join(root, ...group.split('.'), artifact, version, expectedName);
		try {
			await access(candidate);
			return candidate;
		} catch {
			continue;
		}
	}

	// Modules-2 fallback (sha1 bucket directory level)
	const versionDir = join(
		homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1',
		group, artifact, version,
	);

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

/**
 * Format the warn-log message for a sources-resolution miss. The message
 * names the coord and lists every root that was tried, so the silent miss
 * is no longer invisible at load time. When projectRootPath is provided, the
 * loom-cache remapped_mods root is listed FIRST (matching probe order).
 */
function formatUnresolvedSourcesWarn(
	group: string,
	artifact: string,
	version: string,
	mavenRoots: readonly string[],
	projectRootPath: string | null,
): string {
	const modules2 = '~/.gradle/caches/modules-2/files-2.1';
	const roots: string[] = [];
	if (projectRootPath) {
		roots.push(join(projectRootPath, '.gradle', 'loom-cache', 'remapped_mods', 'remapped'));
	}
	roots.push(...mavenRoots);
	roots.push(modules2);
	return `Could not resolve sources for ${group}:${artifact}:${version} (tried roots: ${roots.join(', ')})`;
}

async function addDependencyEntry(
	deps: Map<string, DependencyEntry>,
	modName: string,
	group: string,
	artifact: string,
	version: string,
	category: DependencyEntry['category'],
	mavenRoots: readonly string[],
	projectRoot: string | null,
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

	const sourcesJarPath = await findSourcesJar(group, artifact, version, mavenRoots, projectRoot);
	const compiledJarPath = await findCompiledJar(group, artifact, version, mavenRoots, projectRoot);

	if (sourcesJarPath === null) {
		logger.warn(formatUnresolvedSourcesWarn(group, artifact, version, mavenRoots, projectRoot));
	}

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
	mavenRoots: readonly string[],
	projectRoot: string | null,
): Promise<void> {
	if (depth > 5) return;

	const coordKey = `${group}:${artifact}:${version}`;
	if (visited.has(coordKey)) return;
	visited.add(coordKey);

	const pomPath = await findPom(group, artifact, version, mavenRoots);
	if (!pomPath) return;

	try {
		const pomContent = await readFile(pomPath, 'utf-8');
		const pomDeps = parsePomDependencies(pomContent);

		for (const dep of pomDeps) {
			if (dep.scope !== 'compile') continue;
			if (!dep.version) continue;

			const depId = `${dep.groupId}:${dep.artifactId}`;
			const newChain = [...chain, depId];
			await addDependencyEntry(deps, modName, dep.groupId, dep.artifactId, dep.version, 'library', mavenRoots, projectRoot, newChain);
			await followTransitiveDeps(deps, modName, dep.groupId, dep.artifactId, dep.version, visited, depth + 1, newChain, mavenRoots, projectRoot);
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
	const mavenRoots = config.mavenRoots;

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
					await addDependencyEntry(deps, modName, parts[0], parts[1], parts[2], 'library', mavenRoots, projectRootPath, ['minecraft']);
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
			// Fallback: try Maven roots / modules-2 cache
			const fallbackPath = await findPom(
				'net.fabricmc.fabric-api', 'fabric-api', config.fabricApiVersion, mavenRoots,
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
				await addDependencyEntry(deps, modName, dep.groupId, dep.artifactId, dep.version, 'fabric-api', mavenRoots, projectRootPath, ['net.fabricmc.fabric-api:fabric-api']);
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
		await addDependencyEntry(deps, modName, dep.group, dep.artifact, dep.version, 'library', mavenRoots, projectRootPath, [depId]);
		await followTransitiveDeps(deps, modName, dep.group, dep.artifact, dep.version, visited, 1, [depId], mavenRoots, projectRootPath);
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
