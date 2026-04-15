import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { loadFabricMod } from '../project/loader.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { renameChildNamespace } from '../project/namespace-resolver.js';

export function registerAddFabricModTool(server: McpServer): void {
	server.registerTool(
		'add_fabric_mod',
		{
			title: 'Add Fabric Mod',
			description: TOOL_DESCRIPTIONS.add_fabric_mod,
			inputSchema: {
				project: PARAMS.project,
				path: z.string().describe('Absolute path to the Fabric mod root directory'),
			},
		},
		async ({ project, path }) => {
			logger.debug('add_fabric_mod called', { project, path });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			try {
				const fabricMod = await loadFabricMod(path);

				// Resolve child name with auto-suffix on collision
				let childName = fabricMod.name;
				let wasRenamed = false;
				if (loadedProject.children.has(childName)) {
					const originalName = childName;
					for (let i = 2; ; i++) {
						const candidate = `${originalName}-${i}`;
						if (!loadedProject.children.has(candidate)) {
							childName = candidate;
							break;
						}
					}
					// Rename dependency IDs to match new child name
					fabricMod.dependencyJars = renameChildNamespace(
						fabricMod.dependencyJars,
						fabricMod.fabricMod.id,
						childName,
					);
					fabricMod.name = childName;
					wasRenamed = true;
				}

				loadedProject.children.set(fabricMod.name, fabricMod);

				// Ensure project is registered with jar reader (may not be if created via create_project)
				if (!jarReader.getProjectJars(loadedProject.name)) {
					jarReader.registerProject(loadedProject.name, new Set());
				}

				// Register jars incrementally
				for (const entry of fabricMod.dependencyJars.values()) {
					if (entry.sourcesJarPath) {
						jarReader.addProjectJar(loadedProject.name, entry.sourcesJarPath);
					}
				}
				if (fabricMod.sourcesJar.exists) {
					jarReader.addProjectJar(loadedProject.name, fabricMod.sourcesJar.path);
				}

				// JDT LS workspace sync deferred to Phase 26
				if (loadedProject.jdtls?.available) {
					logger.info(`Child '${fabricMod.name}' added to project '${loadedProject.name}' — JDT LS workspace sync deferred to Phase 26`);
				}

				const envelope = makeSuccess({
					project: loadedProject.name,
					child: fabricMod.name,
					rootPath: fabricMod.rootPath,
					minecraftVersion: fabricMod.gradleConfig.minecraftVersion,
					mappingEra: fabricMod.gradleConfig.mappingEra,
					dependencyCount: fabricMod.dependencyJars.size,
					jdtlsAvailable: loadedProject.jdtls?.available ?? false,
					...(wasRenamed ? { autoSuffixed: true, originalName: fabricMod.fabricMod.id } : {}),
				}, {
					provenance: { tool: 'add_fabric_mod', project: loadedProject.name, child: fabricMod.name },
				});

				return {
					content: [{ type: 'text' as const, text: `Added '${fabricMod.name}' to project '${loadedProject.name}' (Minecraft ${fabricMod.gradleConfig.minecraftVersion}, ${fabricMod.dependencyJars.size} dependencies)` }],
					structuredContent: envelope,
				};
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					return returnError(de.code, de.message, de.tried ?? [path], de.suggestions);
				}
				throw error;
			}
		},
	);
}
