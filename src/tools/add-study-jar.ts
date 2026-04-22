import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { createStudyJar } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { DomainError } from '../errors/domain-error.js';
import { logger } from '../logging/logger.js';
import { syncStudyJarToWorkspace } from '../jdtls/workspace-sync.js';

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
				compiledJar: z.string().optional().describe('Absolute path to a compiled/resources JAR file (for non-source resources like lang files, textures, shaders)'),
			},
		},
		async ({ project, path, name, compiledJar }) => {
			logger.debug('add_study_jar called', { project, path, name, compiledJar });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			try {
				const studyJar = await createStudyJar(path, name, loadedProject, compiledJar);
				loadedProject.children.set(studyJar.name, { kind: 'study-jar', ...studyJar });
				jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);

				// Also register compiled jar with jar reader if provided
				if (studyJar.compiledJarPath) {
					jarReader.addProjectJar(loadedProject.name, studyJar.compiledJarPath);
				}

				// Sync to JDT LS workspace for semantic navigation
				const syncResult = await syncStudyJarToWorkspace(studyJar, loadedProject.jdtls, jarReader);

				const envelope = makeSuccess({
					name: studyJar.name,
					path: studyJar.jarPath,
					compiledJarPath: studyJar.compiledJarPath ?? null,
					autoInclude: studyJar.autoInclude,
					stats: studyJar.stats,
				}, {
					provenance: { tool: 'add_study_jar', project: loadedProject.name },
				});

				return {
					content: [{ type: 'text' as const, text: `Added study jar '${studyJar.name}' (${studyJar.stats.classCount} classes, ${studyJar.stats.packageCount} packages)` + (studyJar.compiledJarPath ? ` with compiled jar` : '') + (syncResult.warning ? `\n${syncResult.warning}` : '') }],
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
