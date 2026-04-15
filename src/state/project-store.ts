import { basename } from 'node:path';
import type { Project } from '../project/types.js';
import { DomainError } from '../errors/domain-error.js';

export class ProjectStore {
	private projects = new Map<string, Project>();
	private activeProject: string | undefined;

	static generateProjectName(projectPath: string, existingNames: Set<string>): string {
		const base = basename(projectPath);
		if (!existingNames.has(base)) return base;
		for (let counter = 1; ; counter++) {
			const candidate = `${base}-${counter}`;
			if (!existingNames.has(candidate)) return candidate;
		}
	}

	get(name: string): Project | undefined {
		return this.projects.get(name);
	}

	set(name: string, project: Project): void {
		if (this.projects.has(name)) {
			throw new DomainError(
				'PROJECT_NAME_COLLISION',
				`Project name '${name}' is already in use`,
				[name],
				['Choose a different name or use remove_project to remove the existing one'],
			);
		}
		this.projects.set(name, project);
	}

	has(name: string): boolean {
		return this.projects.has(name);
	}

	list(): Project[] {
		return Array.from(this.projects.values());
	}

	delete(name: string): boolean {
		const result = this.projects.delete(name);
		if (this.activeProject === name) {
			this.activeProject = undefined;
		}
		return result;
	}

	get size(): number {
		return this.projects.size;
	}

	setActive(name: string): void {
		if (!this.projects.has(name)) {
			throw new DomainError(
				'PROJECT_NOT_FOUND',
				`Project '${name}' not found`,
				[name],
				['Check available projects with list_projects'],
			);
		}
		this.activeProject = name;
	}

	getActive(): string | undefined {
		return this.activeProject;
	}

	names(): Set<string> {
		return new Set(this.projects.keys());
	}

	resolveProject(name?: string): Project {
		if (name !== undefined) {
			const p = this.projects.get(name);
			if (!p) {
				throw new DomainError(
					'PROJECT_NOT_FOUND',
					`Project '${name}' not found`,
					[name],
					['Check available projects with list_projects'],
				);
			}
			return p;
		}

		if (this.activeProject) {
			const p = this.projects.get(this.activeProject);
			if (p) return p;
			// Stale default cleanup
			this.activeProject = undefined;
		}

		if (this.projects.size === 1) {
			return this.projects.values().next().value!;
		}

		if (this.projects.size === 0) {
			throw new DomainError(
				'NO_PROJECTS_LOADED',
				'No projects are loaded',
				[],
				['Create a project with create_project, then add a fabric mod with add_fabric_mod'],
			);
		}

		throw new DomainError(
			'AMBIGUOUS_PROJECT',
			'Multiple projects loaded — specify which project to use',
			[...this.projects.keys()],
			['Provide the project name or use set_active_project to set the active project'],
		);
	}

	clear(): void {
		this.projects.clear();
		this.activeProject = undefined;
	}
}

export const projectStore = new ProjectStore();
