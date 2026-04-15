import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, handleClassSourceError, resolveProjectSafely, returnError, withLspDocument, resolveClassSource, getDependenciesForTool, stripEnrichedSymbol } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';
import { getRootPath } from '../project/compat.js';
import type { TransformedSymbol } from '../browsing/types.js';
import { enrichSymbols } from '../browsing/member-enrichment.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { jarReader } from './shared-jar-reader.js';
import { transformSymbolResponse } from '../browsing/symbol-transform.js';

export function registerListMembersTool(server: McpServer): void {
	server.registerTool(
		'list_members',
		{
			title: 'List Members',
			description: TOOL_DESCRIPTIONS.list_members,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				scope: PARAMS.scope,
				class: PARAMS.class,
				details: DETAIL_PARAMS.member,
			},
		},
		async ({ class: className, jar, scope, project, details }) => {
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
			const sourceResult = await resolveClassSource(loadedProject, className, jar, scope);
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
				const members = transformSymbolResponse(symbolResult);

				// Build resolvePackage that searches all loaded jar indices
				const allDeps = getDependenciesForTool(loadedProject, undefined, scope);
				const resolvePackage = async (packageName: string): Promise<string[]> => {
					const classNames = new Set<string>();
					for (const [id, dep] of allDeps) {
						if (!dep.available) continue;
						try {
							const adapter = createSourceAdapter(jarReader, dep, getRootPath(loadedProject));
							const entries = await adapter.listJavaEntries();
							const cacheKey = dep.sourcesJarPath ?? `fs:${getRootPath(loadedProject)}:${id}`;
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
				const stripped = enriched.map(s => stripEnrichedSymbol(s, details));

				const envelope = makeSuccess(
					{ jar: sourceJarId, class: className, members: stripped },
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
