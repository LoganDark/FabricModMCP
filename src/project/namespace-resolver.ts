import { DomainError } from '../errors/domain-error.js';
import type { Project, FabricModChild, DependencyEntry } from './types.js';

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
	const targetChild = scope ?? project.activeChild ?? inferSoleChildName(project);

	if (targetChild === null) {
		throw new DomainError(
			'AMBIGUOUS_JAR_ID',
			`Bare jar ID '${jarId}' is ambiguous — multiple fabric mods loaded, specify scope or set a default child`,
			[jarId],
			[`Use a namespaced ID like "modName/${jarId}"`, 'Set the active child with set_active_child'],
		);
	}

	return `${targetChild}/${jarId}`;
}

export function resolveJarIds(project: Project, jarIds: string[], scope?: string): string[] {
	return jarIds.map(id => resolveJarId(project, id, scope));
}

/**
 * Rename all dependency IDs that belong to a child namespace.
 * Used when a child is auto-suffixed to avoid name collisions.
 * E.g., renaming "mymod" to "mymod-2" also renames "mymod/minecraft" to "mymod-2/minecraft".
 */
export function renameChildNamespace(
	deps: Map<string, DependencyEntry>,
	originalName: string,
	newName: string,
): Map<string, DependencyEntry> {
	const renamed = new Map<string, DependencyEntry>();
	for (const [id, dep] of deps) {
		if (id === originalName) {
			renamed.set(newName, { ...dep, id: newName });
		} else if (id.startsWith(originalName + '/')) {
			const newId = newName + id.slice(originalName.length);
			renamed.set(newId, { ...dep, id: newId });
		} else {
			renamed.set(id, dep);
		}
	}
	return renamed;
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
