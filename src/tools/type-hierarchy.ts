import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeSuccess } from '../types/envelope.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { SYMBOL_KIND_NAME } from '../jdtls/symbol-kind.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, handleClassSourceError, resolveProjectSafely, returnError, withLspDocument, resolveClassSource } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS } from './descriptions.js';
import type { ClassReference } from '../browsing/types.js';

function toClassReference(item: any): ClassReference {
	const fqn = item.detail ? `${item.detail}.${item.name}` : item.name;
	const kind = SYMBOL_KIND_NAME[item.kind]?.toLowerCase() ?? 'unknown';

	return {
		name: item.name,
		fqn,
		kind,
	};
}

export function registerTypeHierarchyTool(server: McpServer): void {
	server.registerTool(
		'type_hierarchy',
		{
			title: 'Type Hierarchy',
			description: TOOL_DESCRIPTIONS.type_hierarchy,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				class: PARAMS.class,
				depth: z.number().int().min(0).max(10).default(1).optional().describe('Maximum depth for subtype traversal (default: 1, direct subtypes only)'),
			},
		},
		async ({ class: className, jar, project, depth }) => {
			logger.debug('type_hierarchy called', { class: className, jar, project, depth });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			// Check JDT LS availability
			if (!loadedProject.jdtls?.available || !loadedProject.jdtls.endpoint) {
				return returnError(
					'JDTLS_NOT_AVAILABLE',
					`JDT LS not available for project '${loadedProject.name}': ${loadedProject.jdtls?.failureReason ?? 'not initialized'}`,
					[loadedProject.name],
					['Ensure Java 21+ is installed and JDTLS_HOME is set'],
				);
			}

			const jdtls = loadedProject.jdtls;
			const endpoint = jdtls.endpoint!;
			const lspClient = jdtls.client!;

			const provenance = {
				tool: 'type_hierarchy',
				project: loadedProject.name,
				class: className,
			};

			const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

			// Resolve class source from jars
			const sourceResult = await resolveClassSource(loadedProject, className, jar);
			if (!sourceResult.success) return handleClassSourceError(sourceResult, className, loadedProject.name, jar);
			const { sourceJarId, sourceText, entryPath } = sourceResult;

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

			return await withLspDocument(lspClient, fileUri, sourceText, async () => {
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
				const extendsChain: ClassReference[] = [];
				const implementsList: ClassReference[] = [];
				let current = item;
				while (true) {
					const supers = await endpoint.send('typeHierarchy/supertypes', { item: current });
					if (!supers || supers.length === 0) break;
					for (const s of supers) {
						const entry = toClassReference(s);
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
				const subtypes: ClassReference[] = [];
				let frontier = [item];
				for (let d = 0; d < subtypeDepth && frontier.length > 0; d++) {
					const next: any[] = [];
					for (const f of frontier) {
						const subs = await endpoint.send('typeHierarchy/subtypes', { item: f });
						if (subs && subs.length > 0) {
							for (const s of subs) {
								subtypes.push(toClassReference(s));
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
			});
		},
	);
}
