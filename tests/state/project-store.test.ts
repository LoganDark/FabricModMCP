import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';
import { DomainError } from '../../src/errors/domain-error.js';

function makeMockProject(name: string): LoadedProject {
	return {
		name,
		rootPath: `/mock/${name}`,
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'yarn',
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.16.14',
			dependencies: [],
		},
		sourcesJar: { path: `/mock/${name}/sources.jar`, exists: true },
		fabricMod: {
			schemaVersion: 1,
			id: name,
			version: '1.0.0',
			name,
			description: 'Mock project',
			authors: [],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: new Map(),
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}

describe('ProjectStore', () => {
	let store: ProjectStore;

	beforeEach(() => {
		store = new ProjectStore();
	});

	describe('naming', () => {
		it('generateProjectName returns basename when no collision', () => {
			const name = ProjectStore.generateProjectName('/home/user/my-mod', new Set());
			expect(name).toBe('my-mod');
		});

		it('generateProjectName appends suffix on collision', () => {
			const name1 = ProjectStore.generateProjectName('/home/user/my-mod', new Set(['my-mod']));
			expect(name1).toBe('my-mod-1');

			const name2 = ProjectStore.generateProjectName('/home/user/my-mod', new Set(['my-mod', 'my-mod-1']));
			expect(name2).toBe('my-mod-2');
		});

		it('set with explicit name that collides throws DomainError', () => {
			const p1 = makeMockProject('existing');
			const p2 = makeMockProject('existing2');
			store.set('existing', p1);
			expect(() => store.set('existing', p2)).toThrow(DomainError);
			try {
				store.set('existing', p2);
			} catch (e) {
				expect((e as DomainError).code).toBe('PROJECT_NAME_COLLISION');
			}
		});
	});

	describe('resolve', () => {
		it('explicit name returns matching project', () => {
			const p = makeMockProject('foo');
			store.set('foo', p);
			expect(store.resolveProject('foo')).toBe(p);
		});

		it('explicit name not found throws DomainError', () => {
			expect(() => store.resolveProject('nonexistent')).toThrow(DomainError);
			try {
				store.resolveProject('nonexistent');
			} catch (e) {
				expect((e as DomainError).code).toBe('PROJECT_NOT_FOUND');
			}
		});

		it('no name with single project returns it', () => {
			const p = makeMockProject('only');
			store.set('only', p);
			expect(store.resolveProject()).toBe(p);
		});

		it('no name with default project returns it', () => {
			const p1 = makeMockProject('a');
			const p2 = makeMockProject('b');
			store.set('a', p1);
			store.set('b', p2);
			store.setDefault('b');
			expect(store.resolveProject()).toBe(p2);
		});

		it('no name with multiple projects and no default throws', () => {
			store.set('a', makeMockProject('a'));
			store.set('b', makeMockProject('b'));
			expect(() => store.resolveProject()).toThrow(DomainError);
			try {
				store.resolveProject();
			} catch (e) {
				expect((e as DomainError).code).toBe('AMBIGUOUS_PROJECT');
			}
		});

		it('no name with zero projects throws', () => {
			expect(() => store.resolveProject()).toThrow(DomainError);
			try {
				store.resolveProject();
			} catch (e) {
				expect((e as DomainError).code).toBe('NO_PROJECTS_LOADED');
			}
		});
	});

	describe('default', () => {
		it('setDefault sets and getDefault returns', () => {
			store.set('foo', makeMockProject('foo'));
			store.setDefault('foo');
			expect(store.getDefault()).toBe('foo');
		});

		it('delete clears default if deleted project was default', () => {
			const p1 = makeMockProject('a');
			store.set('a', p1);
			store.setDefault('a');
			store.delete('a');
			expect(store.getDefault()).toBeUndefined();
		});

		it('delete does not clear default if different project deleted', () => {
			store.set('a', makeMockProject('a'));
			store.set('b', makeMockProject('b'));
			store.setDefault('a');
			store.delete('b');
			expect(store.getDefault()).toBe('a');
		});
	});

	describe('multiple', () => {
		it('two projects have independent state', () => {
			const p1 = makeMockProject('a');
			const p2 = makeMockProject('b');
			store.set('a', p1);
			store.set('b', p2);
			expect(store.get('a')).not.toBe(store.get('b'));
			expect(store.get('a')).toBe(p1);
			expect(store.get('b')).toBe(p2);
		});
	});

	describe('names', () => {
		it('returns set of all project names', () => {
			store.set('a', makeMockProject('a'));
			store.set('b', makeMockProject('b'));
			expect(store.names()).toEqual(new Set(['a', 'b']));
		});
	});
});
