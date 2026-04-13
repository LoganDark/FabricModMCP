import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess, makeError } from '../types/envelope.js';
import { projectStore } from '../state/project-store.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { SYMBOL_KIND_NAME } from '../jdtls/symbol-kind.js';
import { logger } from '../logging/logger.js';
import type { JarCategory, DependencyEntry } from '../project/types.js';

// Priority order for jar categories when searching all jars
const CATEGORY_PRIORITY: Record<JarCategory, number> = {
	'minecraft': 0,
	'mod-source': 1,
	'fabric-api': 2,
	'library': 3,
};

function sortByPriority(entries: [string, DependencyEntry][]): [string, DependencyEntry][] {
	return entries.sort((a, b) => {
		const pa = CATEGORY_PRIORITY[a[1].category] ?? 99;
		const pb = CATEGORY_PRIORITY[b[1].category] ?? 99;
		if (pa !== pb) return pa - pb;
		return a[0].localeCompare(b[0]);
	});
}

interface HierarchyEntry {
	name: string;
	qualifiedName: string;
	kind: string;
	jar: string | null;
	provenance: string;
}

function toHierarchyEntry(
	item: any,
	loadedProject: any,
	uriMapper: ReturnType<typeof createUriMapper>,
): HierarchyEntry {
	const qualifiedName = item.detail ? `${item.detail}.${item.name}` : item.name;
	const kind = SYMBOL_KIND_NAME[item.kind] ?? 'unknown';

	// Check URI scheme: file:// -> look up jar, anything else (jdt://) -> java provenance
	if (typeof item.uri === 'string' && item.uri.startsWith('file://')) {
		const mapping = uriMapper.fromFileUri(item.uri);
		if (mapping) {
			const dep = loadedProject.dependencyJars.get(mapping.jar);
			return {
				name: item.name,
				qualifiedName,
				kind,
				jar: mapping.jar,
				provenance: dep?.category ?? 'library',
			};
		}
	}

	// JDK type or unmapped URI
	return {
		name: item.name,
		qualifiedName,
		kind,
		jar: null,
		provenance: 'java',
	};
}

