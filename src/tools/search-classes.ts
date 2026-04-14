import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { jarReader } from './shared-jar-reader.js';
import { searchClasses } from '../browsing/search.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, getDependenciesForTool } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerSearchClassesTool(server: McpServer): void {
	server.registerTool(
		'search_classes',
		{
			title: 'Search Classes',
			description: TOOL_DESCRIPTIONS.search_classes,
			inputSchema: {
				pattern: z.string().describe('Glob pattern to match against fully-qualified class names. * matches one segment, ** crosses package boundaries.'),
				caseSensitive: z.boolean().optional().describe('Case-sensitive matching (default: false)'),
				kind: z.array(z.string()).optional().describe('Filter by class type: "class", "interface", "enum", "record", "@interface"'),
				jars: PARAMS.jars,
				offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
				limit: z.number().int().min(1).optional().describe('Maximum results to return (default: 250)'),
				project: PARAMS.project,
			},
		},
		async ({ pattern, caseSensitive, kind, jars, offset, limit, project }) => {
			logger.debug('search_classes called', { project, pattern, caseSensitive, kind, jars, offset, limit });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const resolvedDeps = getDependenciesForTool(loadedProject, jars);
			const response = await searchClasses(
				{ pattern, caseSensitive, kind, offset, limit },
				resolvedDeps,
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
