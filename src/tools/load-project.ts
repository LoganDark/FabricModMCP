import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore, ProjectStore } from '../state/project-store.js';
import { loadFabricMod } from '../project/loader.js';
import type { Project } from '../project/types.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS } from './descriptions.js';
import { detectJava, findJdtLs, startJdtLs } from '../jdtls/client.js';
import { extractSourcesToTemp } from '../jdtls/workspace.js';
import type { JdtLsSession } from '../jdtls/types.js';

export function registerLoadProjectTool(server: McpServer): void {
	server.registerTool(
		'load_project',
		{
			title: 'Load Project',
			description: TOOL_DESCRIPTIONS.load_project,
			inputSchema: {
				path: z.string().describe('Absolute path to the Fabric/Loom project root directory'),
				name: z.string().optional().describe('Custom project name (auto-generated from directory basename if omitted)'),
			},
		},
		async ({ path, name }) => {
			logger.debug('load_project called', { path, name });

			try {
				const fabricMod = await loadFabricMod(path);

				// Determine project name
				let projectName: string;
				if (name) {
					projectName = name;
				} else {
					projectName = ProjectStore.generateProjectName(path, projectStore.names());
				}

				// Wrap fabric mod child into a project
				const project: Project = {
					name: projectName,
					children: new Map([[fabricMod.name, fabricMod]]),
				};
				projectStore.set(projectName, project);

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
				jarReader.registerProject(projectName, jarPaths);

				// Note: Fresh projects have no study jars. Auto-unload of conflicting
				// study jars happens in refresh_dependencies.

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
					logger.info(`JDT LS unavailable for ${projectName}: ${javaResult.error}`);
				} else if (jdtlsResult.jdtlsHome === null) {
					project.jdtls = {
						available: false,
						failureReason: jdtlsResult.error,
						tempDir: '',
						dataDir: '',
						jarIdToDirName: new Map(),
					};
					logger.info(`JDT LS unavailable for ${projectName}: ${jdtlsResult.error}`);
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
						logger.info(`JDT LS initialized for ${projectName}`);
					} catch (err) {
						project.jdtls = {
							available: false,
							failureReason: `JDT LS initialization failed: ${err instanceof Error ? err.message : String(err)}`,
							tempDir: '',
							dataDir: '',
							jarIdToDirName: new Map(),
						};
						logger.warn(`JDT LS failed for ${projectName}: ${project.jdtls.failureReason}`);
					}
				}

				const envelope = makeSuccess({
					name: projectName,
					rootPath: fabricMod.rootPath,
					minecraftVersion: fabricMod.gradleConfig.minecraftVersion,
					mappingEra: fabricMod.gradleConfig.mappingEra,
					dependencyCount: fabricMod.dependencyJars.size,
					jdtlsAvailable: project.jdtls?.available ?? false,
				}, {
					provenance: { tool: 'load_project', project: projectName },
				});

				return {
					content: [{ type: 'text' as const, text: `Loaded project '${projectName}' (Minecraft ${fabricMod.gradleConfig.minecraftVersion}, ${fabricMod.dependencyJars.size} dependencies, JDT LS ${project.jdtls?.available ? 'available' : 'unavailable'})` }],
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
