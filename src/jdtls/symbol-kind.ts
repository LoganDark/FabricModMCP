/**
 * LSP SymbolKind numeric enum to human-readable string mapping.
 * Values from LSP 3.17 specification.
 */
export const SYMBOL_KIND_NAME: Record<number, string> = {
	1: 'file',
	2: 'module',
	3: 'namespace',
	4: 'package',
	5: 'class',
	6: 'method',
	7: 'property',
	8: 'field',
	9: 'constructor',
	10: 'enum',
	11: 'interface',
	12: 'function',
	13: 'variable',
	14: 'constant',
	15: 'string',
	16: 'number',
	17: 'boolean',
	18: 'array',
	19: 'object',
	20: 'key',
	21: 'null',
	22: 'enumMember',
	23: 'struct',
	24: 'event',
	25: 'operator',
	26: 'typeParameter',
};
