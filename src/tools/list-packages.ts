import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { logger } from '../logging/logger.js';
import { filterDependenciesByJarPattern, resolveProjectSafely } from './tool-helpers.js';
import type { PackageEntry } from '../browsing/types.js';

export function registerListPackagesTool(server: McpServer): void {
	server.registerTool(
		'list_packages',
		{
			title: 'List Packages',
			description: 'List Java packages in source jars and mod source. Supports filtering by jar and drilling into sub-packages.',
			inputSchema: {
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				jars: z.array(z.string()).optional().describe('Jar IDs or glob patterns to scope to (default: all jars)'),
				package: z.string().optional().describe('Parent package to list children of (default: top-level packages)'),
				depth: z.number().int().min(1).optional().describe('How many levels deep to list (default: 1)'),
			},
		},
		async ({ project, jars, package: packageName, depth }) => {
			logger.debug('list_packages called', { project, jars, package: packageName, depth });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Get filtered dependencies
			let filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);

			// Apply jars parameter if provided
			if (jars && jars.length > 0) {
				filtered = filterDependenciesByJarPattern(filtered, jars);
			}

			// Build merged package listings across all matching jars
			const mergedPackages = new Map<string, PackageEntry>();

			for (const [id, dep] of filtered) {
				if (!dep.available) continue;

				try {
					const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
					const entries = await adapter.listJavaEntries();
					const cacheKey = dep.sourcesJarPath ?? `fs:${loadedProject.rootPath}:${id}`;
					const index = getOrBuildIndex(entries, cacheKey);
					const packages = index.getPackages(packageName, depth ?? 1);

					for (const pkgName of packages) {
						const existing = mergedPackages.get(pkgName);
						const classCount = index.getClassCount(pkgName);

						if (existing) {
							existing.classCount += classCount;
							if (!existing.jars.includes(id)) {
								existing.jars.push(id);
							}
						} else {
							mergedPackages.set(pkgName, {
								name: pkgName,
								classCount,
								jars: [id],
							});
						}
					}
				} catch {
					// Skip jars that fail to read (e.g., unavailable sources)
					logger.debug(`Skipping jar ${id}: failed to read entries`);
				}
			}

			// Sort alphabetically
			const packages = Array.from(mergedPackages.values()).sort((a, b) => a.name.localeCompare(b.name));

			const envelope = makeSuccess({ packages }, {
				provenance: {
					tool: 'list_packages',
					project: loadedProject.name,
				},
			});

			return {
				content: [{ type: 'text' as const, text: `Found ${packages.length} package${packages.length === 1 ? '' : 's'}${packageName ? ` under '${packageName}'` : ''}` }],
				structuredContent: envelope,
			};
		},
	);
}
