import type { LoadedProject } from '../project/types.js';

export class ProjectStore {
	private projects = new Map<string, LoadedProject>();

	get(name: string): LoadedProject | undefined {
		return this.projects.get(name);
	}

	set(name: string, project: LoadedProject): void {
		this.projects.set(name, project);
	}

	has(name: string): boolean {
		return this.projects.has(name);
	}

	list(): LoadedProject[] {
		return Array.from(this.projects.values());
	}

	delete(name: string): boolean {
		return this.projects.delete(name);
	}

	get size(): number {
		return this.projects.size;
	}
}

export const projectStore = new ProjectStore();
