import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { handleSymbolPositionError, normalizeLocations, processNavigationLocations, resolveProjectSafely, returnError, withLspDocument } from './tool-helpers.js';

export function registerFindDefinitionTool(server: McpServer): void {
	server.registerTool(
		'find_definition',
		{
			title: 'Find Definition',
			description: 'Find the definition of a symbol at a position identified by cascading regex patterns. Uses JDT LS for semantic go-to-definition. Returns definition location(s) with source provenance and context-aware code snippets.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().optional().describe('Specific jar ID where the symbol to navigate FROM is located (default: search all jars containing the class)'),
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				patterns: z.array(z.string()).min(1).describe('Array of cascading regex patterns to locate the symbol position. Each pattern narrows within the previous match. Use inline flags like (?i), (?s), (?m).'),
			},
		},
		async ({ project, jar, class: className, patterns }) => {
			logger.debug('find_definition called', { project, jar, class: className, patterns });

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
				tool: 'find_definition',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Resolve symbol position using shared helper
			const posResult = await resolveSymbolPosition(loadedProject, className, patterns, jar);

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
				const results = await processNavigationLocations(locations, loadedProject, uriMapper);

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

				let summary: string;
				if (results.length === 0) {
					summary = `No definition found (cascading regex matched at line ${cascadeResult.line}, col ${cascadeResult.column})`;
				} else if (results.length === 1) {
					const r = results[0];
					summary = `Found definition in ${r.className} (${r.jar}) at line ${r.line}`;
				} else {
					summary = `Found ${results.length} definitions (${results.map(r => r.className).join(', ')})`;
				}

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			});
		},
	);
}
