import { z } from 'zod';
import { stat } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { logger } from '../logging/logger.js';
import { getAllDependencies } from '../project/dependency-resolver.js';
import { resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { Project, FabricModChild } from '../project/types.js';
import { getGradleConfig, getFabricMod } from '../project/compat.js';
import { returnError } from './tool-helpers.js';

function buildProjectInfo(project: Project) {
	const gc = getGradleConfig(project);
	return {
		minecraftVersion: gc.minecraftVersion,
		mappingEra: gc.mappingEra,
		yarnMappings: gc.yarnMappings ?? null,
		loaderVersion: gc.loaderVersion ?? null,
		fabricApiVersion: gc.fabricApiVersion ?? null,
	};
}

function buildModInfo(project: Project) {
	const mod = getFabricMod(project) as Record<string, unknown>;
	const {
		schemaVersion,
		id,
		version,
		name,
		description,
		authors,
		license,
		environment,
		mixins,
		depends,
		...extra
	} = mod;

	return {
		schemaVersion,
		id,
		version,
		name,
		description,
		authors,
		license,
		environment,
		mixins,
		depends,
		extra: Object.keys(extra).length > 0 ? extra : undefined,
	};
}

async function buildJarInventory(project: Project, includePaths: boolean) {
	const entries: Record<string, unknown>[] = [];

	for (const [, dep] of getAllDependencies(project)) {
		let sizeBytes: number | null = null;

		if (dep.available && dep.sourcesJarPath) {
			try {
				const stats = await stat(dep.sourcesJarPath);
				sizeBytes = stats.size;
			} catch {
				sizeBytes = null;
			}
		}

		const entry: Record<string, unknown> = {
			id: dep.id,
			category: dep.category,
			group: dep.group,
			artifact: dep.artifact,
			version: dep.version,
			available: dep.available,
			sizeBytes,
			provenanceChains: dep.provenanceChains,
		};

		if (includePaths && dep.sourcesJarPath) {
			entry.sourcesJarPath = dep.sourcesJarPath;
		}

		entries.push(entry);
	}

	return entries;
}

export function registerGetProjectMetadataTool(server: McpServer): void {
	server.registerTool(
		'get_project_metadata',
		{
			title: 'Get Project Metadata',
			description: TOOL_DESCRIPTIONS.get_project_metadata,
			inputSchema: {
				project: PARAMS.project,
				scope: PARAMS.scope,
				include_project_info: z.boolean().optional().describe('Include version/mappings info'),
				include_mod_info: z.boolean().optional().describe('Include fabric.mod.json metadata'),
				include_jar_inventory: z.boolean().optional().describe('Include all source jar entries'),
				include_paths: z.boolean().optional().describe('Include file system paths for jars (debug)'),
			},
		},
		async ({ project, scope, include_project_info, include_mod_info, include_jar_inventory, include_paths }) => {
			logger.debug('get_project_metadata called', { project, include_project_info, include_mod_info, include_jar_inventory, include_paths });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Scope-aware: if scope is provided, return metadata for that specific child
			if (scope) {
				const child = loadedProject.children.get(scope);
				if (!child) {
					return returnError(
						'CHILD_NOT_FOUND',
						`Child '${scope}' not found in project '${loadedProject.name}'`,
						[scope],
						['Check available children with get_project_metadata (without scope)'],
					);
				}

				const data: Record<string, unknown> = { childName: child.name, childKind: child.kind };

				if (child.kind === 'fabric-mod') {
					const anyExplicit = include_project_info || include_mod_info || include_jar_inventory;
					if (!anyExplicit || include_project_info) {
						data.projectInfo = {
							minecraftVersion: child.gradleConfig.minecraftVersion,
							mappingEra: child.gradleConfig.mappingEra,
							yarnMappings: child.gradleConfig.yarnMappings ?? null,
							loaderVersion: child.gradleConfig.loaderVersion ?? null,
							fabricApiVersion: child.gradleConfig.fabricApiVersion ?? null,
						};
					}
					if (!anyExplicit || include_mod_info) {
						data.modInfo = child.fabricMod;
					}
					if (!anyExplicit || include_jar_inventory) {
						const entries: Record<string, unknown>[] = [];
						for (const [, dep] of child.dependencyJars) {
							let sizeBytes: number | null = null;
							if (dep.available && dep.sourcesJarPath) {
								try {
									const stats = await stat(dep.sourcesJarPath);
									sizeBytes = stats.size;
								} catch { sizeBytes = null; }
							}
							const entry: Record<string, unknown> = {
								id: dep.id, category: dep.category, group: dep.group,
								artifact: dep.artifact, version: dep.version,
								available: dep.available, sizeBytes,
								provenanceChains: dep.provenanceChains,
							};
							if (include_paths && dep.sourcesJarPath) entry.sourcesJarPath = dep.sourcesJarPath;
							entries.push(entry);
						}
						data.jarInventory = entries;
					}
				} else if (child.kind === 'study-jar') {
					data.jarPath = child.jarPath;
					data.autoInclude = child.autoInclude;
					data.stats = child.stats;
				}

				const envelope = makeSuccess(data, {
					provenance: { tool: 'get_project_metadata', project: loadedProject.name, scope },
				});

				return {
					content: [{ type: 'text' as const, text: `Metadata for child '${scope}' in '${loadedProject.name}'` }],
					structuredContent: envelope,
				};
			}

			const anyExplicit = include_project_info || include_mod_info || include_jar_inventory;

			const data: Record<string, unknown> = {};

			if (!anyExplicit || include_project_info) {
				data.projectInfo = buildProjectInfo(loadedProject);
			}

			if (!anyExplicit || include_mod_info) {
				data.modInfo = buildModInfo(loadedProject);
			}

			if (!anyExplicit || include_jar_inventory) {
				data.jarInventory = await buildJarInventory(loadedProject, include_paths ?? false);
			}

			const envelope = makeSuccess(data, {
				provenance: {
					tool: 'get_project_metadata',
					project: loadedProject.name,
				},
			});

			const sections = [
				data.projectInfo ? `MC ${(data.projectInfo as any).minecraftVersion}` : null,
				data.modInfo ? `mod: ${(data.modInfo as any).id ?? 'unknown'}` : null,
				data.jarInventory ? `${(data.jarInventory as any[]).length} jars` : null,
			].filter(Boolean);
			return {
				content: [{ type: 'text' as const, text: `Metadata for '${loadedProject.name}': ${sections.join(', ')}` }],
				structuredContent: envelope,
			};
		},
	);
}
