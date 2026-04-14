import { describe, it, expect } from 'vitest';
import { sliceLines } from '../../src/browsing/line-slicer.js';
import type { LineSliceResult } from '../../src/browsing/line-slicer.js';

describe('sliceLines', () => {
	it('returns full source with metadata when no params provided', () => {
		const result = sliceLines('a\nb\nc');
		expect(result).toEqual({
			source: 'a\nb\nc',
			startLine: 1,
			endLine: 3,
			totalLineCount: 3,
			truncated: false,
		});
	});

	it('returns from startLine to EOF when only startLine provided', () => {
		const result = sliceLines('a\nb\nc\nd\ne', 3);
		expect(result).toEqual({
			source: 'c\nd\ne',
			startLine: 3,
			endLine: 5,
			totalLineCount: 5,
			truncated: true,
		});
	});

	it('returns first N lines when only lineCount provided', () => {
		const result = sliceLines('a\nb\nc\nd\ne', undefined, 2);
		expect(result).toEqual({
			source: 'a\nb',
			startLine: 1,
			endLine: 2,
			totalLineCount: 5,
			truncated: true,
		});
	});

	it('returns exactly N lines from startLine when both provided', () => {
		const result = sliceLines('a\nb\nc\nd\ne', 2, 2);
		expect(result).toEqual({
			source: 'b\nc',
			startLine: 2,
			endLine: 3,
			totalLineCount: 5,
			truncated: true,
		});
	});

	it('clamps silently when range exceeds file length', () => {
		const result = sliceLines('a\nb\nc', 2, 10);
		expect(result).toEqual({
			source: 'b\nc',
			startLine: 2,
			endLine: 3,
			totalLineCount: 3,
			truncated: true,
		});
	});

	it('returns empty content with metadata when startLine beyond EOF', () => {
		const result = sliceLines('a\nb\nc', 10);
		expect(result).toEqual({
			source: '',
			startLine: 10,
			endLine: 9,
			totalLineCount: 3,
			truncated: true,
		});
	});

	it('handles empty file', () => {
		const result = sliceLines('');
		expect(result).toEqual({
			source: '',
			startLine: 1,
			endLine: 1,
			totalLineCount: 1,
			truncated: false,
		});
	});

	it('preserves trailing newline', () => {
		const result = sliceLines('a\nb\n');
		expect(result).toEqual({
			source: 'a\nb\n',
			startLine: 1,
			endLine: 3,
			totalLineCount: 3,
			truncated: false,
		});
	});

	it('satisfies chunk concatenation invariant', () => {
		const text = 'a\nb\nc\nd\ne\nf';
		const chunk1 = sliceLines(text, 1, 3);
		const chunk2 = sliceLines(text, 4, 3);
		const combined = sliceLines(text, 1, 6);
		expect(chunk1.source + '\n' + chunk2.source).toBe(combined.source);
	});

	it('returns truncated: false when explicit range covers all lines', () => {
		const result = sliceLines('a\nb\nc', 1, 3);
		expect(result).toEqual({
			source: 'a\nb\nc',
			startLine: 1,
			endLine: 3,
			totalLineCount: 3,
			truncated: false,
		});
	});

	it('returns truncated: false when lineCount exceeds total from line 1', () => {
		const result = sliceLines('a\nb\nc', 1, 100);
		expect(result).toEqual({
			source: 'a\nb\nc',
			startLine: 1,
			endLine: 3,
			totalLineCount: 3,
			truncated: false,
		});
	});
});
