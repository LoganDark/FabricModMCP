#!/usr/bin/env tsx
/**
 * Diagnostic script for list-members-only-two debug session.
 *
 * Spawns JDT LS against an existing extracted workspace, opens a target
 * .java file, runs documentSymbol, and dumps the raw response.
 *
 * Usage:
 *   tsx scripts/diagnose-list-members.ts <workspace-dir> <subdir-name> <relative-java-path>
 *
 * Example:
 *   tsx scripts/diagnose-list-members.ts \
 *     /var/folders/.../mcp-jdtls-575fec1c-... \
 *     lifesteal--minecraft \
 *     net/minecraft/server/players/StoredUserEntry.java
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { JSONRPCEndpoint, LspClient } from 'ts-lsp-client';
import { pathToFileUri } from '../src/platform/uri.js';

async function main() {
	const [workspaceDir, subdir, relPath] = process.argv.slice(2);
	if (!workspaceDir || !subdir || !relPath) {
		console.error('Usage: tsx diagnose-list-members.ts <workspace-dir> <subdir-name> <relative-java-path>');
		process.exit(2);
	}

	const jdtlsHome = join(homedir(), 'jdtls');
	const launcherJar = (await import('node:fs/promises'))
		.readdir(join(jdtlsHome, 'plugins'))
		.then(files => files.find(f => f.startsWith('org.eclipse.equinox.launcher_') && f.endsWith('.jar')));
	const launcherName = await launcherJar;
	if (!launcherName) throw new Error('No launcher jar');
	const launcherPath = join(jdtlsHome, 'plugins', launcherName);

	const configDir = join(jdtlsHome, 'config_mac');
	const dataDir = `${workspaceDir}-diag-data`;
	await (await import('node:fs/promises')).mkdir(dataDir, { recursive: true });

	console.error('[diag] launcher:', launcherPath);
	console.error('[diag] workspace:', workspaceDir);
	console.error('[diag] data:', dataDir);

	const proc = spawn('java', [
		'-Declipse.application=org.eclipse.jdt.ls.core.id1',
		'-Dosgi.bundles.defaultStartLevel=4',
		'-Declipse.product=org.eclipse.jdt.ls.core.product',
		'-Xmx1G',
		'--add-modules=ALL-SYSTEM',
		'--add-opens', 'java.base/java.util=ALL-UNNAMED',
		'--add-opens', 'java.base/java.lang=ALL-UNNAMED',
		'-jar', launcherPath,
		'-configuration', configDir,
		'-data', dataDir,
	], { stdio: ['pipe', 'pipe', 'pipe'] });

	proc.stderr.on('data', d => console.error('[jdtls stderr]', d.toString().trimEnd()));

	const endpoint = new JSONRPCEndpoint(proc.stdin, proc.stdout);
	const client = new LspClient(endpoint);

	endpoint.on('language/status', (params: any) => {
		console.error('[jdtls language/status]', JSON.stringify(params));
	});

	console.error('[diag] initialize…');
	await client.initialize({
		processId: process.pid,
		rootUri: pathToFileUri(workspaceDir),
		capabilities: {
			textDocument: {
				definition: { dynamicRegistration: false },
				references: { dynamicRegistration: false },
				documentSymbol: { hierarchicalDocumentSymbolSupport: true },
				hover: { contentFormat: ['markdown', 'plaintext'] },
				implementation: { dynamicRegistration: false },
				...{ typeHierarchy: { dynamicRegistration: false } },
			} as any,
			workspace: { symbol: { dynamicRegistration: false } },
		},
		initializationOptions: {
			settings: {
				java: {
					autobuild: { enabled: true },
					symbols: { includeSourceMethodDeclarations: true },
					import: { maven: { enabled: false }, gradle: { enabled: false } },
				},
			},
		},
		workspaceFolders: [{ uri: pathToFileUri(workspaceDir), name: 'sources' }],
	});
	client.initialized();

	console.error('[diag] waiting for ServiceReady (or 60s)…');
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('ServiceReady timeout')), 60000);
		endpoint.on('language/status', (params: any) => {
			const msg = params?.message ?? params?.type ?? '';
			if (String(msg).includes('ServiceReady') || String(params?.type).includes('Started')) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
	console.error('[diag] ready');

	const filePath = join(workspaceDir, subdir, relPath);
	const sourceText = await readFile(filePath, 'utf-8');
	const fileUri = pathToFileUri(filePath);
	console.error('[diag] file uri:', fileUri);
	console.error('[diag] source length:', sourceText.length);

	// Test 1: documentSymbol immediately
	console.error('\n=== TEST 1: documentSymbol immediately after didOpen ===');
	await client.didOpen({ textDocument: { uri: fileUri, languageId: 'java', version: 1, text: sourceText } });
	const result1 = await client.documentSymbol({ textDocument: { uri: fileUri } });
	console.error('result type:', Array.isArray(result1) ? `array(len=${result1.length})` : typeof result1);
	console.log(JSON.stringify(result1, null, 2));
	await client.didClose({ textDocument: { uri: fileUri } });

	// Test 2: documentSymbol after 2s wait
	console.error('\n=== TEST 2: documentSymbol after didOpen + 2s wait ===');
	await client.didOpen({ textDocument: { uri: fileUri, languageId: 'java', version: 2, text: sourceText } });
	await new Promise(r => setTimeout(r, 2000));
	const result2 = await client.documentSymbol({ textDocument: { uri: fileUri } });
	console.error('result type:', Array.isArray(result2) ? `array(len=${result2.length})` : typeof result2);
	console.log(JSON.stringify(result2, null, 2));
	await client.didClose({ textDocument: { uri: fileUri } });

	// Test 3: documentSymbol again (third call) immediately
	console.error('\n=== TEST 3: documentSymbol immediately, third open ===');
	await client.didOpen({ textDocument: { uri: fileUri, languageId: 'java', version: 3, text: sourceText } });
	const result3 = await client.documentSymbol({ textDocument: { uri: fileUri } });
	console.error('result type:', Array.isArray(result3) ? `array(len=${result3.length})` : typeof result3);
	console.log(JSON.stringify(result3, null, 2));
	await client.didClose({ textDocument: { uri: fileUri } });

	try { await client.shutdown(); } catch {}
	proc.kill('SIGTERM');
	process.exit(0);
}

main().catch(err => {
	console.error('[diag] error:', err);
	process.exit(1);
});
