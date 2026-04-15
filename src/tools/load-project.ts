import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { loadFabricMod } from '../project/loader.js';
import type { Project } from '../project/types.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { detectJava, findJdtLs, startJdtLs } from '../jdtls/client.js';
import { extractSourcesToTemp } from '../jdtls/workspace.js';
import { renameChildNamespace } from '../project/namespace-resolver.js';

export function registerLoadProjectTool(server: McpServer): void {
	server.registerTool(
		'load_project',
		{
			title: 'Load Project',
			description: TOOL_DESCRIPTIONS.load_project,
			inputSchema: {
				path: z.string().describe('Absolute path to the Fabric/Loom project root directory'),
				project: PARAMS.project,
			},
		},
		async ({ path, project: projectParam }) => {
			logger.debug('load_project called', { path, project: projectParam });

			try {
				const fabricMod = await loadFabricMod(path);
				const targetProjectName = projectParam ?? 'default';

				if (projectStore.has(targetProjectName)) {
					// Add child to existing project
					const existingProject = projectStore.get(targetProjectName)!;

					// Resolve child name with auto-suffix on collision
					let childName = fabricMod.name;
					let wasRenamed = false;
					if (existingProject.children.has(childName)) {
						const originalName = childName;
						for (let i = 2; ; i++) {
							const candidate = `${originalName}-${i}`;
							if (!existingProject.children.has(candidate)) {
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

					existingProject.children.set(fabricMod.name, fabricMod);

					// Register jars incrementally
					for (const entry of fabricMod.dependencyJars.values()) {
						if (entry.sourcesJarPath) {
							jarReader.addProjectJar(targetProjectName, entry.sourcesJarPath);
						}
					}
					if (fabricMod.sourcesJar.exists) {
						jarReader.addProjectJar(targetProjectName, fabricMod.sourcesJar.path);
					}

					// Note: JDT LS workspace sync for added children deferred to Phase 26
					if (existingProject.jdtls?.available) {
						logger.info(`Child '${fabricMod.name}' added to project '${targetProjectName}' — JDT LS workspace sync deferred to Phase 26`);
					}

					const envelope = makeSuccess({
						project: targetProjectName,
						name: targetProjectName, // backward compat
						child: fabricMod.name,
						rootPath: fabricMod.rootPath,
						minecraftVersion: fabricMod.gradleConfig.minecraftVersion,
						mappingEra: fabricMod.gradleConfig.mappingEra,
						dependencyCount: fabricMod.dependencyJars.size,
						jdtlsAvailable: existingProject.jdtls?.available ?? false,
						...(wasRenamed ? { autoSuffixed: true, originalName: fabricMod.fabricMod.id } : {}),
					}, {
						provenance: { tool: 'load_project', project: targetProjectName, child: fabricMod.name },
					});

					return {
						content: [{ type: 'text' as const, text: `Loaded '${fabricMod.name}' into project '${targetProjectName}' (Minecraft ${fabricMod.gradleConfig.minecraftVersion}, ${fabricMod.dependencyJars.size} dependencies)` }],
						structuredContent: envelope,
					};
				} else {
					// Create new project
					const project: Project = {
						name: targetProjectName,
						children: new Map([[fabricMod.name, fabricMod]]),
					};
					projectStore.set(targetProjectName, project);

					// Register jar handles for this project
					const jarPaths = new Set<string>();
					for (const entry of fabricMod.dependencyJars.values()) {
						if (entry.sourcesJarPath) {
							jarPaths.add(entry.sourcesJarPath);
						}
					}
					if (fabricMod.sourcesJar.exists) {
						jarPaths.add(fabricMod.sourcesJar.path);
					}
					jarReader.registerProject(targetProjectName, jarPaths);

					// Initialize JDT LS (eager, per user decision)
					const javaResult = detectJava();
					const jdtlsResult = findJdtLs();

					if (javaResult.javaPath === null) {
						project.jdtls = {
							available: false,
							failureReason: javaResult.error,
							tempDir: '',
							dataDir: '',
							jarIdToDirName: new Map(),
						};
						logger.info(`JDT LS unavailable for ${targetProjectName}: ${javaResult.error}`);
					} else if (jdtlsResult.jdtlsHome === null) {
						project.jdtls = {
							available: false,
							failureReason: jdtlsResult.error,
							tempDir: '',
							dataDir: '',
							jarIdToDirName: new Map(),
						};
						logger.info(`JDT LS unavailable for ${targetProjectName}: ${jdtlsResult.error}`);
					} else {
						try {
							const extraction = await extractSourcesToTemp(
								fabricMod.dependencyJars,
								fabricMod.rootPath,
								jarReader,
							);
							const lspResult = await startJdtLs(
								javaResult.javaPath,
								jdtlsResult.jdtlsHome,
								extraction.tempDir,
							);
							project.jdtls = {
								available: true,
								tempDir: extraction.tempDir,
								dataDir: lspResult.dataDir,
								jarIdToDirName: extraction.jarIdToDirNameMap,
								client: lspResult.client,
								endpoint: lspResult.endpoint,
								process: lspResult.process,
							};
							logger.info(`JDT LS initialized for ${targetProjectName}`);
						} catch (err) {
							project.jdtls = {
								available: false,
								failureReason: `JDT LS initialization failed: ${err instanceof Error ? err.message : String(err)}`,
								tempDir: '',
								dataDir: '',
								jarIdToDirName: new Map(),
							};
							logger.warn(`JDT LS failed for ${targetProjectName}: ${project.jdtls.failureReason}`);
						}
					}

					const envelope = makeSuccess({
						project: targetProjectName,
						name: targetProjectName, // backward compat
						child: fabricMod.name,
						rootPath: fabricMod.rootPath,
						minecraftVersion: fabricMod.gradleConfig.minecraftVersion,
						mappingEra: fabricMod.gradleConfig.mappingEra,
						dependencyCount: fabricMod.dependencyJars.size,
						jdtlsAvailable: project.jdtls?.available ?? false,
					}, {
						provenance: { tool: 'load_project', project: targetProjectName, child: fabricMod.name },
					});

					return {
						content: [{ type: 'text' as const, text: `Loaded '${fabricMod.name}' into project '${targetProjectName}' (Minecraft ${fabricMod.gradleConfig.minecraftVersion}, ${fabricMod.dependencyJars.size} dependencies, JDT LS ${project.jdtls?.available ? 'available' : 'unavailable'})` }],
						structuredContent: envelope,
					};
				}
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
