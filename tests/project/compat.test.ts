import { describe, it, expect } from 'vitest';
import {
	getSoleFabricMod,
	getGradleConfig,
	getSourcesJar,
	getFabricMod,
	getDependencyJars,
	getFilterConfig,
	getRootPath,
	getStudyJars,
} from '../../src/project/compat.js';
import { DomainError } from '../../src/errors/domain-error.js';
import type { Project, FabricModChild, StudyJarChild } from '../../src/project/types.js';

function makeFabricMod(name: string): FabricModChild {
	return {
		kind: 'fabric-mod',
		name,
		rootPath: `/path/to/${name}`,
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.4',
			dependencies: [],
		},
		sourcesJar: { path: `/jars/${name}-sources.jar`, exists: true },
		fabricMod: {
			schemaVersion: 1,
			id: name,
			version: '1.0.0',
			name,
			description: `Test mod ${name}`,
			authors: ['test'],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: new Map(),
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}

function makeStudyJar(name: string): StudyJarChild {
	return {
		kind: 'study-jar',
		name,
		jarPath: `/jars/${name}.jar`,
		mtime: Date.now(),
		size: 1024,
		autoInclude: false,
		stats: { totalEntries: 10, packageCount: 2, classCount: 8 },
	};
}

function makeProject(name: string, children: [string, FabricModChild | StudyJarChild][]): Project {
	return {
		name,
		children: new Map(children),
	};
}

describe('getSoleFabricMod', () => {
	it('returns the sole fabric mod when exactly one exists', () => {
		const mod = makeFabricMod('my-mod');
		const project = makeProject('test', [['my-mod', mod]]);
		expect(getSoleFabricMod(project)).toBe(mod);
	});

	it('throws NO_FABRIC_MOD when project has no children', () => {
		const project = makeProject('empty', []);
		expect(() => getSoleFabricMod(project)).toThrow(DomainError);
		try {
			getSoleFabricMod(project);
		} catch (error) {
			expect((error as DomainError).code).toBe('NO_FABRIC_MOD');
		}
	});

	it('throws NO_FABRIC_MOD when project has only study jars', () => {
		const project = makeProject('jars-only', [
			['jar1', makeStudyJar('jar1')],
		]);
		expect(() => getSoleFabricMod(project)).toThrow(DomainError);
		try {
			getSoleFabricMod(project);
		} catch (error) {
			expect((error as DomainError).code).toBe('NO_FABRIC_MOD');
		}
	});

	it('throws MULTIPLE_FABRIC_MODS when project has two fabric mods', () => {
		const project = makeProject('multi', [
			['mod-a', makeFabricMod('mod-a')],
			['mod-b', makeFabricMod('mod-b')],
		]);
		expect(() => getSoleFabricMod(project)).toThrow(DomainError);
		try {
			getSoleFabricMod(project);
		} catch (error) {
			expect((error as DomainError).code).toBe('MULTIPLE_FABRIC_MODS');
		}
	});

	it('returns the fabric mod when mixed with study jars', () => {
		const mod = makeFabricMod('my-mod');
		const project = makeProject('mixed', [
			['jar1', makeStudyJar('jar1')],
			['my-mod', mod],
			['jar2', makeStudyJar('jar2')],
		]);
		expect(getSoleFabricMod(project)).toBe(mod);
	});
});

describe('compat accessor delegation', () => {
	const mod = makeFabricMod('test-mod');
	const project = makeProject('test', [['test-mod', mod]]);

	it('getGradleConfig delegates to sole fabric mod', () => {
		expect(getGradleConfig(project)).toBe(mod.gradleConfig);
	});

	it('getSourcesJar delegates to sole fabric mod', () => {
		expect(getSourcesJar(project)).toBe(mod.sourcesJar);
	});

	it('getFabricMod delegates to sole fabric mod', () => {
		expect(getFabricMod(project)).toBe(mod.fabricMod);
	});

	it('getDependencyJars delegates to sole fabric mod', () => {
		expect(getDependencyJars(project)).toBe(mod.dependencyJars);
	});

	it('getFilterConfig delegates to sole fabric mod', () => {
		expect(getFilterConfig(project)).toBe(mod.filterConfig);
	});

	it('getRootPath delegates to sole fabric mod', () => {
		expect(getRootPath(project)).toBe(mod.rootPath);
	});
});

describe('getStudyJars', () => {
	it('returns empty Map when no study jars exist', () => {
		const project = makeProject('no-jars', [
			['mod', makeFabricMod('mod')],
		]);
		const result = getStudyJars(project);
		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(0);
	});

	it('returns empty Map when project has no children', () => {
		const project = makeProject('empty', []);
		const result = getStudyJars(project);
		expect(result.size).toBe(0);
	});

	it('returns only study jar children from mixed project', () => {
		const jar1 = makeStudyJar('jar1');
		const jar2 = makeStudyJar('jar2');
		const project = makeProject('mixed', [
			['mod', makeFabricMod('mod')],
			['jar1', jar1],
			['jar2', jar2],
		]);
		const result = getStudyJars(project);
		expect(result.size).toBe(2);
		expect(result.get('jar1')).toBe(jar1);
		expect(result.get('jar2')).toBe(jar2);
	});
});
