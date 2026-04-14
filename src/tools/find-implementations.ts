import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveSymbolPosition } from './resolve-symbol-position.js';
import { createUriMapper, entryPathToClassName } from '../jdtls/uri-mapper.js';
import { extractEnclosingContext } from '../jdtls/context-extractor.js';
import { logger } from '../logging/logger.js';
import { handleSymbolPositionError, normalizeLocations, resolveProjectSafely, returnError, withLspDocument } from './tool-helpers.js';
import type { NavigationResult } from '../jdtls/types.js';

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
			});
		},
	);
}
