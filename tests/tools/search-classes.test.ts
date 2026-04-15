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

const REGISTRY_SOURCE_TEXT = `package net.minecraft.registry;

public class SimpleRegistry {
    // A simple registry implementation
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
	return makeFakeProjectBase({ dependencyJars: deps, ...overrides });
}

describe('search_classes tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		mockListEntries.mockReset();
		mockReadEntry.mockReset();

		mockListEntries.mockImplementation(async (jarPath: string) => {
			if (jarPath === '/fake/minecraft-sources.jar') {
				return [
					'net/minecraft/client/MinecraftClient.java',
					'net/minecraft/registry/SimpleRegistry.java',
				];
			}
			return [];
		});

		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (jarPath === '/fake/minecraft-sources.jar') {
				if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
					return Buffer.from(MC_SOURCE_TEXT, 'utf-8');
				}
				if (entryPath === 'net/minecraft/registry/SimpleRegistry.java') {
					return Buffer.from(REGISTRY_SOURCE_TEXT, 'utf-8');
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

	it('searches classes by pattern and returns results', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'search_classes',
			arguments: { project: 'test', pattern: '*Client' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.results).toBeDefined();
		expect(envelope.data.results.length).toBeGreaterThanOrEqual(1);
		expect(envelope.data.results[0].fqn).toContain('MinecraftClient');
		expect(envelope.data.offset).toBe(0);
		expect(envelope.data.limit).toBeDefined();
		expect(envelope.data.total).toBeGreaterThanOrEqual(1);
	});

	it('returns DomainError envelope for nonexistent project', async () => {
		const result = await pair.client.callTool({
			name: 'search_classes',
			arguments: { project: 'nonexistent', pattern: '*Client' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBeDefined();
	});

	it('response envelope has correct structure with provenance', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'search_classes',
			arguments: { project: 'test', pattern: '**.*Registry' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data).toHaveProperty('results');
		expect(envelope.data).toHaveProperty('offset');
		expect(envelope.data).toHaveProperty('limit');
		expect(envelope.data).toHaveProperty('total');
		expect(envelope.metadata.provenance).toBeDefined();
		expect(envelope.metadata.provenance.tool).toBe('search_classes');
		expect(envelope.metadata.provenance.project).toBe('test');
		expect(envelope.metadata.provenance.pattern).toBe('**.*Registry');
	});

	it('accepts optional parameters: caseSensitive, kind, jars, offset, limit', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'search_classes',
			arguments: {
				project: 'test',
				pattern: '*',
				caseSensitive: true,
				kind: ['class'],
				jars: ['minecraft'],
				offset: 0,
				limit: 10,
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.limit).toBe(10);
	});

	it('results are compact by default (no access/modifiers)', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'search_classes',
			arguments: { project: 'test', pattern: '*Client' },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const match = envelope.data.results.find((r: any) => r.fqn.includes('MinecraftClient'));
		expect(match).toBeDefined();
		expect(match.kind).toBeDefined();
		expect(match.jars).toBeDefined();
		expect(Array.isArray(match.jars)).toBe(true);
		// Compact by default: access, modifiers, innerClasses stripped
		expect(match.access).toBeUndefined();
		expect(match.modifiers).toBeUndefined();
	});

	it('results include access and modifiers with details flag but NOT innerClasses', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'search_classes',
			arguments: { project: 'test', pattern: '*Client', details: { modifiers: true } },
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		const match = envelope.data.results.find((r: any) => r.fqn.includes('MinecraftClient'));
		expect(match).toBeDefined();
		expect(match.kind).toBeDefined();
		expect(match.access).toBeDefined();
		expect(match.jars).toBeDefined();
		expect(Array.isArray(match.jars)).toBe(true);
		// modifiers: true alone should NOT include innerClasses
		expect(match.innerClasses).toBeUndefined();
	});
});
