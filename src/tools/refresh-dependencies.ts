import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { discoverDependencies } from '../project/dependency-discovery.js';
import { clearEntryIndexCache, evictEntryIndex } from '../browsing/entry-index-cache.js';
import { checkAndReopenIfStale, autoUnloadConflictingStudyJars } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerRefreshDependenciesTool(server: McpServer): void {
	server.registerTool(
		'refresh_dependencies',
		{
			title: 'Refresh Dependencies',
			description: TOOL_DESCRIPTIONS.refresh_dependencies,
			inputSchema: {
				project: PARAMS.project,
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

			// Auto-unload study jars whose name now collides with a real dependency
			const unloadedNames = await autoUnloadConflictingStudyJars(
				loadedProject,
				jarReader,
				loadedProject.jdtls,
			);

			// Re-register jar paths with the jar reader
			const jarPaths = new Set<string>();
			for (const dep of result.dependencies.values()) {
				if (dep.sourcesJarPath) jarPaths.add(dep.sourcesJarPath);
			}
			jarReader.registerProject(loadedProject.name, jarPaths);

			// Re-register study jar paths that survived the refresh
			if (loadedProject.studyJars) {
				for (const studyJar of loadedProject.studyJars.values()) {
					jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);
				}

				// Trigger staleness checks on study jars
				for (const studyJar of loadedProject.studyJars.values()) {
					await checkAndReopenIfStale(studyJar, jarReader);
				}
			}

			// Clear entry index cache for dependency jars only
			// (study jar caches are managed by checkAndReopenIfStale above)
			for (const dep of result.dependencies.values()) {
				if (dep.sourcesJarPath) {
					evictEntryIndex(dep.sourcesJarPath);
				}
			}

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
					...(unloadedNames.length > 0 ? { autoUnloaded: unloadedNames } : {}),
				},
				{
					provenance: {
						tool: 'refresh_dependencies',
						project: loadedProject.name,
					},
				},
			);

			let text = `Refreshed dependencies: ${result.summary.total} total, ${result.summary.withSources} with sources, ${result.summary.withoutSources} without sources`;
			if (unloadedNames.length > 0) {
				text += `\nAuto-unloaded ${unloadedNames.length} study jar(s) that now match real dependencies: ${unloadedNames.join(', ')}`;
			}

			return {
				content: [{ type: 'text' as const, text }],
				structuredContent: envelope,
			};
		},
	);
}
