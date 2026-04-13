/**
 * JDT LS Client — Process lifecycle management for Eclipse JDT Language Server
 *
 * Handles detecting Java 21+, finding JDT LS installation, spawning the JVM process,
 * initializing the LSP session, and graceful shutdown.
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { glob } from 'glob';
import { JSONRPCEndpoint, LspClient } from 'ts-lsp-client';

export interface JavaDetected {
	javaPath: string;
	version: number;
}

export interface JavaNotFound {
	javaPath: null;
	error: string;
}

export type JavaDetectResult = JavaDetected | JavaNotFound;

export interface JdtLsFound {
	jdtlsHome: string;
}

export interface JdtLsNotFound {
	jdtlsHome: null;
	error: string;
}

export type JdtLsFindResult = JdtLsFound | JdtLsNotFound;

export interface JdtLsStartResult {
	process: ChildProcess;
	client: LspClient;
	endpoint: JSONRPCEndpoint;
	dataDir: string;
}

/**
 * Detect a Java 21+ installation.
 *
 * Checks JAVA_HOME first, then falls back to java on PATH.
 * Returns the java binary path and major version, or an error message.
 */
export function detectJava(): JavaDetectResult {
	const candidates: string[] = [];

	if (process.env.JAVA_HOME) {
		candidates.push(join(process.env.JAVA_HOME, 'bin', 'java'));
	}
	candidates.push('java');

	for (const javaPath of candidates) {
		try {
			const output = execSync(`"${javaPath}" --version`, {
				encoding: 'utf-8',
				timeout: 10_000,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			const version = parseJavaVersion(output);
			if (version === null) {
				continue;
			}

			if (version < 21) {
				return {
					javaPath: null,
					error: `Java ${version} found but JDT LS requires Java 21+`,
				};
			}

			return { javaPath, version };
		} catch {
			continue;
		}
	}

	return {
		javaPath: null,
		error: 'Java not found. Set JAVA_HOME or add java to PATH.',
	};
}

/**
 * Parse the major version number from `java --version` output.
 * Handles formats like "openjdk 21.0.1 2023-10-17" and "java 21 2023-09-19".
 */
export function parseJavaVersion(output: string): number | null {
	// Match version patterns like "21.0.1", "17.0.8", "1.8.0_381"
	const match = output.match(/(?:version\s+")?([\d]+)(?:\.([\d]+))?/);
	if (!match) return null;

	const major = parseInt(match[1], 10);
	// Handle legacy 1.x versioning (1.8 = Java 8)
	if (major === 1 && match[2]) {
		return parseInt(match[2], 10);
	}
	return major;
}

/**
 * Find the JDT LS installation directory.
 *
 * Checks JDTLS_HOME first, then common install locations.
 */
export function findJdtLs(): JdtLsFindResult {
	if (process.env.JDTLS_HOME) {
		if (existsSync(process.env.JDTLS_HOME)) {
			return { jdtlsHome: process.env.JDTLS_HOME };
		}
		return {
			jdtlsHome: null,
			error: `JDTLS_HOME is set to "${process.env.JDTLS_HOME}" but the directory does not exist.`,
		};
	}

	const home = process.env.HOME ?? '';
	const commonLocations = [
		join(home, '.local', 'share', 'jdtls'),
		'/usr/local/share/jdtls',
		join(home, 'jdtls'),
	];

	for (const loc of commonLocations) {
		if (existsSync(loc)) {
			return { jdtlsHome: loc };
		}
	}

	return {
		jdtlsHome: null,
		error: 'JDT LS not found. Set JDTLS_HOME environment variable. Download from https://download.eclipse.org/jdtls/milestones/',
	};
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
	const client = new LspClient(endpoint);

	// Send initialize request
	await client.initialize({
		processId: process.pid,
		rootUri: 'file://' + workspaceDir,
		capabilities: {
			textDocument: {
				definition: { dynamicRegistration: false },
				references: { dynamicRegistration: false },
			},
		},
		initializationOptions: {
			settings: {
				java: {
					autobuild: { enabled: true },
					import: {
						maven: { enabled: false },
						gradle: { enabled: false },
					},
				},
			},
		},
		workspaceFolders: [{ uri: 'file://' + workspaceDir, name: 'sources' }],
	});

	// Send initialized notification
	client.initialized();

	// Wait for JDT LS readiness: listen for language/status with ServiceReady
	await waitForReady(endpoint, 60_000);

	return { process: proc, client, endpoint, dataDir };
}

/**
 * Wait for JDT LS to become ready by listening for "ServiceReady" in
 * language/status notifications.
 */
async function waitForReady(endpoint: JSONRPCEndpoint, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			endpoint.removeListener('notification:language/status', handler);
			reject(new Error(`JDT LS did not become ready within ${timeoutMs}ms`));
		}, timeoutMs);

		function handler(params: any): void {
			const message = typeof params === 'object' && params !== null
				? (params.message ?? params.type ?? '')
				: String(params);

			if (String(message).includes('ServiceReady') || String(params?.type).includes('Started')) {
				clearTimeout(timeout);
				endpoint.removeListener('notification:language/status', handler);
				resolve();
			}
		}

		endpoint.on('notification:language/status', handler);
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
