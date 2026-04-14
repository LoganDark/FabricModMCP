import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper, entryPathToClassName } from '../jdtls/uri-mapper.js';
import { extractEnclosingContext } from '../jdtls/context-extractor.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import type { NavigationResult } from '../jdtls/types.js';

export function registerFindReferencesTool(server: McpServer): void {
	server.registerTool(
		'find_references',
		{
			title: 'Find References',
			description: 'Find all references/usages of a symbol at a position identified by cascading regex patterns. Returns all locations where the symbol is used across all source jars. Each result includes source provenance and context-aware code snippets.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().optional().describe('Specific jar ID where the symbol to navigate FROM is located (default: search all jars containing the class)'),
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				patterns: z.array(z.string()).min(1).describe('Array of cascading regex patterns to locate the symbol position. Each pattern narrows within the previous match. Use inline flags like (?i), (?s), (?m).'),
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

			if (!posResult.success) {
				if (posResult.kind === 'jar-not-found') {
					return returnError(
						'JAR_NOT_FOUND',
						`Jar '${posResult.jar}' not found in project '${loadedProject.name}'`,
						[posResult.jar],
						['Check available jars with get_project_metadata'],
					);
				}
				if (posResult.kind === 'jar-not-available') {
					return returnError(
						'JAR_NOT_AVAILABLE',
						`Sources for jar '${posResult.jar}' are not available`,
						[posResult.jar],
						['The dependency does not have a sources jar'],
					);
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
				return returnError(
					'CLASS_NOT_FOUND',
					`Class '${className}' not found in any jar, or cascading regex failed in all jars`,
					[posResult.entryPath],
					['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
				);
			}

			const { sourceJarId, sourceText, cascadeResult, fileUri } = posResult;

			// Send textDocument/didOpen
			await lspClient.didOpen({
				textDocument: {
					uri: fileUri,
					languageId: 'java',
					version: 1,
					text: sourceText,
				},
			});

			try {
				// Send textDocument/references request
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const refResult = await lspClient.references({
					textDocument: { uri: fileUri },
					position: lspPosition,
					context: { includeDeclaration: true },
				});

				// Send textDocument/didClose
				await lspClient.didClose({ textDocument: { uri: fileUri } });

				// Process reference results -- refResult is Location[] | null
				const locations: Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> = refResult ?? [];
				const results: NavigationResult[] = [];

				for (const loc of locations) {
					const mapping = uriMapper.fromFileUri(loc.uri);
					if (!mapping) continue;

					// Read the source file from the extracted temp dir
					const filePath = loc.uri.replace('file://', '');
					let refSource: string;
					try {
						refSource = await readFile(filePath, 'utf-8');
					} catch {
						continue;
					}

					const refClassName = entryPathToClassName(mapping.entryPath);
					const refLine = loc.range.start.line + 1; // Convert 0-based to 1-based
					const refColumn = loc.range.start.character + 1;
					const context = extractEnclosingContext(refSource, refLine);

					// Look up dependency entry for provenance
					const dep = loadedProject.dependencyJars.get(mapping.jar);

					results.push({
						jar: mapping.jar,
						category: dep?.category ?? 'library',
						provenanceChains: dep?.provenanceChains ?? [],
						entryPath: mapping.entryPath,
						className: refClassName,
						line: refLine,
						column: refColumn,
						context,
					});
				}

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
