export interface PomDependency {
	groupId: string;
	artifactId: string;
	version: string;
	scope: string;
}

export function parsePomDependencies(pomXml: string): PomDependency[] {
	const deps: PomDependency[] = [];

	// Strip XML comments
	const cleaned = pomXml.replace(/<!--[\s\S]*?-->/g, '');

	// Remove <dependencyManagement> section
	const depsSection = cleaned.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/, '');

	// Match <dependency> blocks
	const depRegex = /<dependency>\s*([\s\S]*?)\s*<\/dependency>/g;
	let match: RegExpExecArray | null;

	while ((match = depRegex.exec(depsSection)) !== null) {
		const block = match[1];
		const groupId = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
		const artifactId = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
		const version = block.match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
		const scope = block.match(/<scope>([^<]+)<\/scope>/)?.[1]?.trim() ?? 'compile';

		if (groupId && artifactId && version) {
			deps.push({ groupId, artifactId, version, scope });
		}
	}

	return deps;
}
