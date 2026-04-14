import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, sortByPriority } from './tool-helpers.js';
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

			const entryPath = classNameToEntryPath(className);

			// If specific jar is requested
			if (jar !== undefined) {
				const dep = loadedProject.dependencyJars.get(jar);
				if (!dep) {
					const envelope = makeError(
						'JAR_NOT_FOUND',
						`Jar '${jar}' not found in project '${loadedProject.name}'`,
						[jar],
						['Check available jars with get_project_metadata'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}

				if (!dep.available) {
					const envelope = makeError(
						'JAR_NOT_AVAILABLE',
						`Sources for jar '${jar}' are not available`,
						[jar],
						['The dependency does not have a sources jar'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
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
					const envelope = makeError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in jar '${jar}'`,
						[entryPath],
						['Check the fully-qualified class name'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
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
				const envelope = makeError(
					'CLASS_NOT_FOUND',
					`Class '${className}' not found in any jar`,
					[entryPath],
					['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
				);
				return {
					content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
					structuredContent: envelope,
				};
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
