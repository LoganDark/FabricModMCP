/**
 * Member Extractor — FQN parsing and source extraction for individual members
 *
 * Given enriched symbols and source text, extracts the source of a specific
 * member (method, constructor, or field) by its FQN, including Javadoc,
 * annotations, signature, and body.
 *
 * Pure functions. No I/O.
 */

import type { EnrichedSymbol, EnrichedMethodSymbol, EnrichedFieldSymbol } from './types.js';

export interface ParsedFqn {
	className: string;
	memberName: string;
	isMethod: boolean;
	isField: boolean;
}

export interface MemberExtraction {
	source: string;
	startLine: number;
	endLine: number;
	lineCount: number;
	memberFqn: string;
	kind: string;
}

/**
 * Parse a member FQN into its components.
 *
 * FQN format:
 * - Methods/constructors: `ClassName#methodName()`
 * - Fields: `ClassName#fieldName:`
 * - Inner class members: `Outer$Inner#member()` or `Outer$Inner#field:`
 *
 * @returns Parsed FQN or null if malformed
 */
export function parseMemberFqn(fqn: string): ParsedFqn | null {
	const hashIdx = fqn.indexOf('#');
	if (hashIdx === -1) return null;

	const className = fqn.substring(0, hashIdx);
	const suffix = fqn.substring(hashIdx + 1);

	if (suffix.endsWith('()')) {
		return {
			className,
			memberName: suffix.slice(0, -2),
			isMethod: true,
			isField: false,
		};
	}

	if (suffix.endsWith(':')) {
		return {
			className,
			memberName: suffix.slice(0, -1),
			isMethod: false,
			isField: true,
		};
	}

	return null; // No type indicator suffix
}

/**
 * Scan backward from rangeStartIdx to find the start of Javadoc decorations.
 *
 * JDT LS symbol ranges already include annotations, so this function only
 * looks for Javadoc comment blocks (`/** ... * /`) above the range start.
 *
 * @param lines Source text split into lines
 * @param rangeStartIdx 0-based index into lines array
 * @returns 0-based index of the Javadoc start, or rangeStartIdx if none found
 */
export function findDecorationsStart(lines: string[], rangeStartIdx: number): number {
	if (rangeStartIdx <= 0) return rangeStartIdx;

	let i = rangeStartIdx - 1;

	// Skip blank lines
	while (i >= 0 && lines[i].trim() === '') {
		i--;
	}

	if (i < 0) return rangeStartIdx;

	// Check if we hit a Javadoc closing tag
	if (lines[i].trim().endsWith('*/')) {
		// Scan upward for the Javadoc opening
		while (i >= 0) {
			if (lines[i].trimStart().startsWith('/**')) {
				return i;
			}
			i--;
		}
	}

	return rangeStartIdx;
}

/**
 * Extract source text for members matching a target FQN from enriched symbols.
 *
 * Walks the symbol tree recursively to find all members whose `memberFqn`
 * matches the target. For each match, extracts the source text including
 * any Javadoc above the declaration.
 *
 * @param sourceText Full source text of the class file
 * @param enrichedSymbols Enriched symbol tree from enrichSymbols()
 * @param targetFqn Member FQN to search for (e.g., "ClassName#method()")
 * @returns Array of extractions (multiple for overloaded methods)
 */
export function extractMemberSource(
	sourceText: string,
	enrichedSymbols: EnrichedSymbol[],
	targetFqn: string,
): MemberExtraction[] {
	const lines = sourceText.split('\n');
	const matches = collectMatchingSymbols(enrichedSymbols, targetFqn);

	return matches.map(sym => {
		const rangeStartIdx = sym.range.start.line - 1; // Convert 1-based to 0-based
		const rangeEndIdx = sym.range.end.line; // 1-based end line = exclusive 0-based slice end

		const decorationStart = findDecorationsStart(lines, rangeStartIdx);
		const source = lines.slice(decorationStart, rangeEndIdx).join('\n');

		return {
			source,
			startLine: decorationStart + 1, // Convert back to 1-based
			endLine: sym.range.end.line,
			lineCount: rangeEndIdx - decorationStart,
			memberFqn: (sym as EnrichedMethodSymbol | EnrichedFieldSymbol).memberFqn,
			kind: sym.kind,
		};
	});
}

/**
 * Recursively collect all symbols whose memberFqn matches the target.
 */
function collectMatchingSymbols(
	symbols: EnrichedSymbol[],
	targetFqn: string,
): EnrichedSymbol[] {
	const results: EnrichedSymbol[] = [];

	for (const sym of symbols) {
		// Check if this symbol has a memberFqn that matches
		if ('memberFqn' in sym && (sym as EnrichedMethodSymbol | EnrichedFieldSymbol).memberFqn === targetFqn) {
			results.push(sym);
		}

		// Recurse into children (classes contain members, inner classes contain members)
		if (sym.children.length > 0) {
			results.push(...collectMatchingSymbols(sym.children, targetFqn));
		}
	}

	return results;
}
