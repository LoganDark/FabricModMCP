import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { discoverDependencies } from '../project/dependency-discovery.js';
import { clearEntryIndexCache } from '../browsing/entry-index-cache.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely } from './tool-helpers.js';

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

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Close old jar handles before re-discovering
			await jarReader.closeProject(loadedProject.name);

			const result = await discoverDependencies(
				loadedProject.gradleConfig,
				loadedProject.sourcesJar.path,
				loadedProject.rootPath,
			);

			loadedProject.dependencyJars = result.dependencies;

			// Re-register jar paths with the jar reader
			const jarPaths = new Set<string>();
			for (const dep of result.dependencies.values()) {
				if (dep.sourcesJarPath) jarPaths.add(dep.sourcesJarPath);
			}
			jarReader.registerProject(loadedProject.name, jarPaths);

			// Clear entry index cache — jar contents may have changed
			clearEntryIndexCache();

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
