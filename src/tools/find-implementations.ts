import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { applyPagination } from './pagination.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { handleSymbolPositionError, normalizeLocations, processNavigationLocations, resolveProjectSafely, returnError, withLspDocument } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerFindImplementationsTool(server: McpServer): void {
	server.registerTool(
		'find_implementations',
		{
			title: 'Find Implementations',
			description: TOOL_DESCRIPTIONS.find_implementations,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				class: PARAMS.class,
				patterns: PARAMS.patterns,
				limit: PARAMS.limit,
				offset: PARAMS.offset,
			},
		},
		async ({ project, jar, class: className, patterns, limit, offset }) => {
			logger.debug('find_implementations called', { project, jar, class: className, patterns });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Check JDT LS availability -- hard error, no fallback
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.client || !loadedProject.jdtls.endpoint) {
				return returnError(
					'JDTLS_NOT_AVAILABLE',
					`JDT LS not available for project '${loadedProject.name}': ${loadedProject.jdtls?.failureReason ?? 'not initialized'}`,
					[loadedProject.name],
					['Ensure Java 21+ is installed and JDTLS_HOME is set'],
				);
			}

			const jdtls = loadedProject.jdtls;
			const lspClient = jdtls.client!;
			const endpoint = jdtls.endpoint!;

			const provenance = {
				tool: 'find_implementations',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Resolve symbol position using shared helper
			const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar);

			if (!posResult.success) return handleSymbolPositionError(posResult, loadedProject.name, provenance);

			const { sourceJarId, sourceText, cascadeResult, fileUri } = posResult;

			return await withLspDocument(lspClient, fileUri, sourceText, async () => {
				// Send textDocument/implementation via raw endpoint
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const implResult = await endpoint.send('textDocument/implementation', {
					textDocument: { uri: fileUri },
					position: lspPosition,
				});

				// Process implementation results
				const locations = normalizeLocations(implResult);
				const allResults = await processNavigationLocations(locations, loadedProject, uriMapper);
				const paginated = applyPagination(allResults, { limit, offset });

				const uniqueFiles = new Set(paginated.results.map(r => r.className)).size;
				const envelope = makeSuccess(
					{
						...paginated,
						sourcePosition: {
							jar: sourceJarId,
							class: className,
							line: cascadeResult.line,
							column: cascadeResult.column,
						},
					},
					{ provenance },
				);

				let summary: string;
				if (paginated.total === 0) {
					summary = `No implementations found for symbol at line ${cascadeResult.line}, col ${cascadeResult.column}`;
				} else if (paginated.results.length === paginated.total) {
					summary = `Found ${paginated.total} implementation${paginated.total === 1 ? '' : 's'} across ${uniqueFiles} file${uniqueFiles === 1 ? '' : 's'}`;
				} else {
					summary = `Found ${paginated.total} implementation${paginated.total === 1 ? '' : 's'} across ${uniqueFiles} file${uniqueFiles === 1 ? '' : 's'} (showing ${paginated.results.length} from offset ${paginated.offset})`;
				}

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			});
		},
	);
}
