import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricModNamed } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project, StudyJarChild } from '../../src/project/types.js';

vi.mock('../../src/project/loader.js', () => ({
	loadFabricMod: vi.fn(),
}));

function makeStudyJarChild(name: string, jarPath: string): StudyJarChild {
	return {
		kind: 'study-jar',
		name,
		jarPath,
		mtime: 1000,
		size: 500,
		autoInclude: true,
		stats: { totalEntries: 10, packageCount: 2, classCount: 5 },
	};
}

describe('get_project_info tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns project overview with fabric mod members', async () => {
		const mod = makeFakeFabricModNamed('my-mod');
		const project: Project = {
			name: 'test',
			children: new Map([['my-mod', mod]]),
		};
		projectStore.set('test', project);

		const result = await pair.client.callTool({
			name: 'get_project_info',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.project).toBe('test');
		expect(envelope.data.memberCount).toBe(1);
		expect(envelope.data.activeChild).toBeNull();

		const members = envelope.data.members;
		expect(members).toHaveLength(1);
		expect(members[0].name).toBe('my-mod');
		expect(members[0].kind).toBe('fabric-mod');
		expect(members[0].minecraftVersion).toBe('1.21.11');
		expect(members[0].mappingEra).toBe('mapped');
		expect(members[0].dependencyCount).toBe(2);
	});

	it('returns study jar members with correct fields', async () => {
		const studyJar = makeStudyJarChild('extra-lib', '/path/to/extra-lib-sources.jar');
		const mod = makeFakeFabricModNamed('my-mod');
		const project: Project = {
			name: 'test',
			children: new Map([
				['my-mod', mod],
				['extra-lib', studyJar],
			]),
		};
		projectStore.set('test', project);

		const result = await pair.client.callTool({
			name: 'get_project_info',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.memberCount).toBe(2);

		const sjMember = envelope.data.members.find((m: any) => m.kind === 'study-jar');
		expect(sjMember).toBeDefined();
		expect(sjMember.name).toBe('extra-lib');
		expect(sjMember.jarPath).toBe('/path/to/extra-lib-sources.jar');
		expect(sjMember.autoInclude).toBe(true);
	});

	it('includes activeChild when set', async () => {
		const mod = makeFakeFabricModNamed('my-mod');
		const project: Project = {
			name: 'test',
			activeChild: 'my-mod',
			children: new Map([['my-mod', mod]]),
		};
		projectStore.set('test', project);

		const result = await pair.client.callTool({
			name: 'get_project_info',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.data.activeChild).toBe('my-mod');
	});

	it('returns error for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'get_project_info',
			arguments: { project: 'nonexistent' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});
});
