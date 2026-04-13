import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper, entryPathToClassName } from '../jdtls/uri-mapper.js';
import { extractEnclosingContext } from '../jdtls/context-extractor.js';
import { logger } from '../logging/logger.js';
import type { NavigationResult } from '../jdtls/types.js';

/**
 * Normalize LSP implementation results to an array of { uri, range } objects.
 * Handles Location, Location[], LocationLink[], and null.
 */
function normalizeLocations(result: any): Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> {
	if (result === null || result === undefined) return [];
	if (Array.isArray(result)) {
		return result.map((item: any) => {
			// LocationLink has targetUri/targetRange; Location has uri/range
			if ('targetUri' in item) {
				return { uri: item.targetUri, range: item.targetRange };
			}
			return { uri: item.uri, range: item.range };
		});
	}
	// Single Location
	if ('uri' in result) {
		return [{ uri: result.uri, range: result.range }];
	}
	return [];
}

export function registerFindImplementationsTool(server: McpServer): void {
	server.registerTool(
		'find_implementations',
		{
			title: 'Find Implementations',
			description: 'Find implementations of an interface method, abstract method, or class at a position identified by cascading regex patterns. Uses JDT LS textDocument/implementation for semantic lookup. Returns implementation locations with source provenance and context-aware code snippets.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().optional().describe('Specific jar ID where the symbol to navigate FROM is located (default: search all jars containing the class)'),
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				patterns: z.array(z.string()).min(1).describe('Array of cascading regex patterns to locate the symbol position. Each pattern narrows within the previous match. Use inline flags like (?i), (?s), (?m).'),
			},
		},
		async ({ project, jar, class: className, patterns }) => {
			logger.debug('find_implementations called', { project, jar, class: className, patterns });

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
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.client || !loadedProject.jdtls.endpoint) {
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
				// Send textDocument/implementation via raw endpoint
				const lspPosition = { line: cascadeResult.line - 1, character: cascadeResult.column - 1 };
				const implResult = await endpoint.send('textDocument/implementation', {
					textDocument: { uri: fileUri },
					position: lspPosition,
				});

				// didClose
				await lspClient.didClose({ textDocument: { uri: fileUri } });

				// Process implementation results
				const locations = normalizeLocations(implResult);
				const results: NavigationResult[] = [];

				for (const loc of locations) {
					const mapping = uriMapper.fromFileUri(loc.uri);
					if (!mapping) continue;

					// Read the source file from the extracted temp dir
					const filePath = loc.uri.replace('file://', '');
					let implSource: string;
					try {
						implSource = await readFile(filePath, 'utf-8');
					} catch {
						continue;
					}

					const implClassName = entryPathToClassName(mapping.entryPath);
					const implLine = loc.range.start.line + 1; // Convert 0-based to 1-based
					const implColumn = loc.range.start.character + 1;
					const context = extractEnclosingContext(implSource, implLine);

					// Look up dependency entry for provenance
					const dep = loadedProject.dependencyJars.get(mapping.jar);

					results.push({
						jar: mapping.jar,
						category: dep?.category ?? 'library',
						provenanceChains: dep?.provenanceChains ?? [],
						entryPath: mapping.entryPath,
						className: implClassName,
						line: implLine,
						column: implColumn,
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

				let summary: string;
				if (results.length === 0) {
					summary = `No implementations found for symbol at line ${cascadeResult.line}, col ${cascadeResult.column}`;
				} else {
					summary = `Found ${results.length} implementation${results.length === 1 ? '' : 's'} across ${uniqueFiles} file${uniqueFiles === 1 ? '' : 's'}`;
				}

				return {
					content: [{ type: 'text' as const, text: summary }],
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
