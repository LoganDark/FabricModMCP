import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getResolvedDependencies } from '../project/dependency-resolver.js';
import { projectStore } from '../state/project-store.js';
import { logger } from '../logging/logger.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';
import { getRootPath, getGradleConfig } from '../project/compat.js';

export function registerListProjectsTool(server: McpServer): void {
	server.registerTool(
		'list_projects',
		{
			title: 'List Projects',
			description: TOOL_DESCRIPTIONS.list_projects,
			inputSchema: {},
		},
		async () => {
			logger.debug('list_projects called');

			const defaultName = projectStore.getActive();
			const projects = projectStore.list().map((p) => {
				const gc = getGradleConfig(p);
				return {
					name: p.name,
					rootPath: getRootPath(p),
					minecraftVersion: gc.minecraftVersion,
					mappingEra: gc.mappingEra,
					dependencyCount: getResolvedDependencies(p).size,
					isDefault: p.name === defaultName,
				};
			});

			const envelope = makeSuccess({
				projects,
				count: projects.length,
			});

			return {
				content: [{ type: 'text' as const, text: `${projects.length} project${projects.length === 1 ? '' : 's'} loaded${defaultName ? ` (default: ${defaultName})` : ''}` }],
				structuredContent: envelope,
			};
		},
	);
}
