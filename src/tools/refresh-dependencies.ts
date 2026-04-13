import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { discoverDependencies } from '../project/dependency-discovery.js';
import { logger } from '../logging/logger.js';

export function registerRefreshDependenciesTool(server: McpServer): void {
	server.registerTool(
		'refresh_dependencies',
		{
			title: 'Refresh Dependencies',
			description: 'Re-run dependency discovery for a loaded project. Use after running ./gradlew downloadSources or when dependencies have changed.',
			inputSchema: {
				project: z.string().describe('Project name'),
			},
		},
		async ({ project }) => {
			logger.debug('refresh_dependencies called', { project });

			const loadedProject = projectStore.get(project);
			if (!loadedProject) {
				const envelope = makeError(
					'PROJECT_NOT_FOUND',
					`Project '${project}' is not loaded`,
					[project],
					['Load the project first using the load_project tool'],
				);
				return {
					content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
					structuredContent: envelope,
				};
			}

			const result = await discoverDependencies(
				loadedProject.gradleConfig,
				loadedProject.sourcesJar.path,
				loadedProject.rootPath,
			);

			loadedProject.dependencyJars = result.dependencies;

			const suggestions: string[] = [];
			if (result.summary.withoutSources > 0) {
				suggestions.push(
					`${result.summary.withoutSources} dependencies are missing source jars. Run ./gradlew downloadSources in the project directory to download them, then refresh again.`,
				);
			}

			const envelope = makeSuccess(
				{
					summary: result.summary,
					suggestions,
				},
				{
					provenance: {
						tool: 'refresh_dependencies',
						project,
					},
				},
			);

			return {
				content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
				structuredContent: envelope,
			};
		},
	);
}
