import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeSuccess } from '../types/envelope.js';
import { getAllDependencies } from '../project/dependency-resolver.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { cascadeRegex } from '../browsing/cascading-regex.js';
import { logger } from '../logging/logger.js';
import { classNameToEntryPath, sortByPriority, resolveProjectSafely, requireDependencies, returnError, stripLocateResult, stripLocateFailure, getDependenciesForTool, getRootPathForScope } from './tool-helpers.js';
import { TOOL_DESCRIPTIONS, PARAMS, DETAIL_PARAMS } from './descriptions.js';
import { resolveJarId } from '../project/namespace-resolver.js';
import type { LocateFailure } from './tool-helpers.js';
import type { LocateResult, LocateResultContext } from '../browsing/types.js';
import type { CascadeStep } from '../browsing/cascading-regex.js';

function renderLocateContext(ctx: LocateResultContext, indent: string): string {
	const header = `${indent}context (lines ${ctx.startLine}-${ctx.endLine}):`;
	const body = ctx.text.split('\n').map(l => `${indent}  ${l}`).join('\n');
	return `${header}\n${body}`;
}

function renderLocateSteps(steps: CascadeStep[] | undefined, indent: string): string | null {
	if (!steps || steps.length === 0) return null;
	const head = `${indent}steps (${steps.length}):`;
	const lines = steps.map(s => {
		const where = s.status === 'success' && s.offset !== undefined
			? ` @ offset ${s.offset}${s.matched ? ` matched "${s.matched.length > 60 ? s.matched.slice(0, 60) + '…' : s.matched}"` : ''}`
			: '';
		return `${indent}  ${s.step}. ${s.pattern} — ${s.status}${where}`;
	}).join('\n');
	return `${head}\n${lines}`;
}

function renderLocateResult(r: LocateResult, index: number): string {
	const head = `${index}. ${r.jar} — line ${r.line}, col ${r.column} (offset ${r.offset})`;
	const parts: string[] = [head];
	if (r.context) parts.push(renderLocateContext(r.context, '   '));
	const stepsBlock = renderLocateSteps(r.steps, '   ');
	if (stepsBlock) parts.push(stepsBlock);
	return parts.join('\n');
}

function renderLocateFailure(f: LocateFailure, index: number): string {
	const head = `${index}. ${f.jar} — failed at step ${f.failedStep + 1}${f.error ? `: ${f.error}` : ''}`;
	const stepsBlock = renderLocateSteps(f.steps, '   ');
	return stepsBlock ? `${head}\n${stepsBlock}` : head;
}

function extractContext(
	source: string,
	line: number,
	linesBefore: number,
	linesAfter: number,
): LocateResultContext {
	const lines = source.split('\n');
	const totalLines = lines.length;
	const startLine = Math.max(1, line - linesBefore);
	const endLine = Math.min(totalLines, line + linesAfter);
	const text = lines.slice(startLine - 1, endLine).join('\n');
	return { text, startLine, endLine };
}

