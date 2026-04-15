import { describe, it, expect } from 'vitest';
import { resolveJarId, resolveJarIds, inferSoleChildName, getAutoIncludeIds } from '../../src/project/namespace-resolver.js';
import type { Project, FabricModChild, DependencyEntry } from '../../src/project/types.js';
import { DomainError } from '../../src/errors/domain-error.js';

function makeMod(name: string, depKeys: string[] = []): FabricModChild {
	const depMap = new Map<string, DependencyEntry>();
	for (const key of depKeys) {
		depMap.set(key, {
			id: key,
			group: 'net.minecraft',
			artifact: 'minecraft-merged',
			version: '1.21.11',
			category: key.endsWith('/minecraft') || key === 'minecraft' ? 'minecraft' : 'library',
			sourcesJarPath: '/fake/sources.jar',
			available: true,
			provenanceChains: [],
		});
	}
	return {
		kind: 'fabric-mod',
		name,
		rootPath: `/fake/${name}`,
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'mapped',
			yarnMappings: '1.21.11+build.1',
			loaderVersion: '0.16.14',
			dependencies: [],
		},
		sourcesJar: { path: '/fake/sources.jar', exists: true },
		fabricMod: {
			schemaVersion: 1,
			id: name,
			version: '1.0.0',
			name,
			description: '',
			authors: [],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: depMap,
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}

function makeProject(children: [string, FabricModChild | { kind: 'study-jar'; name: string }][]): Project {
	const childMap = new Map<string, any>();
	for (const [key, child] of children) {
		if (child.kind === 'study-jar') {
			childMap.set(key, {
				kind: 'study-jar',
				name: child.name,
				jarPath: `/fake/${child.name}.jar`,
				mtime: 0,
				size: 0,
				autoInclude: false,
				stats: { totalEntries: 0, packageCount: 0, classCount: 0 },
			});
		} else {
			childMap.set(key, child);
		}
	}
	return { name: 'test-project', children: childMap };
}

describe('inferSoleChildName', () => {
	it('returns the name when exactly one fabric mod exists', () => {
		const project = makeProject([['testmod', makeMod('testmod')]]);
		expect(inferSoleChildName(project)).toBe('testmod');
	});

	it('returns null when no fabric mods exist', () => {
		const project = makeProject([['my-lib', { kind: 'study-jar', name: 'my-lib' }]]);
		expect(inferSoleChildName(project)).toBeNull();
	});

	it('returns null when multiple fabric mods exist', () => {
		const project = makeProject([
			['modA', makeMod('modA')],
			['modB', makeMod('modB')],
		]);
		expect(inferSoleChildName(project)).toBeNull();
	});
});

describe('resolveJarId', () => {
	it('returns already-namespaced IDs unchanged', () => {
		const project = makeProject([['testmod', makeMod('testmod')]]);
		expect(resolveJarId(project, 'testmod/minecraft')).toBe('testmod/minecraft');
	});

	it('returns bare child name unchanged for study-jar', () => {
		const project = makeProject([
			['testmod', makeMod('testmod')],
			['my-lib', { kind: 'study-jar', name: 'my-lib' }],
		]);
		expect(resolveJarId(project, 'my-lib')).toBe('my-lib');
	});

	it('returns bare child name unchanged for fabric-mod (mod source)', () => {
		const project = makeProject([['testmod', makeMod('testmod')]]);
		expect(resolveJarId(project, 'testmod')).toBe('testmod');
	});

	it('resolves bare dep ID when project has exactly one fabric mod', () => {
		const project = makeProject([['testmod', makeMod('testmod', ['testmod/minecraft'])]]);
		expect(resolveJarId(project, 'minecraft')).toBe('testmod/minecraft');
	});

	it('throws AMBIGUOUS_JAR_ID when multiple fabric mods and no scope or defaultChild', () => {
		const project = makeProject([
			['modA', makeMod('modA', ['modA/minecraft'])],
			['modB', makeMod('modB', ['modB/minecraft'])],
		]);
		expect(() => resolveJarId(project, 'minecraft')).toThrow(DomainError);
		try {
			resolveJarId(project, 'minecraft');
		} catch (e) {
			expect((e as DomainError).code).toBe('AMBIGUOUS_JAR_ID');
		}
	});

	it('uses scope to resolve bare dep ID', () => {
		const project = makeProject([
			['modA', makeMod('modA')],
			['modB', makeMod('modB')],
		]);
		expect(resolveJarId(project, 'minecraft', 'modA')).toBe('modA/minecraft');
	});

	it('uses defaultChild when no scope provided', () => {
		const project = makeProject([
			['modA', makeMod('modA')],
			['modB', makeMod('modB')],
		]);
		project.defaultChild = 'modA';
		expect(resolveJarId(project, 'minecraft')).toBe('modA/minecraft');
	});

	it('scope wins over defaultChild', () => {
		const project = makeProject([
			['modA', makeMod('modA')],
			['modB', makeMod('modB')],
		]);
		project.defaultChild = 'modA';
		expect(resolveJarId(project, 'minecraft', 'modB')).toBe('modB/minecraft');
	});
});

describe('resolveJarIds', () => {
	it('resolves an array of jar IDs', () => {
		const project = makeProject([['testmod', makeMod('testmod', ['testmod/minecraft', 'testmod/fabric-api'])]]);
		const result = resolveJarIds(project, ['minecraft', 'testmod/fabric-api']);
		expect(result).toEqual(['testmod/minecraft', 'testmod/fabric-api']);
	});
});

describe('getAutoIncludeIds', () => {
	it('returns set with mod name and minecraft dep ID', () => {
		const mod = makeMod('testmod', ['testmod/minecraft', 'testmod/fabric-api']);
		// Override the minecraft category
		mod.dependencyJars.get('testmod/minecraft')!.category = 'minecraft';
		mod.dependencyJars.get('testmod/fabric-api')!.category = 'fabric-api';

		const ids = getAutoIncludeIds(mod);
		expect(ids).toContain('testmod');
		expect(ids).toContain('testmod/minecraft');
		expect(ids).not.toContain('testmod/fabric-api');
	});

	it('returns only mod name when no minecraft dep exists', () => {
		const mod = makeMod('testmod', ['testmod/fabric-api']);
		mod.dependencyJars.get('testmod/fabric-api')!.category = 'fabric-api';

		const ids = getAutoIncludeIds(mod);
		expect(ids).toContain('testmod');
		expect(ids.size).toBe(1);
	});
});
