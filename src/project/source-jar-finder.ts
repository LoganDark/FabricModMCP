import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

function gradleCacheBase(): string {
	return join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1');
}

export async function findSourcesJar(
	group: string,
	artifact: string,
	version: string,
): Promise<string | null> {
	const versionDir = join(gradleCacheBase(), group, artifact, version);
	const expectedName = `${artifact}-${version}-sources.jar`;

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

export async function findCompiledJar(
	group: string,
	artifact: string,
	version: string,
): Promise<string | null> {
	const versionDir = join(gradleCacheBase(), group, artifact, version);
	const expectedName = `${artifact}-${version}.jar`;

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
