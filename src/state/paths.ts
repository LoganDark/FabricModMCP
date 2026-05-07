/**
 * Server-relative path resolution. The MCP server is usually launched from a
 * downstream Fabric mod project's cwd, so anything that needs to live "next
 * to the server" must be resolved relative to the script — not cwd.
 *
 * `getProjectRoot()` walks upward from this module's source location until it
 * finds a package.json. The result is cached after the first call.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let cachedRoot: string | null = null;

export function getProjectRoot(): string {
	if (cachedRoot !== null) return cachedRoot;
	const start = dirname(fileURLToPath(import.meta.url));
	let dir = start;
	while (true) {
		if (existsSync(resolve(dir, 'package.json'))) {
			cachedRoot = dir;
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(`Could not locate project root (no package.json found walking up from ${start})`);
		}
		dir = parent;
	}
}

/**
 * Path of FEEDBACK.txt at the server's installation root. Override with
 * `FEEDBACK_PATH` env var (used by tests; useful for redirecting in
 * production deployments where the install dir is read-only).
 */
export function getFeedbackPath(): string {
	const override = process.env.FEEDBACK_PATH;
	if (override && override.length > 0) return override;
	return resolve(getProjectRoot(), 'FEEDBACK.txt');
}
