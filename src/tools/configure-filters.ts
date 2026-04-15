import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getResolvedDependencies } from '../project/dependency-resolver.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { getSoleFabricMod } from '../project/compat.js';

export function registerConfigureFiltersTool(server: McpServer): void {
	server.registerTool(
		'configure_filters',
		{
			title: 'Configure Dependency Filters',
			description: TOOL_DESCRIPTIONS.configure_filters,
			inputSchema: {
				project: PARAMS.project,
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

			const mod = getSoleFabricMod(loadedProject);

			if (mode !== undefined) {
				mod.filterConfig.mode = mode;
			}

			if (patterns !== undefined) {
				mod.filterConfig.patterns = patterns;
			}

			const resolvedDeps = getResolvedDependencies(loadedProject);
			const filtered = getFilteredDependencies(resolvedDeps, mod.filterConfig);

			const envelope = makeSuccess({
				filterConfig: mod.filterConfig,
				totalDependencies: resolvedDeps.size,
				filteredDependencies: filtered.size,
			});

			return {
				content: [{ type: 'text' as const, text: `Filter configured: ${filtered.size}/${resolvedDeps.size} dependencies visible (mode: ${mod.filterConfig.mode})` }],
				structuredContent: envelope,
			};
		},
	);
}