export function registerLocateInSourceTool(server: McpServer): void {
	server.registerTool(
		'locate_in_source',
		{
			title: 'Locate in Source',
			description: TOOL_DESCRIPTIONS.locate_in_source,
			inputSchema: {
				project: PARAMS.project,
				jar: PARAMS.jar,
				scope: PARAMS.scope,
				class: PARAMS.class,
				patterns: PARAMS.patterns,
				context: z.object({
					linesBefore: z.number().int().min(0).describe('Number of lines to include before the match'),
					linesAfter: z.number().int().min(0).describe('Number of lines to include after the match'),
				}).optional().describe('When provided, extends match to whole line boundaries and includes surrounding lines. Even {linesBefore: 0, linesAfter: 0} extends to the full line.'),
				details: DETAIL_PARAMS.locate,
			},
		},
		async ({ project, jar, scope, class: className, patterns, context, details }) => {
			logger.debug('locate_in_source called', { project, jar, class: className, patterns });

			const resolved = resolveProjectSafely(project);
			if (!resolved.ok) return resolved.error;
			const loadedProject = resolved.project;

			const depCheck = requireDependencies(loadedProject, scope);
			if (depCheck) return depCheck;

			const entryPath = classNameToEntryPath(className);

			const provenance = {
				tool: 'locate_in_source',
				project: loadedProject.name,
				class: className,
			};

			const rootPath = getRootPathForScope(loadedProject, scope);

			// Specific jar mode
			if (jar !== undefined) {
				const resolvedJar = resolveJarId(loadedProject, jar, scope);
				const dep = getAllDependencies(loadedProject).get(resolvedJar);
				if (!dep) {
					return returnError(
						'JAR_NOT_FOUND',
						`Jar '${jar}' not found in project '${loadedProject.name}'`,
						[jar],
						['Check available jars with get_member_info or get_project_info'],
					);
				}

				if (!dep.available) {
					return returnError(
						'JAR_NOT_AVAILABLE',
						`Sources for jar '${jar}' are not available`,
						[jar],
						['The dependency does not have a sources jar'],
					);
				}

				try {
					const adapter = createSourceAdapter(jarReader, dep, rootPath);
					const buffer = await adapter.readEntry(entryPath);
					const source = buffer.toString('utf-8');
					const result = cascadeRegex(source, patterns);

					if (result.success) {
						const locateResult: LocateResult = {
							jar: dep.id,
							category: dep.category,
							provenanceChains: dep.provenanceChains,
							steps: result.steps,
							offset: result.offset,
							line: result.line,
							column: result.column,
						};
						if (context !== undefined) {
							locateResult.context = extractContext(source, result.line, context.linesBefore, context.linesAfter);
						}
						const stripped = stripLocateResult(locateResult, details);
						const envelope = makeSuccess({ results: [stripped], failures: [] }, { provenance });
						const summary = `Located in ${className} (${dep.id}) at line ${result.line}, col ${result.column}`;
						const bodyContent: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
						const body = renderLocateResult(stripped, 1);
						if (body !== summary) bodyContent.push({ type: 'text' as const, text: body });
						return {
							content: bodyContent,
							structuredContent: envelope,
						};
					} else {
						const locateFailure: LocateFailure = {
							jar: dep.id,
							category: dep.category,
							provenanceChains: dep.provenanceChains,
							steps: result.steps,
							failedStep: result.failedStep,
							error: result.error,
						};
						const strippedFailure = stripLocateFailure(locateFailure, details);
						const envelope = makeSuccess({ results: [], failures: [strippedFailure] }, { provenance });
						const summary = `Cascade failed at step ${result.failedStep + 1} in ${className} (${dep.id})`;
						const content: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
						const body = renderLocateFailure(strippedFailure, 1);
						if (body.includes('\n')) content.push({ type: 'text' as const, text: body });
						return {
							content,
							structuredContent: envelope,
						};
					}
				} catch {
					return returnError(
						'CLASS_NOT_FOUND',
						`Class '${className}' not found in jar '${jar}'`,
						[entryPath],
						['Check the fully-qualified class name'],
					);
				}
			}

			// All-jars mode: search all jars in priority order
			const filtered = getDependenciesForTool(loadedProject, undefined, scope);
			const sorted = sortByPriority(Array.from(filtered.entries()));

			const results: LocateResult[] = [];
			const failures: LocateFailure[] = [];

			for (const [id, dep] of sorted) {
				if (!dep.available) continue;

				let source: string;
				try {
					const adapter = createSourceAdapter(jarReader, dep, rootPath);
					const buffer = await adapter.readEntry(entryPath);
					source = buffer.toString('utf-8');
				} catch {
					// Class not in this jar, continue to next
					continue;
				}

				const result = cascadeRegex(source, patterns);

				if (result.success) {
					const locateResult: LocateResult = {
						jar: id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						steps: result.steps,
						offset: result.offset,
						line: result.line,
						column: result.column,
					};
					if (context !== undefined) {
						locateResult.context = extractContext(source, result.line, context.linesBefore, context.linesAfter);
					}
					results.push(locateResult);
				} else {
					failures.push({
						jar: id,
						category: dep.category,
						provenanceChains: dep.provenanceChains,
						steps: result.steps,
						failedStep: result.failedStep,
						error: result.error,
					});
				}
			}

			if (results.length === 0 && failures.length === 0) {
				return returnError(
					'CLASS_NOT_FOUND',
					`Class '${className}' not found in any jar`,
					[entryPath],
					['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
				);
			}

			const strippedResults = results.map(r => stripLocateResult(r, details));
			const strippedFailures = failures.map(f => stripLocateFailure(f, details));
			const envelope = makeSuccess({ results: strippedResults, failures: strippedFailures }, { provenance });
			if (results.length > 0) {
				const first = results[0];
				const summary = `Located in ${className} (${first.jar}) at line ${first.line}, col ${first.column}${results.length > 1 ? ` (+${results.length - 1} more)` : ''}${failures.length > 0 ? `, ${failures.length} failed` : ''}`;
				const content: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
				const bodyParts: string[] = [];
				bodyParts.push(...strippedResults.map((r, i) => renderLocateResult(r, i + 1)));
				if (strippedFailures.length > 0) {
					bodyParts.push(`failures (${strippedFailures.length}):`);
					bodyParts.push(...strippedFailures.map((f, i) => renderLocateFailure(f, i + 1)));
				}
				content.push({ type: 'text' as const, text: bodyParts.join('\n\n') });
				return {
					content,
					structuredContent: envelope,
				};
			}
			const summary = `Cascade failed in ${failures.length} jar${failures.length === 1 ? '' : 's'} for ${className}`;
			const content: { type: 'text'; text: string }[] = [{ type: 'text' as const, text: summary }];
			if (strippedFailures.length > 0) {
				const body = strippedFailures.map((f, i) => renderLocateFailure(f, i + 1)).join('\n\n');
				content.push({ type: 'text' as const, text: body });
			}
			return {
				content,
				structuredContent: envelope,
			};
		},
	);
}
