import { describe, it, expect } from 'vitest';
import { applyPagination } from '../../src/tools/pagination.js';

describe('applyPagination', () => {
	const items = [1, 2, 3, 4, 5];

	it('returns all items when no options provided', () => {
		expect(applyPagination(items, {})).toEqual({
			results: [1, 2, 3, 4, 5],
			total: 5,
			offset: 0,
			hasMore: false,
		});
	});

	it('returns a slice when limit is provided', () => {
		expect(applyPagination(items, { limit: 2 })).toEqual({
			results: [1, 2],
			total: 5,
			offset: 0,
			hasMore: true,
		});
	});

	it('returns a slice with offset and limit', () => {
		expect(applyPagination(items, { limit: 2, offset: 2 })).toEqual({
			results: [3, 4],
			total: 5,
			offset: 2,
			hasMore: true,
		});
	});

	it('returns partial slice when offset + limit exceeds length', () => {
		expect(applyPagination(items, { limit: 2, offset: 4 })).toEqual({
			results: [5],
			total: 5,
			offset: 4,
			hasMore: false,
		});
	});

	it('returns all items when limit exceeds length', () => {
		expect(applyPagination(items, { limit: 10 })).toEqual({
			results: [1, 2, 3, 4, 5],
			total: 5,
			offset: 0,
			hasMore: false,
		});
	});

	it('returns remainder when only offset is provided', () => {
		expect(applyPagination(items, { offset: 3 })).toEqual({
			results: [4, 5],
			total: 5,
			offset: 3,
			hasMore: false,
		});
	});

	it('returns empty when offset exceeds length', () => {
		expect(applyPagination(items, { offset: 10 })).toEqual({
			results: [],
			total: 5,
			offset: 10,
			hasMore: false,
		});
	});

	it('handles empty array with no options', () => {
		expect(applyPagination([], {})).toEqual({
			results: [],
			total: 0,
			offset: 0,
			hasMore: false,
		});
	});

	it('handles empty array with limit', () => {
		expect(applyPagination([], { limit: 5 })).toEqual({
			results: [],
			total: 0,
			offset: 0,
			hasMore: false,
		});
	});

	it('handles exact boundary (limit equals remaining items)', () => {
		expect(applyPagination([1, 2, 3], { limit: 3 })).toEqual({
			results: [1, 2, 3],
			total: 3,
			offset: 0,
			hasMore: false,
		});
	});
});
