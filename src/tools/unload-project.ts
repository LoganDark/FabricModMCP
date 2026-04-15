import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { shutdownJdtLs } from '../jdtls/client.js';
import { cleanupTempDir } from '../jdtls/workspace.js';

export function registerUnloadProjectTool(server: McpServer): void {
	server.registerTool(
		'unload_project',
		{
			title: 'Unload Project',
			description: TOOL_DESCRIPTIONS.unload_project,
			inputSchema: {
				project: z.string().describe('Name of the project to unload'),
				scope: PARAMS.scope,
			},
		},
		async ({ project, scope }) => {
			logger.debug('unload_project called', { project, scope });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Scoped unload: remove just the specified child
			if (scope) {
				const child = loadedProject.children.get(scope);
				if (!child) {
					return returnError(
						'CHILD_NOT_FOUND',
						`Child '${scope}' not found in project '${loadedProject.name}'`,
						[scope],
						['Check available children with get_project_metadata'],
					);
				}

				loadedProject.children.delete(scope);
				logger.info(`Removed child '${scope}' from project '${loadedProject.name}'`);

				const envelope = makeSuccess({
					name: loadedProject.name,
					child: scope,
					message: `Child '${scope}' removed from project`,
				});

				return {
					content: [{ type: 'text' as const, text: `Removed child '${scope}' from project '${loadedProject.name}'` }],
					structuredContent: envelope,
				};
			}

			// Full project unload
			// Shutdown JDT LS if active
			if (loadedProject.jdtls?.available && loadedProject.jdtls.client && loadedProject.jdtls.process) {
				try {
					await shutdownJdtLs(loadedProject.jdtls.client, loadedProject.jdtls.process);
				} catch (err) {
					logger.warn(`JDT LS shutdown error for ${project}: ${err}`);
				}
			}
			if (loadedProject.jdtls?.tempDir) {
				try {
					await cleanupTempDir(loadedProject.jdtls.tempDir);
				} catch (err) {
					logger.warn(`Temp dir cleanup error for ${project}: ${err}`);
				}
			}

			// Close jar handles for this project
			await jarReader.closeProject(project);

			// Remove from store (also clears default if applicable)
			projectStore.delete(project);

			const envelope = makeSuccess({
				name: project,
				message: 'Project unloaded',
			});

			return {
				content: [{ type: 'text' as const, text: `Unloaded project '${project}'` }],
				structuredContent: envelope,
			};
		},
	);
}
