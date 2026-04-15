import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { jarReader } from './shared-jar-reader.js';
import { searchClasses } from '../browsing/search.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, getDependenciesForTool, stripClassInfo, getRootPathForScope } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';

export function registerSearchClassesTool(server: McpServer): void {
	server.registerTool(
		'search_classes',
		{
			title: 'Search Classes',
			description: TOOL_DESCRIPTIONS.search_classes,
			inputSchema: {
				project: PARAMS.project,
				jars: PARAMS.jars,
				scope: PARAMS.scope,
				pattern: z.string().describe('Glob pattern to match against fully-qualified class names. * matches one segment, ** crosses package boundaries.'),
				caseSensitive: z.boolean().optional().describe('Case-sensitive matching (default: false)'),
				kind: z.array(z.string()).optional().describe('Filter by class type: "class", "interface", "enum", "record", "@interface"'),
				limit: z.number().int().min(1).optional().describe('Maximum results to return (default: 250)'),
				offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
				details: DETAIL_PARAMS.class,
			},
		},
		async ({ pattern, caseSensitive, kind, jars, scope, offset, limit, project, details }) => {
			logger.debug('search_classes called', { project, pattern, caseSensitive, kind, jars, offset, limit });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const resolvedDeps = getDependenciesForTool(loadedProject, jars, scope);
			const response = await searchClasses(
				{ pattern, caseSensitive, kind, offset, limit },
				resolvedDeps,
				getRootPathForScope(loadedProject, scope),
				jarReader,
			);

			const strippedResults = response.results.map(c => stripClassInfo(c, details));
			const strippedResponse = { ...response, results: strippedResults };

			const envelope = makeSuccess(strippedResponse, {
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
