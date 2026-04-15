import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';
import { shutdownJdtLs } from '../jdtls/client.js';
import { cleanupTempDir } from '../jdtls/workspace.js';

export function registerRemoveProjectTool(server: McpServer): void {
	server.registerTool(
		'remove_project',
		{
			title: 'Remove Project',
			description: TOOL_DESCRIPTIONS.remove_project,
			inputSchema: {
				project: z.string().describe('Name of the project to remove'),
			},
		},
		async ({ project }) => {
			logger.debug('remove_project called', { project });

			const proj = projectStore.get(project);
			if (!proj) {
				return returnError(
					'PROJECT_NOT_FOUND',
					`Project '${project}' not found`,
					[project],
					['Check available projects with list_projects'],
				);
			}

			// Shutdown JDT LS if active
			if (proj.jdtls?.available && proj.jdtls.client && proj.jdtls.process) {
				try {
					await shutdownJdtLs(proj.jdtls.client, proj.jdtls.process);
				} catch (err) {
					logger.warn(`JDT LS shutdown error for ${project}: ${err}`);
				}
			}
			if (proj.jdtls?.tempDir) {
				try {
					await cleanupTempDir(proj.jdtls.tempDir);
				} catch (err) {
					logger.warn(`Temp dir cleanup error for ${project}: ${err}`);
				}
			}

			// Close jar handles for this project
			await jarReader.closeProject(project);

			// Remove from store (also clears active if applicable)
			projectStore.delete(project);

			const envelope = makeSuccess({
				removed: project,
			}, {
				provenance: { tool: 'remove_project', project },
			});

			return {
				content: [{ type: 'text' as const, text: `Removed project '${project}'` }],
				structuredContent: envelope,
			};
		},
	);
}
