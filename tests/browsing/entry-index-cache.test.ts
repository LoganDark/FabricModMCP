import { describe, it, expect, beforeEach } from 'vitest';
import { getOrBuildIndex, clearEntryIndexCache, evictEntryIndex, entryIndexCache } from '../../src/browsing/entry-index-cache.js';

const sampleEntries = [
	'net/minecraft/client/MinecraftClient.java',
	'net/minecraft/Bootstrap.java',
];

describe('entry-index-cache', () => {
	beforeEach(() => {
		clearEntryIndexCache();
	});

	describe('evictEntryIndex', () => {
		it('removes a cached entry and returns true', () => {
			getOrBuildIndex(sampleEntries, 'jar-a');
			expect(entryIndexCache.has('jar-a')).toBe(true);
			const result = evictEntryIndex('jar-a');
			expect(result).toBe(true);
			expect(entryIndexCache.has('jar-a')).toBe(false);
		});

		it('returns false for non-existent key', () => {
			const result = evictEntryIndex('nonexistent');
			expect(result).toBe(false);
		});

		it('does not affect other cached entries', () => {
			getOrBuildIndex(sampleEntries, 'jar-a');
			getOrBuildIndex(sampleEntries, 'jar-b');
			evictEntryIndex('jar-a');
			expect(entryIndexCache.has('jar-a')).toBe(false);
			expect(entryIndexCache.has('jar-b')).toBe(true);
		});
	});

	describe('getOrBuildIndex', () => {
		it('caches index on first call and returns same instance', () => {
			const first = getOrBuildIndex(sampleEntries, 'jar-x');
			const second = getOrBuildIndex(sampleEntries, 'jar-x');
			expect(first).toBe(second);
		});
	});

	describe('clearEntryIndexCache', () => {
		it('removes all entries', () => {
			getOrBuildIndex(sampleEntries, 'jar-a');
			getOrBuildIndex(sampleEntries, 'jar-b');
			clearEntryIndexCache();
			expect(entryIndexCache.size).toBe(0);
		});
	});
});
