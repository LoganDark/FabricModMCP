import type { TransformedSymbol, EnrichedSymbol, EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol } from './types.js';
import type { TypeReference } from './member-types.js';
import { parseDetail } from './detail-parser.js';
import { extractImports, createTypeResolver } from './import-resolver.js';
import { buildMemberFqn } from './member-fqn.js';

const CLASS_KINDS = new Set(['class', 'interface', 'enum']);
const METHOD_KINDS = new Set(['method', 'constructor']);
const FIELD_KINDS = new Set(['field', 'constant', 'enumMember']);

export async function enrichSymbols(
	symbols: TransformedSymbol[],
	sourceText: string,
	classFqn: string,
	resolvePackage: (packageName: string) => Promise<string[]>,
): Promise<EnrichedSymbol[]> {
	const imports = extractImports(sourceText);
	const resolveType = createTypeResolver(imports, resolvePackage);
	return Promise.all(symbols.map(sym => enrichOne(sym, classFqn, resolveType)));
}

async function enrichOne(
	sym: TransformedSymbol,
	classFqn: string,
	resolveType: (simpleName: string) => Promise<TypeReference>,
): Promise<EnrichedSymbol> {
	// Recursively enrich children first
	const enrichedChildren = await Promise.all(
		sym.children.map(child => {
			// Inner classes get FQN with $ separator
			const childFqn = CLASS_KINDS.has(child.kind)
				? `${classFqn}$${child.name}`
				: classFqn;
			return enrichOne(child, childFqn, resolveType);
		}),
	);

	// Parse the detail string into a structured MemberReference
	const parsed = await parseDetail(sym.detail, sym.kind, resolveType);

	// Determine member FQN based on symbol kind (not just parsed result)
	const memberFqn = buildMemberFqn(classFqn, sym.name, sym.kind);

	if (parsed?.kind === 'method' || (memberFqn !== null && METHOD_KINDS.has(sym.kind))) {
		return {
			...sym,
			memberFqn: memberFqn!,
			parameters: parsed?.kind === 'method' ? parsed.parameters : [],
			returnType: parsed?.kind === 'method' ? parsed.returnType : null,
			children: enrichedChildren,
		} as EnrichedMethodSymbol;
	}

	if (parsed?.kind === 'field' || (memberFqn !== null && FIELD_KINDS.has(sym.kind))) {
		return {
			...sym,
			memberFqn: memberFqn!,
			fieldType: parsed?.kind === 'field' ? parsed.fieldType : { kind: 'unresolved', rawType: sym.detail ?? 'unknown' } as TypeReference,
			children: enrichedChildren,
		} as EnrichedFieldSymbol;
	}

	// Class/interface/enum or unrecognized -- pass through with enriched children and FQN
	return {
		...sym,
		fqn: classFqn,
		children: enrichedChildren,
	} as EnrichedClassSymbol;
}
