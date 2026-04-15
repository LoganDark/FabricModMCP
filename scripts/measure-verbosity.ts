/**
 * Verbosity measurement script for Phase 22 audit.
 *
 * Creates an in-process MCP client/server pair, loads a real Minecraft
 * Fabric project, and measures structuredContent byte sizes for each
 * audited tool in both compact (default) and full (details flag) modes.
 *
 * Usage: npx tsx scripts/measure-verbosity.ts /path/to/fabric/project
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { registerAllTools } from '../src/tools/index.js';

const projectPath = process.argv[2];
if (!projectPath) {
	console.error('Usage: npx tsx scripts/measure-verbosity.ts /path/to/fabric/project');
	process.exit(1);
}

interface MeasureResult {
	tool: string;
	benchmarkClass: string;
	compactBytes: number | null;
	fullBytes: number | null;
	reductionPct: string | null;
	fieldsStripped: string;
	error?: string;
}

async function createPair(): Promise<{ client: Client; server: McpServer; cleanup: () => Promise<void> }> {
	const server = createServer();
	registerAllTools(server);

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);

	const client = new Client({ name: 'verbosity-measure', version: '0.0.1' });
	await client.connect(clientTransport);

	return {
		client,
		server,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}

function measureBytes(result: any): number {
	const sc = result?.structuredContent;
	if (!sc) return 0;
	return Buffer.byteLength(JSON.stringify(sc));
}

async function callTool(client: Client, name: string, args: Record<string, any>): Promise<any> {
	return client.callTool({ name, arguments: args });
}

async function measureTool(
	client: Client,
	tool: string,
	benchmarkClass: string,
	compactArgs: Record<string, any>,
	fullArgs: Record<string, any>,
	fieldsStripped: string,
): Promise<MeasureResult> {
	try {
		const compactResult = await callTool(client, tool, compactArgs);
		const compactBytes = measureBytes(compactResult);

		const fullResult = await callTool(client, tool, fullArgs);
		const fullBytes = measureBytes(fullResult);

		const reductionPct = fullBytes > 0
			? ((1 - compactBytes / fullBytes) * 100).toFixed(1) + '%'
			: '0%';

		return { tool, benchmarkClass, compactBytes, fullBytes, reductionPct, fieldsStripped };
	} catch (err: any) {
		return {
			tool,
			benchmarkClass,
			compactBytes: null,
			fullBytes: null,
			reductionPct: null,
			fieldsStripped,
			error: err.message ?? String(err),
		};
	}
}

async function main() {
	console.log(`Loading project from: ${projectPath}`);

	const { client, cleanup } = await createPair();

	try {
		// Load the project
		const loadResult = await callTool(client, 'load_project', { path: projectPath });
		const loadEnvelope = (loadResult as any).structuredContent;
		if (!loadEnvelope?.success) {
			console.error('Failed to load project:', JSON.stringify(loadEnvelope, null, 2));
			process.exit(1);
		}
		const projectName = loadEnvelope.data?.project ?? loadEnvelope.data?.name;
		console.log(`Project loaded: ${projectName}`);

		const results: MeasureResult[] = [];

		// Tool measurements against ClientPlayerEntity
		const cpeClass = 'net.minecraft.client.network.ClientPlayerEntity';
		const cpePatterns = ['class ClientPlayerEntity', 'ClientPlayerEntity'];

		// list_members
		results.push(await measureTool(client, 'list_members', 'ClientPlayerEntity',
			{ class: cpeClass, project: projectName },
			{ class: cpeClass, project: projectName, details: { signatures: true } },
			'detail, parameters, returnType, fieldType, selectionRange, range.character',
		));

		// list_classes
		results.push(await measureTool(client, 'list_classes', 'ClientPlayerEntity (package)',
			{ package: 'net.minecraft.client.network', project: projectName },
			{ package: 'net.minecraft.client.network', project: projectName, details: { modifiers: true } },
			'access, modifiers, innerClasses',
		));

		// search_classes
		results.push(await measureTool(client, 'search_classes', 'ClientPlayerEntity',
			{ pattern: 'ClientPlayerEntity', project: projectName },
			{ pattern: 'ClientPlayerEntity', project: projectName, details: { modifiers: true } },
			'access, modifiers, innerClasses',
		));

		// locate_in_source
		results.push(await measureTool(client, 'locate_in_source', 'ClientPlayerEntity',
			{ class: cpeClass, patterns: cpePatterns, project: projectName },
			{ class: cpeClass, patterns: cpePatterns, project: projectName, details: { steps: true } },
			'steps, provenanceChains',
		));

		// Navigation tools (require JDT LS)
		for (const tool of ['find_references', 'find_definition', 'find_implementations']) {
			const detailKey = 'lineContent';
			results.push(await measureTool(client, tool, 'ClientPlayerEntity',
				{ class: cpeClass, patterns: cpePatterns, project: projectName },
				{ class: cpeClass, patterns: cpePatterns, project: projectName, details: { [detailKey]: true } },
				'context, entryPath, provenanceChains',
			));
		}

		// GameRenderer measurements
		const grClass = 'net.minecraft.client.render.GameRenderer';
		const grPatterns = ['class GameRenderer', 'GameRenderer'];

		results.push(await measureTool(client, 'list_members', 'GameRenderer',
			{ class: grClass, project: projectName },
			{ class: grClass, project: projectName, details: { signatures: true } },
			'detail, parameters, returnType, fieldType, selectionRange, range.character',
		));

		results.push(await measureTool(client, 'search_classes', 'GameRenderer',
			{ pattern: 'GameRenderer', project: projectName },
			{ pattern: 'GameRenderer', project: projectName, details: { modifiers: true } },
			'access, modifiers, innerClasses',
		));

		for (const tool of ['find_references', 'find_definition']) {
			results.push(await measureTool(client, tool, 'GameRenderer',
				{ class: grClass, patterns: grPatterns, project: projectName },
				{ class: grClass, patterns: grPatterns, project: projectName, details: { lineContent: true } },
				'context, entryPath, provenanceChains',
			));
		}

		// Print results table
		console.log('\n' + '='.repeat(120));
		console.log('VERBOSITY AUDIT RESULTS');
		console.log('='.repeat(120));
		console.log(
			'Tool'.padEnd(24) +
			'Benchmark'.padEnd(32) +
			'Compact'.padEnd(12) +
			'Full'.padEnd(12) +
			'Reduction'.padEnd(12) +
			'Error',
		);
		console.log('-'.repeat(120));

		for (const r of results) {
			const compactStr = r.compactBytes !== null ? `${r.compactBytes}` : 'N/A';
			const fullStr = r.fullBytes !== null ? `${r.fullBytes}` : 'N/A';
			const redStr = r.reductionPct ?? 'N/A';
			const errStr = r.error ?? '';
			console.log(
				r.tool.padEnd(24) +
				r.benchmarkClass.padEnd(32) +
				compactStr.padEnd(12) +
				fullStr.padEnd(12) +
				redStr.padEnd(12) +
				errStr,
			);
		}

		console.log('='.repeat(120));

		// Calculate totals
		let totalCompact = 0, totalFull = 0;
		for (const r of results) {
			if (r.compactBytes !== null) totalCompact += r.compactBytes;
			if (r.fullBytes !== null) totalFull += r.fullBytes;
		}
		console.log(`\nTotal compact: ${totalCompact} bytes`);
		console.log(`Total full: ${totalFull} bytes`);
		if (totalFull > 0) {
			console.log(`Overall reduction: ${((1 - totalCompact / totalFull) * 100).toFixed(1)}%`);
		}

		// Write JSON for report consumption
		const outputPath = process.argv[3] ?? '/dev/stdout';
		if (process.argv[3]) {
			const { writeFile } = await import('node:fs/promises');
			await writeFile(outputPath, JSON.stringify({ results, totalCompact, totalFull }, null, 2));
			console.log(`\nRaw data written to: ${outputPath}`);
		}

		// Return results for programmatic use
		return results;
	} finally {
		await cleanup();
	}
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
