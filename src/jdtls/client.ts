/**
 * JDT LS Client — Process lifecycle management for Eclipse JDT Language Server
 *
 * Handles finding JDT LS installation, spawning the JVM process, initializing
 * the LSP session, and graceful shutdown.
 *
 * Java discovery symbols (`setJavaHome`, `detectJava`, `discoverJava`,
 * `parseJavaVersion`, `resolveJavaExecutable`) are re-exported from
 * `./java-discovery.js` (Phase 37 Plan 01 carve-out). The shim preserves the
 * existing import surface for `src/index.ts:10` and `tests/jdtls/client.test.ts:4`
 * for one milestone (per Phase 37 D-11).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { glob, globSync } from 'glob';
import { JSONRPCEndpoint, LspClient } from 'ts-lsp-client';
import { logger } from '../logging/logger.js';
import { jdtlsCandidateDirs } from '../platform/index.js';
import { pathToFileUri } from '../platform/uri.js';
import { hardenEndpoint } from './request-queue.js';

export type JdtLsFound = {
	jdtlsHome: string;
}

export type JdtLsNotFound = {
	jdtlsHome: null;
	error: string;
}

export type JdtLsFindResult = JdtLsFound | JdtLsNotFound;

export type JdtLsStartResult = {
	process: ChildProcess;
	client: LspClient;
	endpoint: JSONRPCEndpoint;
	dataDir: string;
}

export { setJavaHome, detectJava, discoverJava, parseJavaVersion, resolveJavaExecutable } from './java-discovery.js';
export type { JavaDetectResult, JavaDetected, JavaNotFound } from './java-discovery.js';

/**
 * Glob pattern matching the Equinox launcher jar shipped with every JDT LS
 * milestone. Used by both `findJdtLs` (depth probe — D-01) and `startJdtLs`
 * (defense-in-depth re-check before spawning the JVM). The literal is
 * duplicated intentionally per Phase 38 RESEARCH §"Open Questions" Q1.
 */
const LAUNCHER_GLOB = 'plugins/org.eclipse.equinox.launcher_*.jar';

/**
 * Reason a discovery slot (JDTLS_HOME or a candidate dir) was skipped.
 *
 * The three `kind` literals double as the human-readable text consumed by
 * `formatReason`, so adding a new variant requires extending the switch
 * below. Phase 38 D-03 locks this 3-variant taxonomy.
 */
type SkipReason =
	| { kind: 'not-set' }
	| { kind: 'directory does not exist' }
	| { kind: 'exists but no launcher jar in plugins/' };

/**
 * One row of the multi-line `JDT LS not found. Tried:` failure message —
 * the JDTLS_HOME slot uses `label === 'JDTLS_HOME'`; every candidate-dir
 * slot uses the bare absolute path as its label (Phase 38 D-04).
 */
type SlotRecord = { label: string; reason: SkipReason };

function formatReason(reason: SkipReason): string {
	switch (reason.kind) {
		case 'not-set':                                return '(not set)';
		case 'directory does not exist':               return 'directory does not exist';
		case 'exists but no launcher jar in plugins/': return 'exists but no launcher jar in plugins/';
	}
}

function formatSlotLine(label: string, reason: SkipReason): string {
	if (label === 'JDTLS_HOME' && reason.kind === 'not-set') {
		return 'JDTLS_HOME: (not set)';
	}
	return label + ': ' + formatReason(reason);
}

function composeFailureReason(slots: SlotRecord[]): string {
	const lines: string[] = ['JDT LS not found. Tried:'];
	for (const slot of slots) {
		lines.push('  ' + formatSlotLine(slot.label, slot.reason));
	}
	lines.push('Install JDT LS from https://download.eclipse.org/jdtls/milestones/ or set JDTLS_HOME.');
	return lines.join('\n');
}

/**
 * Find the JDT LS installation directory.
 *
 * Checks `JDTLS_HOME` first with a deep probe — the directory must exist
 * AND contain a JDT LS launcher jar under `plugins/`. A set-but-invalid
 * `JDTLS_HOME` returns a single-line error with no fall-through (D-07).
 *
 * Otherwise iterates the platform-specific candidate directories from
 * `jdtlsCandidateDirs()` with the same depth check; the first valid match
 * wins (D-01). When every slot fails the returned `error` is a multi-line
 * diagnostic listing every probed slot with its skip reason (D-02 / D-04).
 *
 * Note: `startJdtLs` re-runs the same launcher-jar glob as defense-in-depth
 * before spawning the JVM — that duplicate read is intentional.
 */
export function findJdtLs(): JdtLsFindResult {
	const slots: SlotRecord[] = [];

	const envHome = process.env.JDTLS_HOME;
	if (envHome) {
		if (!existsSync(envHome)) {
			return {
				jdtlsHome: null,
				error: `JDTLS_HOME is set to "${envHome}" but the directory does not exist.`,
			};
		}
		if (globSync(LAUNCHER_GLOB, { cwd: envHome, absolute: true }).length === 0) {
			return {
				jdtlsHome: null,
				error: `JDTLS_HOME is set to "${envHome}" but no JDT LS launcher jar was found in plugins/.`,
			};
		}
		return { jdtlsHome: envHome };
	}

	slots.push({ label: 'JDTLS_HOME', reason: { kind: 'not-set' } });

	for (const dir of jdtlsCandidateDirs()) {
		if (!existsSync(dir)) {
			logger.debug('JDT LS candidate skipped', { candidate: dir, reason: 'directory does not exist' });
			slots.push({ label: dir, reason: { kind: 'directory does not exist' } });
			continue;
		}
		if (globSync(LAUNCHER_GLOB, { cwd: dir, absolute: true }).length === 0) {
			logger.debug('JDT LS candidate skipped', { candidate: dir, reason: 'exists but no launcher jar in plugins/' });
			slots.push({ label: dir, reason: { kind: 'exists but no launcher jar in plugins/' } });
			continue;
		}
		return { jdtlsHome: dir };
	}

	return { jdtlsHome: null, error: composeFailureReason(slots) };
}

