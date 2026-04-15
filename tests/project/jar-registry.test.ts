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

	describe('autoIncludeIds', () => {
		it('returns true for IDs in the autoIncludeIds set regardless of filter', () => {
			const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };
			const autoIncludeIds = new Set(['testmod/minecraft', 'testmod']);
			expect(matchesFilter('testmod/minecraft', filter, autoIncludeIds)).toBe(true);
			expect(matchesFilter('testmod', filter, autoIncludeIds)).toBe(true);
		});

		it('without autoIncludeIds, no IDs are auto-included', () => {
			const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };
			expect(matchesFilter('testmod/minecraft', filter)).toBe(false);
			expect(matchesFilter('testmod', filter)).toBe(false);
		});

		it('non-autoInclude IDs still follow normal filter rules', () => {
			const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };
			const autoIncludeIds = new Set(['testmod/minecraft']);
			expect(matchesFilter('com.google.code.gson:gson', filter, autoIncludeIds)).toBe(false);
		});

		it('autoIncludeIds bypasses exclude patterns in include-all mode', () => {
			const filter: FilterConfig = {
				mode: 'include-all',
				patterns: ['testmod/minecraft'],
			};
			const autoIncludeIds = new Set(['testmod/minecraft']);
			// Without autoIncludeIds this would be excluded by the pattern
			expect(matchesFilter('testmod/minecraft', filter, autoIncludeIds)).toBe(true);
		});
	});
});

describe('getFilteredDependencies', () => {
	it('returns only entries that pass the filter', () => {
		const deps = new Map<string, DependencyEntry>([
			['testmod/minecraft', makeDep('testmod/minecraft', 'minecraft')],
			['testmod', makeDep('testmod', 'mod-source')],
			['testmod/net.fabricmc.fabric-api:fabric-networking-api-v1', makeDep('testmod/net.fabricmc.fabric-api:fabric-networking-api-v1', 'fabric-api')],
			['testmod/com.google.code.gson:gson', makeDep('testmod/com.google.code.gson:gson')],
		]);

		const filter: FilterConfig = {
			mode: 'include-all',
			patterns: ['testmod/net.fabricmc.fabric-api:*'],
		};

		const autoIncludeIds = new Set(['testmod/minecraft', 'testmod']);
		const filtered = getFilteredDependencies(deps, filter, autoIncludeIds);
		expect(filtered.has('testmod/minecraft')).toBe(true);
		expect(filtered.has('testmod')).toBe(true);
		expect(filtered.has('testmod/com.google.code.gson:gson')).toBe(true);
		expect(filtered.has('testmod/net.fabricmc.fabric-api:fabric-networking-api-v1')).toBe(false);
	});

	it('passes autoIncludeIds through to matchesFilter', () => {
		const deps = new Map<string, DependencyEntry>([
			['testmod/minecraft', makeDep('testmod/minecraft', 'minecraft')],
			['testmod', makeDep('testmod', 'mod-source')],
		]);

		const filter: FilterConfig = { mode: 'exclude-all', patterns: [] };

		// Without autoIncludeIds, exclude-all with no patterns excludes everything
		const withoutAuto = getFilteredDependencies(deps, filter);
		expect(withoutAuto.size).toBe(0);

		// With autoIncludeIds, those IDs pass
		const autoIncludeIds = new Set(['testmod/minecraft', 'testmod']);
		const withAuto = getFilteredDependencies(deps, filter, autoIncludeIds);
		expect(withAuto.size).toBe(2);
	});
});
