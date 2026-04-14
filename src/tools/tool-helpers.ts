/**
 * Shared utilities for tool files.
 *
 * Single source of truth for: CATEGORY_PRIORITY, sortByPriority, classNameToEntryPath,
 * normalizeLocations, LocateFailure, resolveProjectSafely, returnError, withLspDocument,
 * and resolveClassSource.
 */

import type { JarCategory, DependencyEntry, LoadedProject } from '../project/types.js';
import type { CascadeStep } from '../browsing/cascading-regex.js';
import type { LspClient } from 'ts-lsp-client';
import { projectStore } from '../state/project-store.js';
import { makeError } from '../types/envelope.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
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
		const dep = loadedProject.dependencyJars.get(jar);
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

	// All-jars mode: find first jar containing the class
	const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
	const sorted = sortByPriority(Array.from(filtered.entries()));

	for (const [id, dep] of sorted) {
		if (!dep.available) continue;
		try {
			const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
			const buffer = await adapter.readEntry(entryPath);
			return { success: true, sourceJarId: id, sourceText: buffer.toString('utf-8'), entryPath };
		} catch {
			continue;
		}
	}

	return { success: false, kind: 'class-not-found', entryPath };
}
