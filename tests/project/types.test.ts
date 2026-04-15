import { describe, it, expect } from 'vitest';
import type {
	Project,
	LoadedProject,
	FabricModChild,
	StudyJarChild,
	ProjectChild,
} from '../../src/project/types.js';

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

describe('type hierarchy', () => {
	it('discriminated union narrows FabricModChild by kind', () => {
		const child: ProjectChild = makeFabricMod('test-mod');
		if (child.kind === 'fabric-mod') {
			expect(child.rootPath).toBe('/path/to/test-mod');
			expect(child.gradleConfig.minecraftVersion).toBe('1.21.11');
			expect(child.sourcesJar.exists).toBe(true);
			expect(child.fabricMod.id).toBe('test-mod');
			expect(child.dependencyJars).toBeInstanceOf(Map);
			expect(child.filterConfig.mode).toBe('include-all');
		} else {
			expect.unreachable('should have narrowed to FabricModChild');
		}
	});

	it('discriminated union narrows StudyJarChild by kind', () => {
		const child: ProjectChild = makeStudyJar('test-jar');
		if (child.kind === 'study-jar') {
			expect(child.jarPath).toBe('/jars/test-jar.jar');
			expect(child.mtime).toBeTypeOf('number');
			expect(child.size).toBe(1024);
			expect(child.autoInclude).toBe(false);
			expect(child.stats.totalEntries).toBe(10);
			expect(child.stats.packageCount).toBe(2);
			expect(child.stats.classCount).toBe(8);
		} else {
			expect.unreachable('should have narrowed to StudyJarChild');
		}
	});

	it('switch on kind correctly identifies each child type', () => {
		const children: ProjectChild[] = [
			makeFabricMod('mod-a'),
			makeStudyJar('jar-a'),
		];
		const kinds: string[] = [];
		for (const child of children) {
			switch (child.kind) {
				case 'fabric-mod':
					kinds.push(`mod:${child.name}`);
					break;
				case 'study-jar':
					kinds.push(`jar:${child.name}`);
					break;
			}
		}
		expect(kinds).toEqual(['mod:mod-a', 'jar:jar-a']);
	});

	it('Project.children Map accepts both child types', () => {
		const project: Project = {
			name: 'mixed',
			children: new Map<string, ProjectChild>([
				['mod', makeFabricMod('mod')],
				['jar', makeStudyJar('jar')],
			]),
		};
		expect(project.children.size).toBe(2);
		expect(project.children.get('mod')!.kind).toBe('fabric-mod');
		expect(project.children.get('jar')!.kind).toBe('study-jar');
	});

	it('LoadedProject is assignable to/from Project', () => {
		const project: Project = {
			name: 'test',
			children: new Map(),
		};
		const loaded: LoadedProject = project;
		const back: Project = loaded;
		expect(loaded.name).toBe('test');
		expect(back.name).toBe('test');
		expect(loaded).toBe(back);
	});

	it('empty Project with no children is valid', () => {
		const project: Project = {
			name: 'empty',
			children: new Map(),
		};
		expect(project.name).toBe('empty');
		expect(project.children.size).toBe(0);
		expect(project.jdtls).toBeUndefined();
	});

	it('Project with mixed children can be iterated and narrowed', () => {
		const mod = makeFabricMod('my-mod');
		const jar = makeStudyJar('my-jar');
		const project: Project = {
			name: 'full',
			children: new Map([
				['my-mod', mod],
				['my-jar', jar],
			]),
		};
		const modNames: string[] = [];
		const jarPaths: string[] = [];
		for (const child of project.children.values()) {
			if (child.kind === 'fabric-mod') {
				modNames.push(child.fabricMod.id);
			} else if (child.kind === 'study-jar') {
				jarPaths.push(child.jarPath);
			}
		}
		expect(modNames).toEqual(['my-mod']);
		expect(jarPaths).toEqual(['/jars/my-jar.jar']);
	});
});
