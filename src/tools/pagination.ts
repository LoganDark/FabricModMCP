/**
 * Shared pagination utility for MCP tool results.
 *
 * Provides generic slice-based pagination with hasMore detection.
 */

/** Input parameters for pagination. Both fields are optional. */
export type PaginationInput = {
	limit?: number;
	offset?: number;
}

/** Paginated result with metadata. */
export type PaginatedResult<T> = {
	results: T[];
	total: number;
	offset: number;
	hasMore: boolean;
}

/**
 * Apply pagination to an array of items.
 *
 * - When limit is omitted, all items from offset onward are returned.
 * - When offset is omitted, it defaults to 0.
 * - hasMore is true when there are more items beyond the returned slice.
 */
export function applyPagination<T>(items: T[], input: PaginationInput): PaginatedResult<T> {
	const offset = input.offset ?? 0;
	const sliced = input.limit !== undefined
		? items.slice(offset, offset + input.limit)
		: items.slice(offset);
	return {
		results: sliced,
		total: items.length,
		offset,
		hasMore: offset + sliced.length < items.length,
	};
}
