import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { logger } from '../logging/logger.js';

export function registerListProjectsTool(server: McpServer): void {
	server.registerTool(
		'list_projects',
		{
			title: 'List Projects',
			description: 'List all loaded projects with their metadata. Shows name, Minecraft version, mapping era, dependency count, and default status for each project.',
			inputSchema: {},
		},
		async () => {
			logger.debug('list_projects called');

			const defaultName = projectStore.getDefault();
			const projects = projectStore.list().map((p) => ({
				name: p.name,
				rootPath: p.rootPath,
				minecraftVersion: p.gradleConfig.minecraftVersion,
				mappingEra: p.gradleConfig.mappingEra,
				dependencyCount: p.dependencyJars.size,
				isDefault: p.name === defaultName,
			}));

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
