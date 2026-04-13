import picomatch from 'picomatch';
import type { DependencyEntry, FilterConfig } from './types.js';

export function matchesFilter(jarId: string, filter: FilterConfig): boolean {
	// minecraft and src are always included
	if (jarId === 'minecraft' || jarId === 'src') return true;

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
): Map<string, DependencyEntry> {
	const filtered = new Map<string, DependencyEntry>();
	for (const [id, entry] of deps) {
		if (matchesFilter(id, filter)) {
			filtered.set(id, entry);
		}
	}
	return filtered;
}
