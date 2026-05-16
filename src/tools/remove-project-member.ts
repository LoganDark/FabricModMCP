import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { resolveProjectSafely, returnError } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import { jarReader } from './shared-jar-reader.js';
import { logger } from '../logging/logger.js';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { generateClasspathFile } from '../jdtls/workspace.js';
import { jarIdToDirName } from '../jdtls/uri-mapper.js';
import { rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { unsyncStudyJarFromWorkspace } from '../jdtls/workspace-sync.js';
import { pathToFileUri } from '../platform/uri.js';

export function registerRemoveProjectMemberTool(server: McpServer): void {
	server.registerTool(
		'remove_project_member',
		{
			title: 'Remove Project Member',
			description: TOOL_DESCRIPTIONS.remove_project_member,
			inputSchema: {
				project: PARAMS.project,
				names: z.array(z.string()).min(1).describe('Names of members to remove'),
			},
		},
		async ({ project, names }) => {
			logger.debug('remove_project_member called', { project, names });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// First pass: validate all names exist
			for (const name of names) {
				if (!loadedProject.children.has(name)) {
					return returnError(
						'CHILD_NOT_FOUND',
						`Child '${name}' not found in project '${loadedProject.name}'`,
						[name],
						['Check available members with get_project_info'],
					);
				}
			}

			// Second pass: remove each member
			for (const name of names) {
				const child = loadedProject.children.get(name)!;

				if (child.kind === 'fabric-mod') {
					// Close jar handles
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

					// Clean up JDT LS workspace for removed child
					if (loadedProject.jdtls?.available) {
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
										uri: pathToFileUri(join(resolvedTempDir, '.classpath')),
										type: 2,
									}],
								});
							}
						} catch (err) {
							logger.warn(`Failed to update .classpath after removing child '${name}': ${err}`);
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
				} else if (child.kind === 'study-jar') {
					await unsyncStudyJarFromWorkspace(name, loadedProject.jdtls);
					await jarReader.removeProjectJar(loadedProject.name, child.jarPath);
					evictEntryIndex(child.jarPath);
				}

				loadedProject.children.delete(name);

				// Clear activeChild if removed member was active
				if (loadedProject.activeChild === name) {
					loadedProject.activeChild = undefined;
				}
			}

			logger.info(`Removed members [${names.join(', ')}] from project '${loadedProject.name}'`);

			const envelope = makeSuccess({
				removed: names,
				project: loadedProject.name,
			}, {
				provenance: { tool: 'remove_project_member', project: loadedProject.name },
			});

			return {
				content: [{ type: 'text' as const, text: `Removed ${names.length} member(s) from project '${loadedProject.name}': ${names.join(', ')}` }],
				structuredContent: envelope,
			};
		},
	);
}
