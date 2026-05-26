import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { logger } from '../logging/logger.js';
import { getDependenciesForTool, resolveProjectSafely, requireDependencies, getRootPathForScope } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { PackageEntry } from '../browsing/types.js';

export function registerListPackagesTool(server: McpServer): void {
	server.registerTool(
		'list_packages',
		{
			title: 'List Packages',
			description: TOOL_DESCRIPTIONS.list_packages,
			inputSchema: {
				project: PARAMS.project,
				jars: PARAMS.jars,
				scope: PARAMS.scope,
				package: z.string().optional().describe('Parent package to list children of (default: top-level packages)'),
				depth: z.number().int().min(1).optional().describe('How many levels deep to list (default: 1)'),
			},
		},
		async ({ project, jars, scope, package: packageName, depth }) => {
			logger.debug('list_packages called', { project, jars, package: packageName, depth });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const depCheck = requireDependencies(loadedProject, scope);
			if (depCheck) return depCheck;

			const filtered = getDependenciesForTool(loadedProject, jars, scope);

			// Build merged package listings across all matching jars
			const mergedPackages = new Map<string, PackageEntry>();

			for (const [id, dep] of filtered) {
				if (!dep.available) continue;

				try {
					const adapter = createSourceAdapter(jarReader, dep, getRootPathForScope(loadedProject, scope));
					const entries = await adapter.listJavaEntries();
					const cacheKey = dep.sourcesJarPath ?? `fs:${getRootPathForScope(loadedProject, scope)}:${id}`;
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

			const summary = `Found ${packages.length} package${packages.length === 1 ? '' : 's'}${packageName ? ` under '${packageName}'` : ''}`;

			const content: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
			if (packages.length > 0) {
				const body = packages.map((p, i) => {
					const jars = p.jars.join(', ');
					return `${i + 1}. ${p.name} (${p.classCount} class${p.classCount === 1 ? '' : 'es'}) [${jars}]`;
				}).join('\n');
				content.push({ type: 'text' as const, text: body });
			}

			return {
				content,
				structuredContent: envelope,
			};
		},
	);
}
