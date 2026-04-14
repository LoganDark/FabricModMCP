import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeSuccess } from '../types/envelope.js';
import { getAllDependencies, getResolvedDependencies } from '../project/dependency-resolver.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { cascadeRegex } from '../browsing/cascading-regex.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, sortByPriority, resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { LocateFailure } from './tool-helpers.js';
import type { LocateResult, LocateResultContext } from '../browsing/types.js';

function extractContext(
	source: string,
	line: number,
	linesBefore: number,
	linesAfter: number,
): LocateResultContext {
	const lines = source.split('\n');
	const totalLines = lines.length;
	const startLine = Math.max(1, line - linesBefore);
	const endLine = Math.min(totalLines, line + linesAfter);
	const text = lines.slice(startLine - 1, endLine).join('\n');
	return { text, startLine, endLine };
}

export function registerLocateInSourceTool(server: McpServer): void {
	server.registerTool(
		'locate_in_source',
		{
			title: 'Locate in Source',
			description: TOOL_DESCRIPTIONS.locate_in_source,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				class: PARAMS.class,
				patterns: PARAMS.patterns,
				context: z.object({
					linesBefore: z.number().int().min(0).describe('Number of lines to include before the match'),
					linesAfter: z.number().int().min(0).describe('Number of lines to include after the match'),
				}).optional().describe('When provided, extends match to whole line boundaries and includes surrounding lines. Even {linesBefore: 0, linesAfter: 0} extends to the full line.'),
			},
		},
		async ({ project, jar, class: className, patterns, context }) => {
			logger.debug('locate_in_source called', { project, jar, class: className, patterns });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const entryPath = classNameToEntryPath(className);

			const provenance = {
				tool: 'locate_in_source',
				project: loadedProject.name,
				class: className,
			};

			// Specific jar mode
			if (jar !== undefined) {
				const dep = getAllDependencies(loadedProject).get(jar);
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
					const source = buffer.toString('utf-8');
					const result = cascadeRegex(source, patterns);

					if (result.success) {
						const locateResult: LocateResult = {
							jar: dep.id,
							category: dep.category,
							provenanceChains: dep.provenanceChains,
							steps: result.steps,
							offset: result.offset,
							line: result.line,
							column: result.column,
						};
						if (context !== undefined) {
							locateResult.context = extractContext(source, result.line, context.linesBefore, context.linesAfter);
						}
						const envelope = makeSuccess({ results: [locateResult], failures: [] }, { provenance });
						return {
							content: [{ type: 'text' as const, text: `Located in ${className} (${dep.id}) at line ${result.line}, col ${result.column}` }],
							structuredContent: envelope,
						};
					} else {
						const locateFailure: LocateFailure = {
							jar: dep.id,
							category: dep.category,
							provenanceChains: dep.provenanceChains,
							steps: result.steps,
							failedStep: result.failedStep,
							error: result.error,
						};
						const envelope = makeSuccess({ results: [], failures: [locateFailure] }, { provenance });
						return {
							content: [{ type: 'text' as const, text: `Cascade failed at step ${result.failedStep + 1} in ${className} (${dep.id})` }],
							structuredContent: envelope,
						};
					}
				} catch {
					return returnError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in jar '${jar}'`,
						[entryPath],
						['Check the fully-qualified class name'],
					);
				}
			}

			// All-jars mode: search all jars in priority order
			const filtered = getFilteredDependencies(getResolvedDependencies(loadedProject), loadedProject.filterConfig);
			const sorted = sortByPriority(Array.from(filtered.entries()));

			const results: LocateResult[] = [];
			const failures: LocateFailure[] = [];

			for (const [id, dep] of sorted) {
				if (!dep.available) continue;

				let source: string;
				try {
					const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
					const buffer = await adapter.readEntry(entryPath);
					source = buffer.toString('utf-8');
				} catch {
					// Class not in this jar, continue to next
					continue;
				}

				const result = cascadeRegex(source, patterns);

				if (result.success) {
					const locateResult: LocateResult = {
						jar: id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						steps: result.steps,
						offset: result.offset,
						line: result.line,
						column: result.column,
					};
					if (context !== undefined) {
						locateResult.context = extractContext(source, result.line, context.linesBefore, context.linesAfter);
					}
					results.push(locateResult);
				} else {
					failures.push({
						jar: id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						steps: result.steps,
						failedStep: result.failedStep,
						error: result.error,
					});
				}
			}

			if (results.length === 0 && failures.length === 0) {
				return returnError(
					'CLASS_NOT_FOUND',
					`Class '${className}' not found in any jar`,
					[entryPath],
					['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
				);
			}

			const envelope = makeSuccess({ results, failures }, { provenance });
			if (results.length > 0) {
				const first = results[0];
				return {
					content: [{ type: 'text' as const, text: `Located in ${className} (${first.jar}) at line ${first.line}, col ${first.column}${results.length > 1 ? ` (+${results.length - 1} more)` : ''}${failures.length > 0 ? `, ${failures.length} failed` : ''}` }],
					structuredContent: envelope,
				};
			}
			return {
				content: [{ type: 'text' as const, text: `Cascade failed in ${failures.length} jar${failures.length === 1 ? '' : 's'} for ${className}` }],
				structuredContent: envelope,
			};
		},
	);
}
