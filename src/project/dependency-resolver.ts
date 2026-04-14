import type { DependencyEntry, LoadedProject } from './types.js';
import { studyJarToDependencyEntry } from './study-jar.js';

/**
 * Returns resolved dependencies: real deps + autoInclude=true study jars.
 * Always returns a new Map (not the same reference as project.dependencyJars).
 */
export function getResolvedDependencies(project: LoadedProject): Map<string, DependencyEntry> {
	const merged = new Map(project.dependencyJars);
	for (const studyJar of project.studyJars.values()) {
		if (studyJar.autoInclude) {
			const entry = studyJarToDependencyEntry(studyJar);
			merged.set(entry.id, entry);
		}
	}
	return merged;
}

/**
 * Returns all dependencies: real deps + ALL study jars regardless of autoInclude.
 * Always returns a new Map (not the same reference as project.dependencyJars).
 */
export function getAllDependencies(project: LoadedProject): Map<string, DependencyEntry> {
	const merged = new Map(project.dependencyJars);
	for (const studyJar of project.studyJars.values()) {
		const entry = studyJarToDependencyEntry(studyJar);
		merged.set(entry.id, entry);
	}
	return merged;
}
