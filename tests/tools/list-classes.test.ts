import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeFabricMod } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { Project, FabricModChild, DependencyEntry } from '../../src/project/types.js';

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
	deps.set('testmod/minecraft', {
		id: 'testmod/minecraft',
		group: 'net.minecraft',
		artifact: 'minecraft-merged',
		version: '1.21.11',
		category: 'minecraft',
		sourcesJarPath: '/fake/minecraft-sources.jar',
		available: true,
		provenanceChains: [],
	});
	deps.set('testmod', {
		id: 'testmod',
		group: 'testmod',
		artifact: 'testmod',
		version: '1.0.0',
		category: 'mod-source',
		sourcesJarPath: null,
		available: true,
		provenanceChains: [],
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
	'net/minecraft/client/MinecraftClient$1.java', // anonymous - should be filtered
	'net/minecraft/server/MinecraftServer.java',
	'net/minecraft/util/Identifier.java',
];

const MC_SOURCE = {
	'net/minecraft/client/MinecraftClient.java': `package net.minecraft.client;

public class MinecraftClient {
}`,
	'net/minecraft/client/MinecraftClient$Options.java': `package net.minecraft.client;

public static class Options {
}`,
	'net/minecraft/server/MinecraftServer.java': `package net.minecraft.server;

public abstract class MinecraftServer {
}`,
	'net/minecraft/util/Identifier.java': `package net.minecraft.util;

public final class Identifier {
}`,
} as Record<string, string>;

describe('list_classes tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		mockListEntries.mockReset();
		mockReadEntry.mockReset();

		mockListEntries.mockImplementation(async (jarPath: string) => {
			if (jarPath === '/fake/minecraft-sources.jar') return MC_ENTRIES;
			return [];
		});

		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			const source = MC_SOURCE[entryPath];
			if (source) return Buffer.from(source, 'utf-8');
			throw new Error(`Entry not found: ${entryPath}`);
		});

		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('returns classes in a package with compact metadata by default', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.classes).toHaveLength(1); // MinecraftClient only
		const mc = envelope.data.classes[0];
		expect(mc.name).toBe('MinecraftClient');
		expect(mc.fqn).toBe('net.minecraft.client.MinecraftClient');
		// Compact by default: access, modifiers, innerClasses are stripped
		expect(mc.access).toBeUndefined();
		expect(mc.modifiers).toBeUndefined();
		expect(mc.innerClasses).toBeUndefined();
		expect(mc.kind).toBe('class');
		expect(mc.jars).toEqual([{ id: 'testmod/minecraft', category: 'minecraft' }]);
	});

	it('inner classes are nested in parent with innerClasses detail flag', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client', details: { innerClasses: true } },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.classes[0];
		expect(mc.innerClasses).toBeDefined();
		expect(mc.innerClasses.length).toBeGreaterThanOrEqual(1);
		const opts = mc.innerClasses.find((ic: any) => ic.name === 'MinecraftClient$Options');
		expect(opts).toBeDefined();
		expect(opts.kind).toBe('class');
		// innerClasses: true without modifiers: true => compact inner classes (no access/modifiers)
		expect(opts.access).toBeUndefined();
		expect(opts.modifiers).toBeUndefined();
	});

	it('inner classes with both innerClasses and modifiers flags include access/modifiers', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client', details: { innerClasses: true, modifiers: true } },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.classes[0];
		expect(mc.innerClasses).toBeDefined();
		expect(mc.innerClasses.length).toBeGreaterThanOrEqual(1);
		const opts = mc.innerClasses.find((ic: any) => ic.name === 'MinecraftClient$Options');
		expect(opts).toBeDefined();
		expect(opts.kind).toBe('class');
		expect(opts.access).toBeDefined();
		expect(opts.modifiers).toBeDefined();
	});

	it('anonymous inner classes are filtered from listing', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client', details: { innerClasses: true } },
		});

		const envelope = parseEnvelope(result);
		const mc = envelope.data.classes[0];
		// Should NOT contain $1 anonymous class
		const anon = mc.innerClasses.find((ic: any) => ic.name.includes('$1'));
		expect(anon).toBeUndefined();
	});

	it('class metadata includes access, modifiers, but NOT innerClasses with only modifiers flag', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.server', details: { modifiers: true } },
		});

		const envelope = parseEnvelope(result);
		const server = envelope.data.classes.find((c: any) => c.name === 'MinecraftServer');
		expect(server).toBeDefined();
		expect(server.access).toBe('public');
		expect(server.modifiers).toContain('abstract');
		expect(server.kind).toBe('class');
		// modifiers: true alone should NOT include innerClasses
		expect(server.innerClasses).toBeUndefined();
	});

	it('class entries include jars array', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.util', details: { modifiers: true } },
		});

		const envelope = parseEnvelope(result);
		const id = envelope.data.classes.find((c: any) => c.name === 'Identifier');
		expect(id).toBeDefined();
		expect(id.jars).toEqual([{ id: 'testmod/minecraft', category: 'minecraft' }]);
		expect(id.modifiers).toContain('final');
	});

	it('supports jar filtering with jars parameter', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client', jars: ['testmod/minecraft'] },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.classes).toHaveLength(1);
	});

	it('returns DomainError for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'nonexistent', package: 'net.minecraft' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});

	it('response includes provenance metadata', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.metadata.provenance).toBeDefined();
		expect(envelope.metadata.provenance.tool).toBe('list_classes');
		expect(envelope.metadata.provenance.project).toBe('test');
		expect(envelope.metadata.provenance.package).toBe('net.minecraft.client');
	});

	it('classes are sorted alphabetically by name', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client' },
		});

		const envelope = parseEnvelope(result);
		const names = envelope.data.classes.map((c: any) => c.name);
		const sorted = [...names].sort();
		expect(names).toEqual(sorted);
	});

	// REGRESSION: content body bug (2026-05-26) — list_classes must list
	// each class in content[] as a body block.
	it('REGRESSION: content body lists matched classes', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'list_classes',
			arguments: { project: 'test', package: 'net.minecraft.client' },
		});

		const r = result as any;
		expect(r.content.length).toBeGreaterThanOrEqual(2);
		expect(r.content[0].text).toMatch(/^Found \d+ class/);
		const bodyText = r.content.slice(1).map((c: any) => c.text).join('\n');
		expect(bodyText).toContain('MinecraftClient');
	});
});
