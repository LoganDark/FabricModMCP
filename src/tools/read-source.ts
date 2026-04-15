import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getAllDependencies, getResolvedDependencies } from '../project/dependency-resolver.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, handleClassSourceError, sortByPriority, resolveProjectSafely, returnError, resolveClassSource } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';
import { getRootPath, getFilterConfig } from '../project/compat.js';
import { sliceLines } from '../browsing/line-slicer.js';
import type { SourceResult } from '../browsing/types.js';

export function registerReadSourceTool(server: McpServer): void {
	server.registerTool(
		'read_source',
		{
			title: 'Read Source',
			description: TOOL_DESCRIPTIONS.read_source,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				class: PARAMS.class,
				startLine: PARAMS.startLine,
				lineCount: PARAMS.lineCount,
				details: DETAIL_PARAMS.source,
			},
		},
		async ({ project, jar, class: className, startLine, lineCount, details }) => {
			logger.debug('read_source called', { project, jar, class: className, startLine, lineCount });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const entryPath = classNameToEntryPath(className);

			// Validate: line-range params require a specific jar
			if ((startLine !== undefined || lineCount !== undefined) && jar === undefined) {
				const allDeps = getAllDependencies(loadedProject);
				const jarIds = Array.from(allDeps.keys());
				return returnError(
					'JAR_REQUIRED',
					`Line-range parameters (startLine/lineCount) require specifying a jar. Available jars: ${jarIds.join(', ')}`,
					[],
					['Specify the jar parameter to use line-range reading', 'Use get_project_metadata with include_jar_inventory to see all available jars'],
				);
			}

			// If specific jar is requested
			if (jar !== undefined) {
				const sourceResult = await resolveClassSource(loadedProject, className, jar);
				if (!sourceResult.success) return handleClassSourceError(sourceResult, className, loadedProject.name, jar);

				const dep = getAllDependencies(loadedProject).get(jar)!;
				const sliced = sliceLines(sourceResult.sourceText, startLine, lineCount);

				const sources: SourceResult[] = [{
					jar: dep.id,
					category: dep.category,
					...(details?.provenance ? { provenanceChains: dep.provenanceChains } : {}),
					source: sliced.source,
					startLine: sliced.startLine,
					endLine: sliced.endLine,
					totalLineCount: sliced.totalLineCount,
					truncated: sliced.truncated,
				}];

				const envelope = makeSuccess({ sources }, {
					provenance: {
						tool: 'read_source',
						project: loadedProject.name,
						class: className,
					},
				});

				return {
					content: [{ type: 'text' as const, text: `Read ${className} from ${dep.id} (${sliced.totalLineCount} lines${sliced.truncated ? `, showing ${sliced.startLine}-${sliced.endLine}` : ''})` }],
					structuredContent: envelope,
				};
			}

			// Search all jars in priority order
			const filtered = getFilteredDependencies(getResolvedDependencies(loadedProject), getFilterConfig(loadedProject));
			const sorted = sortByPriority(Array.from(filtered.entries()));

			const sources: SourceResult[] = [];

			for (const [id, dep] of sorted) {
				if (!dep.available) continue;

				try {
					const adapter = createSourceAdapter(jarReader, dep, getRootPath(loadedProject));
					const buffer = await adapter.readEntry(entryPath);
					const source = buffer.toString('utf-8');
					const sliced = sliceLines(source);

					sources.push({
						jar: id,
						category: dep.category,
						...(details?.provenance ? { provenanceChains: dep.provenanceChains } : {}),
						source: sliced.source,
						startLine: sliced.startLine,
						endLine: sliced.endLine,
						totalLineCount: sliced.totalLineCount,
						truncated: sliced.truncated,
					});
				} catch {
					// Class not in this jar, continue to next
				}
			}

			if (sources.length === 0) {
				return returnError(
					'CLASS_NOT_FOUND',
					`Class '${className}' not found in any jar`,
					[entryPath],
					['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
				);
			}

			const envelope = makeSuccess({ sources }, {
				provenance: {
					tool: 'read_source',
					project: loadedProject.name,
					class: className,
				},
			});

			return {
				content: [{ type: 'text' as const, text: `Read ${className} from ${sources.length} jar${sources.length === 1 ? '' : 's'} (${sources[0].jar}${sources.length > 1 ? `, +${sources.length - 1} more` : ''})` }],
				structuredContent: envelope,
			};
		},
	);
}
