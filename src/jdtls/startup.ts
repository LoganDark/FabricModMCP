/**
 * JDT LS Startup — Session initialization with graceful degradation
 *
 * Creates a JDT LS session by discovering Java, finding JDT LS, creating a temp
 * workspace with .project/.classpath files, and starting the JDT LS process.
 * Returns a degraded session when Java or JDT LS is unavailable.
 *
 * Also exports `retryDegradedJdtLsSessions()` — a sweep that walks every project
 * with `project.jdtls?.available === false`, derives that project's own root
 * from its first fabric-mod child, cleans the prior tempDir/dataDir, and
 * reinit's with `{ projectRoot }` so a freshly installed Java can rescue the
 * session.
 */

import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { discoverJava, findJdtLs, startJdtLs } from './client.js';
import { generateClasspathFile, generateProjectFile, cleanupTempDir } from './workspace.js';
import { syncFabricModToWorkspace } from './workspace-sync.js';
import type { JdtLsSession } from './types.js';
import { logger } from '../logging/logger.js';
import { projectStore } from '../state/project-store.js';
import { jarReader } from '../tools/shared-jar-reader.js';

/**
 * Initialize a JDT LS session with graceful degradation.
 *
 * Discovers Java 21+ (per-project — `org.gradle.java.home` from
 * `<projectRoot>/gradle.properties` is consulted when `projectRoot` is set),
 * finds JDT LS installation, creates a temp workspace with .project and empty
 * .classpath, then starts JDT LS. If any step fails, returns a session with
 * available=false and a descriptive failureReason.
 *
 * The returned session monitors the JDT LS process: if it exits with a non-zero
 * code, available is set to false so navigation tools degrade gracefully.
 *
 * The `projectRoot` parameter is optional (defaults to `{}`) so the existing
 * zero-arg callsite `await initJdtLsSession()` at `src/index.ts:21` continues
 * to type-check unchanged (D-06).
 */
export async function initJdtLsSession(opts: { projectRoot?: string } = {}): Promise<JdtLsSession> {
	const java = await discoverJava({ projectRoot: opts.projectRoot });

	if (java.javaPath === null) {
		return {
			available: false,
			failureReason: java.error,
			tempDir: '',
			dataDir: '',
			jarIdToDirName: new Map(),
		};
	}

	const jdtlsFind = findJdtLs();

	if (jdtlsFind.jdtlsHome === null) {
		return {
			available: false,
			failureReason: jdtlsFind.error,
			tempDir: '',
			dataDir: '',
			jarIdToDirName: new Map(),
		};
	}

	const tempDir = join(tmpdir(), 'mcp-jdtls-' + randomUUID());
	await mkdir(tempDir, { recursive: true });
	await writeFile(join(tempDir, '.project'), generateProjectFile());
	await writeFile(join(tempDir, '.classpath'), generateClasspathFile([]));

	try {
		const { process: proc, client, endpoint, dataDir } = await startJdtLs(
			java.javaPath, jdtlsFind.jdtlsHome, tempDir,
		);

		const session: JdtLsSession = {
			available: true,
			tempDir,
			dataDir,
			jarIdToDirName: new Map(),
			client,
			endpoint,
			process: proc,
		};

		proc.on('exit', (code) => {
			if (code !== 0 && code !== null) {
				logger.warn(`JDT LS process exited with code ${code}`);
				session.available = false;
				session.failureReason = `JDT LS process exited with code ${code}`;
			}
		});

		return session;
	} catch (err) {
		return {
			available: false,
			failureReason: `JDT LS startup failed: ${err instanceof Error ? err.message : String(err)}`,
			tempDir,
			dataDir: '',
			jarIdToDirName: new Map(),
		};
	}
}

/**
 * Sweep every project whose `jdtls.available === false` and attempt to reinit.
 *
 * Per D-03/D-05: for each degraded project, the `projectRoot` passed to
 * `initJdtLsSession` is derived per-iteration from THAT project's own first
 * fabric-mod child rootPath — NOT a captured outer value, NOT the default
 * project's root. This ensures each project's gradle.properties is consulted
 * for its own `org.gradle.java.home` slot.
 *
 * Cleanup mirrors `src/index.ts:32-46` cleanupAllSessions: tempDir/dataDir of
 * the previous degraded session are removed (best-effort, warn on error) before
 * the reinit allocates fresh dirs. The new session — successful OR still
 * degraded — replaces `project.jdtls` atomically.
 *
 * Exceptions in `initJdtLsSession` are swallowed and logged (D-04 trigger
 * semantics — tool handlers must not see throws).
 */
export async function retryDegradedJdtLsSessions(): Promise<void> {
	for (const project of projectStore.list()) {
		if (project.jdtls?.available !== false) continue;

		// Derive THIS project's own root from its first fabric-mod child.
		// Declared inside the loop body so each iteration recomputes from the
		// current `project` (D-03/D-05 per-project projectRoot).
		let projectRoot: string | undefined;
		for (const child of project.children.values()) {
			if (child.kind === 'fabric-mod') {
				projectRoot = child.rootPath;
				break;
			}
		}

		const oldTempDir = project.jdtls.tempDir;
		const oldDataDir = project.jdtls.dataDir;

		if (oldTempDir) {
			try { await cleanupTempDir(oldTempDir); } catch (err) {
				logger.warn('Failed to clean up tempDir during reinit', { dir: oldTempDir, error: String(err) });
			}
		}
		if (oldDataDir) {
			try { await cleanupTempDir(oldDataDir); } catch (err) {
				logger.warn('Failed to clean up dataDir during reinit', { dir: oldDataDir, error: String(err) });
			}
		}

		try {
			const newSession = await initJdtLsSession({ projectRoot });
			project.jdtls = newSession;
			if (newSession.available === true) {
				// Re-sync every fabric-mod child into the freshly-created
				// workspace so the rescued session's .classpath is repopulated.
				// Without this, newSession.available is true but the workspace
				// is empty — find_definition returns nothing (CR-01).
				//
				// Per-child try/catch preserves D-04 swallow-and-log semantics:
				// a thrown error in one child's sync must not abort the sweep.
				// Study-jar children are skipped (only fabric-mod children own
				// dependencyJars that need workspace extraction).
				for (const child of project.children.values()) {
					if (child.kind !== 'fabric-mod') continue;
					try {
						const result = await syncFabricModToWorkspace(child, newSession, jarReader);
						if (result.warning) {
							logger.warn(`Workspace re-sync after JDT LS rescue for '${child.name}': ${result.warning}`);
						}
					} catch (err) {
						logger.warn('Workspace re-sync failed after JDT LS rescue', {
							project: project.name,
							child: child.name,
							error: String(err),
						});
					}
				}
				logger.info(`JDT LS reinit succeeded for project '${project.name}'`);
			}
			// available === false: leave assigned. Possibly-updated failureReason
			// from a fresh discoverJava is more informative than the original.
		} catch (err) {
			logger.warn(`JDT LS reinit failed for project '${project.name}'`, { error: String(err) });
		}
	}
}
