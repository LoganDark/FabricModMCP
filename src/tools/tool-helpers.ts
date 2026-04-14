/**
 * Shared utilities for tool files.
 *
 * Single source of truth for: CATEGORY_PRIORITY, sortByPriority, classNameToEntryPath,
 * normalizeLocations, and LocateFailure.
 */

import type { JarCategory, DependencyEntry } from '../project/types.js';
import type { CascadeStep } from '../browsing/cascading-regex.js';

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
