import { describe, it, expect } from 'vitest';
import { getResolvedDependencies, getAllDependencies } from '../../src/project/dependency-resolver.js';
import { CATEGORY_PRIORITY, sortByPriority, getDependenciesForTool } from '../../src/tools/tool-helpers.js';
import type { DependencyEntry, Project, FabricModChild, ProjectChild, StudyJar, StudyJarChild, JarCategory } from '../../src/project/types.js';
// StudyJarChild used directly in multi-mod tests

function makeDep(id: string, category: JarCategory = 'library'): DependencyEntry {
	return {
		id,
		group: id.split(':')[0] ?? id,
		artifact: id.split(':')[1] ?? id,
		version: '1.0',
		category,
		sourcesJarPath: `/fake/${id}-sources.jar`,
		available: true,
		provenanceChains: [],
	};
}

function makeStudyJar(name: string, autoInclude: boolean): StudyJar {
	return {
		name,
		jarPath: `/fake/study/${name}.jar`,
		mtime: Date.now(),
		size: 1024,
		autoInclude,
		stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
	};
}

function makeProject(
	deps: Map<string, DependencyEntry>,
	studyJars: Map<string, StudyJar>,
): Project {
	const fabricMod: FabricModChild = {
		kind: 'fabric-mod',
		name: 'test-mod',
		rootPath: '/fake/project',
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped' as const,
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.16.14',
			dependencies: [],
		},
		sourcesJar: { path: '/fake/sources.jar', exists: true },
		fabricMod: {
			schemaVersion: 1,
			id: 'test-mod',
			version: '1.0.0',
			name: 'Test Mod',
			description: '',
			authors: [],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: deps,
		filterConfig: { mode: 'include-all', patterns: [] },
	};

	const children = new Map<string, ProjectChild>();
	children.set('test-mod', fabricMod);

	for (const [name, sj] of studyJars) {
		const child: StudyJarChild = {
			kind: 'study-jar',
			...sj,
		};
		children.set(name, child);
	}

	return {
		name: 'test-project',
		children,
	};
}

