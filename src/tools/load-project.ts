import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore, ProjectStore } from '../state/project-store.js';
import { loadProject } from '../project/loader.js';
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
				const project = await loadProject(path);

				// Determine project name
				let projectName: string;
				if (name) {
					projectName = name;
				} else {
					projectName = ProjectStore.generateProjectName(path, projectStore.names());
				}

				project.name = projectName;
				projectStore.set(projectName, project);

				// Register jar handles for this project
				const jarPaths = new Set<string>();
				for (const entry of project.dependencyJars.values()) {
					if (entry.sourcesJarPath) {
						jarPaths.add(entry.sourcesJarPath);
					}
				}
				if (project.sourcesJar.exists) {
					jarPaths.add(project.sourcesJar.path);
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
							project.dependencyJars,
							project.rootPath,
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
					rootPath: project.rootPath,
					minecraftVersion: project.gradleConfig.minecraftVersion,
					mappingEra: project.gradleConfig.mappingEra,
					dependencyCount: project.dependencyJars.size,
					jdtlsAvailable: project.jdtls?.available ?? false,
				}, {
					provenance: { tool: 'load_project', project: projectName },
				});

				return {
					content: [{ type: 'text' as const, text: `Loaded project '${projectName}' (Minecraft ${project.gradleConfig.minecraftVersion}, ${project.dependencyJars.size} dependencies, JDT LS ${project.jdtls?.available ? 'available' : 'unavailable'})` }],
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
