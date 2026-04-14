import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, sortByPriority, resolveProjectSafely, returnError } from './tool-helpers.js';
import type { JarCategory } from '../project/types.js';

interface SourceResult {
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	source: string;
	lineCount: number;
}

export function registerReadSourceTool(server: McpServer): void {
	server.registerTool(
		'read_source',
		{
			title: 'Read Source',
			description: 'Read the full source code of a Java class by fully-qualified name. Returns source from all matching jars with provenance when no specific jar is specified.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().optional().describe('Specific jar ID to read from (default: search all jars)'),
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
			},
		},
		async ({ project, jar, class: className }) => {
			logger.debug('read_source called', { project, jar, class: className });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const entryPath = classNameToEntryPath(className);

			// If specific jar is requested
			if (jar !== undefined) {
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
					const source = buffer.toString('utf-8');
					const lineCount = source.split('\n').length;

					const sources: SourceResult[] = [{
						jar: dep.id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						source,
						lineCount,
					}];

					const envelope = makeSuccess({ sources }, {
						provenance: {
							tool: 'read_source',
							project: loadedProject.name,
							class: className,
						},
					});

					return {
						content: [{ type: 'text' as const, text: `Read ${className} from ${dep.id} (${lineCount} lines)` }],
						structuredContent: envelope,
					};
				} catch {
					return returnError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in jar '${jar}'`,
						[entryPath],
						['Check the fully-qualified class name'],
					);
				}
			}

			// Search all jars in priority order
			const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
			const sorted = sortByPriority(Array.from(filtered.entries()));

			const sources: SourceResult[] = [];

			for (const [id, dep] of sorted) {
				if (!dep.available) continue;

				try {
					const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
					const buffer = await adapter.readEntry(entryPath);
					const source = buffer.toString('utf-8');
					const lineCount = source.split('\n').length;

					sources.push({
						jar: id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						source,
						lineCount,
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
