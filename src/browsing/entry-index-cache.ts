import { EntryIndex } from './entry-index.js';

// Cache EntryIndex per jar path to avoid rebuilding on repeated calls
export const entryIndexCache = new Map<string, EntryIndex>();

export function getOrBuildIndex(entries: string[], cacheKey: string): EntryIndex {
	const cached = entryIndexCache.get(cacheKey);
	if (cached) return cached;

	const index = new EntryIndex(entries);
	entryIndexCache.set(cacheKey, index);
	return index;
}

export function clearEntryIndexCache(): void {
	entryIndexCache.clear();
}

export function evictEntryIndex(cacheKey: string): boolean {
	return entryIndexCache.delete(cacheKey);
}
