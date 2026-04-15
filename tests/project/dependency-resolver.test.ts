import { describe, it, expect } from 'vitest';
import { getResolvedDependencies, getAllDependencies } from '../../src/project/dependency-resolver.js';
import { CATEGORY_PRIORITY, sortByPriority, getDependenciesForTool } from '../../src/tools/tool-helpers.js';
import type { DependencyEntry, Project, FabricModChild, ProjectChild, StudyJar, StudyJarChild, JarCategory } from '../../src/project/types.js';

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

	// Include filterConfig as a runtime property for getDependenciesForTool compat
	// (tool-helpers still reads project.filterConfig directly until Plan 03 migration)
	const project = {
		name: 'test-project',
		children,
		filterConfig: fabricMod.filterConfig,
	} as unknown as Project;

	return project;
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
			['minecraft', makeDep('minecraft', 'minecraft')],
			['some-lib', makeDep('some-lib', 'library')],
		]);
		const studyJars = new Map([
			['mylib', makeStudyJar('mylib', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getDependenciesForTool(project, ['mylib']);
		expect(result.size).toBe(1);
		expect(result.has('mylib')).toBe(true);
	});

	it('with jars=[mylib, minecraft] returns study jars + minecraft', () => {
		const deps = new Map([
			['minecraft', makeDep('minecraft', 'minecraft')],
			['some-lib', makeDep('some-lib', 'library')],
		]);
		const studyJars = new Map([
			['mylib', makeStudyJar('mylib', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getDependenciesForTool(project, ['mylib', 'minecraft']);
		expect(result.size).toBe(2);
		expect(result.has('mylib')).toBe(true);
		expect(result.has('minecraft')).toBe(true);
		expect(result.has('some-lib')).toBe(false);
	});

	it('with jars=[mylib] returns only that one study jar', () => {
		const deps = new Map([
			['minecraft', makeDep('minecraft', 'minecraft')],
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

	it('without jars param returns getFilteredDependencies(getResolvedDependencies(project), filterConfig)', () => {
		const deps = new Map([
			['minecraft', makeDep('minecraft', 'minecraft')],
			['some-lib', makeDep('some-lib', 'library')],
		]);
		const studyJars = new Map([
			['included', makeStudyJar('included', true)],
			['excluded', makeStudyJar('excluded', false)],
		]);
		const project = makeProject(deps, studyJars);
		const result = getDependenciesForTool(project);
		// Should include minecraft, some-lib, and autoInclude=true study jar
		expect(result.has('minecraft')).toBe(true);
		expect(result.has('some-lib')).toBe(true);
		expect(result.has('included')).toBe(true);
		// autoInclude=false excluded
		expect(result.has('excluded')).toBe(false);
	});

	it('without jars param respects filterConfig exclusion patterns', () => {
		const deps = new Map([
			['minecraft', makeDep('minecraft', 'minecraft')],
			['some-lib', makeDep('some-lib', 'library')],
		]);
		const project = makeProject(deps, new Map());
		// Override filterConfig on the fabric mod child and the project compat property
		const mod = project.children.get('test-mod') as FabricModChild;
		mod.filterConfig = { mode: 'include-all', patterns: ['some-lib'] };
		(project as any).filterConfig = mod.filterConfig;
		const result = getDependenciesForTool(project);
		expect(result.has('minecraft')).toBe(true);
		expect(result.has('some-lib')).toBe(false);
	});
});
