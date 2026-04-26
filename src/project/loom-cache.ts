import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, access } from 'node:fs/promises';
import type { GradleConfig } from './types.js';

type ArtifactInfo = {
	artifactPrefix: string;  // 'minecraft-merged' or 'minecraft-merged-deobf'
	version: string;
};

function artifactInfo(config: GradleConfig): ArtifactInfo {
	if (config.mappingEra === 'mapped') {
		const sanitized = config.minecraftVersion.replace(/\./g, '_');
		return {
			artifactPrefix: 'minecraft-merged',
			version: `${config.minecraftVersion}-net.fabricmc.yarn.${sanitized}.${config.yarnMappings}`,
		};
	} else {
		return {
			artifactPrefix: 'minecraft-merged-deobf',
			version: config.minecraftVersion,
		};
	}
}

// Probe the project-local Loom cache for a matching artifact dir.
// Newer Loom (e.g. 1.16-SNAPSHOT used by MC 1.19+) writes to
// <projectRoot>/.gradle/loom-cache/minecraftMaven/net/minecraft/<artifactPrefix>(-<hash>)?/<version>/<dirName>-<version><suffix>
// where <hash> is a 10-hex-char fingerprint that is NOT derivable from gradle.properties.
async function probeProjectLocal(
	projectRoot: string,
	artifactPrefix: string,
	version: string,
	filenameSuffix: string,  // '-sources.jar' or '.jar'
): Promise<string | null> {
	const netMinecraft = join(projectRoot, '.gradle', 'loom-cache', 'minecraftMaven', 'net', 'minecraft');
	let entries: string[];
	try {
		entries = await readdir(netMinecraft);
	} catch {
		return null;  // no project-local cache
	}
	// Match exact prefix OR prefix-<hex>. The hash is typically 10 hex chars but accept any -<hex> suffix.
	// IMPORTANT: when the prefix is `minecraft-merged`, do NOT match `minecraft-merged-deobf*` — that's a different artifact.
	const hashRegex = new RegExp(`^${artifactPrefix}(-[a-f0-9]+)?$`);
	const candidates = entries.filter(entry => {
		if (!hashRegex.test(entry)) return false;
		if (artifactPrefix === 'minecraft-merged' && entry.startsWith('minecraft-merged-deobf')) return false;
		return true;
	});
	for (const dirName of candidates) {
		const versionDir = join(netMinecraft, dirName, version);
		// Filename uses the FULL dir name (with hash) as prefix.
		const filename = `${dirName}-${version}${filenameSuffix}`;
		const candidate = join(versionDir, filename);
		try {
			await access(candidate);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

// Legacy global-cache path (older Loom, fallback). Returned even if missing — callers check existence
// and surface SOURCES_JAR_NOT_FOUND with this path in `tried`.
function globalCachePath(
	artifactPrefix: string,
	version: string,
	filenameSuffix: string,
): string {
	const base = join(homedir(), '.gradle', 'caches', 'fabric-loom', 'minecraftMaven', 'net', 'minecraft');
	// Global cache uses the bare artifact prefix (no hash suffix).
	return join(base, artifactPrefix, version, `${artifactPrefix}-${version}${filenameSuffix}`);
}

export async function resolveSourcesJarPath(
	config: GradleConfig,
	projectRoot: string,
): Promise<string> {
	const { artifactPrefix, version } = artifactInfo(config);
	const local = await probeProjectLocal(projectRoot, artifactPrefix, version, '-sources.jar');
	if (local) return local;
	// Newer Loom (1.16-SNAPSHOT) writes unmapped projects under the bare
	// `minecraft-merged-<hash>` prefix instead of `minecraft-merged-deobf-<hash>`.
	// The era is encoded by the version string (bare MC version vs yarn-suffixed),
	// not by the artifact prefix. Try the bare prefix as a secondary probe.
	if (config.mappingEra === 'unmapped') {
		const localBare = await probeProjectLocal(projectRoot, 'minecraft-merged', version, '-sources.jar');
		if (localBare) return localBare;
	}
	return globalCachePath(artifactPrefix, version, '-sources.jar');
}

export async function resolveCompiledJarPath(
	config: GradleConfig,
	projectRoot: string,
): Promise<string> {
	const { artifactPrefix, version } = artifactInfo(config);
	const local = await probeProjectLocal(projectRoot, artifactPrefix, version, '.jar');
	if (local) return local;
	if (config.mappingEra === 'unmapped') {
		const localBare = await probeProjectLocal(projectRoot, 'minecraft-merged', version, '.jar');
		if (localBare) return localBare;
	}
	return globalCachePath(artifactPrefix, version, '.jar');
}
