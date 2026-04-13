import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';

export function registerUnloadProjectTool(server: McpServer): void {
	server.registerTool(
		'unload_project',
		{
			title: 'Unload Project',
			description: 'Unload a project by name. Closes associated jar handles and removes it from the session. If the unloaded project was the default, the default is cleared.',
			inputSchema: {
				project: z.string().describe('Name of the project to unload'),
			},
		},
		async ({ project }) => {
			logger.debug('unload_project called', { project });

			try {
				// Verify project exists
				projectStore.resolveProject(project);

				// Close jar handles for this project
				await jarReader.closeProject(project);

				// Remove from store (also clears default if applicable)
				projectStore.delete(project);

				const envelope = makeSuccess({
					name: project,
					message: 'Project unloaded',
				});

				return {
					content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
					structuredContent: envelope,
				};
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					const envelope = makeError(de.code, de.message, de.tried ?? [], de.suggestions);
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
						structuredContent: envelope,
					};
				}
				throw error;
			}
		},
	);
}
