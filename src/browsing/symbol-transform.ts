/**
 * Symbol Transform — Convert LSP DocumentSymbol/SymbolInformation to TransformedSymbol
 *
 * Shared by list-members and read-member tools. Converts 0-based LSP positions
 * to 1-based for human readability.
 */

import { SYMBOL_KIND_NAME } from '../jdtls/symbol-kind.js';
import type { TransformedSymbol } from './types.js';

/**
 * Transform a DocumentSymbol from the LSP response into a structured member.
 * Converts 0-based LSP positions to 1-based for human readability.
 */
export function transformSymbol(sym: any): TransformedSymbol {
	return {
		name: sym.name,
		kind: SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`,
		detail: sym.detail ?? null,
		deprecated: sym.tags?.includes(1) ?? false, // SymbolTag.Deprecated = 1
		range: {
			start: { line: sym.range.start.line + 1, character: sym.range.start.character + 1 },
			end: { line: sym.range.end.line + 1, character: sym.range.end.character + 1 },
		},
		selectionRange: {
			start: { line: sym.selectionRange.start.line + 1, character: sym.selectionRange.start.character + 1 },
			end: { line: sym.selectionRange.end.line + 1, character: sym.selectionRange.end.character + 1 },
		},
		children: sym.children?.map(transformSymbol) ?? [],
	};
}

/**
 * Handle SymbolInformation[] (flat) response defensively.
 * If JDT LS ignores hierarchicalDocumentSymbolSupport, items have `location` instead of `range`.
 */
export function transformSymbolInformation(sym: any): TransformedSymbol {
	const range = sym.location?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
	return {
		name: sym.name,
		kind: SYMBOL_KIND_NAME[sym.kind] ?? `unknown(${sym.kind})`,
		detail: null,
		deprecated: sym.tags?.includes(1) ?? false,
		range: {
			start: { line: range.start.line + 1, character: range.start.character + 1 },
			end: { line: range.end.line + 1, character: range.end.character + 1 },
		},
		selectionRange: {
			start: { line: range.start.line + 1, character: range.start.character + 1 },
			end: { line: range.end.line + 1, character: range.end.character + 1 },
		},
		children: [],
	};
}

/**
 * Check if an LSP response item is SymbolInformation (flat) vs DocumentSymbol (hierarchical).
 */
export function isSymbolInformation(item: any): boolean {
	return item && 'location' in item && !('range' in item);
}

/**
 * Transform an array of LSP symbol results (DocumentSymbol[] or SymbolInformation[])
 * into TransformedSymbol[].
 */
export function transformSymbolResponse(symbolResult: any): TransformedSymbol[] {
	if (symbolResult === null || symbolResult === undefined) {
		return [];
	}
	if (Array.isArray(symbolResult) && symbolResult.length > 0 && isSymbolInformation(symbolResult[0])) {
		return symbolResult.map(transformSymbolInformation);
	}
	if (Array.isArray(symbolResult)) {
		return symbolResult.map(transformSymbol);
	}
	return [];
}
