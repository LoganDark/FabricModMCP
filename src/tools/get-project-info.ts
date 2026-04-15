import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerGetProjectInfoTool(server: McpServer): void {
	server.registerTool(
		'get_project_info',
		{
			title: 'Get Project Info',
			description: TOOL_DESCRIPTIONS.get_project_info,
			inputSchema: {
				project: PARAMS.project,
			},
		},
		async ({ project }) => {
			logger.debug('get_project_info called', { project });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const members: Array<Record<string, unknown>> = [];
			for (const [name, child] of loadedProject.children) {
				if (child.kind === 'fabric-mod') {
					members.push({
						name,
						kind: 'fabric-mod' as const,
						minecraftVersion: child.gradleConfig.minecraftVersion,
						mappingEra: child.gradleConfig.mappingEra,
						dependencyCount: child.dependencyJars.size,
					});
				} else if (child.kind === 'study-jar') {
					members.push({
						name,
						kind: 'study-jar' as const,
						jarPath: child.jarPath,
						autoInclude: child.autoInclude,
					});
				}
			}

			const envelope = makeSuccess(
				{
					project: loadedProject.name,
					activeChild: loadedProject.activeChild ?? null,
					memberCount: members.length,
					members,
				},
				{
					provenance: {
						tool: 'get_project_info',
						project: loadedProject.name,
					},
				},
			);

			const text = `Project '${loadedProject.name}': ${members.length} member${members.length === 1 ? '' : 's'}`;
			return {
				content: [{ type: 'text' as const, text }],
				structuredContent: envelope,
			};
		},
	);
}
