import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { logger } from '../logging/logger.js';
import { handleSymbolPositionError, resolveProjectSafely, returnError, withLspDocument } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

/**
 * Extract markdown text from an LSP hover contents field.
 * Handles MarkupContent ({ kind, value }), plain string, MarkedString ({ language, value }),
 * and array of MarkedString | string.
 */
function extractHoverMarkdown(contents: any): string {
	if (contents === null || contents === undefined) return '';

	// MarkupContent: { kind: 'markdown' | 'plaintext', value: string }
	if (typeof contents === 'object' && 'kind' in contents && 'value' in contents) {
		return contents.value;
	}

	// Plain string
	if (typeof contents === 'string') {
		return contents;
	}

	// Array of MarkedString | string
	if (Array.isArray(contents)) {
		return contents.map((item: any) => {
			if (typeof item === 'string') return item;
			if (typeof item === 'object' && 'value' in item) {
				if ('language' in item) {
					return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
				}
				return item.value;
			}
			return String(item);
		}).join('\n\n');
	}

	return String(contents);
}

export function registerGetSymbolInfoTool(server: McpServer): void {
	server.registerTool(
		'get_symbol_info',
		{
			title: 'Get Symbol Info',
			description: TOOL_DESCRIPTIONS.get_symbol_info,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				scope: PARAMS.scope,
				class: PARAMS.class,
				patterns: PARAMS.patterns,
			},
		},
		async ({ project, jar, scope, class: className, patterns }) => {
			logger.debug('get_symbol_info called', { project, jar, class: className, patterns });

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

			const lspClient = loadedProject.jdtls.client!;

			const provenance = {
				tool: 'get_symbol_info',
				project: loadedProject.name,
				class: className,
			};

			// Resolve symbol position using shared helper
			const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar, scope);

			if (!posResult.success) return handleSymbolPositionError(posResult, loadedProject.name, provenance);

			const { sourceJarId, sourceText, cascadeResult, fileUri } = posResult;

			return await withLspDocument(lspClient, fileUri, sourceText, async () => {
				// Send hover request
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const hoverResult = await lspClient.hover({
					textDocument: { uri: fileUri },
					position: lspPosition,
				});

				// Process hover result
				if (hoverResult === null || hoverResult === undefined) {
					const envelope = makeSuccess(
						{
							hover: null,
							position: {
								jar: sourceJarId,
								class: className,
								line: cascadeResult.line,
								column: cascadeResult.column,
							},
						},
						{ provenance },
					);
					return {
						content: [{ type: 'text' as const, text: 'No hover info available' }],
						structuredContent: envelope,
					};
				}

				const hoverMarkdown = extractHoverMarkdown(hoverResult.contents);

				// Filter import/package declarations
				if (/^(import|package)\s/.test(hoverMarkdown)) {
					const envelope = makeSuccess(
						{
							hover: null,
							position: {
								jar: sourceJarId,
								class: className,
								line: cascadeResult.line,
								column: cascadeResult.column,
							},
						},
						{ provenance },
					);
					return {
						content: [{ type: 'text' as const, text: 'Position is on an import/package declaration -- no useful symbol info' }],
						structuredContent: envelope,
					};
				}

				// TODO: Extract Javadoc from hover markdown or source text when Javadoc support is implemented
				const envelope = makeSuccess(
					{
						hover: hoverMarkdown,
						position: {
							jar: sourceJarId,
							class: className,
							line: cascadeResult.line,
							column: cascadeResult.column,
						},
					},
					{ provenance },
				);
				return {
					content: [{ type: 'text' as const, text: hoverMarkdown }],
					structuredContent: envelope,
				};
			});
		},
	);
}
