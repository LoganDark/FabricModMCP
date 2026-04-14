import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { handleSymbolPositionError, normalizeLocations, processNavigationLocations, resolveProjectSafely, returnError, withLspDocument } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerFindReferencesTool(server: McpServer): void {
	server.registerTool(
		'find_references',
		{
			title: 'Find References',
			description: TOOL_DESCRIPTIONS.find_references,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				class: PARAMS.class,
				patterns: PARAMS.patterns,
			},
		},
		async ({ project, jar, class: className, patterns }) => {
			logger.debug('find_references called', { project, jar, class: className, patterns });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

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
				tool: 'find_references',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Resolve symbol position using shared helper
			const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar);

			if (!posResult.success) return handleSymbolPositionError(posResult, loadedProject.name, provenance);

			const { sourceJarId, sourceText, cascadeResult, fileUri } = posResult;

			return await withLspDocument(lspClient, fileUri, sourceText, async () => {
				// Send textDocument/references request
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const refResult = await lspClient.references({
					textDocument: { uri: fileUri },
					position: lspPosition,
					context: { includeDeclaration: true },
				});

				// Process reference results
				const locations = normalizeLocations(refResult);
				const results = await processNavigationLocations(locations, loadedProject, uriMapper);

				const uniqueFiles = new Set(results.map(r => r.className)).size;
				const envelope = makeSuccess(
					{
						results,
						sourcePosition: {
							jar: sourceJarId,
							class: className,
							line: cascadeResult.line,
							column: cascadeResult.column,
						},
					},
					{ provenance },
				);
				return {
					content: [{ type: 'text' as const, text: results.length > 0 ? `Found ${results.length} reference${results.length === 1 ? '' : 's'} across ${uniqueFiles} file${uniqueFiles === 1 ? '' : 's'}` : `No references found for symbol at line ${cascadeResult.line}, col ${cascadeResult.column}` }],
					structuredContent: envelope,
				};
			});
		},
	);
}
