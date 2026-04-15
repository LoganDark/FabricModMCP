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

const FABRIC_SOURCE_TEXT = `package net.minecraft.client;

public class MinecraftClient {
    // Fabric API version
    public void run() {}
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

describe('locate_in_source tool', () => {
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
			}
			if (jarPath === '/fake/fabric-sources.jar') {
				if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
					return Buffer.from(FABRIC_SOURCE_TEXT, 'utf-8');
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

	it('returns success with results when cascade matches', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'locate_in_source',
			arguments: {
				project: 'test',
				jar: 'minecraft',
				class: 'net.minecraft.client.MinecraftClient',
				patterns: ['public class MinecraftClient', 'MinecraftClient'],
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.results).toHaveLength(1);
		expect(envelope.data.results[0].jar).toBe('minecraft');
		expect(envelope.data.results[0].category).toBe('minecraft');
		// Compact by default: steps and provenanceChains are stripped
		expect(envelope.data.results[0].steps).toBeUndefined();
		expect(envelope.data.results[0].offset).toBeGreaterThanOrEqual(0);
		expect(envelope.data.results[0].line).toBeGreaterThanOrEqual(1);
		expect(envelope.data.results[0].column).toBeGreaterThanOrEqual(1);
		expect(envelope.data.failures).toHaveLength(0);
		expect(envelope.metadata.provenance.tool).toBe('locate_in_source');
	});

	it('returns DomainError for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'locate_in_source',
			arguments: {
				project: 'nonexistent',
				class: 'net.minecraft.client.MinecraftClient',
				patterns: ['public class'],
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});

	it('returns CLASS_NOT_FOUND when class not in any jar', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'locate_in_source',
			arguments: {
				project: 'test',
				class: 'com.nonexistent.FakeClass',
				patterns: ['something'],
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('CLASS_NOT_FOUND');
	});

	it('returns both results and failures when cascade fails in one jar but succeeds in another', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		// Use a pattern that matches in minecraft jar but fails in fabric jar
		// MC source has "private static MinecraftClient instance" but fabric source doesn't
		const result = await pair.client.callTool({
			name: 'locate_in_source',
			arguments: {
				project: 'test',
				class: 'net.minecraft.client.MinecraftClient',
				patterns: ['public class MinecraftClient[\\s\\S]*', 'private static MinecraftClient instance'],
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.results.length).toBeGreaterThanOrEqual(1);
		expect(envelope.data.failures.length).toBeGreaterThanOrEqual(1);

		// Success should be from minecraft
		const successJar = envelope.data.results[0].jar;
		expect(successJar).toBe('minecraft');
		// Compact by default: steps and provenanceChains are stripped
		expect(envelope.data.results[0].steps).toBeUndefined();
		expect(envelope.data.results[0].line).toBeGreaterThanOrEqual(1);

		// Failure should be from fabric
		const failureJar = envelope.data.failures[0].jar;
		expect(failureJar).toBe('net.fabricmc.fabric-api:fabric-resource-loader-v0');
		expect(envelope.data.failures[0].steps).toBeDefined();
		expect(envelope.data.failures[0].failedStep).toBeGreaterThanOrEqual(1);
	});

	it('returns JAR_NOT_FOUND for invalid jar ID', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'locate_in_source',
			arguments: {
				project: 'test',
				jar: 'nonexistent-jar',
				class: 'net.minecraft.client.MinecraftClient',
				patterns: ['something'],
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('JAR_NOT_FOUND');
	});

	describe('context parameter', () => {
		it('returns context with surrounding lines when context parameter provided', async () => {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'locate_in_source',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['private static MinecraftClient instance'],
					context: { linesBefore: 1, linesAfter: 1 },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(1);
			const ctx = envelope.data.results[0].context;
			expect(ctx).toBeDefined();
			// Line 7 is "private static MinecraftClient instance;", linesBefore=1 gets line 6, linesAfter=1 gets line 8
			expect(ctx.startLine).toBe(6);
			expect(ctx.endLine).toBe(8);
			const lines = ctx.text.split('\n');
			expect(lines).toHaveLength(3);
		});

		it('extends to whole line with linesBefore=0, linesAfter=0', async () => {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'locate_in_source',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					// Pattern matches mid-line: "static" within the instance line
					patterns: ['private static MinecraftClient instance', 'static'],
					context: { linesBefore: 0, linesAfter: 0 },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			const ctx = envelope.data.results[0].context;
			expect(ctx).toBeDefined();
			expect(ctx.startLine).toBe(ctx.endLine);
			// Should be the full line, not just "static"
			expect(ctx.text).toContain('private static MinecraftClient instance');
		});

		it('omits context field when parameter not provided', async () => {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'locate_in_source',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public class MinecraftClient', 'MinecraftClient'],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results[0]).not.toHaveProperty('context');
		});

		it('clamps at file start', async () => {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			// Line 2 is empty, line 1 is "package net.minecraft.client;"
			// Match on line 2 (the empty line after package) -- actually let's match line 1
			const result = await pair.client.callTool({
				name: 'locate_in_source',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['package net\\.minecraft\\.client;'],
					context: { linesBefore: 10, linesAfter: 0 },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			const ctx = envelope.data.results[0].context;
			expect(ctx).toBeDefined();
			expect(ctx.startLine).toBe(1);
		});

		it('clamps at file end', async () => {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			// The closing brace "}" is the last line of MC_SOURCE_TEXT
			const result = await pair.client.callTool({
				name: 'locate_in_source',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\(\\)[\\s\\S]*\\}[\\s\\S]*', '\\}$'],
					context: { linesBefore: 0, linesAfter: 100 },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			const ctx = envelope.data.results[0].context;
			expect(ctx).toBeDefined();
			// MC_SOURCE_TEXT has 12 lines
			const totalLines = MC_SOURCE_TEXT.split('\n').length;
			expect(ctx.endLine).toBe(totalLines);
		});

		it('includes context for multi-jar results', async () => {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'locate_in_source',
				arguments: {
					project: 'test',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public class MinecraftClient'],
					context: { linesBefore: 1, linesAfter: 1 },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			// Should have results from multiple jars, each with context
			for (const r of envelope.data.results) {
				expect(r.context).toBeDefined();
				expect(r.context.text).toBeTruthy();
				expect(r.context.startLine).toBeGreaterThanOrEqual(1);
			}
		});
	});

	it('results are sorted by jar priority', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		// Pattern that matches in all jars
		const result = await pair.client.callTool({
			name: 'locate_in_source',
			arguments: {
				project: 'test',
				class: 'net.minecraft.client.MinecraftClient',
				patterns: ['public class MinecraftClient'],
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		// Minecraft should come before fabric-api
		if (envelope.data.results.length >= 2) {
			const categories = envelope.data.results.map((r: any) => r.category);
			const mcIdx = categories.indexOf('minecraft');
			const fabIdx = categories.indexOf('fabric-api');
			if (mcIdx !== -1 && fabIdx !== -1) {
				expect(mcIdx).toBeLessThan(fabIdx);
			}
		}
	});
});
