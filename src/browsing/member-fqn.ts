const FIELD_KINDS = new Set(["field", "constant", "enumMember"]);
const METHOD_KINDS = new Set(["method", "constructor"]);

export function buildMemberFqn(
	classFqn: string,
	memberName: string,
	memberKind: string,
): string | null {
	// Strip trailing () from name to prevent double-parens (JDT LS includes them)
	const cleanName = memberName.replace(/\(\)$/, '');

	if (METHOD_KINDS.has(memberKind)) {
		return `${classFqn}#${cleanName}()`;
	}
	if (FIELD_KINDS.has(memberKind)) {
		return `${classFqn}#${cleanName}:`;
	}
	return null; // classes, interfaces, enums, packages don't get FQN
}
