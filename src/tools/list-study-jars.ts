import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { logger } from '../logging/logger.js';
import { isWorkspaceSynced } from '../jdtls/workspace-sync.js';

export function registerListStudyJarsTool(server: McpServer): void {
	server.registerTool(
		'list_study_jars',
		{
			title: 'List Study Jars',
			description: TOOL_DESCRIPTIONS.list_study_jars,
			inputSchema: {
				project: PARAMS.project,
			},
		},
		async ({ project }) => {
			logger.debug('list_study_jars called', { project });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const jars: Array<{ name: string; path: string; autoInclude: boolean; stats: { classCount: number; packageCount: number }; workspaceSynced: boolean }> = [];
			for (const [name, child] of loadedProject.children) {
				if (child.kind === 'study-jar') {
					jars.push({
						name,
						path: child.jarPath,
						autoInclude: child.autoInclude,
						stats: child.stats,
						workspaceSynced: isWorkspaceSynced(name, loadedProject.jdtls),
					});
				}
			}

			const envelope = makeSuccess({
				jars,
				count: jars.length,
			});

			return {
				content: [{ type: 'text' as const, text: jars.length === 0 ? 'No study jars configured' : `${jars.length} study jar(s): ${jars.map(j => j.name).join(', ')}` }],
				structuredContent: envelope,
			};
		},
	);
}
