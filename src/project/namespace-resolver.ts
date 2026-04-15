import { DomainError } from '../errors/domain-error.js';
import type { Project, FabricModChild } from './types.js';

export function inferSoleChildName(project: Project): string | null {
	let soleName: string | null = null;
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') {
			if (soleName !== null) {
				return null; // multiple fabric mods
			}
			soleName = child.name;
		}
	}
	return soleName;
}

export function resolveJarId(project: Project, jarId: string, scope?: string): string {
	// Already namespaced — passthrough
	if (jarId.includes('/')) {
		return jarId;
	}

	// Bare child name — matches a project child directly
	if (project.children.has(jarId)) {
		return jarId;
	}

	// Bare dependency ID — need to prefix with a child name
	const targetChild = scope ?? project.defaultChild ?? inferSoleChildName(project);

	if (targetChild === null) {
		throw new DomainError(
			'AMBIGUOUS_JAR_ID',
			`Bare jar ID '${jarId}' is ambiguous — multiple fabric mods loaded, specify scope or set a default child`,
			[jarId],
			[`Use a namespaced ID like "modName/${jarId}"`, 'Set a default child with set_default_project'],
		);
	}

	return `${targetChild}/${jarId}`;
}

export function resolveJarIds(project: Project, jarIds: string[], scope?: string): string[] {
	return jarIds.map(id => resolveJarId(project, id, scope));
}

export function getAutoIncludeIds(child: FabricModChild): Set<string> {
	const ids = new Set<string>();

	// Mod source is always included
	ids.add(child.name);

	// Include any minecraft-category deps
	for (const [depId, dep] of child.dependencyJars) {
		if (dep.category === 'minecraft') {
			ids.add(depId);
		}
	}

	return ids;
}
