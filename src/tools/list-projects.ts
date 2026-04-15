import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { logger } from '../logging/logger.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';

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

			const activeName = projectStore.getActive();
			const projects = projectStore.list().map((p) => ({
				name: p.name,
				memberCount: p.children.size,
				activeChild: p.activeChild ?? null,
				isActive: p.name === activeName,
			}));

			const envelope = makeSuccess({
				projects,
			});

			const text = projects.length === 0
				? 'No projects loaded'
				: projects.map(p => `${p.name} (${p.memberCount} member${p.memberCount === 1 ? '' : 's'})${p.isActive ? ' [active]' : ''}`).join(', ');

			return {
				content: [{ type: 'text' as const, text }],
				structuredContent: envelope,
			};
		},
	);
}