describe('getResolvedDependencies', () => {
	it('returns copy of dependencyJars when no study jars exist', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const project = makeProject(deps, new Map());
		const result = getResolvedDependencies(project);
		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(1);
		expect(result.get('minecraft')).toBeDefined();
	});

	it('returns a NEW Map (not same reference as fabric mod dependencyJars)', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const project = makeProject(deps, new Map());
		const result = getResolvedDependencies(project);
		expect(result).not.toBe(deps);
	});

	it('includes autoInclude=true study jar with plain name ID', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const studyJars = new Map([['mylib', makeStudyJar('mylib', true)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		expect(result.size).toBe(2);
		expect(result.has('mylib')).toBe(true);
		const entry = result.get('mylib')!;
		expect(entry.category).toBe('study');
		expect(entry.id).toBe('mylib');
	});

	it('excludes autoInclude=false study jar from result', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const studyJars = new Map([['excluded', makeStudyJar('excluded', false)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		expect(result.size).toBe(1);
		expect(result.has('excluded')).toBe(false);
	});

	it('with mix of autoInclude true/false includes only true ones', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const studyJars = new Map([
			['included', makeStudyJar('included', true)],
			['excluded', makeStudyJar('excluded', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		expect(result.size).toBe(2);
		expect(result.has('included')).toBe(true);
		expect(result.has('excluded')).toBe(false);
	});

	it('study jar entries use studyJarToDependencyEntry conversion', () => {
		const deps = new Map<string, DependencyEntry>();
		const studyJars = new Map([['mylib', makeStudyJar('mylib', true)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		const entry = result.get('mylib')!;
		expect(entry.group).toBe('study');
		expect(entry.artifact).toBe('mylib');
		expect(entry.version).toBe('local');
		expect(entry.available).toBe(true);
		expect(entry.sourcesJarPath).toBe('/fake/study/mylib.jar');
	});

	it('aggregates deps from multiple fabric mod children', () => {
		const modA: FabricModChild = {
			kind: 'fabric-mod',
			name: 'mod-a',
			rootPath: '/fake/mod-a',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
				yarnMappings: '1.21.11+build.4',
				loaderVersion: '0.16.14',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/sources-a.jar', exists: true },
			fabricMod: {
				schemaVersion: 1, id: 'mod-a', version: '1.0.0', name: 'Mod A',
				description: '', authors: [], license: 'MIT', environment: '*', mixins: [], depends: {},
			},
			dependencyJars: new Map([
				['mod-a/minecraft', makeDep('mod-a/minecraft', 'minecraft')],
				['mod-a/com.example:lib', makeDep('mod-a/com.example:lib', 'library')],
			]),
			filterConfig: { mode: 'include-all', patterns: [] },
		};

		const modB: FabricModChild = {
			kind: 'fabric-mod',
			name: 'mod-b',
			rootPath: '/fake/mod-b',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
				yarnMappings: '1.21.11+build.4',
				loaderVersion: '0.16.14',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/sources-b.jar', exists: true },
			fabricMod: {
				schemaVersion: 1, id: 'mod-b', version: '1.0.0', name: 'Mod B',
				description: '', authors: [], license: 'MIT', environment: '*', mixins: [], depends: {},
			},
			dependencyJars: new Map([
				['mod-b/minecraft', makeDep('mod-b/minecraft', 'minecraft')],
				['mod-b/com.other:lib', makeDep('mod-b/com.other:lib', 'library')],
			]),
			filterConfig: { mode: 'include-all', patterns: [] },
		};

		const children = new Map<string, ProjectChild>();
		children.set('mod-a', modA);
		children.set('mod-b', modB);

		const project: Project = { name: 'multi-project', children };
		const result = getResolvedDependencies(project);

		// Both mods' deps should be present
		expect(result.has('mod-a/minecraft')).toBe(true);
		expect(result.has('mod-b/minecraft')).toBe(true);
		expect(result.has('mod-a/com.example:lib')).toBe(true);
		expect(result.has('mod-b/com.other:lib')).toBe(true);
		expect(result.size).toBe(4);
	});

	it('study jar entries have bare IDs (not namespaced)', () => {
		const deps = new Map<string, DependencyEntry>();
		const studyJars = new Map([['custom-jar', makeStudyJar('custom-jar', true)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		const entry = result.get('custom-jar')!;
		expect(entry.id).toBe('custom-jar');
		// Should not contain a slash (not namespaced)
		expect(entry.id.includes('/')).toBe(false);
	});
});

describe('getAllDependencies', () => {
	it('returns copy of dependencyJars when no study jars exist', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const project = makeProject(deps, new Map());
		const result = getAllDependencies(project);
		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(1);
	});

	it('returns a NEW Map (not same reference as fabric mod dependencyJars)', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const project = makeProject(deps, new Map());
		const result = getAllDependencies(project);
		expect(result).not.toBe(deps);
	});

	it('includes ALL study jars regardless of autoInclude flag', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const studyJars = new Map([
			['included', makeStudyJar('included', true)],
			['excluded', makeStudyJar('excluded', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getAllDependencies(project);
		expect(result.size).toBe(3);
		expect(result.has('included')).toBe(true);
		expect(result.has('excluded')).toBe(true);
	});

	it('study jar entries use studyJarToDependencyEntry conversion', () => {
		const deps = new Map<string, DependencyEntry>();
		const studyJars = new Map([['mylib', makeStudyJar('mylib', false)]]);
		const project = makeProject(deps, studyJars);
		const result = getAllDependencies(project);
		const entry = result.get('mylib')!;
		expect(entry.category).toBe('study');
		expect(entry.id).toBe('mylib');
		expect(entry.group).toBe('study');
		expect(entry.artifact).toBe('mylib');
		expect(entry.version).toBe('local');
	});
});

describe('CATEGORY_PRIORITY', () => {
	it('includes study at priority 4', () => {
		expect(CATEGORY_PRIORITY['study']).toBe(4);
	});

	it('study is higher number (lower priority) than library', () => {
		expect(CATEGORY_PRIORITY['study']).toBeGreaterThan(CATEGORY_PRIORITY['library']);
	});
});

describe('sortByPriority with study', () => {
	it('places study category entries after library category entries', () => {
		const entries: [string, DependencyEntry][] = [
			['mylib', makeDep('mylib', 'study')],
			['some-lib', makeDep('some-lib', 'library')],
			['minecraft', makeDep('minecraft', 'minecraft')],
		];
		const sorted = sortByPriority(entries);
		const ids = sorted.map(([id]) => id);
		expect(ids.indexOf('minecraft')).toBeLessThan(ids.indexOf('some-lib'));
		expect(ids.indexOf('some-lib')).toBeLessThan(ids.indexOf('mylib'));
	});
});

describe('getDependenciesForTool', () => {
	it('with jars param returns strict whitelist from getAllDependencies', () => {
		const deps = new Map([
			['test-mod/minecraft', makeDep('test-mod/minecraft', 'minecraft')],
			['test-mod/some-lib', makeDep('test-mod/some-lib', 'library')],
		]);
		const studyJars = new Map([
			['mylib', makeStudyJar('mylib', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getDependenciesForTool(project, ['mylib']);
		expect(result.size).toBe(1);
		expect(result.has('mylib')).toBe(true);
	});

	it('with jars=[mylib, minecraft] resolves bare minecraft to namespaced', () => {
		const deps = new Map([
			['test-mod/minecraft', makeDep('test-mod/minecraft', 'minecraft')],
			['test-mod/some-lib', makeDep('test-mod/some-lib', 'library')],
		]);
		const studyJars = new Map([
			['mylib', makeStudyJar('mylib', false)],
		]);
		const project = makeProject(deps, studyJars);
		// Bare 'minecraft' resolves to 'test-mod/minecraft' via namespace resolver
		const result = getDependenciesForTool(project, ['mylib', 'minecraft']);
		expect(result.size).toBe(2);
		expect(result.has('mylib')).toBe(true);
		expect(result.has('test-mod/minecraft')).toBe(true);
		expect(result.has('test-mod/some-lib')).toBe(false);
	});

	it('with jars=[mylib] returns only that one study jar', () => {
		const deps = new Map([
			['test-mod/minecraft', makeDep('test-mod/minecraft', 'minecraft')],
		]);
		const studyJars = new Map([
			['mylib', makeStudyJar('mylib', false)],
			['other', makeStudyJar('other', true)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getDependenciesForTool(project, ['mylib']);
		expect(result.size).toBe(1);
		expect(result.has('mylib')).toBe(true);
	});

	it('with scope param scopes filtered deps to that child', () => {
		const deps = new Map([
			['test-mod/minecraft', makeDep('test-mod/minecraft', 'minecraft')],
			['test-mod/some-lib', makeDep('test-mod/some-lib', 'library')],
		]);
		const project = makeProject(deps, new Map());
		const result = getDependenciesForTool(project, undefined, 'test-mod');
		expect(result.has('test-mod/minecraft')).toBe(true);
		expect(result.has('test-mod/some-lib')).toBe(true);
	});

	it('without jars param returns filtered deps with autoInclude study jars', () => {
		const deps = new Map([
			['test-mod/minecraft', makeDep('test-mod/minecraft', 'minecraft')],
			['test-mod/some-lib', makeDep('test-mod/some-lib', 'library')],
		]);
		const studyJars = new Map([
			['included', makeStudyJar('included', true)],
			['excluded', makeStudyJar('excluded', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getDependenciesForTool(project);
		// Should include namespaced deps and autoInclude=true study jar
		expect(result.has('test-mod/minecraft')).toBe(true);
		expect(result.has('test-mod/some-lib')).toBe(true);
		expect(result.has('included')).toBe(true);
		// autoInclude=false excluded
		expect(result.has('excluded')).toBe(false);
	});

	it('unscoped multi-mod applies each child\'s own filter independently', () => {
		// mod-a has deps: mod-a/minecraft (minecraft), mod-a/lib-x (library)
		// mod-b has deps: mod-b/minecraft (minecraft), mod-b/lib-y (library)
		// mod-a filter: exclude all lib-* (would kill mod-b/lib-y if applied globally)
		// mod-b filter: no exclusions
		const modA: FabricModChild = {
			kind: 'fabric-mod',
			name: 'mod-a',
			rootPath: '/fake/mod-a',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
				yarnMappings: '1.21.11+build.4',
				loaderVersion: '0.16.14',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/sources-a.jar', exists: true },
			fabricMod: {
				schemaVersion: 1, id: 'mod-a', version: '1.0.0', name: 'Mod A',
				description: '', authors: [], license: 'MIT', environment: '*', mixins: [], depends: {},
			},
			dependencyJars: new Map([
				['mod-a/minecraft', makeDep('mod-a/minecraft', 'minecraft')],
				['mod-a/lib-x', makeDep('mod-a/lib-x', 'library')],
			]),
			filterConfig: { mode: 'include-all', patterns: ['*/lib-*'] },
		};

		const modB: FabricModChild = {
			kind: 'fabric-mod',
			name: 'mod-b',
			rootPath: '/fake/mod-b',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
				yarnMappings: '1.21.11+build.4',
				loaderVersion: '0.16.14',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/sources-b.jar', exists: true },
			fabricMod: {
				schemaVersion: 1, id: 'mod-b', version: '1.0.0', name: 'Mod B',
				description: '', authors: [], license: 'MIT', environment: '*', mixins: [], depends: {},
			},
			dependencyJars: new Map([
				['mod-b/minecraft', makeDep('mod-b/minecraft', 'minecraft')],
				['mod-b/lib-y', makeDep('mod-b/lib-y', 'library')],
			]),
			filterConfig: { mode: 'include-all', patterns: [] },
		};

		const children = new Map<string, ProjectChild>();
		children.set('mod-a', modA);
		children.set('mod-b', modB);
		const project: Project = { name: 'multi-project', children };

		const result = getDependenciesForTool(project);
		// mod-a's filter (exclude */lib-*) applies only to mod-a's deps:
		//   mod-a/minecraft passes, mod-a/lib-x excluded
		// mod-b's filter (no exclusions) applies only to mod-b's deps:
		//   mod-b/minecraft passes, mod-b/lib-y passes
		// If old global behavior: mod-a's filter would exclude mod-b/lib-y too
		expect(result.size).toBe(3);
		expect(result.has('mod-a/minecraft')).toBe(true);
		expect(result.has('mod-a/lib-x')).toBe(false);
		expect(result.has('mod-b/minecraft')).toBe(true);
		expect(result.has('mod-b/lib-y')).toBe(true);
	});

	it('unscoped multi-mod includes autoInclude study jars', () => {
		const modA: FabricModChild = {
			kind: 'fabric-mod',
			name: 'mod-a',
			rootPath: '/fake/mod-a',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
				yarnMappings: '1.21.11+build.4',
				loaderVersion: '0.16.14',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/sources-a.jar', exists: true },
			fabricMod: {
				schemaVersion: 1, id: 'mod-a', version: '1.0.0', name: 'Mod A',
				description: '', authors: [], license: 'MIT', environment: '*', mixins: [], depends: {},
			},
			dependencyJars: new Map([
				['mod-a/minecraft', makeDep('mod-a/minecraft', 'minecraft')],
			]),
			filterConfig: { mode: 'include-all', patterns: [] },
		};

		const modB: FabricModChild = {
			kind: 'fabric-mod',
			name: 'mod-b',
			rootPath: '/fake/mod-b',
			gradleConfig: {
				minecraftVersion: '1.21.11',
				mappingEra: 'mapped' as const,
				yarnMappings: '1.21.11+build.4',
				loaderVersion: '0.16.14',
				dependencies: [],
			},
			sourcesJar: { path: '/fake/sources-b.jar', exists: true },
			fabricMod: {
				schemaVersion: 1, id: 'mod-b', version: '1.0.0', name: 'Mod B',
				description: '', authors: [], license: 'MIT', environment: '*', mixins: [], depends: {},
			},
			dependencyJars: new Map([
				['mod-b/minecraft', makeDep('mod-b/minecraft', 'minecraft')],
			]),
			filterConfig: { mode: 'include-all', patterns: [] },
		};

		const children = new Map<string, ProjectChild>();
		children.set('mod-a', modA);
		children.set('mod-b', modB);

		const sj: StudyJarChild = {
			kind: 'study-jar',
			name: 'my-study',
			jarPath: '/fake/study/my-study.jar',
			mtime: Date.now(),
			size: 1024,
			autoInclude: true,
			stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
		};
		children.set('my-study', sj);

		const project: Project = { name: 'multi-project', children };
		const result = getDependenciesForTool(project);
		expect(result.has('mod-a/minecraft')).toBe(true);
		expect(result.has('mod-b/minecraft')).toBe(true);
		expect(result.has('my-study')).toBe(true);
		expect(result.size).toBe(3);
	});

	it('without jars param respects filterConfig exclusion patterns', () => {
		const deps = new Map([
			['test-mod/minecraft', makeDep('test-mod/minecraft', 'minecraft')],
			['test-mod/some-lib', makeDep('test-mod/some-lib', 'library')],
		]);
		const project = makeProject(deps, new Map());
		const mod = project.children.get('test-mod') as FabricModChild;
		mod.filterConfig = { mode: 'include-all', patterns: ['test-mod/some-lib'] };
		const result = getDependenciesForTool(project);
		// minecraft is auto-included, some-lib is excluded by pattern
		expect(result.has('test-mod/minecraft')).toBe(true);
		expect(result.has('test-mod/some-lib')).toBe(false);
	});
});
