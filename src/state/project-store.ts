import { basename } from 'node:path';
import type { LoadedProject } from '../project/types.js';
import { DomainError } from '../errors/domain-error.js';

export class ProjectStore {
	private projects = new Map<string, LoadedProject>();
	private defaultProject: string | undefined;

	static generateProjectName(projectPath: string, existingNames: Set<string>): string {
		const base = basename(projectPath);
		if (!existingNames.has(base)) return base;
		for (let counter = 1; ; counter++) {
			const candidate = `${base}-${counter}`;
			if (!existingNames.has(candidate)) return candidate;
		}
	}

	get(name: string): LoadedProject | undefined {
		return this.projects.get(name);
	}

	set(name: string, project: LoadedProject): void {
		if (this.projects.has(name)) {
			throw new DomainError(
				'PROJECT_NAME_COLLISION',
				`Project name '${name}' is already in use`,
				[name],
				['Choose a different name or unload the existing project'],
			);
		}
		this.projects.set(name, project);
	}

	has(name: string): boolean {
		return this.projects.has(name);
	}

	list(): LoadedProject[] {
		return Array.from(this.projects.values());
	}

	delete(name: string): boolean {
		const result = this.projects.delete(name);
		if (this.defaultProject === name) {
			this.defaultProject = undefined;
		}
		return result;
	}

	get size(): number {
		return this.projects.size;
	}

	setDefault(name: string): void {
		if (!this.projects.has(name)) {
			throw new DomainError(
				'PROJECT_NOT_FOUND',
				`Project '${name}' not found`,
				[name],
				['Check available projects with list_projects'],
			);
		}
		this.defaultProject = name;
	}

	getDefault(): string | undefined {
		return this.defaultProject;
	}

	names(): Set<string> {
		return new Set(this.projects.keys());
	}

	resolveProject(name?: string): LoadedProject {
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

		if (this.defaultProject) {
			const p = this.projects.get(this.defaultProject);
			if (p) return p;
			// Stale default cleanup
			this.defaultProject = undefined;
		}

		if (this.projects.size === 1) {
			return this.projects.values().next().value!;
		}

		if (this.projects.size === 0) {
			throw new DomainError(
				'NO_PROJECTS_LOADED',
				'No projects are loaded',
				[],
				['Load a project first using the load_project tool'],
			);
		}

		throw new DomainError(
			'AMBIGUOUS_PROJECT',
			'Multiple projects loaded — specify which project to use',
			[...this.projects.keys()],
			['Provide the project name or use set_default_project to set a default'],
		);
	}

	clear(): void {
		this.projects.clear();
		this.defaultProject = undefined;
	}
}

export const projectStore = new ProjectStore();
