import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { SYMBOL_KIND_NAME } from '../jdtls/symbol-kind.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { buildMemberFqn } from '../browsing/member-fqn.js';

const KIND_NAME_TO_NUMBER: Record<string, number> = {
	'class': 5,
	'method': 6,
	'property': 7,
	'field': 8,
	'constructor': 9,
	'enum': 10,
	'interface': 11,
	'constant': 14,
};

export function registerSearchSymbolsTool(server: McpServer): void {
	server.registerTool(
		'search_symbols',
		{
			title: 'Search Symbols',
			description: TOOL_DESCRIPTIONS.search_symbols,
			inputSchema: {
				project: PARAMS.project,
				query: z.string().describe('Symbol name pattern to search for'),
				kind: z.enum(['class', 'method', 'field', 'interface', 'enum', 'constructor', 'constant', 'property']).optional().describe('Filter results by symbol kind'),
				limit: z.number().int().min(1).max(200).default(50).optional().describe('Maximum results per page (default: 50)'),
				offset: z.number().int().min(0).default(0).optional().describe('Pagination offset (default: 0)'),
			},
		},
		async ({ query, kind, limit, offset, project }) => {
			logger.debug('search_symbols called', { query, kind, limit, offset, project });

			const effectiveLimit = limit ?? 50;
			const effectiveOffset = offset ?? 0;

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Check JDT LS availability
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.endpoint) {
				return returnError(
					'JDTLS_NOT_AVAILABLE',
					`JDT LS not available for project '${loadedProject.name}': ${loadedProject.jdtls?.failureReason ?? 'not initialized'}`,
					[loadedProject.name],
					['Ensure Java 21+ is installed and JDTLS_HOME is set'],
				);
			}

			const jdtls = loadedProject.jdtls;
			const endpoint = jdtls.endpoint!;

			const provenance = {
				tool: 'search_symbols',
				project: loadedProject.name,
				query,
			};

			// workspace/symbol does NOT need didOpen/didClose
			const results = await endpoint.send('workspace/symbol', { query });

			if (!results || !Array.isArray(results) || results.length === 0) {
				const envelope = makeSuccess(
					{ results: [], total: 0, limit: effectiveLimit, offset: effectiveOffset },
					{ provenance },
				);
				return {
					content: [{ type: 'text' as const, text: `No symbols found matching '${query}'` }],
					structuredContent: envelope,
				};
			}

			// Filter by kind if specified
			let filtered = results;
			if (kind) {
				const kindNumber = KIND_NAME_TO_NUMBER[kind];
				if (kindNumber !== undefined) {
					filtered = results.filter((s: any) => s.kind === kindNumber);
				}
			}

			// Paginate
			const total = filtered.length;
			const page = filtered.slice(effectiveOffset, effectiveOffset + effectiveLimit);

			// Transform to structured output
			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			const transformed = page.map((sym: any) => {
				const kindName = SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`;
				const memberFqn = sym.containerName
					? buildMemberFqn(sym.containerName, sym.name, kindName)
					: null;
				const mapping = uriMapper.fromFileUri(sym.location.uri);
				return {
					name: sym.name,
					kind: kindName,
					containerName: sym.containerName ?? null,
					memberFqn,
					deprecated: sym.tags?.includes(1) ?? false,
					location: {
						uri: sym.location.uri,
						jar: mapping?.jar ?? null,
						line: sym.location.range.start.line + 1,
						column: sym.location.range.start.character + 1,
					},
				};
			});

			const envelope = makeSuccess(
				{ results: transformed, total, limit: effectiveLimit, offset: effectiveOffset },
				{ provenance },
			);

			const endIndex = Math.min(effectiveOffset + page.length, total);
			const summary = `Found ${total} symbol${total === 1 ? '' : 's'} matching '${query}' (showing ${effectiveOffset + 1}-${endIndex})`;

			return {
				content: [{ type: 'text' as const, text: summary }],
				structuredContent: envelope,
			};
		},
	);
}
