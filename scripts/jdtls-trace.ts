/**
 * scripts/jdtls-trace.ts
 *
 * Direct-trace diagnostic for Phase 39 Plan 04. Bypasses MCP stdio and pokes
 * JDT LS step by step so the no-find_definition failure surfaced by the
 * matrix-row harness can be isolated to a specific phase (LSP request,
 * workspace sync, classpath rebuild, didOpen, etc).
 *
 * Not part of the production server. Lives outside src/** per CONTEXT.md
 * carve-out.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { discoverJava, findJdtLs, startJdtLs } from '../src/jdtls/client.js';
import { syncFabricModToWorkspace } from '../src/jdtls/workspace-sync.js';
import { loadFabricMod } from '../src/project/loader.js';
import { jarReader } from '../src/tools/shared-jar-reader.js';
import { generateClasspathFile, generateProjectFile } from '../src/jdtls/workspace.js';
import { pathToFileUri } from '../src/platform/uri.js';
import { logger } from '../src/logging/logger.js';

logger.setLevel('debug');

const MOD_ROOT = 'C:\\Users\\LoganDark\\Downloads\\fabric-mod';

function banner(msg: string): void {
	console.error('\n========================================');
	console.error(msg);
	console.error('========================================');
}

async function tailJdtlsLog(dataDir: string, label: string): Promise<void> {
	const logPath = join(dataDir, '.metadata', '.log');
	try {
		const content = await readFile(logPath, 'utf-8');
		const lines = content.split('\n');
		console.error(`[${label}] JDT LS log (last 25 lines of ${lines.length}):`);
		for (const line of lines.slice(-25)) console.error('  ' + line);
	} catch (err) {
		console.error(`[${label}] JDT LS log not available: ${String(err)}`);
	}
}

async function main(): Promise<void> {
	banner('Phase 1 — discoverJava');
	const java = await discoverJava();
	console.error('java:', JSON.stringify(java, null, 2));
	if (java.javaPath === null) { process.exit(1); }

	banner('Phase 2 — findJdtLs');
	const jdtlsHome = findJdtLs();
	console.error('findJdtLs:', JSON.stringify(jdtlsHome, null, 2));
	if (jdtlsHome.jdtlsHome === null) { process.exit(1); }

	banner('Phase 3 — startJdtLs (empty workspace)');
	const tempDir = join(tmpdir(), 'jdtls-trace-' + randomUUID());
	await mkdir(tempDir, { recursive: true });
	await writeFile(join(tempDir, '.project'), generateProjectFile());
	await writeFile(join(tempDir, '.classpath'), generateClasspathFile([]));
	console.error('tempDir:', tempDir);
	const t0 = Date.now();
	const session = await startJdtLs(java.javaPath, jdtlsHome.jdtlsHome, tempDir);
	console.error(`JDT LS ready in ${Date.now() - t0}ms; dataDir=${session.dataDir}`);
	const sess = {
		available: true as const,
		tempDir,
		dataDir: session.dataDir,
		jarIdToDirName: new Map<string, string>(),
		client: session.client,
		endpoint: session.endpoint,
		process: session.process,
	};

	await sleep(2000);
	await tailJdtlsLog(session.dataDir, 'after-startup');

	banner('Phase 4 — loadFabricMod');
	jarReader.registerProject('matrix', new Set());
	const mod = await loadFabricMod(MOD_ROOT);
	console.error('mod:', JSON.stringify({
		name: mod.name,
		deps: mod.dependencyJars.size,
		sourcesJarExists: mod.sourcesJar.exists,
		sourcesJarPath: mod.sourcesJar.path,
	}, null, 2));
	for (const entry of mod.dependencyJars.values()) {
		if (entry.sourcesJarPath) jarReader.addProjectJar('matrix', entry.sourcesJarPath);
	}
	if (mod.sourcesJar.exists) jarReader.addProjectJar('matrix', mod.sourcesJar.path);

	banner('Phase 5 — syncFabricModToWorkspace');
	const syncResult = await syncFabricModToWorkspace(mod, sess, jarReader);
	console.error('syncResult:', syncResult);
	const cpAfter = await readFile(join(tempDir, '.classpath'), 'utf-8');
	console.error('.classpath after sync:\n' + cpAfter);
	const top = await readdir(tempDir);
	console.error('tempDir top:', top);
	const templateDir = sess.jarIdToDirName.get('template');
	const mcDir = sess.jarIdToDirName.get('template/minecraft');
	console.error(`mapped dirs: template=${templateDir} template/minecraft=${mcDir}`);
	if (templateDir) {
		const tpl = await readdir(join(tempDir, templateDir), { recursive: true });
		console.error(`template dir top 20 entries:`, tpl.slice(0, 20));
	}
	if (mcDir) {
		const mc = await readdir(join(tempDir, mcDir));
		console.error(`minecraft dir count:`, mc.length, 'top 10:', mc.slice(0, 10));
		const mcResources = join(tempDir, mcDir, 'net', 'minecraft', 'resources');
		try {
			const r = await readdir(mcResources);
			const idFile = r.find(f => f === 'Identifier.java');
			console.error('Identifier.java present in workspace:', idFile === 'Identifier.java');
		} catch {
			console.error('net/minecraft/resources not found in extracted dir');
		}
	}

	banner('Phase 6 — wait 5s, tail JDT LS log');
	await sleep(5000);
	await tailJdtlsLog(session.dataDir, 'after-sync-5s');

	banner('Phase 7 — textDocument/didOpen for template file');
	const templateFile = templateDir
		? join(tempDir, templateDir, 'TEMPLATE_PACKAGE', 'TEMPLATE_CLASSNAME.java')
		: '';
	if (!templateFile) { console.error('NO TEMPLATE FILE'); process.exit(1); }
	const exists = await stat(templateFile).then(() => true, () => false);
	console.error(`templateFile=${templateFile} exists=${exists}`);
	if (!exists) { process.exit(1); }
	const templateText = await readFile(templateFile, 'utf-8');
	const templateUri = pathToFileUri(templateFile);
	console.error('templateUri:', templateUri);
	console.error('templateText preview:\n' + templateText.split('\n').slice(0, 14).map((l, i) => `${i + 1}: ${l}`).join('\n'));

	await session.client.didOpen({
		textDocument: { uri: templateUri, languageId: 'java', version: 1, text: templateText },
	});
	console.error('didOpen sent');

	banner('Phase 8 — wait 10s, then textDocument/definition at line 11 col 22');
	await sleep(10000);
	await tailJdtlsLog(session.dataDir, 'after-didopen-10s');
	let defResult;
	try {
		defResult = await session.client.definition({
			textDocument: { uri: templateUri },
			position: { line: 10, character: 21 },
		});
		console.error('definition #1:', JSON.stringify(defResult));
	} catch (err) {
		console.error('definition #1 failed:', String(err));
	}

	banner('Phase 9 — workspace/symbol "Identifier"');
	try {
		const symResult = await session.endpoint.send('workspace/symbol', { query: 'Identifier' });
		const arr = Array.isArray(symResult) ? symResult : [symResult];
		console.error(`workspace/symbol returned ${arr.length} items; first 5:`);
		for (const s of arr.slice(0, 5)) console.error('  ' + JSON.stringify(s));
	} catch (err) {
		console.error('workspace/symbol failed:', String(err));
	}

	banner('Phase 10 — workspace/executeCommand java.project.updateClassPaths');
	try {
		const wsUri = pathToFileUri(tempDir);
		console.error('wsUri:', wsUri);
		const cpResult = await session.endpoint.send('workspace/executeCommand', {
			command: 'java.project.updateClassPaths',
			arguments: [wsUri],
		});
		console.error('updateClassPaths result:', JSON.stringify(cpResult));
	} catch (err) {
		console.error('updateClassPaths failed:', String(err));
	}

	banner('Phase 11 — wait 20s, tail JDT LS log');
	await sleep(20000);
	await tailJdtlsLog(session.dataDir, 'after-updateClassPaths-20s');

	banner('Phase 12 — definition #2');
	try {
		const def2 = await session.client.definition({
			textDocument: { uri: templateUri },
			position: { line: 10, character: 21 },
		});
		console.error('definition #2:', JSON.stringify(def2));
	} catch (err) {
		console.error('definition #2 failed:', String(err));
	}

	banner('Phase 13 — workspace/symbol "Identifier" #2');
	try {
		const symResult2 = await session.endpoint.send('workspace/symbol', { query: 'Identifier' });
		const arr = Array.isArray(symResult2) ? symResult2 : [symResult2];
		console.error(`workspace/symbol #2 returned ${arr.length} items; first 5:`);
		for (const s of arr.slice(0, 5)) console.error('  ' + JSON.stringify(s));
	} catch (err) {
		console.error('workspace/symbol #2 failed:', String(err));
	}

	banner('Cleanup');
	try {
		await session.client.shutdown();
		session.client.exit();
	} catch {}
	process.exit(0);
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
