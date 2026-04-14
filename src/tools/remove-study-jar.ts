import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { jarReader } from './shared-jar-reader.js';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { logger } from '../logging/logger.js';

export function registerRemoveStudyJarTool(server: McpServer): void {
	server.registerTool(
		'remove_study_jar',
		{
			title: 'Remove Study Jar',
			description: TOOL_DESCRIPTIONS.remove_study_jar,
			inputSchema: {
				project: PARAMS.project,
				names: z.array(z.string()).min(1).describe('Study jar name(s) to remove'),
			},
		},
		async ({ project, names }) => {
			logger.debug('remove_study_jar called', { project, names });

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

			// Apply removals
			for (const name of names) {
				const studyJar = loadedProject.studyJars.get(name)!;
				await jarReader.removeProjectJar(loadedProject.name, studyJar.jarPath);
				evictEntryIndex(studyJar.jarPath);
				loadedProject.studyJars.delete(name);
			}

			const envelope = makeSuccess({
				removed: names,
				remaining: loadedProject.studyJars.size,
			});

			return {
				content: [{ type: 'text' as const, text: `Removed ${names.length} study jar(s): ${names.join(', ')}` }],
				structuredContent: envelope,
			};
		},
	);
}
