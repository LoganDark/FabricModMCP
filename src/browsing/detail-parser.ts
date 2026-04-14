import type { TypeReference, MemberReference, MethodReference, FieldReference, ParameterInfo } from './member-types.js';

const FIELD_KINDS = new Set(["field", "constant", "enumMember"]);
const METHOD_KINDS = new Set(["method", "constructor"]);

/**
 * Parse a JDT LS detail string into a structured MemberReference.
 *
 * Detail strings describe the type signature of a symbol:
 * - Fields: just the type, e.g. "boolean", "BlockState", "List<String>"
 * - Methods: "(ParamType, ParamType) : ReturnType"
 * - Constructors: "(ParamType, ParamType)" (no return type)
 * - No-arg methods: just the return type, e.g. "void"
 *
 * @param detail - The raw detail string from TransformedSymbol, or null
 * @param symbolKind - The symbol kind ("method", "constructor", "field", etc.)
 * @param resolveType - Type name resolver (from createTypeResolver or equivalent)
 * @returns Structured MemberReference, or null for empty/unsupported inputs
 */
export async function parseDetail(
	detail: string | null,
	symbolKind: string,
	resolveType: (simpleName: string) => Promise<TypeReference>,
): Promise<MemberReference | null> {
	if (detail === null || detail === '') return null;

	if (FIELD_KINDS.has(symbolKind)) {
		return parseFieldDetail(detail, resolveType);
	}

	if (METHOD_KINDS.has(symbolKind)) {
		return parseMethodDetail(detail, symbolKind, resolveType);
	}

	return null;
}

async function parseFieldDetail(
	detail: string,
	resolveType: (simpleName: string) => Promise<TypeReference>,
): Promise<FieldReference> {
	const fieldType = await resolveTypeToken(detail, resolveType);
	return { kind: "field", fieldType };
}

async function parseMethodDetail(
	detail: string,
	symbolKind: string,
	resolveType: (simpleName: string) => Promise<TypeReference>,
): Promise<MethodReference> {
	const isConstructor = symbolKind === "constructor";

	// No-arg method: detail has no parens, entire string is return type
	if (!detail.includes('(')) {
		const returnType = isConstructor ? null : await resolveTypeToken(detail, resolveType);
		return { kind: "method", parameters: [], returnType };
	}

	// Split on " : " to separate params from return type
	const colonIdx = detail.indexOf(' : ');
	let paramsStr: string;
	let returnTypeStr: string | null;

	if (colonIdx === -1) {
		// Constructor: no return type separator
		paramsStr = detail;
		returnTypeStr = null;
	} else {
		paramsStr = detail.substring(0, colonIdx);
		returnTypeStr = detail.substring(colonIdx + 3);
	}

	// Strip outer parens from params
	const innerParams = paramsStr.replace(/^\(/, '').replace(/\)$/, '').trim();

	// Parse parameters
	const parameters: ParameterInfo[] = [];
	if (innerParams.length > 0) {
		const paramTokens = splitParams(innerParams);
		for (const token of paramTokens) {
			const type = await resolveTypeToken(token.trim(), resolveType);
			parameters.push({ name: null, type });
		}
	}

	// Resolve return type
	const returnType = isConstructor || returnTypeStr === null
		? null
		: await resolveTypeToken(returnTypeStr, resolveType);

	return { kind: "method", parameters, returnType };
}

/**
 * Resolve a single type token (e.g. "@Nullable List<String>[]") into a TypeReference.
 * Strips annotations, generic type arguments, then detects array/vararg suffixes.
 */
async function resolveTypeToken(
	token: string,
	resolveType: (simpleName: string) => Promise<TypeReference>,
): Promise<TypeReference> {
	let cleaned = token.trim();

	// Strip leading annotations: @Word or @Word(args)
	cleaned = cleaned.replace(/^(?:@\w+(?:\([^)]*\))?\s+)+/, '');

	// Strip generic type arguments with depth counting
	cleaned = stripGenerics(cleaned);

	// Check for varargs (must check before array since "..." should not be treated as array)
	if (cleaned.endsWith('...')) {
		const baseName = cleaned.slice(0, -3).trim();
		const elementType = await resolveType(baseName);
		return { kind: "vararg", elementType };
	}

	// Check for array suffix(es)
	let arrayDepth = 0;
	while (cleaned.endsWith('[]')) {
		arrayDepth++;
		cleaned = cleaned.slice(0, -2);
	}

	const baseType = await resolveType(cleaned.trim());

	// Wrap in ArrayType for each dimension
	let result: TypeReference = baseType;
	for (let i = 0; i < arrayDepth; i++) {
		result = { kind: "array", elementType: result };
	}

	return result;
}

/**
 * Strip generic type arguments from a type string using depth-counting.
 * "Map<String, List<Integer>>" -> "Map"
 * "List<String>" -> "List"
 */
function stripGenerics(input: string): string {
	const firstAngle = input.indexOf('<');
	if (firstAngle === -1) return input;

	// Find the matching closing angle bracket
	let depth = 0;
	let endIdx = -1;
	for (let i = firstAngle; i < input.length; i++) {
		if (input[i] === '<') depth++;
		else if (input[i] === '>') {
			depth--;
			if (depth === 0) {
				endIdx = i;
				break;
			}
		}
	}

	if (endIdx === -1) {
		// Malformed -- just return everything before first <
		return input.substring(0, firstAngle);
	}

	// Return base name + anything after the generic block (e.g. "[]")
	return input.substring(0, firstAngle) + input.substring(endIdx + 1);
}

/**
 * Split parameter list by commas at depth 0 (respecting angle brackets).
 * "(Map<String, Integer>, int)" splits into ["Map<String, Integer>", "int"]
 */
function splitParams(params: string): string[] {
	const result: string[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < params.length; i++) {
		const ch = params[i];
		if (ch === '<') depth++;
		else if (ch === '>') depth--;
		else if (ch === ',' && depth === 0) {
			result.push(params.substring(start, i));
			start = i + 1;
		}
	}

	result.push(params.substring(start));
	return result;
}
