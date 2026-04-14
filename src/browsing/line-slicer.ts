/**
 * Line Slicer — pure utility for extracting line ranges from source text
 *
 * Given source text and optional startLine/lineCount parameters, returns
 * the requested slice with metadata. 1-based line numbering throughout.
 *
 * Pure function. No I/O.
 */

export interface LineSliceResult {
	source: string;
	startLine: number;
	endLine: number;
	totalLineCount: number;
	truncated: boolean;
}

export function sliceLines(
	sourceText: string,
	requestedStartLine?: number,
	requestedLineCount?: number,
): LineSliceResult {
	const lines = sourceText.split('\n');
	const totalLineCount = lines.length;

	// When neither param provided: return full source unchanged
	if (requestedStartLine === undefined && requestedLineCount === undefined) {
		return {
			source: sourceText,
			startLine: 1,
			endLine: totalLineCount,
			totalLineCount,
			truncated: false,
		};
	}

	const start = requestedStartLine ?? 1;

	// When startLine is beyond EOF: return empty content
	if (start > totalLineCount) {
		return {
			source: '',
			startLine: start,
			endLine: start - 1,
			totalLineCount,
			truncated: true,
		};
	}

	// Compute effective end line
	const end = requestedLineCount !== undefined
		? Math.min(start + requestedLineCount - 1, totalLineCount)
		: totalLineCount;

	// Extract: 1-based start to 0-based for slice, end is inclusive 1-based
	// so use end directly since Array.slice end is exclusive
	const source = lines.slice(start - 1, end).join('\n');
	const truncated = start !== 1 || end !== totalLineCount;

	return {
		source,
		startLine: start,
		endLine: end,
		totalLineCount,
		truncated,
	};
}
