/**
 * JDT LS Startup — Session initialization with graceful degradation
 *
 * Creates a JDT LS session by detecting Java, finding JDT LS, creating a temp
 * workspace with .project/.classpath files, and starting the JDT LS process.
 * Returns a degraded session when Java or JDT LS is unavailable.
 */

import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { detectJava, findJdtLs, startJdtLs } from './client.js';
import { generateClasspathFile, generateProjectFile } from './workspace.js';
import type { JdtLsSession } from './types.js';
import { logger } from '../logging/logger.js';

/**
 * Initialize a JDT LS session with graceful degradation.
 *
 * Detects Java 21+, finds JDT LS installation, creates a temp workspace with
 * .project and empty .classpath, then starts JDT LS. If any step fails, returns
 * a session with available=false and a descriptive failureReason.
 *
 * The returned session monitors the JDT LS process: if it exits with a non-zero
 * code, available is set to false so navigation tools degrade gracefully.
 */
export async function initJdtLsSession(): Promise<JdtLsSession> {
	const java = detectJava();

	if (!java.javaPath) {
		return {
			available: false,
			failureReason: java.error,
			tempDir: '',
			dataDir: '',
			jarIdToDirName: new Map(),
		};
	}

	const jdtlsFind = findJdtLs();

	if (!jdtlsFind.jdtlsHome) {
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
