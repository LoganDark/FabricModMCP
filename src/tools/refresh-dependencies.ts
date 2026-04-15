import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { discoverDependencies } from '../project/dependency-discovery.js';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { checkAndReopenIfStale, autoUnloadConflictingStudyJars, autoUnloadConflictingStudyJarsForDeps } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { getStudyJars } from '../project/compat.js';
import { DomainError } from '../errors/domain-error.js';
import type { FabricModChild, Project } from '../project/types.js';
import { returnError } from './tool-helpers.js';

function resolveFabricModsForRefresh(
	project: Project,
	scope?: string,
): FabricModChild[] {
	if (scope) {
		const child = project.children.get(scope);
		if (!child || child.kind !== 'fabric-mod') {
			throw new DomainError(
				'CHILD_NOT_FOUND',
				`Fabric mod child '${scope}' not found in project '${project.name}'`,
				[scope],
				['Check available children with get_project_metadata'],
			);
		}
		return [child];
	}
	const mods: FabricModChild[] = [];
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') mods.push(child);
	}
	if (mods.length === 0) {
		throw new DomainError(
			'NO_FABRIC_MOD',
			`No fabric mod loaded in project '${project.name}'`,
			[project.name],
			['Load a fabric mod using load_project'],
		);
	}
	return mods;
}

export function registerRefreshDependenciesTool(server: McpServer): void {
	server.registerTool(
		'refresh_dependencies',
		{
			title: 'Refresh Dependencies',
			description: TOOL_DESCRIPTIONS.refresh_dependencies,
			inputSchema: {
				project: PARAMS.project,
				scope: PARAMS.scope,
			},
		},
		async ({ project, scope }) => {
			logger.debug('refresh_dependencies called', { project, scope });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			let modsToRefresh: FabricModChild[];
			try {
				modsToRefresh = resolveFabricModsForRefresh(loadedProject, scope);
			} catch (err) {
				if (err instanceof DomainError) {
					return returnError(err.code, err.message, err.tried, err.suggestions);
				}
				throw err;
			}

			const combinedSummaries: Array<{ modName: string; total: number; withSources: number; withoutSources: number }> = [];

			for (const mod of modsToRefresh) {
				// Collect old jar paths before closing
				const oldJarPaths = new Set<string>();
				for (const dep of mod.dependencyJars.values()) {
					if (dep.sourcesJarPath) oldJarPaths.add(dep.sourcesJarPath);
				}
				if (mod.sourcesJar.path) oldJarPaths.add(mod.sourcesJar.path);

				// Close ONLY this mod's old jar handles via removeProjectJar (not closeProject)
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

				// Re-register new jars via addProjectJar (incremental, not registerProject)
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

			// Study jar collision check: scoped vs unscoped
			let unloadedNames: string[];
			if (scope && modsToRefresh.length === 1) {
				// Scoped: only check against the refreshed child's deps
				unloadedNames = await autoUnloadConflictingStudyJarsForDeps(
					loadedProject,
					modsToRefresh[0].dependencyJars,
					jarReader,
					loadedProject.jdtls,
				);
			} else {
				// Unscoped: check against ALL children's deps
				unloadedNames = await autoUnloadConflictingStudyJars(
					loadedProject,
					jarReader,
					loadedProject.jdtls,
				);
			}

			// Re-register surviving study jar paths
			const studyJars = getStudyJars(loadedProject);
			for (const studyJar of studyJars.values()) {
				jarReader.addProjectJar(loadedProject.name, studyJar.jarPath);
			}

			// Trigger staleness checks on study jars
			for (const studyJar of studyJars.values()) {
				await checkAndReopenIfStale(studyJar, jarReader);
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
						tool: 'refresh_dependencies',
						project: loadedProject.name,
						...(scope ? { scope } : {}),
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
