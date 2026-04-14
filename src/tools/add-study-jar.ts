import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { createStudyJar } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { DomainError } from '../errors/domain-error.js';
import { logger } from '../logging/logger.js';

export function registerAddStudyJarTool(server: McpServer): void {
	server.registerTool(
		'add_study_jar',
		{
			title: 'Add Study Jar',
			description: TOOL_DESCRIPTIONS.add_study_jar,
			inputSchema: {
				project: PARAMS.project,
				path: z.string().describe('Absolute path to a sources JAR file'),
				name: z.string().optional().describe('Display name for the study jar (auto-derived from filename if omitted)'),
			},
		},
		async ({ project, path, name }) => {
			logger.debug('add_study_jar called', { project, path, name });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			try {
				const studyJar = await createStudyJar(path, name, loadedProject);
				loadedProject.studyJars.set(studyJar.name, studyJar);
				jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);

				const envelope = makeSuccess({
					name: studyJar.name,
					path: studyJar.jarPath,
					autoInclude: studyJar.autoInclude,
					stats: studyJar.stats,
				});

				return {
					content: [{ type: 'text' as const, text: `Added study jar '${studyJar.name}' (${studyJar.stats.classCount} classes, ${studyJar.stats.packageCount} packages)` }],
					structuredContent: envelope,
				};
			} catch (err) {
				if (err instanceof DomainError) {
					return returnError(err.code, err.message, err.tried, err.suggestions);
				}
				throw err;
			}
		},
	);
}
