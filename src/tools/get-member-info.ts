import { z } from 'zod';
import { stat } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, requireDependencies, returnError } from './tool-helpers.js';
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

			const depCheck = requireDependencies(loadedProject);
			if (depCheck) return depCheck;

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
				} = child.fabricMod;

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
						hasCompiledJar: dep.compiledJarPath !== null,
						sizeBytes,
						provenanceChains: dep.provenanceChains,
					});
				}
				data.jarInventory = entries;
			} else if (child.kind === 'study-jar') {
				data.jarPath = child.jarPath;
				data.compiledJarPath = child.compiledJarPath ?? null;
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

			const summary = `Member '${member}' in project '${loadedProject.name}' (kind: ${child.kind})`;
			const bodyLines: string[] = [];
			if (child.kind === 'fabric-mod') {
				const projInfo = data.projectInfo as Record<string, unknown>;
				const modInfo = data.modInfo as Record<string, unknown>;
				const jars = data.jarInventory as Record<string, unknown>[];
				bodyLines.push(`Fabric mod project`);
				bodyLines.push(`  minecraft: ${projInfo.minecraftVersion}`);
				bodyLines.push(`  mapping era: ${projInfo.mappingEra}`);
				if (projInfo.yarnMappings) bodyLines.push(`  yarn mappings: ${projInfo.yarnMappings}`);
				if (projInfo.loaderVersion) bodyLines.push(`  loader: ${projInfo.loaderVersion}`);
				if (projInfo.fabricApiVersion) bodyLines.push(`  fabric API: ${projInfo.fabricApiVersion}`);
				const declared = projInfo.declaredDependencies as unknown[];
				bodyLines.push(`  declared dependencies: ${declared.length}`);
				bodyLines.push('');
				bodyLines.push(`fabric.mod.json:`);
				bodyLines.push(`  id: ${modInfo.id}`);
				bodyLines.push(`  version: ${modInfo.version}`);
				if (modInfo.name) bodyLines.push(`  name: ${modInfo.name}`);
				if (modInfo.description) bodyLines.push(`  description: ${modInfo.description}`);
				if (modInfo.environment) bodyLines.push(`  environment: ${modInfo.environment}`);
				if (Array.isArray(modInfo.authors) && modInfo.authors.length > 0) bodyLines.push(`  authors: ${modInfo.authors.join(', ')}`);
				if (Array.isArray(modInfo.mixins) && modInfo.mixins.length > 0) bodyLines.push(`  mixins: ${(modInfo.mixins as unknown[]).length}`);
				bodyLines.push('');
				bodyLines.push(`jar inventory (${jars.length}):`);
				for (const j of jars) {
					const available = j.available ? '' : ' [unavailable]';
					const compiled = j.hasCompiledJar ? '' : ' (no compiled jar)';
					const size = j.sizeBytes != null ? ` ${j.sizeBytes} bytes` : '';
					bodyLines.push(`  - ${j.id} (${j.category})${available}${compiled}${size}`);
				}
			} else if (child.kind === 'study-jar') {
				const stats = data.stats as Record<string, unknown>;
				bodyLines.push(`Study jar`);
				bodyLines.push(`  path: ${data.jarPath}`);
				if (data.compiledJarPath) bodyLines.push(`  compiled jar: ${data.compiledJarPath}`);
				bodyLines.push(`  size: ${data.size} bytes`);
				bodyLines.push(`  mtime: ${data.mtime}`);
				bodyLines.push(`  auto-include: ${data.autoInclude}`);
				bodyLines.push(`  classes: ${stats.classCount}, packages: ${stats.packageCount}`);
			}

			const content: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
			if (bodyLines.length > 0) content.push({ type: 'text' as const, text: bodyLines.join('\n') });

			return {
				content,
				structuredContent: envelope,
			};
		},
	);
}
