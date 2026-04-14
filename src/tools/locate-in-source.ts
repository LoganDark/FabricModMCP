import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { cascadeRegex } from '../browsing/cascading-regex.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, sortByPriority } from './tool-helpers.js';
import type { LocateFailure } from './tool-helpers.js';
import type { JarCategory } from '../project/types.js';
import type { CascadeStep } from '../browsing/cascading-regex.js';

interface LocateResult {
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	steps: CascadeStep[];
	offset: number;
	line: number;
	column: number;
}

export function registerLocateInSourceTool(server: McpServer): void {
	server.registerTool(
		'locate_in_source',
		{
			title: 'Locate in Source',
			description: 'Locate a precise position in Java source using cascading regex patterns. Each pattern narrows within the previous match. Returns character offset, line, and column. Use inline flags like (?i) for case-insensitive or (?s) for dotAll matching.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().optional().describe('Specific jar ID to search (default: search all jars containing the class)'),
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				patterns: z.array(z.string()).min(1).describe('Array of regex patterns. Each searches within the previous match. First searches entire source. Use (?i), (?s), (?m) prefixes for per-pattern flags.'),
			},
		},
		async ({ project, jar, class: className, patterns }) => {
			logger.debug('locate_in_source called', { project, jar, class: className, patterns });

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

			const provenance = {
				tool: 'locate_in_source',
				project: loadedProject.name,
				class: className,
			};

			// Specific jar mode
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

			// All-jars mode: search all jars in priority order
			const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
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
					results.push({
						jar: id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						steps: result.steps,
						offset: result.offset,
						line: result.line,
						column: result.column,
					});
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
