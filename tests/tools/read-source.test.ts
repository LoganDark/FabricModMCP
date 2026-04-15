import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';

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

const MC_SOURCE_TEXT = `package net.minecraft.client;

import net.minecraft.util.Identifier;

public class MinecraftClient {
    // Main game client
    private static MinecraftClient instance;

    public void run() {
        // game loop
    }
}`;

const INNER_SOURCE_TEXT = `package net.minecraft.client;

public static class Options {
    public boolean fullscreen;
}`;

function makeFakeProject(overrides: Partial<LoadedProject> = {}): LoadedProject {
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
	return makeFakeProjectBase({ dependencyJars: deps, ...overrides });
}

describe('read_source tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		mockListEntries.mockReset();
		mockReadEntry.mockReset();

		mockListEntries.mockResolvedValue([]);
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (jarPath === '/fake/minecraft-sources.jar') {
				if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
					return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
				}
				if (entryPath === 'net/minecraft/client/MinecraftClient$Options.java') {
					return Buffer.from(INNER_SOURCE_TEXT, 'utf-8');
				}
			}
			throw new Error(`Entry not found: ${entryPath} in ${jarPath}`);
		});

		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('reads source by FQN with explicit jar', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.sources).toHaveLength(1);
		expect(envelope.data.sources[0].jar).toBe('minecraft');
		expect(envelope.data.sources[0].source).toContain('public class MinecraftClient');
		expect(envelope.data.sources[0].totalLineCount).toBeGreaterThan(0);
		expect(envelope.data.sources[0].category).toBe('minecraft');
	});

	it('searches all jars when no jar specified', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.sources.length).toBeGreaterThanOrEqual(1);
		expect(envelope.data.sources[0].jar).toBe('minecraft');
	});

	it('returns multiple matches when class exists in multiple jars', async () => {
		// Make the fabric jar also contain the same class
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
				return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
			}
			throw new Error(`Entry not found: ${entryPath}`);
		});

		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		// Should have matches from both minecraft and fabric jars
		expect(envelope.data.sources.length).toBeGreaterThanOrEqual(2);
		const jarIds = envelope.data.sources.map((s: any) => s.jar);
		expect(jarIds).toContain('minecraft');
	});

	it('supports inner class FQN with $ notation', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient$Options' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.sources).toHaveLength(1);
		expect(envelope.data.sources[0].source).toContain('public static class Options');
	});

	it('returns CLASS_NOT_FOUND error when class not in any jar', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'com.nonexistent.FakeClass' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CLASS_NOT_FOUND');
	});

	it('returns JAR_NOT_FOUND error for invalid jar ID', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'nonexistent-jar', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('JAR_NOT_FOUND');
	});

	it('returns DomainError for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'nonexistent', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});

	it('sources do not include provenanceChains by default (compact output)', async () => {
		// Make fabric jar return the class too
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
				return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
			}
			throw new Error(`Entry not found: ${entryPath}`);
		});

		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		const fabricResult = envelope.data.sources.find((s: any) => s.jar === 'net.fabricmc.fabric-api:fabric-resource-loader-v0');
		if (fabricResult) {
			expect(fabricResult.provenanceChains).toBeUndefined();
		}
	});

	it('sources include provenanceChains when details: { provenance: true }', async () => {
		// Make fabric jar return the class too
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
				return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
			}
			throw new Error(`Entry not found: ${entryPath}`);
		});

		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: {
				project: 'test',
				class: 'net.minecraft.client.MinecraftClient',
				details: { provenance: true },
			},
		});

		const envelope = parseEnvelope(result);
		const fabricResult = envelope.data.sources.find((s: any) => s.jar === 'net.fabricmc.fabric-api:fabric-resource-loader-v0');
		if (fabricResult) {
			expect(fabricResult.provenanceChains).toEqual([['net.fabricmc.fabric-api:fabric-api']]);
		}
		// Minecraft jar should have empty provenance chains
		const mcResult = envelope.data.sources.find((s: any) => s.jar === 'minecraft');
		expect(mcResult.provenanceChains).toEqual([]);
	});

	it('response includes provenance metadata', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.metadata.provenance).toBeDefined();
		expect(envelope.metadata.provenance.tool).toBe('read_source');
		expect(envelope.metadata.provenance.project).toBe('test');
		expect(envelope.metadata.provenance.class).toBe('net.minecraft.client.MinecraftClient');
	});

	it('priority ordering: minecraft before deps when searching all jars', async () => {
		// Both jars return the class
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
				return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
			}
			throw new Error(`Entry not found: ${entryPath}`);
		});

		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		// First result should be from minecraft (highest priority)
		expect(envelope.data.sources[0].jar).toBe('minecraft');
	});

	it('totalLineCount reflects actual number of lines', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		const lines = MC_SOURCE_TEXT.split('\n').length;
		expect(envelope.data.sources[0].totalLineCount).toBe(lines);
	});

	it('returns metadata fields on every response', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const src = envelope.data.sources[0];
		expect(src.startLine).toBe(1);
		expect(src.endLine).toBe(MC_SOURCE_TEXT.split('\n').length);
		expect(src.totalLineCount).toBe(MC_SOURCE_TEXT.split('\n').length);
		expect(src.truncated).toBe(false);
	});

	it('reads specific line range with startLine and lineCount', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient', startLine: 3, lineCount: 2 },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const src = envelope.data.sources[0];
		expect(src.source).toBe(MC_SOURCE_TEXT.split('\n').slice(2, 4).join('\n'));
		expect(src.startLine).toBe(3);
		expect(src.endLine).toBe(4);
		expect(src.truncated).toBe(true);
	});

	it('reads from startLine to EOF when lineCount omitted', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient', startLine: 5 },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const src = envelope.data.sources[0];
		expect(src.startLine).toBe(5);
		expect(src.endLine).toBe(MC_SOURCE_TEXT.split('\n').length);
		expect(src.truncated).toBe(true);
	});

	it('reads first N lines when only lineCount provided', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient', lineCount: 3 },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const src = envelope.data.sources[0];
		expect(src.startLine).toBe(1);
		expect(src.endLine).toBe(3);
		expect(src.truncated).toBe(true);
	});

	it('returns JAR_REQUIRED error when startLine without jar', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient', startLine: 1 },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('JAR_REQUIRED');
	});

	it('returns JAR_REQUIRED error when lineCount without jar', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient', lineCount: 10 },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('JAR_REQUIRED');
	});

	it('clamps range when extending beyond file', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient', startLine: 10, lineCount: 500 },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const src = envelope.data.sources[0];
		expect(src.endLine).toBe(src.totalLineCount);
		expect(src.truncated).toBe(true);
	});

	it('chunk concatenation invariant', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		// Read full file
		const fullResult = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient' },
		});
		const fullEnv = parseEnvelope(fullResult);
		const totalLines = fullEnv.data.sources[0].totalLineCount;

		// Read first 5 lines
		const chunk1Result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient', startLine: 1, lineCount: 5 },
		});
		const chunk1Env = parseEnvelope(chunk1Result);

		// Read remaining lines
		const chunk2Result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', jar: 'minecraft', class: 'net.minecraft.client.MinecraftClient', startLine: 6, lineCount: totalLines - 5 },
		});
		const chunk2Env = parseEnvelope(chunk2Result);

		const concatenated = chunk1Env.data.sources[0].source + '\n' + chunk2Env.data.sources[0].source;
		expect(concatenated).toBe(fullEnv.data.sources[0].source);
	});

	it('multi-jar search includes metadata on each result', async () => {
		// Make the fabric jar also contain the same class
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
				return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
			}
			throw new Error(`Entry not found: ${entryPath}`);
		});

		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_source',
			arguments: { project: 'test', class: 'net.minecraft.client.MinecraftClient' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.sources.length).toBeGreaterThanOrEqual(2);
		for (const src of envelope.data.sources) {
			expect(src.startLine).toBe(1);
			expect(src.endLine).toBe(MC_SOURCE_TEXT.split('\n').length);
			expect(src.totalLineCount).toBe(MC_SOURCE_TEXT.split('\n').length);
			expect(src.truncated).toBe(false);
		}
	});
});