/**
 * Start a JDT LS process and initialize the LSP session.
 *
 * Spawns the JDT LS JVM with correct arguments, creates the LSP client,
 * sends initialize/initialized, and waits for readiness.
 */
export async function startJdtLs(
	javaPath: string,
	jdtlsHome: string,
	workspaceDir: string,
): Promise<JdtLsStartResult> {
	const dataDir = join(tmpdir(), 'mcp-jdtls-data-' + randomUUID());
	await mkdir(dataDir, { recursive: true });

	// Find the launcher jar
	const launcherJars = await glob('plugins/org.eclipse.equinox.launcher_*.jar', {
		cwd: jdtlsHome,
		absolute: true,
	});

	if (launcherJars.length === 0) {
		throw new Error(`JDT LS launcher jar not found in ${jdtlsHome}/plugins/`);
	}

	const launcherJar = launcherJars[0];

	// Determine platform-specific config directory
	const configName = process.platform === 'darwin'
		? 'config_mac'
		: process.platform === 'win32'
			? 'config_win'
			: 'config_linux';
	const configDir = join(jdtlsHome, configName);

	// Spawn JDT LS
	const proc = spawn(javaPath, [
		'-Declipse.application=org.eclipse.jdt.ls.core.id1',
		'-Dosgi.bundles.defaultStartLevel=4',
		'-Declipse.product=org.eclipse.jdt.ls.core.product',
		'-Xmx1G',
		'--add-modules=ALL-SYSTEM',
		'--add-opens', 'java.base/java.util=ALL-UNNAMED',
		'--add-opens', 'java.base/java.lang=ALL-UNNAMED',
		'-jar', launcherJar,
		'-configuration', configDir,
		'-data', dataDir,
	], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	const endpoint = new JSONRPCEndpoint(proc.stdin!, proc.stdout!);
	// Serialize requests and attach an 'error' listener BEFORE any send() so a
	// concurrent-response id mismatch (or a malformed message) can never crash
	// the MCP server process. See request-queue.ts for the full rationale.
	hardenEndpoint(endpoint);
	const client = new LspClient(endpoint);

	// Send initialize request
	await client.initialize({
		processId: process.pid,
		rootUri: pathToFileUri(workspaceDir),
		capabilities: {
			textDocument: {
				definition: { dynamicRegistration: false },
				references: { dynamicRegistration: false },
				documentSymbol: {
					hierarchicalDocumentSymbolSupport: true,
				},
				hover: {
					contentFormat: ['markdown', 'plaintext'],
				},
				implementation: { dynamicRegistration: false },
				// JDT LS supports typeHierarchy but it's not in the LSP 3.17 types yet
				...{ typeHierarchy: { dynamicRegistration: false } },
			},
			workspace: {
				symbol: { dynamicRegistration: false },
			},
		},
		initializationOptions: {
			settings: {
				java: {
					autobuild: { enabled: true },
					symbols: {
						includeSourceMethodDeclarations: true,
					},
					import: {
						maven: { enabled: false },
						gradle: { enabled: false },
					},
				},
			},
		},
		workspaceFolders: [{ uri: pathToFileUri(workspaceDir), name: 'sources' }],
	});

	// Send initialized notification
	client.initialized();

	// Log stderr for debugging
	proc.stderr!.on('data', (chunk: Buffer) => {
		logger.debug('JDT LS stderr', { data: chunk.toString().trimEnd() });
	});

	// Wait for JDT LS readiness: listen for language/status with ServiceReady
	await waitForReady(endpoint, 120_000);

	return { process: proc, client, endpoint, dataDir };
}

/**
 * Wait for JDT LS to become ready by listening for "ServiceReady" in
 * language/status notifications.
 */
async function waitForReady(endpoint: JSONRPCEndpoint, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			endpoint.removeListener('language/status', handler);
			reject(new Error(`JDT LS did not become ready within ${timeoutMs}ms`));
		}, timeoutMs);

		function handler(params: any): void {
			logger.debug('JDT LS language/status', { params });

			const message = typeof params === 'object' && params !== null
				? (params.message ?? params.type ?? '')
				: String(params);

			if (String(message).includes('ServiceReady') || String(params?.type).includes('Started')) {
				clearTimeout(timeout);
				endpoint.removeListener('language/status', handler);
				resolve();
			}
		}

		endpoint.on('language/status', handler);
	});
}

/**
 * Gracefully shut down a JDT LS process.
 *
 * Sends shutdown request and exit notification, then force-kills if needed.
 */
export async function shutdownJdtLs(client: LspClient, proc: ChildProcess): Promise<void> {
	try {
		await client.shutdown();
		client.exit();
	} catch {
		// Ignore errors during shutdown
	}

	// Wait up to 5 seconds for process exit
	if (!proc.killed && proc.exitCode === null) {
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				proc.kill('SIGKILL');
				resolve();
			}, 5_000);

			proc.once('exit', () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}
}
