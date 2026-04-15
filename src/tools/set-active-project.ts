import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { logger } from '../logging/logger.js';
import { returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';

export function registerSetActiveProjectTool(server: McpServer): void {
	server.registerTool(
		'set_active_project',
		{
			title: 'Set Active Project',
			description: TOOL_DESCRIPTIONS.set_active_project,
			inputSchema: {
				project: z.string().describe('Name of the project to set as active'),
			},
		},
		async ({ project }) => {
			logger.debug('set_active_project called', { project });

			try {
				projectStore.setActive(project);

				const envelope = makeSuccess({
					activeProject: project,
				});

				return {
					content: [{ type: 'text' as const, text: `Active project set to '${project}'` }],
					structuredContent: envelope,
				};
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					return returnError(de.code, de.message, de.tried ?? [], de.suggestions);
				}
				throw error;
			}
		},
	);
}
