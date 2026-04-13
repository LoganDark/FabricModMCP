import { homedir } from 'node:os';
import { join } from 'node:path';
import type { GradleConfig } from './types.js';

export function resolveSourcesJarPath(config: GradleConfig): string {
	const base = join(homedir(), '.gradle', 'caches', 'fabric-loom', 'minecraftMaven', 'net', 'minecraft');

	if (config.mappingEra === 'yarn') {
		const artifactId = 'minecraft-merged';
		const sanitizedMcVersion = config.minecraftVersion.replace(/\./g, '_');
		const version = `${config.minecraftVersion}-net.fabricmc.yarn.${sanitizedMcVersion}.${config.yarnMappings}`;
		return join(base, artifactId, version, `${artifactId}-${version}-sources.jar`);
	} else {
		const artifactId = 'minecraft-merged-deobf';
		const version = config.minecraftVersion;
		return join(base, artifactId, version, `${artifactId}-${version}-sources.jar`);
	}
}
