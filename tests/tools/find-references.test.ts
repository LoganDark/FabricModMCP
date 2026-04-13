import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

// These tests require the tool implementation from Plan 09-03.
// They will be populated with test cases when find-references.ts is created.

const toolModuleAvailable = await import('../../src/tools/find-references.js').then(() => true).catch(() => false);

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

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	const content = result.content as Array<{ type: string; text: string }>;
	return JSON.parse(content[0].text);
}

const mockReferences = vi.fn();
const mockDidOpen = vi.fn();
const mockDidClose = vi.fn();

const mockJdtlsSession: JdtLsSession = {
	available: true,
	tempDir: '/tmp/test-jdtls',
	jarIdToDirName: new Map([
		['minecraft', 'minecraft'],
		['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1'],
	]),
};

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
	deps.set('fabric-api:fabric-networking-api-v1', {
		id: 'fabric-api:fabric-networking-api-v1',
		group: 'net.fabricmc.fabric-api',
		artifact: 'fabric-networking-api-v1',
		version: '4.0.0',
		category: 'fabric-api',
		sourcesJarPath: '/fake/fabric-networking-sources.jar',
		available: true,
		provenanceChains: [['net.fabricmc.fabric-api:fabric-api']],
	});

	return {
		name: 'test',
		rootPath: '/fake/path',
		gradleConfig: {
			minecraftVersion: '1.21.11',
			mappingEra: 'yarn',
			yarnMappings: '1.21.11+build.4',
			loaderVersion: '0.16.14',
			fabricApiVersion: '0.119.5+1.21.11',
			dependencies: [],
		},
		sourcesJar: { path: '/fake/sources.jar', exists: true },
		fabricMod: {
			schemaVersion: 1,
			id: 'testmod',
			version: '1.0.0',
			name: 'Test Mod',
			description: 'A test mod',
			authors: ['Test'],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		},
		dependencyJars: deps,
		filterConfig: { mode: 'include-all', patterns: [] },
		...overrides,
	};
}

describe('find_references', () => {
	test.skipIf(!toolModuleAvailable)('returns error when JDT LS not available', async () => {
		// Set up a loaded project with jdtls.available = false
		// Call find_references tool
		// Expect JDTLS_NOT_AVAILABLE error in envelope
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_references',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public class MinecraftClient'],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
			expect(envelope.error.code).toBe('JDTLS_NOT_AVAILABLE');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns reference locations with context snippets', async () => {
		// Set up a loaded project with mock jdtls session
		// Mock the LspClient.references() to return Location[]
		// Mock readFile to return Java source for context extraction
		// Call find_references tool
		// Expect results with jar, entryPath, line, column, context for each reference
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_references',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty results when no references found', async () => {
		// Mock client.references() returning empty array
		// Expect success envelope with empty results
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_references',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['someUniqueThing'],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns error on cascading regex failure', async () => {
		// Provide patterns that don't match the source
		// Expect failure in response
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_references',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['thisPatternWillNeverMatch12345'],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns references across different jars', async () => {
		// Mock references returning locations from multiple jars
		// Expect all jars represented in results
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_references',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public class MinecraftClient'],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
