import picomatch from 'picomatch';
import type { DependencyEntry, FilterConfig } from './types.js';

export function matchesFilter(jarId: string, filter: FilterConfig, autoIncludeIds?: Set<string>): boolean {
	// Auto-include IDs always pass the filter
	if (autoIncludeIds?.has(jarId)) return true;

	if (filter.patterns.length === 0) {
		return filter.mode === 'include-all';
	}

	const isMatch = picomatch(filter.patterns);
	const matched = isMatch(jarId);

	// include-all mode: patterns are an EXCLUDE list, so matched = excluded
	// exclude-all mode: patterns are an INCLUDE list, so matched = included
	return filter.mode === 'include-all' ? !matched : matched;
}

export function getFilteredDependencies(
	deps: Map<string, DependencyEntry>,
	filter: FilterConfig,
	autoIncludeIds?: Set<string>,
): Map<string, DependencyEntry> {
	const filtered = new Map<string, DependencyEntry>();
	for (const [id, entry] of deps) {
		if (matchesFilter(id, filter, autoIncludeIds)) {
			filtered.set(id, entry);
		}
	}
	return filtered;
}
