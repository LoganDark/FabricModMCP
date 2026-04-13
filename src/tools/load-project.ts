import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore, ProjectStore } from '../state/project-store.js';
import { loadProject } from '../project/loader.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';

export function registerLoadProjectTool(server: McpServer): void {
	server.registerTool(
		'load_project',
		{
			title: 'Load Project',
			description: 'Load a Fabric/Loom Gradle project by path. Optionally assign a custom name. If no name is provided, auto-generates from directory basename (with collision suffix if needed).',
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

				const envelope = makeSuccess({
					name: projectName,
					rootPath: project.rootPath,
					minecraftVersion: project.gradleConfig.minecraftVersion,
					mappingEra: project.gradleConfig.mappingEra,
					dependencyCount: project.dependencyJars.size,
				}, {
					provenance: { tool: 'load_project', project: projectName },
				});

				return {
					content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
					structuredContent: envelope,
				};
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					const envelope = makeError(de.code, de.message, de.tried ?? [path], de.suggestions);
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
						structuredContent: envelope,
					};
				}
				throw error;
			}
		},
	);
}
