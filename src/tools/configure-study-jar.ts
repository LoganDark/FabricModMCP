import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { logger } from '../logging/logger.js';

export function registerConfigureStudyJarTool(server: McpServer): void {
	server.registerTool(
		'configure_study_jar',
		{
			title: 'Configure Study Jar',
			description: TOOL_DESCRIPTIONS.configure_study_jar,
			inputSchema: {
				project: PARAMS.project,
				names: z.array(z.string()).min(1).describe('Study jar name(s) to configure'),
				autoInclude: z.boolean().optional().describe('Whether to include in default tool results when jars parameter is omitted'),
			},
		},
		async ({ project, names, autoInclude }) => {
			logger.debug('configure_study_jar called', { project, names, autoInclude });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Pre-validate all names exist before any mutation
			for (const name of names) {
				if (!loadedProject.studyJars.has(name)) {
					return returnError(
						'STUDY_JAR_NOT_FOUND',
						`Study jar '${name}' not found on project '${loadedProject.name}'`,
						[name],
						['Use list_study_jars to see available study jars'],
					);
				}
			}

			// Apply configuration
			const updated = names.map(name => {
				const studyJar = loadedProject.studyJars.get(name)!;
				if (autoInclude !== undefined) {
					studyJar.autoInclude = autoInclude;
				}
				return { name, autoInclude: studyJar.autoInclude };
			});

			const envelope = makeSuccess({ updated });

			return {
				content: [{ type: 'text' as const, text: `Configured ${names.length} study jar(s): ${names.join(', ')}` }],
				structuredContent: envelope,
			};
		},
	);
}
