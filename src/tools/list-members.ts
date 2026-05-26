import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, handleClassSourceError, resolveProjectSafely, requireDependencies, returnError, withLspDocument, resolveClassSource, getDependenciesForTool, stripEnrichedSymbol, getRootPathForScope } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';
import type { TransformedSymbol } from '../browsing/types.js';
import { enrichSymbols } from '../browsing/member-enrichment.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { jarReader } from './shared-jar-reader.js';
import { transformSymbolResponse } from '../browsing/symbol-transform.js';

function renderMember(m: Record<string, unknown>, index: number, indent: string): string {
	const name = m.name as string;
	const kind = m.kind as string;
	const memberFqn = m.memberFqn as string | undefined;
	const deprecated = m.deprecated as boolean | undefined;
	const range = m.range as { start: { line: number }; end: { line: number } } | undefined;
	const parameters = m.parameters as Array<{ name: string; type: { display: string } }> | undefined;
	const returnType = m.returnType as { display: string } | null | undefined;
	const fieldType = m.fieldType as { display: string } | undefined;
	const children = (m.children as Record<string, unknown>[] | undefined) ?? [];

	let signature: string;
	if (parameters !== undefined && returnType !== undefined) {
		const params = parameters.map(p => `${p.type.display} ${p.name}`).join(', ');
		const ret = returnType ? `: ${returnType.display}` : '';
		signature = `${name}(${params})${ret}`;
	} else if (fieldType !== undefined) {
		signature = `${name}: ${fieldType.display}`;
	} else {
		signature = name;
	}

	const tag = deprecated ? ' [deprecated]' : '';
	const lines = range ? ` (line ${range.start.line + 1}-${range.end.line + 1})` : '';
	const head = `${indent}${index}. ${kind} ${signature}${tag}${lines}${memberFqn ? `  [${memberFqn}]` : ''}`;

	if (children.length === 0) return head;
	const childLines = children.map((c, i) => renderMember(c, i + 1, indent + '   ')).join('\n');
	return `${head}\n${childLines}`;
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

			const depCheck = requireDependencies(loadedProject, scope);
			if (depCheck) return depCheck;

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
							const adapter = createSourceAdapter(jarReader, dep, getRootPathForScope(loadedProject, scope));
							const entries = await adapter.listJavaEntries();
							const cacheKey = dep.sourcesJarPath ?? `fs:${getRootPathForScope(loadedProject, scope)}:${id}`;
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

				const content: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
				if (stripped.length > 0) {
					const body = stripped.map((m, i) => renderMember(m, i + 1, '')).join('\n');
					content.push({ type: 'text' as const, text: body });
				}

				return {
					content,
					structuredContent: envelope,
				};
			});
		},
	);
}
