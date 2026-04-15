/**
 * Shared utilities for tool files.
 *
 * Single source of truth for: CATEGORY_PRIORITY, sortByPriority, classNameToEntryPath,
 * normalizeLocations, LocateFailure, resolveProjectSafely, returnError, withLspDocument,
 * resolveClassSource, handleSymbolPositionError, handleClassSourceError,
 * and filterDependenciesByJarPattern.
 */

import { readFile } from 'node:fs/promises';
import picomatch from 'picomatch';
import type { JarCategory, DependencyEntry, LoadedProject } from '../project/types.js';
import type { CascadeStep } from '../browsing/cascading-regex.js';
import type { SymbolPositionResult } from './resolve-symbol-position.js';
import type { NavigationResult } from '../jdtls/types.js';
import type { LocateResult } from '../browsing/types.js';
import type { UriMapper } from '../jdtls/uri-mapper.js';
import { entryPathToClassName } from '../jdtls/uri-mapper.js';
import { extractEnclosingContext } from '../jdtls/context-extractor.js';
import type { LspClient } from 'ts-lsp-client';
import { projectStore } from '../state/project-store.js';
import { makeError, makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { getResolvedDependencies, getAllDependencies } from '../project/dependency-resolver.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';

export interface LocateFailure {
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	steps: CascadeStep[];
	failedStep: number;
	error?: string;
}

// Priority order for jar categories when searching all jars
export const CATEGORY_PRIORITY: Record<JarCategory, number> = {
	'minecraft': 0,
	'mod-source': 1,
	'fabric-api': 2,
	'library': 3,
	'study': 4,
};

export function sortByPriority(entries: [string, DependencyEntry][]): [string, DependencyEntry][] {
	return entries.sort((a, b) => {
		const pa = CATEGORY_PRIORITY[a[1].category] ?? 99;
		const pb = CATEGORY_PRIORITY[b[1].category] ?? 99;
		if (pa !== pb) return pa - pb;
		return a[0].localeCompare(b[0]);
	});
}

export function classNameToEntryPath(className: string): string {
	const lastDot = className.lastIndexOf('.');
	if (lastDot === -1) return `${className}.java`;
	const packagePath = className.substring(0, lastDot).replaceAll('.', '/');
	const simpleNameWithInner = className.substring(lastDot + 1);
	return `${packagePath}/${simpleNameWithInner}.java`;
}

/**
 * Normalize LSP definition/implementation results to an array of { uri, range } objects.
 * Handles Location, Location[], LocationLink[], and null.
 */
export function normalizeLocations(result: any): Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> {
	if (result === null || result === undefined) return [];
	if (Array.isArray(result)) {
		return result.map((item: any) => {
			// LocationLink has targetUri/targetRange; Location has uri/range
			if ('targetUri' in item) {
				return { uri: item.targetUri, range: item.targetRange };
			}
			return { uri: item.uri, range: item.range };
		});
	}
	// Single Location
	if ('uri' in result) {
		return [{ uri: result.uri, range: result.range }];
	}
	return [];
}

/**
 * Safely resolve a project from the project store, catching DomainError and returning
 * an MCP-formatted error response.
 */
export function resolveProjectSafely(project?: string): { ok: true; project: LoadedProject } | { ok: false; error: { content: { type: 'text'; text: string }[]; structuredContent: ReturnType<typeof makeError> } } {
	try {
		const loaded = projectStore.resolveProject(project);
		return { ok: true, project: loaded };
	} catch (error) {
		if (error instanceof Error && 'code' in error) {
			const de = error as any;
			return { ok: false, error: returnError(de.code, de.message, de.tried ?? [], de.suggestions) };
		}
		throw error;
	}
}

/**
 * Build a standard MCP error response from error parameters.
 */
export function returnError(code: string, message: string, tried: string[], suggestions?: string[]): { content: { type: 'text'; text: string }[]; structuredContent: ReturnType<typeof makeError> } {
	const envelope = makeError(code, message, tried, suggestions);
	return {
		content: [{ type: 'text' as const, text: `Error [${code}]: ${message}` }],
		structuredContent: envelope,
	};
}

/**
 * Wrap an LSP operation with didOpen/didClose lifecycle management.
 * Opens the document before calling fn, and ensures didClose is called in finally.
 */
export async function withLspDocument<T>(
	lspClient: LspClient,
	fileUri: string,
	sourceText: string,
	fn: () => Promise<T>,
): Promise<T> {
	await lspClient.didOpen({
		textDocument: { uri: fileUri, languageId: 'java', version: 1, text: sourceText },
	});
	try {
		return await fn();
	} finally {
		try { await lspClient.didClose({ textDocument: { uri: fileUri } }); } catch {}
	}
}

/**
 * Resolve a class source from jars. If jar is specified, reads from that jar only.
 * Otherwise searches all filtered jars in priority order and returns the first match.
 */
export async function resolveClassSource(
	loadedProject: LoadedProject,
	className: string,
	jar?: string,
): Promise<
	| { success: true; sourceJarId: string; sourceText: string; entryPath: string }
	| { success: false; kind: 'jar-not-found'; jar: string }
	| { success: false; kind: 'jar-not-available'; jar: string }
	| { success: false; kind: 'class-not-found'; entryPath: string; jar?: string }
> {
	const entryPath = classNameToEntryPath(className);

	if (jar !== undefined) {
		const dep = getAllDependencies(loadedProject).get(jar);
		if (!dep) {
			return { success: false, kind: 'jar-not-found', jar };
		}
		if (!dep.available) {
			return { success: false, kind: 'jar-not-available', jar };
		}
		try {
			const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
			const buffer = await adapter.readEntry(entryPath);
			return { success: true, sourceJarId: jar, sourceText: buffer.toString('utf-8'), entryPath };
		} catch {
			return { success: false, kind: 'class-not-found', entryPath, jar };
		}
	}

	// All-jars mode: read from all jars in parallel, return highest-priority match
	const filtered = getFilteredDependencies(getResolvedDependencies(loadedProject), loadedProject.filterConfig);
	const sorted = sortByPriority(Array.from(filtered.entries()));

	const attempts = await Promise.all(sorted.map(async ([id, dep]) => {
		if (!dep.available) return null;
		try {
			const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
			const buffer = await adapter.readEntry(entryPath);
			return { id, text: buffer.toString('utf-8') };
		} catch {
			return null;
		}
	}));

	for (const attempt of attempts) {
		if (attempt) {
			return { success: true as const, sourceJarId: attempt.id, sourceText: attempt.text, entryPath };
		}
	}

	return { success: false, kind: 'class-not-found', entryPath };
}

/**
 * Handle error results from resolveSymbolPosition().
 * Shared by find-definition, find-references, find-implementations, and get-symbol-info.
 */
export function handleSymbolPositionError(
	posResult: Extract<SymbolPositionResult, { success: false }>,
	projectName: string,
	provenance: Record<string, string>,
): { content: { type: 'text'; text: string }[]; structuredContent: any } {
	if (posResult.kind === 'jar-not-found') {
		return returnError(
			'JAR_NOT_FOUND',
			`Jar '${posResult.jar}' not found in project '${projectName}'`,
			[posResult.jar],
			['Check available jars with get_project_metadata'],
		);
	}
	if (posResult.kind === 'jar-not-available') {
		return returnError(
			'JAR_NOT_AVAILABLE',
			`Sources for jar '${posResult.jar}' are not available`,
			[posResult.jar],
			['The dependency does not have a sources jar'],
		);
	}
	if (posResult.kind === 'cascade-failure') {
		const failure: LocateFailure = {
			jar: posResult.jar,
			category: posResult.category,
			provenanceChains: posResult.provenanceChains,
			steps: posResult.steps,
			failedStep: posResult.failedStep,
			error: posResult.error,
		};
		const envelope = makeSuccess({ results: [], failures: [failure] }, { provenance });
		return {
			content: [{ type: 'text' as const, text: `Cascade failed at step ${posResult.failedStep + 1} in ${provenance.class} (${posResult.jar})` }],
			structuredContent: envelope,
		};
	}
	// not-found (only remaining kind after jar-not-found, jar-not-available, cascade-failure)
	const notFound = posResult as Extract<SymbolPositionResult, { kind: 'not-found' }>;
	return returnError(
		'CLASS_NOT_FOUND',
		`Class '${provenance.class}' not found in any jar, or cascading regex failed in all jars`,
		[notFound.entryPath],
		['Check the fully-qualified class name', 'Use list_packages to browse available packages'],
	);
}

/**
 * Handle error results from resolveClassSource().
 * Shared by list-members, type-hierarchy, and read-source.
 */
export function handleClassSourceError(
	sourceResult: Extract<Awaited<ReturnType<typeof resolveClassSource>>, { success: false }>,
	className: string,
	projectName: string,
	jar?: string,
): { content: { type: 'text'; text: string }[]; structuredContent: any } {
	if (sourceResult.kind === 'jar-not-found') {
		return returnError('JAR_NOT_FOUND', `Jar '${sourceResult.jar}' not found in project '${projectName}'`, [sourceResult.jar], ['Check available jars with get_project_metadata']);
	}
	if (sourceResult.kind === 'jar-not-available') {
		return returnError('JAR_NOT_AVAILABLE', `Sources for jar '${sourceResult.jar}' are not available`, [sourceResult.jar], ['The dependency does not have a sources jar']);
	}
	return returnError('CLASS_NOT_FOUND', `Class '${className}' not found in ${jar ? `jar '${jar}'` : 'any jar'}`, [sourceResult.entryPath], jar ? ['Check the fully-qualified class name'] : ['Check the fully-qualified class name', 'Use list_packages to browse available packages']);
}

/**
 * Convert normalized LSP locations into NavigationResult[] by reading source files,
 * extracting context snippets, and looking up jar provenance.
 * Shared by find-definition, find-references, and find-implementations.
 */
export async function processNavigationLocations(
	locations: ReturnType<typeof normalizeLocations>,
	loadedProject: LoadedProject,
	uriMapper: UriMapper,
): Promise<NavigationResult[]> {
	const results: NavigationResult[] = [];
	const sourceCache = new Map<string, string>();

	for (const loc of locations) {
		const mapping = uriMapper.fromFileUri(loc.uri);
		if (!mapping) continue;

		const filePath = loc.uri.replace('file://', '');
		let source = sourceCache.get(filePath);
		if (source === undefined) {
			try {
				source = await readFile(filePath, 'utf-8');
				sourceCache.set(filePath, source);
			} catch {
				continue;
			}
		}

		const className = entryPathToClassName(mapping.entryPath);
		const line = loc.range.start.line + 1;
		const column = loc.range.start.character + 1;
		const context = extractEnclosingContext(source, line);
		const dep = getAllDependencies(loadedProject).get(mapping.jar);

		results.push({
			jar: mapping.jar,
			category: dep?.category ?? 'library',
			provenanceChains: dep?.provenanceChains ?? [],
			entryPath: mapping.entryPath,
			className,
			line,
			column,
			context,
		});
	}

	return results;
}

/**
 * Filter dependencies by jar glob patterns using picomatch.
 * Shared by list-packages, list-classes, and search.
 */
export function filterDependenciesByJarPattern(
	filtered: Map<string, DependencyEntry>,
	jars: string[],
): Map<string, DependencyEntry> {
	const isMatch = picomatch(jars);
	const scoped = new Map<string, DependencyEntry>();
	for (const [id, entry] of filtered) {
		if (isMatch(id)) {
			scoped.set(id, entry);
		}
	}
	return scoped;
}

/**
 * Resolve dependencies for a tool invocation.
 * With jars param: strict whitelist from getAllDependencies (includes all study jars).
 * Without jars param: getFilteredDependencies(getResolvedDependencies(project), filterConfig).
 */
export function getDependenciesForTool(
	project: LoadedProject,
	jars?: string[],
): Map<string, DependencyEntry> {
	if (jars && jars.length > 0) {
		return filterDependenciesByJarPattern(getAllDependencies(project), jars);
	}
	return getFilteredDependencies(getResolvedDependencies(project), project.filterConfig);
}

/**
 * Strip detail fields from a NavigationResult for compact output.
 * When details.lineContent is true, returns the full result unchanged.
 */
export function stripNavigationResult(
	result: NavigationResult,
	details?: { lineContent?: boolean },
): NavigationResult {
	if (details?.lineContent) return result;
	const { context, entryPath, provenanceChains, ...essential } = result;
	return essential;
}

/**
 * Strip detail fields from a LocateResult for compact output.
 * When details.steps is true, returns the full result unchanged.
 * Note: the existing `context` field on LocateResult is controlled by
 * the separate `context` parameter and is NOT stripped here.
 */
export function stripLocateResult(
	result: LocateResult,
	details?: { steps?: boolean },
): LocateResult {
	if (details?.steps) return result;
	const { steps, provenanceChains, ...essential } = result;
	return essential;
}
