import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { shutdownJdtLs } from '../jdtls/client.js';
import { cleanupTempDir, generateClasspathFile } from '../jdtls/workspace.js';
import { jarIdToDirName } from '../jdtls/uri-mapper.js';
import { rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';

export function registerUnloadProjectTool(server: McpServer): void {
	server.registerTool(
		'unload_project',
		{
			title: 'Unload Project',
			description: TOOL_DESCRIPTIONS.unload_project,
			inputSchema: {
				project: z.string().describe('Name of the project to unload'),
				scope: PARAMS.scope,
			},
		},
		async ({ project, scope }) => {
			logger.debug('unload_project called', { project, scope });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Scoped unload: remove just the specified child
			if (scope) {
				const child = loadedProject.children.get(scope);
				if (!child) {
					return returnError(
						'CHILD_NOT_FOUND',
						`Child '${scope}' not found in project '${loadedProject.name}'`,
						[scope],
						['Check available children with get_project_metadata'],
					);
				}

				// Clean up jar handles BEFORE removing from children map
				if (child.kind === 'fabric-mod') {
					for (const dep of child.dependencyJars.values()) {
						if (dep.sourcesJarPath) {
							await jarReader.removeProjectJar(loadedProject.name, dep.sourcesJarPath);
							evictEntryIndex(dep.sourcesJarPath);
						}
					}
					if (child.sourcesJar.path) {
						await jarReader.removeProjectJar(loadedProject.name, child.sourcesJar.path);
						evictEntryIndex(child.sourcesJar.path);
					}
				} else if (child.kind === 'study-jar') {
					await jarReader.removeProjectJar(loadedProject.name, child.jarPath);
					evictEntryIndex(child.jarPath);
				}

				loadedProject.children.delete(scope);

				// Clean up JDT LS workspace for removed child
				if (child.kind === 'fabric-mod' && loadedProject.jdtls?.available) {
					const jdtls = loadedProject.jdtls;
					// Remove this child's entries from jarIdToDirName
					for (const depId of child.dependencyJars.keys()) {
						jdtls.jarIdToDirName.delete(depId);
					}
					// Also remove the mod source entry
					jdtls.jarIdToDirName.delete(child.name);

					// Rebuild .classpath with remaining entries
					const allDirs = Array.from(jdtls.jarIdToDirName.values());
					const classpathXml = generateClasspathFile(allDirs);
					try {
						const resolvedTempDir = realpathSync(jdtls.tempDir);
						await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);
						// Notify JDT LS of classpath change
						if (jdtls.endpoint) {
							jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
								changes: [{
									uri: 'file://' + resolvedTempDir + '/.classpath',
									type: 2,
								}],
							});
						}
					} catch (err) {
						logger.warn(`Failed to update .classpath after removing child '${scope}': ${err}`);
					}

					// Remove extracted directories from tempDir
					for (const depId of child.dependencyJars.keys()) {
						const dirName = jarIdToDirName(depId);
						try {
							await rm(join(jdtls.tempDir, dirName), { recursive: true, force: true });
						} catch {
							// Directory may not exist
						}
					}
					// Also remove mod source dir
					const modDirName = jarIdToDirName(child.name);
					try {
						await rm(join(jdtls.tempDir, modDirName), { recursive: true, force: true });
					} catch {
						// Directory may not exist
					}
				}

				logger.info(`Removed child '${scope}' from project '${loadedProject.name}'`);

				const envelope = makeSuccess({
					name: loadedProject.name,
					child: scope,
					message: `Child '${scope}' removed from project`,
				});

				return {
					content: [{ type: 'text' as const, text: `Removed child '${scope}' from project '${loadedProject.name}'` }],
					structuredContent: envelope,
				};
			}

			// Full project unload
			// Shutdown JDT LS if active
			if (loadedProject.jdtls?.available && loadedProject.jdtls.client && loadedProject.jdtls.process) {
				try {
					await shutdownJdtLs(loadedProject.jdtls.client, loadedProject.jdtls.process);
				} catch (err) {
					logger.warn(`JDT LS shutdown error for ${project}: ${err}`);
				}
			}
			if (loadedProject.jdtls?.tempDir) {
				try {
					await cleanupTempDir(loadedProject.jdtls.tempDir);
				} catch (err) {
					logger.warn(`Temp dir cleanup error for ${project}: ${err}`);
				}
			}

			// Close jar handles for this project
			await jarReader.closeProject(project);

			// Remove from store (also clears default if applicable)
			projectStore.delete(project);

			const envelope = makeSuccess({
				name: project,
				message: 'Project unloaded',
			});

			return {
				content: [{ type: 'text' as const, text: `Unloaded project '${project}'` }],
				structuredContent: envelope,
			};
		},
	);
}
