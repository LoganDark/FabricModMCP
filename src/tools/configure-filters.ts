import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';

export function registerConfigureFiltersTool(server: McpServer): void {
	server.registerTool(
		'configure_filters',
		{
			title: 'Configure Dependency Filters',
			description: TOOL_DESCRIPTIONS.configure_filters,
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
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

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

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
				content: [{ type: 'text' as const, text: `Filter configured: ${filtered.size}/${loadedProject.dependencyJars.size} dependencies visible (mode: ${loadedProject.filterConfig.mode})` }],
				structuredContent: envelope,
			};
		},
	);
}
