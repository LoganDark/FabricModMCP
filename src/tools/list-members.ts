import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { SYMBOL_KIND_NAME } from '../jdtls/symbol-kind.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, sortByPriority, resolveProjectSafely, returnError } from './tool-helpers.js';

interface TransformedSymbol {
	name: string;
	kind: string;
	detail: string | null;
	deprecated: boolean;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	selectionRange: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	children: TransformedSymbol[];
}

/**
 * Transform a DocumentSymbol from the LSP response into a structured member.
 * Converts 0-based LSP positions to 1-based for human readability.
 */
function transformSymbol(sym: any): TransformedSymbol {
	return {
		name: sym.name,
		kind: SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`,
		detail: sym.detail ?? null,
		deprecated: sym.tags?.includes(1) ?? false, // SymbolTag.Deprecated = 1
		range: {
			start: { line: sym.range.start.line + 1, character: sym.range.start.character + 1 },
			end: { line: sym.range.end.line + 1, character: sym.range.end.character + 1 },
		},
		selectionRange: {
			start: { line: sym.selectionRange.start.line + 1, character: sym.selectionRange.start.character + 1 },
			end: { line: sym.selectionRange.end.line + 1, character: sym.selectionRange.end.character + 1 },
		},
		children: sym.children?.map(transformSymbol) ?? [],
	};
}

/**
 * Handle SymbolInformation[] (flat) response defensively.
 * If JDT LS ignores hierarchicalDocumentSymbolSupport, items have `location` instead of `range`.
 */
function transformSymbolInformation(sym: any): TransformedSymbol {
	const range = sym.location?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
	return {
		name: sym.name,
		kind: SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`,
		detail: null,
		deprecated: sym.tags?.includes(1) ?? false,
		range: {
			start: { line: range.start.line + 1, character: range.start.character + 1 },
			end: { line: range.end.line + 1, character: range.end.character + 1 },
		},
		selectionRange: {
			start: { line: range.start.line + 1, character: range.start.character + 1 },
			end: { line: range.end.line + 1, character: range.end.character + 1 },
		},
		children: [],
	};
}

function isSymbolInformation(item: any): boolean {
	return item && 'location' in item && !('range' in item);
}

export function registerListMembersTool(server: McpServer): void {
	server.registerTool(
		'list_members',
		{
			title: 'List Members',
			description: 'List all members (fields, methods, inner classes) of a Java class as a tree. Returns name, kind, type signature, line ranges, and nested children. More useful than reading raw source for understanding class structure.',
			inputSchema: {
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				jar: z.string().optional().describe('Specific jar ID (default: search all jars for the class)'),
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
			},
		},
		async ({ class: className, jar, project }) => {
			logger.debug('list_members called', { class: className, jar, project });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Check JDT LS availability
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

			const entryPath = classNameToEntryPath(className);

			const provenance = {
				tool: 'list_members',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Find source text and jar ID
			let sourceJarId: string;
			let sourceText: string;

			if (jar !== undefined) {
				// Specific jar mode
				const dep = loadedProject.dependencyJars.get(jar);
				if (!dep) {
					return returnError(
						'JAR_NOT_FOUND',
						`Jar '${jar}' not found in project '${loadedProject.name}'`,
						[jar],
						['Check available jars with get_project_metadata'],
					);
				}

				if (!dep.available) {
					return returnError(
						'JAR_NOT_AVAILABLE',
						`Sources for jar '${jar}' are not available`,
						[jar],
						['The dependency does not have a sources jar'],
					);
				}

				try {
					const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
					const buffer = await adapter.readEntry(entryPath);
					sourceText = buffer.toString('utf-8');
					sourceJarId = jar;
				} catch {
					return returnError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in jar '${jar}'`,
						[entryPath],
						['Check the fully-qualified class name'],
					);
				}
			} else {
				// All-jars mode: find first jar containing the class
				const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
				const sorted = sortByPriority(Array.from(filtered.entries()));

				let found = false;
				sourceJarId = '';
				sourceText = '';

				for (const [id, dep] of sorted) {
					if (!dep.available) continue;

					try {
						const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
						const buffer = await adapter.readEntry(entryPath);
						sourceText = buffer.toString('utf-8');
						sourceJarId = id;
						found = true;
						break;
					} catch {
						continue;
					}
				}

				if (!found) {
					return returnError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in any jar`,
						[entryPath],
						['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
					);
				}
			}

			// Build file URI for the class
			const fileUri = uriMapper.toFileUri(sourceJarId, entryPath);

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
				// Request document symbols
				const symbolResult = await lspClient.documentSymbol({
					textDocument: { uri: fileUri },
				});

				// Transform response
				let members: TransformedSymbol[];
				if (symbolResult === null || symbolResult === undefined) {
					members = [];
				} else if (Array.isArray(symbolResult) && symbolResult.length > 0 && isSymbolInformation(symbolResult[0])) {
					// SymbolInformation[] (flat) — defensive fallback
					members = symbolResult.map(transformSymbolInformation);
				} else if (Array.isArray(symbolResult)) {
					// DocumentSymbol[] (hierarchical)
					members = symbolResult.map(transformSymbol);
				} else {
					members = [];
				}

				const envelope = makeSuccess(
					{ jar: sourceJarId, class: className, members },
					{ provenance },
				);

				const summary = `Found ${members.length} top-level member${members.length === 1 ? '' : 's'} in ${className}`;

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			} finally {
				// didClose in finally for cleanup
				try {
					await lspClient.didClose({ textDocument: { uri: fileUri } });
				} catch {
					// Ignore close errors
				}
			}
		},
	);
}
