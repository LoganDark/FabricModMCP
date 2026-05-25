/**
 * scripts/matrix-row.ts
 *
 * Single-row driver for the Phase 39 Plan 04 Windows 4-row Java-discovery matrix.
 * Spawns the FabricModMCP server over stdio with a row-specific env/CLI config,
 * runs the happy-path tool sequence (create_project → add_fabric_mod →
 * find_definition → find_references), and prints a JSON result blob.
 *
 * Usage: tsx scripts/matrix-row.ts '<config-json>'
 *
 * Not part of the shipped server. Intentionally outside src/** so the executor
 * carve-out in CONTEXT.md (Files this phase MUST NOT modify: src/**) holds.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);

function inspectWorkspaces(): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	let entries: string[] = [];
	try { entries = readdirSync(tmpdir()); } catch { return out; }
	for (const entry of entries) {
		if (!entry.startsWith('mcp-jdtls-') || entry.startsWith('mcp-jdtls-data-')) continue;
		const ws = join(tmpdir(), entry);
		try {
			const st = statSync(ws);
			if (!st.isDirectory()) continue;
			const info: Record<string, unknown> = {
				path: ws,
				mtime: st.mtimeMs,
			};
			const cpPath = join(ws, '.classpath');
			try { info.classpath = readFileSync(cpPath, 'utf-8'); } catch { info.classpath = '<missing>'; }
			try {
				info.topLevelEntries = readdirSync(ws).slice(0, 50);
			} catch {}
			out.push(info);
		} catch {}
	}
	out.sort((a, b) => (b.mtime as number) - (a.mtime as number));
	return out;
}

async function snapshotJavaProcesses(): Promise<{ commandLine: string; processId: number }[]> {
	try {
		const { stdout } = await execFileAsync('powershell.exe', [
			'-NoProfile',
			'-Command',
			"$p = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*org.eclipse.equinox.launcher*' } | Where-Object { $_.CommandLine -notlike '*powershell*' } | Select-Object -Property ProcessId, CommandLine); if ($p.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $p -Compress -Depth 3 }",
		], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
		const trimmed = stdout.trim();
		if (!trimmed) return [];
		const parsed = JSON.parse(trimmed);
		const arr = Array.isArray(parsed) ? parsed : [parsed];
		return arr.map((p: { CommandLine: string; ProcessId: number }) => ({
			commandLine: p.CommandLine,
			processId: p.ProcessId,
		}));
	} catch (err) {
		return [{ commandLine: `<snapshot failed: ${err instanceof Error ? err.message : String(err)}>`, processId: -1 }];
	}
}

function extractJavaPath(commandLine: string): string | null {
	if (!commandLine) return null;
	if (commandLine.startsWith('"')) {
		const end = commandLine.indexOf('"', 1);
		if (end > 0) return commandLine.slice(1, end);
	}
	const space = commandLine.indexOf(' ');
	return space > 0 ? commandLine.slice(0, space) : commandLine;
}

type RowConfig = {
	row: 1 | 2 | 3 | 4;
	slotLabel: string;
	javaHome?: string;
	envAdd?: Record<string, string>;
	envRemove?: string[];
	testModRoot: string;
	reindexWaitMs?: number;
	skipFindReferences?: boolean;
	findReferencesTimeoutMs?: number;
};

const configPath = process.argv[2];
if (!configPath) {
	console.error('Usage: tsx scripts/matrix-row.ts <config-json-path>');
	process.exit(2);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as RowConfig;
const reindexWaitMs = cfg.reindexWaitMs ?? 45000;

const env: Record<string, string> = { ...process.env } as Record<string, string>;
for (const key of cfg.envRemove ?? []) {
	delete env[key];
}
for (const [key, value] of Object.entries(cfg.envAdd ?? {})) {
	env[key] = value;
}

const serverArgs = ['node_modules/tsx/dist/cli.mjs', 'src/index.ts', '--verbose'];
if (cfg.javaHome) {
	serverArgs.push('--java-home', cfg.javaHome);
}

const transport = new StdioClientTransport({
	command: process.execPath,
	args: serverArgs,
	env,
	cwd: process.cwd(),
	stderr: 'pipe',
});

const stderrChunks: string[] = [];
transport.stderr?.on('data', (chunk: Buffer) => {
	stderrChunks.push(chunk.toString());
});

const client = new Client({ name: 'matrix-row', version: '0.0.1' });
await client.connect(transport);

const result: Record<string, unknown> = {
	row: cfg.row,
	slotLabel: cfg.slotLabel,
	javaHomeArg: cfg.javaHome ?? null,
	envAdd: cfg.envAdd ?? null,
	envRemove: cfg.envRemove ?? null,
};

try {
	const createResp = await client.callTool({
		name: 'create_project',
		arguments: { name: 'matrix' },
	});
	result.create = (createResp as any).structuredContent;

	await sleep(2000);
	result.snapshotAfterCreate = await snapshotJavaProcesses();

	const addResp = await client.callTool({
		name: 'add_fabric_mod',
		arguments: { project: 'matrix', path: cfg.testModRoot },
	});
	result.add = (addResp as any).structuredContent;

	// Brief settle, then inspect workspace state (BEFORE the long reindex wait)
	await sleep(5000);
	result.workspacesAfterAdd = inspectWorkspaces().map(w => ({
		path: w.path,
		topLevelEntries: w.topLevelEntries,
		classpath: w.classpath,
	}));

	await sleep(reindexWaitMs);
	result.snapshotAfterAdd = await snapshotJavaProcesses();
	const snap = (result.snapshotAfterAdd as { commandLine: string }[]);
	result.capturedJavaPath = snap.length > 0 ? extractJavaPath(snap[0].commandLine) : null;

	const defResp = await client.callTool({
		name: 'find_definition',
		arguments: {
			project: 'matrix',
			jar: 'template',
			class: 'TEMPLATE_PACKAGE.TEMPLATE_CLASSNAME',
			patterns: ['Identifier\\s+ROOT_ID'],
		},
	}, undefined, { timeout: 300_000 });
	result.findDefinition = (defResp as any).structuredContent;

	if (!cfg.skipFindReferences) {
		const refResp = await client.callTool({
			name: 'find_references',
			arguments: {
				project: 'matrix',
				jar: 'template/minecraft',
				class: 'net.minecraft.resources.Identifier',
				patterns: ['public final class Identifier'],
			},
		}, undefined, { timeout: cfg.findReferencesTimeoutMs ?? 300_000 });
		result.findReferences = (refResp as any).structuredContent;
	}
} catch (err) {
	result.error = err instanceof Error ? err.stack ?? err.message : String(err);
}

try {
	await client.close();
} catch {
}

result.stderrTail = stderrChunks.join('').split('\n').slice(-40).join('\n');

console.log(JSON.stringify(result, null, 2));
process.exit(0);
