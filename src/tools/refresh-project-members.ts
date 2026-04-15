import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { discoverDependencies } from '../project/dependency-discovery.js';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { checkAndReopenIfStale, autoUnloadConflictingStudyJarsForDeps } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { FabricModChild, DependencyEntry, StudyJarChild } from '../project/types.js';

export function registerRefreshProjectMembersTool(server: McpServer): void {
	server.registerTool(
		'refresh_project_members',
		{
			title: 'Refresh Project Members',
			description: TOOL_DESCRIPTIONS.refresh_project_members,
			inputSchema: {
				project: PARAMS.project,
				members: z.array(z.string()).describe('Names of fabric mod members to refresh. Empty array returns "nothing changed".'),
			},
		},
		async ({ project, members }) => {
			logger.debug('refresh_project_members called', { project, members });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Empty array: return success with nothing changed
			if (members.length === 0) {
				const envelope = makeSuccess(
					{
						refreshed: [],
						message: 'Nothing changed',
					},
					{
						provenance: {
							tool: 'refresh_project_members',
							project: loadedProject.name,
						},
					},
				);

				return {
					content: [{ type: 'text' as const, text: 'Nothing changed' }],
					structuredContent: envelope,
				};
			}

			// Validate all names exist and are fabric mods
			const modsToRefresh: FabricModChild[] = [];
			for (const name of members) {
				const child = loadedProject.children.get(name);
				if (!child) {
					return returnError(
						'CHILD_NOT_FOUND',
						`Member '${name}' not found in project '${loadedProject.name}'`,
						[name],
						[`Check available members with get_project_info for project '${loadedProject.name}'`],
					);
				}
				if (child.kind !== 'fabric-mod') {
					return returnError(
						'INVALID_CHILD_TYPE',
						`Member '${name}' is a ${child.kind}, not a fabric mod. Only fabric mods can be refreshed.`,
						[name],
						['Use refresh_project to refresh all fabric mods, or specify fabric mod names only'],
					);
				}
				modsToRefresh.push(child);
			}

			const combinedSummaries: Array<{ modName: string; total: number; withSources: number; withoutSources: number }> = [];

			for (const mod of modsToRefresh) {
				// Collect old jar paths before closing
				const oldJarPaths = new Set<string>();
				for (const dep of mod.dependencyJars.values()) {
					if (dep.sourcesJarPath) oldJarPaths.add(dep.sourcesJarPath);
				}
				if (mod.sourcesJar.path) oldJarPaths.add(mod.sourcesJar.path);

				// Close ONLY this mod's old jar handles via removeProjectJar
				for (const jarPath of oldJarPaths) {
					await jarReader.removeProjectJar(loadedProject.name, jarPath);
				}

				// Re-discover dependencies
				const result = await discoverDependencies(
					mod.gradleConfig,
					mod.sourcesJar.path,
					mod.rootPath,
					mod.name,
				);

				mod.dependencyJars = result.dependencies;

				// Re-register new jars via addProjectJar
				for (const dep of result.dependencies.values()) {
					if (dep.sourcesJarPath) {
						jarReader.addProjectJar(loadedProject.name, dep.sourcesJarPath);
					}
				}
				if (mod.sourcesJar.path) {
					jarReader.addProjectJar(loadedProject.name, mod.sourcesJar.path);
				}

				// Evict entry index cache for old jar paths
				for (const jarPath of oldJarPaths) {
					evictEntryIndex(jarPath);
				}

				combinedSummaries.push({
					modName: mod.name,
					...result.summary,
				});
			}

			// Study jar collision check: only against the refreshed members' deps
			const allRefreshedDeps = new Map<string, DependencyEntry>();
			for (const mod of modsToRefresh) {
				for (const [id, dep] of mod.dependencyJars) {
					allRefreshedDeps.set(id, dep);
				}
			}

			const unloadedNames = await autoUnloadConflictingStudyJarsForDeps(
				loadedProject,
				allRefreshedDeps,
				jarReader,
				loadedProject.jdtls,
			);

			// Re-register surviving study jar paths and check staleness
			for (const child of loadedProject.children.values()) {
				if (child.kind === 'study-jar') {
					jarReader.addProjectJar(loadedProject.name, child.jarPath);
					await checkAndReopenIfStale(child as StudyJarChild, jarReader);
				}
			}

			// Build combined summary
			const totalSummary = {
				total: combinedSummaries.reduce((sum, s) => sum + s.total, 0),
				withSources: combinedSummaries.reduce((sum, s) => sum + s.withSources, 0),
				withoutSources: combinedSummaries.reduce((sum, s) => sum + s.withoutSources, 0),
			};

			const suggestions: string[] = [];
			if (totalSummary.withoutSources > 0) {
				suggestions.push(
					`${totalSummary.withoutSources} dependencies are missing source jars. Run ./gradlew downloadSources in the project directory to download them, then refresh again.`,
				);
			}

			const envelope = makeSuccess(
				{
					summary: totalSummary,
					refreshedChildren: modsToRefresh.map(m => m.name),
					suggestions,
					...(unloadedNames.length > 0 ? { autoUnloaded: unloadedNames } : {}),
				},
				{
					provenance: {
						tool: 'refresh_project_members',
						project: loadedProject.name,
					},
				},
			);

			let text = `Refreshed dependencies for ${modsToRefresh.map(m => m.name).join(', ')}: ${totalSummary.total} total, ${totalSummary.withSources} with sources, ${totalSummary.withoutSources} without sources`;
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
