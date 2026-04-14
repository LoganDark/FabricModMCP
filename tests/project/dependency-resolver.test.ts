import { describe, it, expect } from 'vitest';
import { getResolvedDependencies, getAllDependencies } from '../../src/project/dependency-resolver.js';
import type { DependencyEntry, LoadedProject, StudyJar, JarCategory } from '../../src/project/types.js';

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
): LoadedProject {
	return {
		name: 'test-project',
		rootPath: '/fake/project',
		dependencyJars: deps,
		studyJars,
		filterConfig: { mode: 'include-all' as const, patterns: [] },
	} as unknown as LoadedProject;
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

	it('returns a NEW Map (not same reference as project.dependencyJars)', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const project = makeProject(deps, new Map());
		const result = getResolvedDependencies(project);
		expect(result).not.toBe(project.dependencyJars);
	});

	it('includes autoInclude=true study jar with id "study:name"', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const studyJars = new Map([['mylib', makeStudyJar('mylib', true)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		expect(result.size).toBe(2);
		expect(result.has('study:mylib')).toBe(true);
		const entry = result.get('study:mylib')!;
		expect(entry.category).toBe('study');
		expect(entry.id).toBe('study:mylib');
	});

	it('excludes autoInclude=false study jar from result', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const studyJars = new Map([['excluded', makeStudyJar('excluded', false)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		expect(result.size).toBe(1);
		expect(result.has('study:excluded')).toBe(false);
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
		expect(result.has('study:included')).toBe(true);
		expect(result.has('study:excluded')).toBe(false);
	});

	it('study jar entries use studyJarToDependencyEntry conversion', () => {
		const deps = new Map<string, DependencyEntry>();
		const studyJars = new Map([['mylib', makeStudyJar('mylib', true)]]);
		const project = makeProject(deps, studyJars);
		const result = getResolvedDependencies(project);
		const entry = result.get('study:mylib')!;
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

	it('returns a NEW Map (not same reference as project.dependencyJars)', () => {
		const deps = new Map([['minecraft', makeDep('minecraft', 'minecraft')]]);
		const project = makeProject(deps, new Map());
		const result = getAllDependencies(project);
		expect(result).not.toBe(project.dependencyJars);
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
		expect(result.has('study:included')).toBe(true);
		expect(result.has('study:excluded')).toBe(true);
	});

	it('study jar entries use studyJarToDependencyEntry conversion', () => {
		const deps = new Map<string, DependencyEntry>();
		const studyJars = new Map([['mylib', makeStudyJar('mylib', false)]]);
		const project = makeProject(deps, studyJars);
		const result = getAllDependencies(project);
		const entry = result.get('study:mylib')!;
		expect(entry.category).toBe('study');
		expect(entry.id).toBe('study:mylib');
		expect(entry.group).toBe('study');
		expect(entry.artifact).toBe('mylib');
		expect(entry.version).toBe('local');
	});
});