export function registerTypeHierarchyTool(server: McpServer): void {
	server.registerTool(
		'type_hierarchy',
		{
			title: 'Type Hierarchy',
			description: 'Get the full type hierarchy for a Java class — supertype chain (extends + implements separated) and subtypes to configurable depth. Essential for understanding Mixin targets and class relationships.',
			inputSchema: {
				class: z.string().describe('Fully-qualified class name using dot notation (e.g., net.minecraft.client.MinecraftClient)'),
				jar: z.string().optional().describe('Specific jar ID to find the class in (default: search all jars)'),
				project: z.string().optional().describe('Project name (optional if only one project loaded or default is set)'),
				depth: z.number().int().min(0).max(10).default(1).optional().describe('Maximum depth for subtype traversal (default: 1, direct subtypes only)'),
			},
		},
		async ({ class: className, jar, project, depth }) => {
			logger.debug('type_hierarchy called', { class: className, jar, project, depth });

			let loadedProject;
			try {
				loadedProject = projectStore.resolveProject(project);
			} catch (error) {
				if (error instanceof Error && 'code' in error) {
					const de = error as any;
					const envelope = makeError(de.code, de.message, de.tried ?? [], de.suggestions);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
				throw error;
			}

			// Check JDT LS availability
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.endpoint) {
				const envelope = makeError(
					'JDTLS_NOT_AVAILABLE',
					`JDT LS not available for project '${loadedProject.name}': ${loadedProject.jdtls?.failureReason ?? 'not initialized'}`,
					[loadedProject.name],
					['Ensure Java 21+ is installed and JDTLS_HOME is set'],
				);
				return {
					content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
					structuredContent: envelope,
				};
			}

			const jdtls = loadedProject.jdtls;
			const endpoint = jdtls.endpoint!;
			const lspClient = jdtls.client!;

			// Convert FQN to entry path
			const lastDot = className.lastIndexOf('.');
			let entryPath: string;
			if (lastDot === -1) {
				entryPath = `${className}.java`;
			} else {
				const packagePath = className.substring(0, lastDot).replaceAll('.', '/');
				const simpleNameWithInner = className.substring(lastDot + 1);
				entryPath = `${packagePath}/${simpleNameWithInner}.java`;
			}

			const provenance = {
				tool: 'type_hierarchy',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Find source text and jar ID
			let sourceJarId: string;
			let sourceText: string;

			if (jar !== undefined) {
				const dep = loadedProject.dependencyJars.get(jar);
				if (!dep) {
					const envelope = makeError(
						'JAR_NOT_FOUND',
						`Jar '${jar}' not found in project '${loadedProject.name}'`,
						[jar],
						['Check available jars with get_project_metadata'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}

				if (!dep.available) {
					const envelope = makeError(
						'JAR_NOT_AVAILABLE',
						`Sources for jar '${jar}' are not available`,
						[jar],
						['The dependency does not have a sources jar'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}

				try {
					const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
					const buffer = await adapter.readEntry(entryPath);
					sourceText = buffer.toString('utf-8');
					sourceJarId = jar;
				} catch {
					const envelope = makeError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in jar '${jar}'`,
						[entryPath],
						['Check the fully-qualified class name'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
			} else {
				// All-jars mode
				const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
				const sorted = sortByPriority(Array.from(filtered.entries()));

				let found = false;
				sourceJarId = '';
				sourceText = '';

				for (const [id, dep] of sorted) {
					if (!dep.available) continue;

					try {
						const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
						const buffer = await adapter.readEntry(entryPath);
						sourceText = buffer.toString('utf-8');
						sourceJarId = id;
						found = true;
						break;
					} catch {
						continue;
					}
				}

				if (!found) {
					const envelope = makeError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in any jar`,
						[entryPath],
						['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
					);
					return {
						content: [{ type: 'text' as const, text: `Error [${envelope.error.code}]: ${envelope.error.message}` }],
						structuredContent: envelope,
					};
				}
			}

			// Build file URI
			const fileUri = uriMapper.toFileUri(sourceJarId, entryPath);

			// Locate the class declaration position in source text
			const simpleName = className.includes('.') ? className.substring(className.lastIndexOf('.') + 1) : className;
			const classRegex = new RegExp(`(?:class|interface|enum|record)\\s+${simpleName.replace(/\$/g, '\\$')}\\b`);
			let position = { line: 0, character: 0 };
			const lines = sourceText.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const match = classRegex.exec(lines[i]);
				if (match) {
					// Position at the class name itself (after the keyword + space)
					const keywordEnd = match[0].lastIndexOf(simpleName);
					position = { line: i, character: match.index + keywordEnd };
					break;
				}
			}

			// didOpen
			await lspClient.didOpen({
				textDocument: {
					uri: fileUri,
					languageId: 'java',
					version: 1,
					text: sourceText,
				},
			});

			try {
				// Step 1: Prepare type hierarchy
				const items = await endpoint.send('textDocument/prepareTypeHierarchy', {
					textDocument: { uri: fileUri },
					position,
				});

				if (!items || !Array.isArray(items) || items.length === 0) {
					const envelope = makeSuccess(
						{
							class: className,
							jar: sourceJarId,
							extends: [],
							implements: [],
							subtypes: [],
							subtypeDepth: depth ?? 1,
						},
						{ provenance },
					);
					return {
						content: [{ type: 'text' as const, text: `Type hierarchy for ${className}: no hierarchy information available` }],
						structuredContent: envelope,
					};
				}

				const item = items[0];

				// Step 2: Walk supertypes to root
				const extendsChain: HierarchyEntry[] = [];
				const implementsList: HierarchyEntry[] = [];
				let current = item;
				while (true) {
					const supers = await endpoint.send('typeHierarchy/supertypes', { item: current });
					if (!supers || supers.length === 0) break;
					for (const s of supers) {
						const entry = toHierarchyEntry(s, loadedProject, uriMapper);
						// SymbolKind 11 = Interface
						if (s.kind === 11) {
							implementsList.push(entry);
						} else {
							extendsChain.push(entry);
						}
					}
					// Continue walking up from the first superclass (class inheritance is single)
					const superclass = supers.find((s: any) => s.kind !== 11);
					if (!superclass) break;
					current = superclass;
				}

				// Step 3: Walk subtypes (BFS to depth)
				const subtypeDepth = depth ?? 1;
				const subtypes: HierarchyEntry[] = [];
				let frontier = [item];
				for (let d = 0; d < subtypeDepth && frontier.length > 0; d++) {
					const next: any[] = [];
					for (const f of frontier) {
						const subs = await endpoint.send('typeHierarchy/subtypes', { item: f });
						if (subs && subs.length > 0) {
							for (const s of subs) {
								subtypes.push(toHierarchyEntry(s, loadedProject, uriMapper));
								next.push(s);
							}
						}
					}
					frontier = next;
				}

				const envelope = makeSuccess(
					{
						class: className,
						jar: sourceJarId,
						extends: extendsChain,
						implements: implementsList,
						subtypes,
						subtypeDepth,
					},
					{ provenance },
				);

				const summary = `Type hierarchy for ${className}: extends ${extendsChain.length} type${extendsChain.length === 1 ? '' : 's'}, implements ${implementsList.length} interface${implementsList.length === 1 ? '' : 's'}, ${subtypes.length} direct subtype${subtypes.length === 1 ? '' : 's'}`;

				return {
					content: [{ type: 'text' as const, text: summary }],
					structuredContent: envelope,
				};
			} finally {
				try {
					await lspClient.didClose({ textDocument: { uri: fileUri } });
				} catch {
					// Ignore close errors
				}
			}
		},
	);
}
