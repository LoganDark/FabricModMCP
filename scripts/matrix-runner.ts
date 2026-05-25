/**
 * scripts/matrix-runner.ts
 *
 * Phase 39 Plan 04 matrix executor. Bypasses the MCP stdio layer (which has a
 * race documented in this run's REVIEW: withLspDocument fires definition
 * immediately after didOpen, before JDT LS validates the file — on Windows
 * the race wins and definition returns empty).
 *
 * Each row directly drives FabricModMCP's domain modules + raw LSP requests:
 *   1. setJavaHome (slot 1) / mutate gradle.properties (slot 2) / env (slot 3/4)
 *   2. discoverJava with projectRoot — captures javaPath per slot
 *   3. findJdtLs
 *   4. startJdtLs (fresh tempDir/dataDir per row)
 *   5. loadFabricMod + syncFabricModToWorkspace
 *   6. didOpen template file
 *   7. wait for JDT LS validation (~12-15s on Windows; trace proved 10s works)
 *   8. textDocument/definition for Identifier — capture target URI
 *   9. textDocument/references for Identifier class declaration in MC sources — capture refs
 *  10. shutdown session, restore env/properties, log to row result
 *
 * Each row records: slot label, attempted javaPath (env/property/flag passed),
 * captured javaPath (from JDT LS spawn argv), find_definition success + target
 * URI, find_references success + sample URIs.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, copyFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { setJavaHome, discoverJava, findJdtLs, startJdtLs } from '../src/jdtls/client.js';
import { syncFabricModToWorkspace } from '../src/jdtls/workspace-sync.js';
import { loadFabricMod } from '../src/project/loader.js';
import { jarReader } from '../src/tools/shared-jar-reader.js';
import { generateClasspathFile, generateProjectFile } from '../src/jdtls/workspace.js';
import { pathToFileUri } from '../src/platform/uri.js';
import { logger } from '../src/logging/logger.js';

logger.setLevel('warn');

const MOD_ROOT = 'C:\\Users\\LoganDark\\Downloads\\fabric-mod';
const PROPS_PATH = join(MOD_ROOT, 'gradle.properties');
const PROPS_BACKUP = PROPS_PATH + '.matrix-backup';

const JDK_21 = 'C:\\Program Files\\Java\\jdk-21.0.11';
const JDK_25 = 'C:\\Program Files\\Java\\jdk-25.0.3';
const JDK_26 = 'C:\\Program Files\\Java\\jdk-26.0.1';

type RowConfig = {
	row: 1 | 2 | 3 | 4;
	slot: string;
	intendedJdk: string;
	configure: () => Promise<void>;
	teardown: () => Promise<void>;
};

type RowResult = {
	row: number;
	slot: string;
	intendedJdk: string;
	javaPath: string | null;
	javaVersion: number | null;
	jdtlsSpawnArgv0: string | null;
	jdtlsHome: string | null;
	definition: { target: string; line: number } | null;
	references: { count: number; sampleUris: string[] } | null;
	classpath: string;
	error: string | null;
};

const ORIG_JAVA_HOME = process.env.JAVA_HOME;
const ORIG_PATH = process.env.Path ?? process.env.PATH ?? '';

function restoreEnv(): void {
	if (ORIG_JAVA_HOME === undefined) delete process.env.JAVA_HOME;
	else process.env.JAVA_HOME = ORIG_JAVA_HOME;
	process.env.Path = ORIG_PATH;
	process.env.PATH = ORIG_PATH;
}

function clearJavaFromPath(): void {
	// Filter PATH entries by directory-segment match, not a naive substring.
	// The original `.includes('java')` also removed unrelated entries like
	// `C:\Tools\JavaScript-utils\bin` or any `Javadoc` / `Javascript` dirs,
	// perturbing subprocesses the matrix expected to find on PATH (WR-03).
	//
	// An entry is considered a Java entry if any path segment is exactly
	// `java` / `jre`, or starts with `jdk-` / `jdk_` / `jre-` / `jre_`
	// (the common installer-layout names). Substring-only-because matches
	// like `JavaScript` no longer trigger.
	const filtered = ORIG_PATH.split(';').filter(p => {
		const segs = p.toLowerCase().split(/[\\/]+/).filter(s => s.length > 0);
		for (const s of segs) {
			if (s === 'java' || s === 'jre') return false;
			if (/^jdk[-_]/.test(s) || /^jre[-_]/.test(s)) return false;
		}
		return true;
	}).join(';');
	process.env.Path = filtered;
	process.env.PATH = filtered;
}

async function snapshotJdtlsArgv(): Promise<string | null> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const execAsync = promisify(execFile);
	try {
		const { stdout } = await execAsync('powershell.exe', [
			'-NoProfile', '-Command',
			"$p = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*org.eclipse.equinox.launcher*' } | Where-Object { $_.CommandLine -notlike '*powershell*' } | Select-Object -Property CommandLine -First 1); if ($p.Count -eq 0) { '' } else { $p[0].CommandLine }",
		], { timeout: 8_000, maxBuffer: 2 * 1024 * 1024 });
		const line = stdout.trim();
		if (!line) return null;
		if (line.startsWith('"')) {
			const end = line.indexOf('"', 1);
			if (end > 0) return line.slice(1, end);
		}
		const space = line.indexOf(' ');
		return space > 0 ? line.slice(0, space) : line;
	} catch {
		return null;
	}
}

function setGradleProperty(name: string, value: string): void {
	const content = readFileSync(PROPS_PATH, 'utf-8');
	const lines = content.split(/\r?\n/);
	const re = new RegExp('^\\s*' + name.replace(/\./g, '\\.') + '\\s*=');
	let found = false;
	for (let i = 0; i < lines.length; i++) {
		if (re.test(lines[i])) {
			lines[i] = `${name}=${value}`;
			found = true;
			break;
		}
	}
	if (!found) lines.push(`${name}=${value}`);
	writeFileSync(PROPS_PATH, lines.join('\n'));
}

async function runRow(cfg: RowConfig): Promise<RowResult> {
	const result: RowResult = {
		row: cfg.row,
		slot: cfg.slot,
		intendedJdk: cfg.intendedJdk,
		javaPath: null, javaVersion: null,
		jdtlsSpawnArgv0: null, jdtlsHome: null,
		definition: null, references: null,
		classpath: '',
		error: null,
	};

	process.stderr.write(`\n=== Row ${cfg.row} — ${cfg.slot} ===\n`);
	try {
		await cfg.configure();

		// discoverJava with projectRoot — slot 2 path lookup engages here.
		const java = await discoverJava({ projectRoot: MOD_ROOT });
		if (java.javaPath === null) throw new Error('discoverJava failed: ' + java.error);
		result.javaPath = java.javaPath;
		result.javaVersion = java.version;
		process.stderr.write(`  javaPath: ${java.javaPath} (Java ${java.version})\n`);

		const jdtlsFind = findJdtLs();
		if (jdtlsFind.jdtlsHome === null) throw new Error('findJdtLs failed: ' + jdtlsFind.error);
		result.jdtlsHome = jdtlsFind.jdtlsHome;

		const tempDir = join(tmpdir(), `matrix-row${cfg.row}-` + randomUUID());
		await mkdir(tempDir, { recursive: true });
		await writeFile(join(tempDir, '.project'), generateProjectFile());
		await writeFile(join(tempDir, '.classpath'), generateClasspathFile([]));

		const t0 = Date.now();
		const session = await startJdtLs(java.javaPath, jdtlsFind.jdtlsHome, tempDir);
		process.stderr.write(`  JDT LS ready in ${Date.now() - t0}ms\n`);

		// Snapshot JDT LS argv now that it's spawned
		result.jdtlsSpawnArgv0 = await snapshotJdtlsArgv();

		const sess = {
			available: true as const,
			tempDir, dataDir: session.dataDir,
			jarIdToDirName: new Map<string, string>(),
			client: session.client, endpoint: session.endpoint, process: session.process,
		};

		// Need a fresh jarReader project registration per row
		jarReader.registerProject(`row${cfg.row}`, new Set());
		const mod = await loadFabricMod(MOD_ROOT);
		for (const entry of mod.dependencyJars.values()) {
			if (entry.sourcesJarPath) jarReader.addProjectJar(`row${cfg.row}`, entry.sourcesJarPath);
		}
		if (mod.sourcesJar.exists) jarReader.addProjectJar(`row${cfg.row}`, mod.sourcesJar.path);

		const syncRes = await syncFabricModToWorkspace(mod, sess, jarReader);
		if (!syncRes.synced) throw new Error('sync failed: ' + syncRes.warning);

		result.classpath = await readFile(join(tempDir, '.classpath'), 'utf-8');

		const templateDir = sess.jarIdToDirName.get('template');
		const mcDir = sess.jarIdToDirName.get('template/minecraft');
		if (!templateDir || !mcDir) throw new Error('jarIdToDirName missing template or minecraft');

		const templateFile = join(tempDir, templateDir, 'TEMPLATE_PACKAGE', 'TEMPLATE_CLASSNAME.java');
		const templateText = await readFile(templateFile, 'utf-8');
		const templateUri = pathToFileUri(templateFile);

		const identifierFile = join(tempDir, mcDir, 'net', 'minecraft', 'resources', 'Identifier.java');
		const identifierText = await readFile(identifierFile, 'utf-8');
		const identifierUri = pathToFileUri(identifierFile);

		// Phase: didOpen template + wait for JDT LS validation
		// (jdtls-trace observed reconcile completing 10-14s after didOpen on this
		// Windows host; matrix-runner's 12s wait was sometimes too short)
		await session.client.didOpen({
			textDocument: { uri: templateUri, languageId: 'java', version: 1, text: templateText },
		});
		process.stderr.write(`  didOpen template, waiting 25s for JDT LS validation...\n`);
		await sleep(25_000);

		// definition for Identifier (line 11 col 22 → 0-based line 10 col 21)
		//
		// Use an AbortController so the 30s timeout timer is cancelable when
		// the definition resolves first. Without this, the underlying timer
		// stayed active for the full 30s after each row, keeping the process
		// alive 2+ extra minutes across the 4-row matrix and emitting a late
		// 'TIMEOUT' resolution that could confuse downstream logic (WR-02).
		const ac = new AbortController();
		try {
			const defResult = await Promise.race([
				session.client.definition({
					textDocument: { uri: templateUri },
					position: { line: 10, character: 21 },
				}),
				sleep(30_000, undefined, { signal: ac.signal })
					.then(() => 'TIMEOUT' as const)
					.catch(() => 'ABORTED' as const),
			]);
			ac.abort();
			if (defResult === 'TIMEOUT') {
				process.stderr.write(`  definition: TIMED OUT after 30s\n`);
			} else if (defResult === 'ABORTED') {
				// Sleep was aborted before resolving — unreachable in practice
				// because we only abort AFTER the race resolves.
				process.stderr.write(`  definition: timer aborted (unreachable)\n`);
			} else {
				const arr = Array.isArray(defResult) ? defResult : (defResult ? [defResult] : []);
				if (arr.length > 0) {
					result.definition = {
						target: (arr[0] as { uri: string }).uri,
						line: ((arr[0] as { range?: { start?: { line?: number } } }).range?.start?.line ?? -1) + 1,
					};
					process.stderr.write(`  definition: ${result.definition.target.split('/').slice(-3).join('/')}#L${result.definition.line}\n`);
				} else {
					process.stderr.write(`  definition: 0 results (after 25s settle)\n`);
				}
			}
		} catch (err) {
			ac.abort();
			process.stderr.write(`  definition failed: ${String(err)}\n`);
		}

		// references skipped — Identifier has 6000+ usages in MC, scanning all of them
		// is prohibitively slow and JDT LS doesn't support cancellation here. Falling
		// back to definition-only as cross-jar evidence per the verification doc note.
		// identifierText/identifierUri are loaded above but unused in this run.
		void identifierText; void identifierUri;

		// Hard kill — graceful shutdown waits behind queued LSP requests.
		try { session.process.kill('SIGKILL'); } catch {}
	} catch (err) {
		result.error = String(err);
		process.stderr.write(`  ERROR: ${result.error}\n`);
	} finally {
		try { await cfg.teardown(); } catch {}
		try { await jarReader.closeProject(`row${cfg.row}`); } catch {}
	}
	return result;
}

const rows: RowConfig[] = [
	{
		row: 1, slot: '--java-home', intendedJdk: JDK_21,
		configure: async () => {
			delete process.env.JAVA_HOME;
			process.env.Path = ORIG_PATH;
			process.env.PATH = ORIG_PATH;
			setJavaHome(JDK_21);
		},
		teardown: async () => { setJavaHome(undefined); restoreEnv(); },
	},
	{
		row: 2, slot: 'org.gradle.java.home', intendedJdk: JDK_25,
		configure: async () => {
			setJavaHome(undefined);
			delete process.env.JAVA_HOME;
			clearJavaFromPath();
			await copyFile(PROPS_PATH, PROPS_BACKUP);
			setGradleProperty('org.gradle.java.home', JDK_25.replace(/\\/g, '\\\\'));
		},
		teardown: async () => {
			if (existsSync(PROPS_BACKUP)) {
				await copyFile(PROPS_BACKUP, PROPS_PATH);
				await unlink(PROPS_BACKUP);
			}
			restoreEnv();
		},
	},
	{
		row: 3, slot: 'JAVA_HOME', intendedJdk: JDK_26,
		configure: async () => {
			setJavaHome(undefined);
			process.env.JAVA_HOME = JDK_26;
			process.env.Path = ORIG_PATH;
			process.env.PATH = ORIG_PATH;
		},
		teardown: async () => { restoreEnv(); },
	},
	{
		row: 4, slot: 'PATH only', intendedJdk: 'whatever PATH resolves to',
		configure: async () => {
			setJavaHome(undefined);
			delete process.env.JAVA_HOME;
			process.env.Path = ORIG_PATH;
			process.env.PATH = ORIG_PATH;
		},
		teardown: async () => { restoreEnv(); },
	},
];

async function main(): Promise<void> {
	const results: RowResult[] = [];
	for (const cfg of rows) {
		const r = await runRow(cfg);
		results.push(r);
	}
	console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
