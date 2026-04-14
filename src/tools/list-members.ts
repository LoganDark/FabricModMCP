import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { SYMBOL_KIND_NAME } from '../jdtls/symbol-kind.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, handleClassSourceError, resolveProjectSafely, returnError, withLspDocument, resolveClassSource, getDependenciesForTool } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { TransformedSymbol } from '../browsing/types.js';
import { enrichSymbols } from '../browsing/member-enrichment.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { jarReader } from './shared-jar-reader.js';

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
			description: TOOL_DESCRIPTIONS.list_members,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				class: PARAMS.class,
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

			const provenance = {
				tool: 'list_members',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Resolve class source from jars
			const sourceResult = await resolveClassSource(loadedProject, className, jar);
			if (!sourceResult.success) return handleClassSourceError(sourceResult, className, loadedProject.name, jar);
			const { sourceJarId, sourceText, entryPath } = sourceResult;

			// Build file URI for the class
			const fileUri = uriMapper.toFileUri(sourceJarId, entryPath);

			return await withLspDocument(lspClient, fileUri, sourceText, async () => {
				// Request document symbols
				const symbolResult = await lspClient.documentSymbol({
					textDocument: { uri: fileUri },
				});

				// Transform response
				let members: TransformedSymbol[];
				if (symbolResult === null || symbolResult === undefined) {
					members = [];
				} else if (Array.isArray(symbolResult) && symbolResult.length > 0 && isSymbolInformation(symbolResult[0])) {
					// SymbolInformation[] (flat) -- defensive fallback
					members = symbolResult.map(transformSymbolInformation);
				} else if (Array.isArray(symbolResult)) {
					// DocumentSymbol[] (hierarchical)
					members = symbolResult.map(transformSymbol);
				} else {
					members = [];
				}

				// Build resolvePackage that searches all loaded jar indices
				const allDeps = getDependenciesForTool(loadedProject);
				const resolvePackage = async (packageName: string): Promise<string[]> => {
					const classNames = new Set<string>();
					for (const [id, dep] of allDeps) {
						if (!dep.available) continue;
						try {
							const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
							const entries = await adapter.listJavaEntries();
							const cacheKey = dep.sourcesJarPath ?? `fs:${loadedProject.rootPath}:${id}`;
							const index = getOrBuildIndex(entries, cacheKey);
							for (const entry of index.getClasses(packageName)) {
								classNames.add(entry.className);
							}
						} catch { /* skip unavailable jars */ }
					}
					return [...classNames];
				};

				// Enrich symbols with FQNs, parameters, return types, field types
				const classFqn = entryPath.replace(/\.java$/, '').replaceAll('/', '.');
				const enriched = await enrichSymbols(members, sourceText, classFqn, resolvePackage);

				const envelope = makeSuccess(
					{ jar: sourceJarId, class: className, members: enriched },
					{ provenance },
				);

				const summary = `Found ${members.length} top-level member${members.length === 1 ? '' : 's'} in ${className}`;

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			});
		},
	);
}
