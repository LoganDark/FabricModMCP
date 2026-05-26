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
import type { JarCategory, DependencyEntry, Project } from '../project/types.js';
import { resolveJarId, resolveJarIds, getAutoIncludeIds } from '../project/namespace-resolver.js';
import { studyJarToDependencyEntry } from '../project/study-jar.js';
import type { CascadeStep } from '../browsing/cascading-regex.js';
import type { SymbolPositionResult } from './resolve-symbol-position.js';
import type { NavigationResult } from '../jdtls/types.js';
import type { LocateResult, EnrichedSymbol, ClassInfo } from '../browsing/types.js';
import type { UriMapper } from '../jdtls/uri-mapper.js';
import { entryPathToClassName } from '../jdtls/uri-mapper.js';
import { extractEnclosingContext } from '../jdtls/context-extractor.js';
import type { LspClient } from 'ts-lsp-client';
import { projectStore } from '../state/project-store.js';
import { makeError, makeSuccess } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { getAllDependencies } from '../project/dependency-resolver.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { fileUriToPath } from '../platform/uri.js';

export type LocateFailure = {
	jar: string;
	category: JarCategory;
	provenanceChains?: string[][];
	steps?: CascadeStep[];
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

/**
 * Get rootPath for a dependency's owning child.
 * With scope: use that child's rootPath.
 * Without scope: find sole fabric mod's rootPath, or undefined if ambiguous.
 */
export function getRootPathForScope(project: Project, scope?: string): string | undefined {
	if (scope) {
		const child = project.children.get(scope);
		return child?.kind === 'fabric-mod' ? child.rootPath : undefined;
	}
	// Find sole fabric mod's rootPath
	let rootPath: string | undefined;
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') {
			if (rootPath !== undefined) return undefined; // multiple mods, ambiguous
			rootPath = child.rootPath;
		}
	}
	return rootPath;
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
export function resolveProjectSafely(project?: string): { ok: true; project: Project } | { ok: false; error: { content: { type: 'text'; text: string }[]; structuredContent: ReturnType<typeof makeError> } } {
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
 * Check whether a resolved project has any browseable content.
 * Returns an error result if the workspace is empty, or null if dependencies exist.
 */
export function requireDependencies(project: Project, scope?: string): ReturnType<typeof returnError> | null {
	if (project.children.size === 0) {
		return returnError(
			'EMPTY_WORKSPACE',
			`Project '${project.name}' has no fabric mods or study jars loaded. Add content before browsing.`,
			[],
			['Use add_fabric_mod to register a Fabric mod directory (provides Minecraft sources + dependencies)', 'Use add_study_jar to load any jar file for source browsing'],
		);
	}

	const deps = getDependenciesForTool(project, undefined, scope);
	let hasAvailable = false;
	for (const [, dep] of deps) {
		if (dep.available) {
			hasAvailable = true;
			break;
		}
	}

	if (deps.size === 0 || !hasAvailable) {
		// Check if any children have available dependencies at all
		let anyAvailable = false;
		for (const child of project.children.values()) {
			if (child.kind === 'fabric-mod') {
				for (const [, dep] of child.dependencyJars) {
					if (dep.available) { anyAvailable = true; break; }
				}
			} else if (child.kind === 'study-jar') {
				anyAvailable = true;
			}
			if (anyAvailable) break;
		}

		if (!anyAvailable) {
			return returnError(
				'NO_SOURCES_AVAILABLE',
				`Project '${project.name}' has no source jars available for browsing.`,
				[],
				['Check that your fabric mod directory has valid Gradle properties', 'Use add_study_jar to load a jar file directly'],
			);
		}
	}

	return null;
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
	loadedProject: Project,
	className: string,
	jar?: string,
	scope?: string,
): Promise<
	| { success: true; sourceJarId: string; sourceText: string; entryPath: string }
	| { success: false; kind: 'jar-not-found'; jar: string }
	| { success: false; kind: 'jar-not-available'; jar: string }
	| { success: false; kind: 'class-not-found'; entryPath: string; jar?: string }
> {
	const entryPath = classNameToEntryPath(className);
	const rootPath = getRootPathForScope(loadedProject, scope);

	if (jar !== undefined) {
		const resolvedJar = resolveJarId(loadedProject, jar, scope);
		const dep = getAllDependencies(loadedProject).get(resolvedJar);
		if (!dep) {
			return { success: false, kind: 'jar-not-found', jar: resolvedJar };
		}
		if (!dep.available) {
			return { success: false, kind: 'jar-not-available', jar: resolvedJar };
		}
		try {
			const adapter = createSourceAdapter(jarReader, dep, rootPath);
			const buffer = await adapter.readEntry(entryPath);
			return { success: true, sourceJarId: resolvedJar, sourceText: buffer.toString('utf-8'), entryPath };
		} catch {
			return { success: false, kind: 'class-not-found', entryPath, jar: resolvedJar };
		}
	}

	// All-jars mode: use getDependenciesForTool for scope-aware filtering
	const filtered = getDependenciesForTool(loadedProject, undefined, scope);
	const sorted = sortByPriority(Array.from(filtered.entries()));

	const attempts = await Promise.all(sorted.map(async ([id, dep]) => {
		if (!dep.available) return null;
		try {
			const adapter = createSourceAdapter(jarReader, dep, rootPath);
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
			['Check available jars with get_member_info or get_project_info'],
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
		return returnError('JAR_NOT_FOUND', `Jar '${sourceResult.jar}' not found in project '${projectName}'`, [sourceResult.jar], ['Check available jars with get_member_info or get_project_info']);
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
	loadedProject: Project,
	uriMapper: UriMapper,
): Promise<NavigationResult[]> {
	const results: NavigationResult[] = [];
	const sourceCache = new Map<string, string>();

	for (const loc of locations) {
		const mapping = uriMapper.fromFileUri(loc.uri);
		if (!mapping) continue;

		let filePath: string;
		try {
			filePath = fileUriToPath(loc.uri);
		} catch {
			continue;
		}
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
 * With jars param: resolve bare IDs via namespace resolver, then filter from getAllDependencies.
 * Without jars param: scope-aware filtered dependencies with autoIncludeIds.
 */
export function getDependenciesForTool(
	project: Project,
	jars?: string[],
	scope?: string,
): Map<string, DependencyEntry> {
	if (jars && jars.length > 0) {
		const resolvedJars = resolveJarIds(project, jars, scope);
		return filterDependenciesByJarPattern(getAllDependencies(project), resolvedJars);
	}

	// Compute auto-include IDs from fabric mod children (scoped or all)
	const autoIncludeIds = new Set<string>();
	if (scope) {
		const child = project.children.get(scope);
		if (child?.kind === 'fabric-mod') {
			for (const id of getAutoIncludeIds(child)) autoIncludeIds.add(id);
		}
	} else {
		for (const child of project.children.values()) {
			if (child.kind === 'fabric-mod') {
				for (const id of getAutoIncludeIds(child)) autoIncludeIds.add(id);
			}
		}
	}

	// Scope filtering: if scoped, only include that child's deps + autoInclude study jars
	let deps: Map<string, DependencyEntry>;
	if (scope) {
		deps = new Map<string, DependencyEntry>();
		const child = project.children.get(scope);
		if (child?.kind === 'fabric-mod') {
			for (const [id, dep] of child.dependencyJars) {
				deps.set(id, dep);
			}
		}
		// Add autoInclude study jars
		for (const c of project.children.values()) {
			if (c.kind === 'study-jar' && c.autoInclude) {
				const entry = studyJarToDependencyEntry(c);
				deps.set(entry.id, entry);
			}
		}
	} else {
		// Per-child filtering: each mod's filter applies only to its own deps
		deps = new Map<string, DependencyEntry>();
		for (const child of project.children.values()) {
			if (child.kind === 'fabric-mod') {
				const childAutoInclude = getAutoIncludeIds(child);
				const filtered = getFilteredDependencies(child.dependencyJars, child.filterConfig, childAutoInclude);
				for (const [id, entry] of filtered) {
					deps.set(id, entry);
				}
			}
		}
		// Add autoInclude study jars (project-level, always included)
		for (const child of project.children.values()) {
			if (child.kind === 'study-jar' && child.autoInclude) {
				const entry = studyJarToDependencyEntry(child);
				deps.set(entry.id, entry);
			}
		}
		return deps;
	}

	// Apply filter for scoped path only
	const filterChild = project.children.get(scope!);
	const filter = filterChild?.kind === 'fabric-mod' ? filterChild.filterConfig : { mode: 'include-all' as const, patterns: [] };

	return getFilteredDependencies(deps, filter, autoIncludeIds);
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

/**
 * Strip detail fields from a LocateFailure for compact output.
 * When details.steps is true, returns the full failure unchanged.
 */
export function stripLocateFailure(
	failure: LocateFailure,
	details?: { steps?: boolean },
): LocateFailure {
	if (details?.steps) return failure;
	const { steps, provenanceChains, ...essential } = failure;
	return essential;
}

/**
 * Strip detail fields from an EnrichedSymbol for compact output.
 * Recurses through children. When details.signatures is true, returns full data.
 *
 * Compact shape keeps: name, kind, memberFqn, deprecated, range (lines only), children.
 * Full shape adds: detail, selectionRange, range characters, parameters, returnType, fieldType.
 */
export function stripEnrichedSymbol(
	sym: EnrichedSymbol,
	details?: { signatures?: boolean },
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		name: sym.name,
		kind: sym.kind,
		deprecated: sym.deprecated,
		range: {
			start: { line: sym.range.start.line },
			end: { line: sym.range.end.line },
		},
		children: sym.children.map(c => stripEnrichedSymbol(c, details)),
	};

	if ('memberFqn' in sym) base.memberFqn = sym.memberFqn;
	if ('fqn' in sym) base.fqn = sym.fqn;

	if (details?.signatures) {
		base.detail = sym.detail;
		base.selectionRange = sym.selectionRange;
		base.range = sym.range; // full range with characters
		if ('parameters' in sym) base.parameters = sym.parameters;
		if ('returnType' in sym) base.returnType = sym.returnType;
		if ('fieldType' in sym) base.fieldType = sym.fieldType;
	}

	return base;
}

/**
 * Strip detail fields from a ClassInfo for compact output.
 * modifiers flag controls access/modifiers fields.
 * innerClasses flag controls inner class listings.
 * When innerClasses is true but modifiers is false, inner classes have compact shape (name/fqn/kind only).
 *
 * Compact shape keeps: name, fqn, kind, jars.
 * Full shape adds: access, modifiers, innerClasses (with inner class access/modifiers).
 */
export function stripClassInfo(
	info: ClassInfo,
	details?: { modifiers?: boolean; innerClasses?: boolean },
): ClassInfo {
	const { access, modifiers, innerClasses, ...essential } = info;
	const result: ClassInfo = { ...essential };

	if (details?.modifiers) {
		result.access = access;
		result.modifiers = modifiers;
	}

	if (details?.innerClasses && innerClasses) {
		if (details?.modifiers) {
			result.innerClasses = innerClasses;
		} else {
			// Compact inner classes: strip access and modifiers from each entry
			result.innerClasses = innerClasses.map(({ access: _a, modifiers: _m, ...ic }) => ic);
		}
	}

	return result;
}

/**
 * Render a single NavigationResult (find_definition / find_implementations / find_references)
 * as a human/agent-readable text block. Includes the optional context snippet when present
 * (i.e. when the tool was called with details.lineContent=true).
 */
export function renderNavigationResult(r: NavigationResult, index: number): string {
	const lines: string[] = [];
	lines.push(`${index + 1}. ${r.className} (${r.jar}) — line ${r.line}, col ${r.column}`);
	if (r.entryPath) lines.push(`   path: ${r.entryPath}`);
	if (r.context) {
		lines.push(`   context (${r.context.kind}, lines ${r.context.startLine}-${r.context.endLine}):`);
		const indented = r.context.snippet.split('\n').map(l => `     ${l}`).join('\n');
		lines.push(indented);
	}
	return lines.join('\n');
}

/**
 * Render a list of NavigationResults as a single text block (numbered list).
 * Returns null when the list is empty so callers can skip the body block.
 */
export function renderNavigationList(results: NavigationResult[]): string | null {
	if (results.length === 0) return null;
	return results.map((r, i) => renderNavigationResult(r, i)).join('\n');
}
