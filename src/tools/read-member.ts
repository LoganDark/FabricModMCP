import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, handleClassSourceError, resolveProjectSafely, returnError, withLspDocument, resolveClassSource, getDependenciesForTool } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';
import { getRootPath } from '../project/compat.js';
import type { MemberResult } from '../browsing/types.js';
import { enrichSymbols } from '../browsing/member-enrichment.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { jarReader } from './shared-jar-reader.js';
import { transformSymbolResponse } from '../browsing/symbol-transform.js';
import { parseMemberFqn, extractMemberSource } from '../browsing/member-extractor.js';
import { getAllDependencies } from '../project/dependency-resolver.js';

export function registerReadMemberTool(server: McpServer): void {
	server.registerTool(
		'read_member',
		{
			title: 'Read Member',
			description: TOOL_DESCRIPTIONS.read_member,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				memberFqn: z.string().describe('Member FQN from list_members or search_symbols (e.g., net.minecraft.client.MinecraftClient#tick())'),
				linesBefore: PARAMS.linesBefore,
				linesAfter: PARAMS.linesAfter,
				details: DETAIL_PARAMS.source,
			},
		},
		async ({ project, jar, memberFqn, linesBefore, linesAfter, details }) => {
			logger.debug('read_member called', { project, jar, memberFqn });

			// Parse and validate FQN
			const parsed = parseMemberFqn(memberFqn);
			if (!parsed) {
				return returnError(
					'INVALID_FQN',
					`Malformed member FQN: '${memberFqn}'`,
					[memberFqn],
					['FQN format: ClassName#method() or ClassName#field:'],
				);
			}

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
				tool: 'read_member',
				project: loadedProject.name,
				memberFqn,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// For inner class FQNs (className contains $), use the outer class for file lookup
			const outerClassName = parsed.className.includes('$')
				? parsed.className.substring(0, parsed.className.indexOf('$'))
				: parsed.className;

			// Resolve class source from jars
			const sourceResult = await resolveClassSource(loadedProject, outerClassName, jar);
			if (!sourceResult.success) return handleClassSourceError(sourceResult, outerClassName, loadedProject.name, jar);
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

				// Build resolvePackage for enrichment
				const allDeps = getDependenciesForTool(loadedProject);
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

				// Extract member source
				const extractions = extractMemberSource(sourceText, enriched, memberFqn, linesBefore, linesAfter);

				if (extractions.length === 0) {
					return returnError(
						'MEMBER_NOT_FOUND',
						`Member '${memberFqn}' not found in class '${outerClassName}'`,
						[memberFqn],
						['Check the member FQN from list_members output', 'Use list_members to see available members'],
					);
				}

				// Look up jar metadata for result
				const dep = getAllDependencies(loadedProject).get(sourceJarId)!;

				const results: MemberResult[] = extractions.map(ext => ({
					jar: sourceJarId,
					category: dep.category,
					...(details?.provenance ? { provenanceChains: dep.provenanceChains } : {}),
					memberFqn: ext.memberFqn,
					kind: ext.kind,
					source: ext.source,
					startLine: ext.startLine,
					endLine: ext.endLine,
					lineCount: ext.lineCount,
					memberStartLine: ext.memberStartLine,
					memberEndLine: ext.memberEndLine,
				}));

				const envelope = makeSuccess({ members: results }, { provenance });

				const summary = extractions.length === 1
					? `Read ${memberFqn} from ${sourceJarId} (${extractions[0].lineCount} lines)`
					: `Read ${extractions.length} overloads of ${memberFqn} from ${sourceJarId}`;

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			});
		},
	);
}
