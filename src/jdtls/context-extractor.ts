/**
 * Context Extractor — Enclosing semantic unit extraction
 *
 * Given Java source text and a 1-based target line, finds the smallest
 * enclosing semantic unit (method, field, class, or falls back to
 * surrounding lines).
 *
 * Pure function. No I/O.
 */

import type { ContextSnippet, SnippetKind } from './types.js';

/** Matches lines that look like method/constructor declarations or annotations that precede them. */
const METHOD_MODIFIER_RE = /^\s*(?:@\w+|public|protected|private|static|final|abstract|synchronized|native|default)\b/;

/** Matches field declarations: modifiers + type + name + (= or ;) */
const FIELD_RE = /^\s*(?:public |protected |private |static |final |volatile |transient )*(?:[\w<>\[\],?\s]+)\s+\w+\s*[=;]/;

/** Matches class/interface/enum/record declarations */
const CLASS_RE = /^\s*(?:public |protected |private |static |final |abstract |sealed |non-sealed )*(?:class|interface|enum|record)\s+/;

const FALLBACK_CONTEXT_LINES = 5;
const METHOD_SCAN_LIMIT = 50;
const CLASS_SCAN_LIMIT = 10;

function buildSnippet(lines: string[], startLine: number, endLine: number, kind: SnippetKind): ContextSnippet {
	const snippet = lines.slice(startLine - 1, endLine).join('\n');
	return { snippet, startLine, endLine, kind };
}

/**
 * Find the matching closing brace for an opening brace, handling nesting.
 * @param lines Array of source lines
 * @param startIdx 0-based line index to start scanning from
 * @returns 0-based line index of the closing brace, or -1 if not found
 */
function findMatchingBrace(lines: string[], startIdx: number): number {
	let depth = 0;
	for (let i = startIdx; i < lines.length; i++) {
		const line = lines[i];
		for (const ch of line) {
			if (ch === '{') depth++;
			if (ch === '}') {
				depth--;
				if (depth === 0) return i;
			}
		}
	}
	return -1;
}

/**
 * Scan backward from targetIdx looking for method declaration start.
 * Returns 0-based line index of the first line of the method declaration, or -1.
 */
function findMethodStart(lines: string[], targetIdx: number): number {
	const limit = Math.max(0, targetIdx - METHOD_SCAN_LIMIT);

	for (let i = targetIdx; i >= limit; i--) {
		const line = lines[i];

		// Skip blank lines and lines that are just closing braces
		if (line.trim() === '' || line.trim() === '}') continue;

		// Check if this line has method-like modifiers/annotations and contains '('
		if (METHOD_MODIFIER_RE.test(line)) {
			// Check if this line or nearby lines contain '(' (method params)
			// Look forward up to 5 lines for the opening paren
			for (let j = i; j <= Math.min(i + 5, targetIdx); j++) {
				if (lines[j].includes('(')) {
					// Found a method-like declaration starting at line i
					// But we need to include preceding annotations
					let methodStart = i;
					while (methodStart > 0 && /^\s*@\w+/.test(lines[methodStart - 1])) {
						methodStart--;
					}
					return methodStart;
				}
			}
		}
	}

	return -1;
}

/**
 * Find the opening brace of a method starting from its declaration line.
 * @returns 0-based line index containing the opening brace, or -1
 */
function findOpeningBrace(lines: string[], startIdx: number): number {
	for (let i = startIdx; i < Math.min(startIdx + 10, lines.length); i++) {
		if (lines[i].includes('{')) {
			return i;
		}
	}
	return -1;
}

/**
 * Extract the smallest enclosing semantic unit for the given position.
 *
 * @param source Full Java source text
 * @param targetLine 1-based line number
 * @returns ContextSnippet describing the enclosing unit
 */
export function extractEnclosingContext(source: string, targetLine: number): ContextSnippet {
	const lines = source.split('\n');
	const totalLines = lines.length;
	const targetIdx = targetLine - 1; // Convert to 0-based

	// Clamp target line
	const clampedIdx = Math.max(0, Math.min(targetIdx, totalLines - 1));

	// 1. Try to find enclosing method
	const methodStart = findMethodStart(lines, clampedIdx);
	if (methodStart !== -1) {
		const braceIdx = findOpeningBrace(lines, methodStart);
		if (braceIdx !== -1) {
			if (clampedIdx <= braceIdx) {
				// Position is at or before the opening brace -- return method signature
				return buildSnippet(lines, methodStart + 1, braceIdx + 1, 'method');
			}
			// Position is inside the method body -- find closing brace
			const closeIdx = findMatchingBrace(lines, braceIdx);
			if (closeIdx !== -1 && clampedIdx <= closeIdx) {
				return buildSnippet(lines, methodStart + 1, closeIdx + 1, 'method');
			}
		}
	}

	// 2. Try field declaration (check target line itself)
	if (FIELD_RE.test(lines[clampedIdx])) {
		let endIdx = clampedIdx;
		// Extend for multi-line fields (lines ending with , or +)
		while (endIdx < totalLines - 1 && /[,+]\s*$/.test(lines[endIdx]) && !lines[endIdx].includes(';')) {
			endIdx++;
		}
		return buildSnippet(lines, clampedIdx + 1, endIdx + 1, 'field');
	}

	// 3. Try class/interface/enum/record declaration
	for (let i = clampedIdx; i >= Math.max(0, clampedIdx - CLASS_SCAN_LIMIT); i--) {
		if (CLASS_RE.test(lines[i])) {
			// Find the line with the opening brace
			let endIdx = i;
			for (let j = i; j < Math.min(i + 5, totalLines); j++) {
				if (lines[j].includes('{')) {
					endIdx = j;
					break;
				}
			}
			return buildSnippet(lines, i + 1, endIdx + 1, 'class');
		}
	}

	// 4. Fallback: surrounding lines
	const startLine = Math.max(1, targetLine - FALLBACK_CONTEXT_LINES);
	const endLine = Math.min(totalLines, targetLine + FALLBACK_CONTEXT_LINES);
	return buildSnippet(lines, startLine, endLine, 'fallback');
}
