import type { TransformedSymbol, EnrichedSymbol, EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol } from './types.js';
import type { TypeReference } from './member-types.js';
import { parseDetail } from './detail-parser.js';
import { extractImports, createTypeResolver } from './import-resolver.js';
import { buildMemberFqn } from './member-fqn.js';

const CLASS_KINDS = new Set(['class', 'interface', 'enum']);

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

	if (parsed?.kind === 'method') {
		const memberFqn = buildMemberFqn(classFqn, sym.name, sym.kind);
		return {
			...sym,
			memberFqn: memberFqn!,
			parameters: parsed.parameters,
			returnType: parsed.returnType,
			children: enrichedChildren,
		} as EnrichedMethodSymbol;
	}

	if (parsed?.kind === 'field') {
		const memberFqn = buildMemberFqn(classFqn, sym.name, sym.kind);
		return {
			...sym,
			memberFqn: memberFqn!,
			fieldType: parsed.fieldType,
			children: enrichedChildren,
		} as EnrichedFieldSymbol;
	}

	// Class/interface/enum or unrecognized -- just pass through with enriched children
	return {
		...sym,
		children: enrichedChildren,
	} as EnrichedClassSymbol;
}
