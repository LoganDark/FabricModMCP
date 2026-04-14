const CLASS_DECL_RE = /^(?:(public|protected|private)\s+)?(?:((?:(?:abstract|final|static|sealed|non-sealed|strictfp)\s+)*))?(class|interface|enum|record|@interface)\s+(\w+)/m;

export function parseClassDeclaration(sourceText: string): { name: string; kind: string; access: string; modifiers: string[] } | null {
	const head = sourceText.substring(0, 4096);
	const match = head.match(CLASS_DECL_RE);
	if (!match) return null;

	const access = match[1] ?? 'package-private';
	const modifiers = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);
	const type = match[3];
	const name = match[4];

	return { access, modifiers, kind: type, name };
}
