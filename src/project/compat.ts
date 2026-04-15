import { DomainError } from '../errors/domain-error.js';
import type { Project, FabricModChild, StudyJarChild } from './types.js';

export function getSoleFabricMod(project: Project): FabricModChild {
	const mods: FabricModChild[] = [];
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') {
			mods.push(child);
		}
	}

	if (mods.length === 0) {
		throw new DomainError(
			'NO_FABRIC_MOD',
			`No fabric mod loaded in project '${project.name}'`,
			[project.name],
			['Load a fabric mod using the load_project tool'],
		);
	}

	if (mods.length > 1) {
		throw new DomainError(
			'MULTIPLE_FABRIC_MODS',
			`Multiple fabric mods in project '${project.name}' -- specify which one`,
			mods.map(m => m.name),
			['This operation requires exactly one fabric mod'],
		);
	}

	return mods[0];
}

export function getGradleConfig(project: Project) {
	return getSoleFabricMod(project).gradleConfig;
}

export function getSourcesJar(project: Project) {
	return getSoleFabricMod(project).sourcesJar;
}

export function getFabricMod(project: Project) {
	return getSoleFabricMod(project).fabricMod;
}

export function getDependencyJars(project: Project) {
	return getSoleFabricMod(project).dependencyJars;
}

export function getFilterConfig(project: Project) {
	return getSoleFabricMod(project).filterConfig;
}

export function getRootPath(project: Project) {
	return getSoleFabricMod(project).rootPath;
}

export function getStudyJars(project: Project): Map<string, StudyJarChild> {
	const result = new Map<string, StudyJarChild>();
	for (const [key, child] of project.children) {
		if (child.kind === 'study-jar') {
			result.set(key, child);
		}
	}
	return result;
}
