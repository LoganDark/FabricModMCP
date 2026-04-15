/**
 * URI Mapper — Bidirectional mapping between file:// URIs and jar ID + entry paths
 *
 * Translates between file:// URIs pointing to extracted source files on disk
 * and the project's jar-based model (jar ID + entry path within the jar).
 *
 * Directory naming conventions:
 * - `/` (namespace separator) -> `--` (double dash)
 * - `:` (Maven coordinate separator) -> `__` (double underscore)
 */

import { realpathSync } from 'node:fs';

export interface UriMapping {
	jar: string;        // jar ID
	entryPath: string;  // path within jar (e.g., "net/minecraft/client/MinecraftClient.java")
}

/**
 * Convert a jar ID to a filesystem-safe directory name.
 * Replaces `/` with `--` and `:` with `__`.
 * Order matters: `/` first to avoid ambiguity.
 */
export function jarIdToDirName(jarId: string): string {
	return jarId.replace(/\//g, '--').replace(/:/g, '__');
}

/**
 * Convert a filesystem directory name back to a jar ID.
 * Replaces `--` with `/` and `__` with `:`.
 * Order matters: `--` first to avoid ambiguity.
 */
export function dirNameToJarId(dirName: string): string {
	return dirName.replace(/--/g, '/').replace(/__/g, ':');
}

/**
 * Convert an entry path (e.g., "net/minecraft/client/MinecraftClient.java")
 * to a fully-qualified class name (e.g., "net.minecraft.client.MinecraftClient").
 */
export function entryPathToClassName(entryPath: string): string {
	return entryPath.replace(/\.java$/, '').replace(/\//g, '.');
}

export interface UriMapper {
	toFileUri(jarId: string, entryPath: string): string;
	fromFileUri(uri: string): UriMapping | null;
}

/**
 * Create a URI mapper for a given temp directory and jar ID mapping.
 *
 * @param tempDir - Root directory where extracted sources live
 * @param jarIdToDirNameMap - Map from jar ID to extraction directory name
 */
export function createUriMapper(tempDir: string, jarIdToDirNameMap: Map<string, string>): UriMapper {
	// Build reverse map: dirName -> jarId
	const dirNameToJarIdMap = new Map<string, string>();
	for (const [jarId, dirName] of jarIdToDirNameMap) {
		dirNameToJarIdMap.set(dirName, jarId);
	}

	// Resolve symlinks (macOS /tmp -> /private/var/...) so URIs match JDT LS responses
	let resolvedTempDir: string;
	try {
		resolvedTempDir = realpathSync(tempDir);
	} catch {
		resolvedTempDir = tempDir;
	}

	// Normalize tempDir to not have trailing slash
	const normalizedTempDir = resolvedTempDir.replace(/\/+$/, '');

	return {
		toFileUri(jarId: string, entryPath: string): string {
			const dirName = jarIdToDirNameMap.get(jarId) ?? jarIdToDirName(jarId);
			return `file://${normalizedTempDir}/${dirName}/${entryPath}`;
		},

		fromFileUri(uri: string): UriMapping | null {
			const prefix = `file://${normalizedTempDir}/`;
			if (!uri.startsWith(prefix)) {
				return null;
			}

			const rest = uri.slice(prefix.length);
			const slashIndex = rest.indexOf('/');
			if (slashIndex === -1) {
				return null;
			}

			const dirName = rest.slice(0, slashIndex);
			const entryPath = rest.slice(slashIndex + 1);

			// Cross-check against the known jar ID map
			const jarId = dirNameToJarIdMap.get(dirName);
			if (jarId === undefined) {
				return null;
			}

			return { jar: jarId, entryPath };
		},
	};
}
