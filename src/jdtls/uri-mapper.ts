/**
 * URI Mapper — Bidirectional mapping between file:// URIs and jar ID + entry paths
 *
 * Translates between file:// URIs pointing to extracted source files on disk
 * and the project's jar-based model (jar ID + entry path within the jar).
 *
 * Directory naming conventions:
 * - `/` (namespace separator) -> `--` (double dash)
 * - `:` (Maven coordinate separator) -> `__` (double underscore)
 *
 * Phase 36 (Plans 01 + 03):
 * - `toFileUri` emits three-slash form via `pathToFileUri(normalizedTempDir)`
 *   so the on-the-wire URI matches `/^file:\/\/\/[A-Za-z]:/` on Windows (the
 *   shape JDT LS returns) and stays byte-identical to v1.5 on Unix
 *   (`pathToFileUri('/path')` -> `'file:///path'`, same prefix as the old
 *   concat-based literal — UNIX-02 round-trip preserved).
 * - `fromFileUri` uses the surgical `prefixMatches` state machine: on Windows
 *   the drive-letter byte (position 8) is case-insensitive, every other byte
 *   stays byte-exact. UNC URIs, DOS device URIs, Win32 namespace URIs, and
 *   all Unix URIs fall through to byte-exact `uri.startsWith(prefix)` — they
 *   do not match the drive-letter regex (D-09, D-11). No symlink-resolving
 *   API or canonical-path probe (D-10 — pure string compare).
 */

import { realpathSync } from 'node:fs';
import { isWindows } from '../platform/index.js';
import { pathToFileUri } from '../platform/uri.js';

/**
 * Three-slash drive-letter URI shape: `file:///X:` where X is a single ASCII
 * letter. Anchored at start so UNC (`file:////server/...`), DOS device
 * (`file:////./X:/...`), and Unix (`file:///path/...`) URIs do NOT match —
 * those branches take the byte-exact `startsWith` path (D-11).
 */
const DRIVE_LETTER_URI = /^file:\/\/\/[A-Za-z]:/;

export type UriMapping = {
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

export type UriMapper = {
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

	// Normalize tempDir to its canonical (long-name) form via realpathSync.native
	// — Windows-only concern. On hosts where `tmpdir()` returns an 8.3 short name
	// (`C:\Users\LOGAND~1\AppData\Local\Temp` instead of `C:\Users\LoganDark\…`,
	// the default when the username exceeds 8 chars), JDT LS internally
	// canonicalizes to the LONG form and emits Location.uri values with the long
	// path. The prefix we build below must match the long form, otherwise every
	// JDT LS reply URI mismatches our prefix and `fromFileUri` returns null —
	// `find_definition` would observe a 1-result JDT LS reply degraded to 0 in
	// the final envelope (Phase 39 VERIFICATION Failure 1 actual root cause —
	// the documentSymbol-race hypothesis was wrong; this is the real bug).
	//
	// `realpathSync.native` is the only API that resolves 8.3 short names on
	// Windows (`realpathSync` without `.native` does NOT — it only resolves
	// symlinks). On Unix the call is a no-op canonicalization. The realpath
	// also resolves any symlinks in the tempDir path, which is desirable for
	// the same shape-match reason: JDT LS will resolve them too.
	//
	// D-10 said "pure string compare, no canonical-path probe." That decision
	// was made before the Windows 8.3 short-name shape mismatch was observed.
	// This is the documented carve-out (Phase 39 Failure 1).
	let canonicalTempDir: string;
	try {
		canonicalTempDir = realpathSync.native(tempDir);
	} catch {
		// Fall back to as-given (Unix-style behavior preservation when tempDir
		// doesn't exist yet, which shouldn't happen in production but unit tests
		// sometimes pass synthetic paths).
		canonicalTempDir = tempDir;
	}
	// Strip BOTH forward and backslashes — on Windows `realpathSync.native`
	// returns backslash-separated paths, and callers may also synthesize
	// tempDir values via `path.win32.join` that leave a trailing `\`.
	// Stripping only `/` (the pre-CR-02 behavior) left the backslash embedded
	// in the prefix, which then produced a double-slash in `pathToFileUri`
	// output and broke `prefixMatches` against JDT LS's single-slash replies.
	const normalizedTempDir = canonicalTempDir.replace(/[\\/]+$/, '');

	// Build the canonical URI prefix once, via the same helper toFileUri uses.
	// This guarantees prefix and emitted URIs share a shape — critical for the
	// drive-letter case-fold regex to match on Windows (RESEARCH Open Landmine 8).
	// `{ windows: isWindows }` makes the helper emit Windows-flavor URIs when
	// running under a mocked `process.platform === 'win32'` on a non-Windows
	// host (Phase 36 Plan 01 §A2 — `pathToFileURL` does not auto-detect the
	// drive-letter shape on darwin/linux). In production the flag is redundant:
	// when the host is Windows, host-flavor detection already matches.
	const baseUri = pathToFileUri(normalizedTempDir, { windows: isWindows });
	const prefix = `${baseUri}/`;

	/**
	 * Surgical prefix compare with Windows drive-letter case-fold (D-08/D-09/D-11).
	 *
	 * - When BOTH `uri` and `prefix` are three-slash drive-letter shapes AND
	 *   `isWindows`, byte 8 (the drive letter) is compared case-insensitively;
	 *   every other byte is compared byte-exact. The drive identity is
	 *   preserved (`C:` vs `D:` still rejects).
	 * - In every other configuration (Unix host, UNC URI, DOS device URI,
	 *   Win32 namespace URI, mismatched-shape inputs), falls through to
	 *   `uri.startsWith(prefix)` — byte-exact (D-11).
	 *
	 * Per D-10, no symlink-resolving API or canonical-path probe — this is
	 * pure string compare. The path tail (jar-entry segments after the
	 * trailing slash) is always byte-exact (D-09).
	 */
	function prefixMatches(uri: string, prefix: string): boolean {
		if (isWindows && DRIVE_LETTER_URI.test(uri) && DRIVE_LETTER_URI.test(prefix)) {
			if (uri.length < prefix.length) return false;
			// head 'file:///' (8 chars) byte-exact
			if (uri.slice(0, 8) !== prefix.slice(0, 8)) return false;
			// drive letter case-insensitive (byte 8 only)
			if (uri[8].toLowerCase() !== prefix[8].toLowerCase()) return false;
			// rest of the prefix (':', path bytes, trailing '/') byte-exact
			if (uri.slice(9, prefix.length) !== prefix.slice(9)) return false;
			return true;
		}
		return uri.startsWith(prefix);
	}

	return {
		toFileUri(jarId: string, entryPath: string): string {
			const dirName = jarIdToDirNameMap.get(jarId) ?? jarIdToDirName(jarId);
			return `${baseUri}/${dirName}/${entryPath}`;
		},

		fromFileUri(uri: string): UriMapping | null {
			if (!prefixMatches(uri, prefix)) {
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
