import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';

export function registerReadJarEntryTool(server: McpServer): void {
	server.registerTool(
		'read_jar_entry',
		{
			title: 'Read Jar Entry',
			description: 'Read a specific file from a source jar on demand. Returns the file content as UTF-8 text. Use for reading .java source files from Minecraft, Fabric API, or library source jars.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jar: z.string().describe('Jar identifier (e.g., "minecraft", "com.google.code.gson:gson")'),
				path: z.string().describe('File path within the jar (e.g., "net/minecraft/client/MinecraftClient.java")'),
			},
		},
		async ({ project, jar, path }) => {
			logger.debug('read_jar_entry called', { project, jar, path });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const entry = loadedProject.dependencyJars.get(jar);
			if (!entry) {
				const available = Array.from(loadedProject.dependencyJars.keys()).slice(0, 20);
				return returnError(
					'JAR_NOT_FOUND',
					`Jar '${jar}' not found in project '${project}'`,
					[jar],
					[
						'Check the jar identifier -- use configure_filters or list dependencies to see available jars',
						`Available jars (first 20): ${available.join(', ')}`,
					],
				);
			}

			if (!entry.available || !entry.sourcesJarPath) {
				return returnError(
					'JAR_NO_SOURCES',
					`Source jar for '${jar}' is not available`,
					[jar],
					['Run ./gradlew downloadSources in the project directory, then use refresh_dependencies'],
				);
			}

			try {
				const buffer = await jarReader.readEntry(entry.sourcesJarPath, path);
				const content = buffer.toString('utf-8');

				const envelope = makeSuccess(
					{
						content,
						jarId: jar,
						entryPath: path,
					},
					{
						provenance: {
							tool: 'read_jar_entry',
							project: loadedProject.name,
							jar,
							category: entry.category,
							version: entry.version,
							sourcesJarPath: entry.sourcesJarPath,
						},
					},
				);

				return {
					content: [{ type: 'text' as const, text: `Read ${path} from ${jar} (${content.length} bytes)` }],
					structuredContent: envelope,
				};
			} catch (err) {
				return returnError(
					'JAR_ENTRY_NOT_FOUND',
					`Entry '${path}' not found in jar '${jar}'`,
					[jar, path],
					['Check the file path -- use listEntries or browse packages to find available paths'],
				);
			}
		},
	);
}
