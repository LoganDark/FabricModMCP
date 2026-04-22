import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { applyPagination } from './pagination.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { handleSymbolPositionError, normalizeLocations, processNavigationLocations, resolveProjectSafely, requireDependencies, returnError, stripNavigationResult, withLspDocument } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';

export function registerFindDefinitionTool(server: McpServer): void {
	server.registerTool(
		'find_definition',
		{
			title: 'Find Definition',
			description: TOOL_DESCRIPTIONS.find_definition,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				scope: PARAMS.scope,
				class: PARAMS.class,
				patterns: PARAMS.patterns,
				limit: PARAMS.limit,
				offset: PARAMS.offset,
				details: DETAIL_PARAMS.navigation,
			},
		},
		async ({ project, jar, scope, class: className, patterns, limit, offset, details }) => {
			logger.debug('find_definition called', { project, jar, class: className, patterns });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const depCheck = requireDependencies(loadedProject, scope);
			if (depCheck) return depCheck;

			// Check JDT LS availability -- hard error, no fallback
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.client) {
				return returnError(
					'JDTLS_NOT_AVAILABLE',
					`JDT LS not available for project '${loadedProject.name}': ${loadedProject.jdtls?.failureReason ?? 'not initialized'}`,
					[loadedProject.name],
					['Ensure Java 21+ is installed and JDTLS_HOME is set'],
				);
			}

			const jdtls = loadedProject.jdtls;
			const lspClient = jdtls.client!;

			const provenance = {
				tool: 'find_definition',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Resolve symbol position using shared helper
			const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar, scope);

			if (!posResult.success) return handleSymbolPositionError(posResult, loadedProject.name, provenance);

			const { sourceJarId, sourceText, cascadeResult, fileUri } = posResult;

			return await withLspDocument(lspClient, fileUri, sourceText, async () => {
				// Send textDocument/definition request
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const defResult = await lspClient.definition({
					textDocument: { uri: fileUri },
					position: lspPosition,
				});

				// Process definition results
				const locations = normalizeLocations(defResult);
				const allResults = await processNavigationLocations(locations, loadedProject, uriMapper);
				const paginated = applyPagination(allResults, { limit, offset });
				const stripped = paginated.results.map(r => stripNavigationResult(r, details));

				const envelope = makeSuccess(
					{
						...paginated,
						limit: limit ?? paginated.results.length,
						results: stripped,
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
					summary = `No definition found (cascading regex matched at line ${cascadeResult.line}, col ${cascadeResult.column})`;
				} else if (paginated.results.length === 1 && paginated.total === 1) {
					const r = paginated.results[0];
					summary = `Found definition in ${r.className} (${r.jar}) at line ${r.line}`;
				} else if (paginated.results.length === paginated.total) {
					summary = `Found ${paginated.total} definitions (${paginated.results.map(r => r.className).join(', ')})`;
				} else {
					summary = `Found ${paginated.total} definition${paginated.total === 1 ? '' : 's'} (showing ${paginated.results.length} from offset ${paginated.offset})`;
				}

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			});
		},
	);
}
