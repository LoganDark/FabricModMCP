import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { parseClassDeclaration } from '../browsing/class-parser.js';
import { getOrBuildIndex } from '../browsing/entry-index-cache.js';
import { logger } from '../logging/logger.js';
import { filterDependenciesByJarPattern, resolveProjectSafely } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { SourceAdapter } from '../browsing/source-adapter.js';
import type { ClassInfo, InnerClassInfo } from '../browsing/types.js';

async function readClassMetadata(
	adapter: SourceAdapter,
	packageName: string,
	className: string,
): Promise<{ kind: string; access: string; modifiers: string[] } | null> {
	const entryPath = packageName
		? `${packageName.replaceAll('.', '/')}/${className}.java`
		: `${className}.java`;

	try {
		const buffer = await adapter.readEntry(entryPath);
		// Only read first 4KB for performance
		const head = buffer.subarray(0, 4096).toString('utf-8');
		const parsed = parseClassDeclaration(head);
		if (!parsed) return null;
		return { access: parsed.access, modifiers: parsed.modifiers, kind: parsed.kind };
	} catch {
		return null;
	}
}

export function registerListClassesTool(server: McpServer): void {
	server.registerTool(
		'list_classes',
		{
			title: 'List Classes',
			description: TOOL_DESCRIPTIONS.list_classes,
			inputSchema: {
				project: PARAMS.project,
				jars: PARAMS.jars,
				package: z.string().describe('Fully-qualified package name to list classes from (required)'),
				depth: z.number().int().min(1).optional().describe('Include classes from sub-packages up to this depth (default: 1, this package only)'),
			},
		},
		async ({ project, jars, package: packageName, depth }) => {
			logger.debug('list_classes called', { project, jars, package: packageName, depth });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Get filtered dependencies
			let filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);

			// Apply jars parameter if provided
			if (jars && jars.length > 0) {
				filtered = filterDependenciesByJarPattern(filtered, jars);
			}

			// Build merged class listings across all matching jars
			const mergedClasses = new Map<string, ClassInfo>();

			for (const [id, dep] of filtered) {
				if (!dep.available) continue;

				try {
					const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
					const entries = await adapter.listJavaEntries();
					const cacheKey = dep.sourcesJarPath ?? `fs:${loadedProject.rootPath}:${id}`;
					const index = getOrBuildIndex(entries, cacheKey);

					// Get packages to scan (just this package, or sub-packages if depth > 1)
					const packagesToScan = [packageName];
					if (depth && depth > 1) {
						const subPackages = index.getPackages(packageName, depth - 1);
						packagesToScan.push(...subPackages);
					}

					for (const pkgName of packagesToScan) {
						const classInfos = index.getClasses(pkgName);

						for (const classInfo of classInfos) {
							const fqn = pkgName ? `${pkgName}.${classInfo.className}` : classInfo.className;

							// Get metadata for the outer class
							const metadata = await readClassMetadata(adapter, pkgName, classInfo.className);

							// Build inner class entries
							const innerClasses: InnerClassInfo[] = [];
							for (const innerClassName of classInfo.innerClassNames) {
								const innerMetadata = await readClassMetadata(adapter, pkgName, innerClassName);
								innerClasses.push({
									name: innerClassName,
									fqn: pkgName ? `${pkgName}.${innerClassName}` : innerClassName,
									kind: innerMetadata?.kind ?? 'unknown',
									access: innerMetadata?.access ?? 'unknown',
									modifiers: innerMetadata?.modifiers ?? [],
								});
							}

							const existing = mergedClasses.get(fqn);
							if (existing) {
								if (!existing.jars.some(j => j.id === id)) {
									existing.jars.push({ id, category: dep.category });
								}
								// Merge inner classes
								for (const ic of innerClasses) {
									if (!existing.innerClasses?.some(e => e.fqn === ic.fqn)) {
										if (!existing.innerClasses) {
											existing.innerClasses = [];
										}
										existing.innerClasses.push(ic);
									}
								}
							} else {
								mergedClasses.set(fqn, {
									name: classInfo.className,
									fqn,
									kind: metadata?.kind ?? 'unknown',
									access: metadata?.access ?? 'unknown',
									modifiers: metadata?.modifiers ?? [],
									jars: [{ id, category: dep.category }],
									innerClasses: innerClasses.length > 0 ? innerClasses : undefined,
								});
							}
						}
					}
				} catch {
					logger.debug(`Skipping jar ${id}: failed to read entries`);
				}
			}

			// Sort alphabetically
			const classes = Array.from(mergedClasses.values()).sort((a, b) => a.name.localeCompare(b.name));

			const envelope = makeSuccess({ classes }, {
				provenance: {
					tool: 'list_classes',
					project: loadedProject.name,
					package: packageName,
				},
			});

			return {
				content: [{ type: 'text' as const, text: `Found ${classes.length} class${classes.length === 1 ? '' : 'es'} in ${packageName}` }],
				structuredContent: envelope,
			};
		},
	);
}
