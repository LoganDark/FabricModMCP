/**
 * URI helpers — file:// ↔ filesystem path conversion.
 *
 * Pure module: no fs I/O, no child_process, no side effects. Wraps node:url's
 * `pathToFileURL` / `fileURLToPath`. Sibling to `src/platform/index.ts` (which
 * holds platform-detection primitives + Java helpers from Phase 35).
 *
 * Consumed by:
 *   - src/jdtls/client.ts (forward sites F1, F2 — `rootUri`, workspaceFolders)
 *   - src/jdtls/workspace-sync.ts (forward sites F3–F6 — DidChangeWatchedFiles)
 *   - src/tools/remove-project-member.ts (forward site F7 — DidChangeWatchedFiles)
 *   - src/tools/tool-helpers.ts (reverse site R1 — LSP Location.uri → file path)
 *   - src/jdtls/uri-mapper.ts (internal building blocks; public method shape unchanged)
 *
 * NOT used by src/project/gradle-parser.ts (which keeps its local `fileUriToPath`
 * for Gradle-DSL semantics — two-slash `file://` + `~/` substitution).
 */

import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Convert an absolute filesystem path to a `file://` URI string.
 *
 * On Windows: `'C:\\path\\to\\file'` → `'file:///C:/path/to/file'` (three-slash,
 * drive letter in path, backslashes flipped to forward slashes).
 * On Unix: `'/path/to/file'` → `'file:///path/to/file'`.
 * Percent-encodes URL control characters (space → `%20`, `#` → `%23`, `%` → `%25`).
 *
 * **Cross-host Windows fixtures (Phase 36 RESEARCH §A2):** on a non-Windows
 * host, `pathToFileURL` does NOT auto-detect Windows-shaped input strings —
 * `'C:\\foo'` is parsed as a relative POSIX path. Tests that need Windows-
 * flavored output regardless of `process.platform` must pass
 * `{ windows: true }`. Production callsites never need this option (host
 * matches the path flavor).
 *
 * @param absPath - Absolute path. Relative paths are resolved against cwd.
 * @param opts.windows - Force Windows flavor regardless of host. Default: host-detected.
 * @returns Three-slash `file://` URI.
 */
export function pathToFileUri(absPath: string, opts?: { windows?: boolean }): string {
	if (opts?.windows === true) {
		return pathToFileURL(absPath, { windows: true }).href;
	}
	return pathToFileURL(absPath).href;
}

/**
 * Convert a `file://` URI string to an absolute filesystem path.
 *
 * On Windows: `'file:///C:/path'` → `'C:\\path'`; `'file://server/share'` → `'\\\\server\\share'`.
 * On Unix: `'file:///path'` → `'/path'`.
 * Percent-decoded transparently.
 *
 * Throws `TypeError` on non-`file:` scheme URIs and on malformed `file://` shapes.
 * Callers (`tool-helpers.ts:350`) feed in LSP `Location.uri` values which JDT LS
 * always emits as well-formed three-slash `file://` URIs.
 *
 * @param uri - `file://` URI string.
 * @returns Native filesystem path.
 */
export function fileUriToPath(uri: string): string {
	return fileURLToPath(uri);
}
