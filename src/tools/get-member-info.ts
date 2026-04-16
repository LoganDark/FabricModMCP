import { z } from 'zod';
import { stat } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';

export function registerGetMemberInfoTool(server: McpServer): void {
	server.registerTool(
		'get_member_info',
		{
			title: 'Get Member Info',
			description: TOOL_DESCRIPTIONS.get_member_info,
			inputSchema: {
				project: PARAMS.project,
				member: z.string().describe('Name of the member to inspect'),
			},
		},
		async ({ project, member }) => {
			logger.debug('get_member_info called', { project, member });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const child = loadedProject.children.get(member);
			if (!child) {
				return returnError(
					'CHILD_NOT_FOUND',
					`Member '${member}' not found in project '${loadedProject.name}'`,
					[member],
					[`Check available members with get_project_info for project '${loadedProject.name}'`],
				);
			}

			const data: Record<string, unknown> = {
				name: child.name,
				kind: child.kind,
			};

			if (child.kind === 'fabric-mod') {
				data.projectInfo = {
					minecraftVersion: child.gradleConfig.minecraftVersion,
					mappingEra: child.gradleConfig.mappingEra,
					yarnMappings: child.gradleConfig.yarnMappings ?? null,
					loaderVersion: child.gradleConfig.loaderVersion ?? null,
					fabricApiVersion: child.gradleConfig.fabricApiVersion ?? null,
					declaredDependencies: child.gradleConfig.dependencies.map(d => ({
						configuration: d.configuration,
						group: d.group,
						artifact: d.artifact,
						version: d.version,
					})),
				};

				const mod = child.fabricMod as Record<string, unknown>;
				const {
					schemaVersion,
					id,
					version,
					name: modName,
					description,
					authors,
					license,
					environment,
					mixins,
					depends,
					...extra
				} = mod;

				data.modInfo = {
					schemaVersion,
					id,
					version,
					name: modName,
					description,
					authors,
					license,
					environment,
					mixins,
					depends,
					extra: Object.keys(extra).length > 0 ? extra : undefined,
				};

				const entries: Record<string, unknown>[] = [];
				for (const [, dep] of child.dependencyJars) {
					let sizeBytes: number | null = null;
					if (dep.available && dep.sourcesJarPath) {
						try {
							const stats = await stat(dep.sourcesJarPath);
							sizeBytes = stats.size;
						} catch {
							sizeBytes = null;
						}
					}
					entries.push({
						id: dep.id,
						category: dep.category,
						group: dep.group,
						artifact: dep.artifact,
						version: dep.version,
						available: dep.available,
						sizeBytes,
						provenanceChains: dep.provenanceChains,
					});
				}
				data.jarInventory = entries;
			} else if (child.kind === 'study-jar') {
				data.jarPath = child.jarPath;
				data.mtime = child.mtime;
				data.size = child.size;
				data.autoInclude = child.autoInclude;
				data.stats = child.stats;
			}

			const envelope = makeSuccess(data, {
				provenance: {
					tool: 'get_member_info',
					project: loadedProject.name,
					member,
				},
			});

			return {
				content: [{ type: 'text' as const, text: `Member '${member}' in project '${loadedProject.name}'` }],
				structuredContent: envelope,
			};
		},
	);
}
