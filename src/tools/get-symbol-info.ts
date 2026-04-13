import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { logger } from '../logging/logger.js';

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
			description: 'Get hover/type information for a symbol at a position identified by cascading regex patterns. Uses JDT LS hover to return type signatures, javadoc, and other symbol metadata as raw markdown.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().optional().describe('Specific jar ID where the symbol is located (default: search all jars containing the class)'),
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				patterns: z.array(z.string()).min(1).describe('Array of cascading regex patterns to locate the symbol position. Each pattern narrows within the previous match.'),
			},
		},
		async ({ project, jar, class: className, patterns }) => {
			logger.debug('get_symbol_info called', { project, jar, class: className, patterns });

			let loadedProject;
			try {
				loadedProject = projectStore.resolveProject(project);
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					const envelope = makeError(de.code, de.message, de.tried ?? [], de.suggestions);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
				throw error;
			}

			// Check JDT LS availability -- hard error, no fallback
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.client) {
				const envelope = makeError(
					'JDTLS_NOT_AVAILABLE',
					`JDT LS not available for project '${loadedProject.name}': ${loadedProject.jdtls?.failureReason ?? 'not initialized'}`,
					[loadedProject.name],
					['Ensure Java 21+ is installed and JDTLS_HOME is set'],
				);
				return {
					content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
					structuredContent: envelope,
				};
			}

			const lspClient = loadedProject.jdtls.client!;

			const provenance = {
				tool: 'get_symbol_info',
				project: loadedProject.name,
				class: className,
			};

			// Resolve symbol position using shared helper
			const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar);

			if (!posResult.success) {
				if (posResult.kind === 'jar-not-found') {
					const envelope = makeError(
						'JAR_NOT_FOUND',
						`Jar '${posResult.jar}' not found in project '${loadedProject.name}'`,
						[posResult.jar],
						['Check available jars with get_project_metadata'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
				if (posResult.kind === 'jar-not-available') {
					const envelope = makeError(
						'JAR_NOT_AVAILABLE',
						`Sources for jar '${posResult.jar}' are not available`,
						[posResult.jar],
						['The dependency does not have a sources jar'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
				if (posResult.kind === 'cascade-failure') {
					const failure = {
						jar: posResult.jar,
						category: posResult.category,
						provenanceChains: posResult.provenanceChains,
						steps: posResult.steps,
						failedStep: posResult.failedStep,
						error: posResult.error,
					};
					const envelope = makeSuccess({ results: [], failures: [failure] }, { provenance });
					return {
						content: [{ type: 'text' as const, text: `Cascade failed at step ${posResult.failedStep + 1} in ${className} (${posResult.jar})` }],
						structuredContent: envelope,
					};
				}
				// not-found
				const envelope = makeError(
					'CLASS_NOT_FOUND',
					`Class '${className}' not found in any jar, or cascading regex failed in all jars`,
					[posResult.entryPath],
					['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
				);
				return {
					content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
					structuredContent: envelope,
				};
			}

			const { sourceJarId, sourceText, cascadeResult, fileUri } = posResult;

			// didOpen
			await lspClient.didOpen({
				textDocument: {
					uri: fileUri,
					languageId: 'java',
					version: 1,
					text: sourceText,
				},
			});

			try {
				// Send hover request
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const hoverResult = await lspClient.hover({
					textDocument: { uri: fileUri },
					position: lspPosition,
				});

				// didClose
				await lspClient.didClose({ textDocument: { uri: fileUri } });

				// Process hover result
				if (hoverResult === null || hoverResult === undefined) {
					const envelope = makeSuccess(
						{
							hover: null,
							javadoc: '',
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
							javadoc: '',
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

				const envelope = makeSuccess(
					{
						hover: hoverMarkdown,
						javadoc: '',
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
			} catch (error) {
				// Ensure didClose even on error
				try {
					await lspClient.didClose({ textDocument: { uri: fileUri } });
				} catch {
					// Ignore close errors
				}
				throw error;
			}
		},
	);
}
