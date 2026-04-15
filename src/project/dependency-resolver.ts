import type { DependencyEntry, Project } from './types.js';
import { studyJarToDependencyEntry } from './study-jar.js';

/**
 * Returns resolved dependencies: real deps from ALL fabric mod children + autoInclude=true study jars.
 * Always returns a new Map.
 */
export function getResolvedDependencies(project: Project): Map<string, DependencyEntry> {
	const merged = new Map<string, DependencyEntry>();

	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') {
			for (const [id, dep] of child.dependencyJars) {
				merged.set(id, dep);
			}
		} else if (child.kind === 'study-jar' && child.autoInclude) {
			const entry = studyJarToDependencyEntry(child);
			merged.set(entry.id, entry);
		}
	}

	return merged;
}

/**
 * Returns all dependencies: real deps from ALL fabric mod children + ALL study jars regardless of autoInclude.
 * Always returns a new Map.
 */
export function getAllDependencies(project: Project): Map<string, DependencyEntry> {
	const merged = new Map<string, DependencyEntry>();

	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') {
			for (const [id, dep] of child.dependencyJars) {
				merged.set(id, dep);
			}
		} else if (child.kind === 'study-jar') {
			const entry = studyJarToDependencyEntry(child);
			merged.set(entry.id, entry);
		}
	}

	return merged;
}
