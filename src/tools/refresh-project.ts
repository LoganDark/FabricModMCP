import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { discoverDependencies } from '../project/dependency-discovery.js';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { checkAndReopenIfStale, autoUnloadConflictingStudyJars } from '../project/study-jar.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { DomainError } from '../errors/domain-error.js';
import type { FabricModChild, StudyJarChild } from '../project/types.js';
import { syncFabricModToWorkspace, unsyncFabricModFromWorkspace } from '../jdtls/workspace-sync.js';

export function registerRefreshProjectTool(server: McpServer): void {
	server.registerTool(
		'refresh_project',
		{
			title: 'Refresh Project',
			description: TOOL_DESCRIPTIONS.refresh_project,
			inputSchema: {
				project: PARAMS.project,
			},
		},
		async ({ project }) => {
			logger.debug('refresh_project called', { project });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Collect all fabric mod children
			const mods: FabricModChild[] = [];
			for (const child of loadedProject.children.values()) {
				if (child.kind === 'fabric-mod') mods.push(child);
			}

			if (mods.length === 0) {
				return returnError(
					'NO_FABRIC_MOD',
					`No fabric mod loaded in project '${loadedProject.name}'`,
					[loadedProject.name],
					['Add a fabric mod using add_fabric_mod'],
				);
			}

			const combinedSummaries: Array<{ modName: string; total: number; withSources: number; withoutSources: number }> = [];

			for (const mod of mods) {
				// Save old dependency list for workspace unsync
				const oldDeps = mod.dependencyJars;

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

				// Resync JDT LS workspace: unsync old deps, sync new deps
				const oldModForUnsync = { ...mod, dependencyJars: oldDeps } as FabricModChild;
				await unsyncFabricModFromWorkspace(oldModForUnsync, loadedProject.jdtls);
				const syncResult = await syncFabricModToWorkspace(mod, loadedProject.jdtls, jarReader);
				if (syncResult.warning) {
					logger.warn(`Workspace resync for '${mod.name}': ${syncResult.warning}`);
				}

				combinedSummaries.push({
					modName: mod.name,
					...result.summary,
				});
			}

			// Study jar collision check against ALL children's deps
			const unloadedNames = await autoUnloadConflictingStudyJars(
				loadedProject,
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
					refreshedChildren: mods.map(m => m.name),
					suggestions,
					...(unloadedNames.length > 0 ? { autoUnloaded: unloadedNames } : {}),
				},
				{
					provenance: {
						tool: 'refresh_project',
						project: loadedProject.name,
					},
				},
			);

			let text = `Refreshed dependencies for ${mods.map(m => m.name).join(', ')}: ${totalSummary.total} total, ${totalSummary.withSources} with sources, ${totalSummary.withoutSources} without sources`;
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
