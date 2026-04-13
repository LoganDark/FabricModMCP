import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { logger } from '../logging/logger.js';

export function registerConfigureFiltersTool(server: McpServer): void {
	server.registerTool(
		'configure_filters',
		{
			title: 'Configure Dependency Filters',
			description: 'Configure include/exclude filtering for dependency jars. In include-all mode (default), patterns define what to EXCLUDE. In exclude-all mode, patterns define what to INCLUDE. "minecraft" and "src" are always included regardless of filter.',
			inputSchema: {
				project: z.string().describe('Project name'),
				mode: z.enum(['include-all', 'exclude-all']).optional().describe(
					'Filter mode. include-all (default): patterns define what to EXCLUDE. exclude-all: patterns define what to INCLUDE.',
				),
				patterns: z.array(z.string()).optional().describe(
					'Glob patterns matching jar identifiers. Use * for single-level (net.fabricmc.fabric-api:*) and ** for multi-level (**:gson)',
				),
			},
		},
		async ({ project, mode, patterns }) => {
			logger.debug('configure_filters called', { project, mode, patterns });

			const loadedProject = projectStore.get(project);
			if (!loadedProject) {
				const envelope = makeError(
					'PROJECT_NOT_FOUND',
					`Project '${project}' is not loaded`,
					[project],
					['Load the project first using the load_project tool'],
				);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
					structuredContent: envelope,
				};
			}

			if (mode !== undefined) {
				loadedProject.filterConfig.mode = mode;
			}

			if (patterns !== undefined) {
				loadedProject.filterConfig.patterns = patterns;
			}

			const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);

			const envelope = makeSuccess({
				filterConfig: loadedProject.filterConfig,
				totalDependencies: loadedProject.dependencyJars.size,
				filteredDependencies: filtered.size,
			});

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
				structuredContent: envelope,
			};
		},
	);
}
