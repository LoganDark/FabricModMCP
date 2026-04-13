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
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
			},
		},
		async ({ project }) => {
			logger.debug('refresh_dependencies called', { project });

			let loadedProject;
			try {
				loadedProject = projectStore.resolveProject(project);
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					const envelope = makeError(de.code, de.message, de.tried ?? [], de.suggestions);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
				throw error;
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
						project: loadedProject.name,
					},
				},
			);

			return {
				content: [{ type: 'text' as const, text: `Refreshed dependencies: ${result.summary.total} total, ${result.summary.withSources} with sources, ${result.summary.withoutSources} without sources` }],
				structuredContent: envelope,
			};
		},
	);
}
