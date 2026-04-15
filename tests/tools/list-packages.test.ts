import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricMod } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project, FabricModChild, DependencyEntry } from '../../src/project/types.js';

// Mock jar-reader so we can control listEntries/readEntry
const mockListEntries = vi.fn<(jarPath: string) => Promise<string[]>>();
const mockReadEntry = vi.fn<(jarPath: string, entryPath: string) => Promise<Buffer>>();

vi.mock('../../src/tools/shared-jar-reader.js', () => ({
	jarReader: {
		listEntries: (...args: any[]) => mockListEntries(...args),
		readEntry: (...args: any[]) => mockReadEntry(...args),
		openJar: vi.fn(),
		closeJar: vi.fn(),
	},
}));

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...original,
		stat: vi.fn().mockResolvedValue({ size: 12345 }),
		readdir: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
	};
});

function makeFakeProject(modOverrides: Partial<FabricModChild> = {}): Project {
	const deps = new Map<string, DependencyEntry>();
	deps.set('minecraft', {
		id: 'minecraft',
		group: 'net.minecraft',
		artifact: 'minecraft-merged',
		version: '1.21.11',
		category: 'minecraft',
		sourcesJarPath: '/fake/minecraft-sources.jar',
		available: true,
		provenanceChains: [],
	});
	deps.set('src', {
		id: 'src',
		group: 'testmod',
		artifact: 'testmod',
		version: '1.0.0',
		category: 'mod-source',
		sourcesJarPath: null,
		available: true,
		provenanceChains: [],
	});
	deps.set('net.fabricmc.fabric-api:fabric-resource-loader-v0', {
		id: 'net.fabricmc.fabric-api:fabric-resource-loader-v0',
		group: 'net.fabricmc.fabric-api',
		artifact: 'fabric-resource-loader-v0',
		version: '1.2.3',
		category: 'fabric-api',
		sourcesJarPath: '/fake/fabric-sources.jar',
		available: true,
		provenanceChains: [['net.fabricmc.fabric-api:fabric-api']],
	});
	const mod = makeFakeFabricMod({ dependencyJars: deps, ...modOverrides });
	return {
		name: 'test',
		children: new Map([[mod.name, mod]]),
	};
}

const MC_ENTRIES = [
	'net/minecraft/client/MinecraftClient.java',
	'net/minecraft/client/MinecraftClient$Options.java',
	'net/minecraft/server/MinecraftServer.java',
	'net/minecraft/util/Identifier.java',
	'net/minecraft/package-info.java',
];

const FABRIC_ENTRIES = [
	'net/fabricmc/fabric/api/resource/ResourceManagerHelper.java',
	'net/fabricmc/fabric/api/resource/ResourcePackActivationType.java',
];

describe('list_packages tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		mockListEntries.mockReset();
		mockReadEntry.mockReset();

		// Default: minecraft jar returns MC_ENTRIES
		mockListEntries.mockImplementation(async (jarPath: string) => {
			if (jarPath === '/fake/minecraft-sources.jar') return MC_ENTRIES;
			if (jarPath === '/fake/fabric-sources.jar') return FABRIC_ENTRIES;
			return [];
		});

		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns top-level packages when no package param specified', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const pkgNames = envelope.data.packages.map((p: any) => p.name);
		expect(pkgNames).toContain('net');
	});

	it('returns sub-packages of a given package', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test', package: 'net.minecraft' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const pkgNames = envelope.data.packages.map((p: any) => p.name);
		expect(pkgNames).toContain('net.minecraft.client');
		expect(pkgNames).toContain('net.minecraft.server');
		expect(pkgNames).toContain('net.minecraft.util');
	});

	it('each package entry has name, classCount, jars', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test', package: 'net.minecraft' },
		});

		const envelope = parseEnvelope(result);
		const clientPkg = envelope.data.packages.find((p: any) => p.name === 'net.minecraft.client');
		expect(clientPkg).toBeDefined();
		expect(clientPkg.classCount).toBe(1); // MinecraftClient (inner class not counted)
		expect(clientPkg.jars).toContain('minecraft');
	});

	it('filters jars when jars parameter provided', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test', jars: ['minecraft'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		// Should only have packages from minecraft jar
		const allJars = envelope.data.packages.flatMap((p: any) => p.jars);
		const uniqueJars = [...new Set(allJars)];
		expect(uniqueJars).toEqual(['minecraft']);
	});

	it('supports jars glob pattern matching', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test', jars: ['net.fabricmc*'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const pkgNames = envelope.data.packages.map((p: any) => p.name);
		expect(pkgNames).toContain('net');
	});

	it('supports depth parameter for deeper package listing', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test', depth: 2 },
		});

		const envelope = parseEnvelope(result);
		const pkgNames = envelope.data.packages.map((p: any) => p.name);
		// depth=2 from root should include net and net.minecraft/net.fabricmc
		expect(pkgNames).toContain('net');
		expect(pkgNames).toContain('net.minecraft');
	});

	it('merges packages across jars', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		// Both minecraft and fabric have packages under 'net'
		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		const netPkg = envelope.data.packages.find((p: any) => p.name === 'net');
		expect(netPkg).toBeDefined();
		// 'net' package should have jars from both minecraft and fabric
		expect(netPkg.jars).toContain('minecraft');
		expect(netPkg.jars).toContain('net.fabricmc.fabric-api:fabric-resource-loader-v0');
	});

	it('response includes provenance metadata', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.metadata.provenance).toBeDefined();
		expect(envelope.metadata.provenance.tool).toBe('list_packages');
		expect(envelope.metadata.provenance.project).toBe('test');
	});

	it('returns DomainError for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'nonexistent' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});

	it('packages are sorted alphabetically', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_packages',
			arguments: { project: 'test', package: 'net.minecraft' },
		});

		const envelope = parseEnvelope(result);
		const names = envelope.data.packages.map((p: any) => p.name);
		const sorted = [...names].sort();
		expect(names).toEqual(sorted);
	});
});
