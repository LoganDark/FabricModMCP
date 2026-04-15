import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import type { Project } from '../project/types.js';
import { logger } from '../logging/logger.js';
import { returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';
import { initJdtLsSession } from '../jdtls/startup.js';

export function registerCreateProjectTool(server: McpServer): void {
	server.registerTool(
		'create_project',
		{
			title: 'Create Project',
			description: TOOL_DESCRIPTIONS.create_project,
			inputSchema: {
				name: z.string().describe('Name for the new project'),
			},
		},
		async ({ name }) => {
			logger.debug('create_project called', { name });

			try {
				const project: Project = {
					name,
					children: new Map(),
				};
				projectStore.set(name, project);
				project.jdtls = await initJdtLsSession();

				const envelope = makeSuccess({
					name,
					jdtlsAvailable: project.jdtls.available,
					...(project.jdtls.failureReason ? { jdtlsWarning: project.jdtls.failureReason } : {}),
				}, {
					provenance: { tool: 'create_project', project: name },
				});

				return {
					content: [{ type: 'text' as const, text: `Created project '${name}'${project.jdtls.available ? ' (JDT LS ready)' : ' (JDT LS unavailable: ' + (project.jdtls.failureReason ?? 'unknown') + ')'}` }],
					structuredContent: envelope,
				};
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					return returnError(de.code, de.message, de.tried ?? [name], de.suggestions);
				}
				throw error;
			}
		},
	);
}
