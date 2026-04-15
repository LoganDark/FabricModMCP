import type { DependencyEntry, Project } from './types.js';
import { getDependencyJars, getStudyJars } from './compat.js';
import { studyJarToDependencyEntry } from './study-jar.js';

/**
 * Returns resolved dependencies: real deps + autoInclude=true study jars.
 * Always returns a new Map (not the same reference as the fabric mod's dependencyJars).
 */
export function getResolvedDependencies(project: Project): Map<string, DependencyEntry> {
	const merged = new Map(getDependencyJars(project));
	for (const studyJar of getStudyJars(project).values()) {
		if (studyJar.autoInclude) {
			const entry = studyJarToDependencyEntry(studyJar);
			merged.set(entry.id, entry);
		}
	}
	return merged;
}

/**
 * Returns all dependencies: real deps + ALL study jars regardless of autoInclude.
 * Always returns a new Map (not the same reference as the fabric mod's dependencyJars).
 */
export function getAllDependencies(project: Project): Map<string, DependencyEntry> {
	const merged = new Map(getDependencyJars(project));
	for (const studyJar of getStudyJars(project).values()) {
		const entry = studyJarToDependencyEntry(studyJar);
		merged.set(entry.id, entry);
	}
	return merged;
}
