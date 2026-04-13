import { describe, it, expect } from 'vitest';
import { matchesFilter, getFilteredDependencies } from '../../src/project/jar-registry.js';
import type { DependencyEntry, FilterConfig } from '../../src/project/types.js';

function makeDep(id: string, category: DependencyEntry['category'] = 'library'): DependencyEntry {
	const parts = id.split(':');
	return {
		id,
		group: parts.length === 2 ? parts[0] : '',
		artifact: parts.length === 2 ? parts[1] : id,
		version: '1.0.0',
		category,
		sourcesJarPath: `/fake/${id}-sources.jar`,
		available: true,
	};
}

describe('matchesFilter', () => {
	it('always returns true for "minecraft" regardless of filter config', () => {
		const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };
		expect(matchesFilter('minecraft', filter)).toBe(true);
	});

	it('always returns true for "src" regardless of filter config', () => {
		const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };
		expect(matchesFilter('src', filter)).toBe(true);
	});

	it('include-all mode with empty patterns returns true for any ID', () => {
		const filter: FilterConfig = { mode: 'include-all', patterns: [] };
		expect(matchesFilter('com.google.code.gson:gson', filter)).toBe(true);
	});

	it('exclude-all mode with empty patterns returns false for non-special IDs', () => {
		const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };
		expect(matchesFilter('com.google.code.gson:gson', filter)).toBe(false);
	});

	it('include-all mode: matching pattern excludes the jar', () => {
		const filter: FilterConfig = {
			mode: 'include-all',
			patterns: ['net.fabricmc.fabric-api:*'],
		};
		expect(matchesFilter('net.fabricmc.fabric-api:fabric-networking-api-v1', filter)).toBe(false);
	});

	it('include-all mode: non-matching ID is included', () => {
		const filter: FilterConfig = {
			mode: 'include-all',
			patterns: ['net.fabricmc.fabric-api:*'],
		};
		expect(matchesFilter('com.google.code.gson:gson', filter)).toBe(true);
	});

	it('exclude-all mode: matching pattern includes the jar', () => {
		const filter: FilterConfig = {
			mode: 'exclude-all',
			patterns: ['net.fabricmc.fabric-api:*'],
		};
		expect(matchesFilter('net.fabricmc.fabric-api:fabric-networking-api-v1', filter)).toBe(true);
	});

	it('exclude-all mode: non-matching ID is excluded', () => {
		const filter: FilterConfig = {
			mode: 'exclude-all',
			patterns: ['net.fabricmc.fabric-api:*'],
		};
		expect(matchesFilter('com.google.code.gson:gson', filter)).toBe(false);
	});

	it('glob "**:gson" matches "com.google.code.gson:gson"', () => {
		const filter: FilterConfig = {
			mode: 'exclude-all',
			patterns: ['**:gson'],
		};
		expect(matchesFilter('com.google.code.gson:gson', filter)).toBe(true);
	});
});

describe('getFilteredDependencies', () => {
	it('returns only entries that pass the filter', () => {
		const deps = new Map<string, DependencyEntry>([
			['minecraft', makeDep('minecraft', 'minecraft')],
			['src', makeDep('src', 'mod-source')],
			['net.fabricmc.fabric-api:fabric-networking-api-v1', makeDep('net.fabricmc.fabric-api:fabric-networking-api-v1', 'fabric-api')],
			['com.google.code.gson:gson', makeDep('com.google.code.gson:gson')],
		]);

		const filter: FilterConfig = {
			mode: 'include-all',
			patterns: ['net.fabricmc.fabric-api:*'],
		};

		const filtered = getFilteredDependencies(deps, filter);
		expect(filtered.has('minecraft')).toBe(true);
		expect(filtered.has('src')).toBe(true);
		expect(filtered.has('com.google.code.gson:gson')).toBe(true);
		expect(filtered.has('net.fabricmc.fabric-api:fabric-networking-api-v1')).toBe(false);
	});
});
