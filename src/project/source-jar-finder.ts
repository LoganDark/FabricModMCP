import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveLoomRemappedJarPath } from './loom-cache.js';

function gradleCacheBase(): string {
	return join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1');
}

/**
 * Probe an ordered list of standard-Maven-layout roots for the given file.
 * Maven layout: <root>/<group-as-path>/<artifact>/<version>/<expectedName>.
 * Group is split on '.' and joined with the path separator (slashes), NOT
 * left as a literal dotted directory (that is the modules-2 shape).
 */
async function probeMavenRoots(
	mavenRoots: readonly string[],
	group: string,
	artifact: string,
	version: string,
	expectedName: string,
): Promise<string | null> {
	for (const root of mavenRoots) {
		const candidate = join(root, ...group.split('.'), artifact, version, expectedName);
		try {
			await access(candidate);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

/**
 * Probe the Gradle modules-2 cache (sha1-bucketed) for the given file.
 * Modules-2 layout: <cacheBase>/<group-with-dots>/<artifact>/<version>/<sha1>/<expectedName>.
 * Returns null if the version directory does not exist or no sha1 bucket
 * contains the file.
 */
async function probeModules2(
	group: string,
	artifact: string,
	version: string,
	expectedName: string,
): Promise<string | null> {
	const versionDir = join(gradleCacheBase(), group, artifact, version);

	try {
		const sha1Dirs = await readdir(versionDir);
		for (const sha1 of sha1Dirs) {
			const candidate = join(versionDir, sha1, expectedName);
			try {
				await access(candidate);
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

export async function findSourcesJar(
	group: string,
	artifact: string,
	version: string,
	mavenRoots: readonly string[] = [],
	projectRoot: string | null = null,
): Promise<string | null> {
	// Loom remaps every Fabric mod dependency from intermediary into the project's
	// mappings (yarn) and writes the result to <projectRoot>/.gradle/loom-cache/
	// remapped_mods/remapped/. These remapped jars match what the IDE shows and
	// what the project compiles against, so they MUST be preferred over the
	// intermediary-mapped sources in declared Maven roots / modules-2.
	if (projectRoot !== null) {
		const fromLoom = await resolveLoomRemappedJarPath(projectRoot, group, artifact, version, '-sources.jar');
		if (fromLoom) return fromLoom;
	}
	const expectedName = `${artifact}-${version}-sources.jar`;
	const fromMaven = await probeMavenRoots(mavenRoots, group, artifact, version, expectedName);
	if (fromMaven) return fromMaven;
	return probeModules2(group, artifact, version, expectedName);
}

export async function findCompiledJar(
	group: string,
	artifact: string,
	version: string,
	mavenRoots: readonly string[] = [],
	projectRoot: string | null = null,
): Promise<string | null> {
	// Same loom-cache-first logic as findSourcesJar -- the binary jar is also
	// remapped to the project's mappings.
	if (projectRoot !== null) {
		const fromLoom = await resolveLoomRemappedJarPath(projectRoot, group, artifact, version, '.jar');
		if (fromLoom) return fromLoom;
	}
	const expectedName = `${artifact}-${version}.jar`;
	const fromMaven = await probeMavenRoots(mavenRoots, group, artifact, version, expectedName);
	if (fromMaven) return fromMaven;
	return probeModules2(group, artifact, version, expectedName);
}
