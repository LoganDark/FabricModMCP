import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { jarReader } from './shared-jar-reader.js';
import { searchClasses } from '../browsing/search.js';
import { logger } from '../logging/logger.js';

export function registerSearchClassesTool(server: McpServer): void {
	server.registerTool(
		'search_classes',
		{
			title: 'Search Classes',
			description: 'Search for Java classes by glob pattern across all sources in a project. Use * to match a single name/package segment, ** to cross package boundaries. Examples: "*Client" matches MinecraftClient, "net.minecraft.client.*" matches all classes in that package, "**.*Registry" matches any Registry class in any package.',
			inputSchema: {
				pattern: z.string().describe('Glob pattern to match against fully-qualified class names. * matches one segment, ** crosses package boundaries.'),
				caseSensitive: z.boolean().optional().describe('Case-sensitive matching (default: false)'),
				kind: z.array(z.string()).optional().describe('Filter by class type: "class", "interface", "enum", "record", "@interface"'),
				jars: z.array(z.string()).optional().describe('Jar IDs or glob patterns to scope search (default: all jars)'),
				offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
				limit: z.number().int().min(1).optional().describe('Maximum results to return (default: 250)'),
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
			},
		},
		async ({ pattern, caseSensitive, kind, jars, offset, limit, project }) => {
			logger.debug('search_classes called', { project, pattern, caseSensitive, kind, jars, offset, limit });

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

			const response = await searchClasses(
				{ pattern, caseSensitive, kind, jars, offset, limit },
				loadedProject.dependencyJars,
				loadedProject.filterConfig,
				loadedProject.rootPath,
				jarReader,
			);

			const envelope = makeSuccess(response, {
				provenance: {
					tool: 'search_classes',
					project: loadedProject.name,
					pattern,
				},
			});

			return {
				content: [{ type: 'text' as const, text: `Found ${response.results.length} class${response.results.length === 1 ? '' : 'es'} matching '${pattern}' (${response.total} total, showing ${response.offset}-${response.offset + response.results.length})` }],
				structuredContent: envelope,
			};
		},
	);
}
