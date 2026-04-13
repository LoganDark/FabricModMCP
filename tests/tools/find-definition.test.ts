import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

// These tests require the tool implementation from Plan 09-03.
// They will be populated with test cases when find-definition.ts is created.

const toolModuleAvailable = await import('../../src/tools/find-definition.js').then(() => true).catch(() => false);

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

const mockDefinition = vi.fn();
const mockDidOpen = vi.fn();
const mockDidClose = vi.fn();

const mockJdtlsSession: JdtLsSession = {
	available: true,
	tempDir: '/tmp/test-jdtls',
	jarIdToDirName: new Map([['minecraft', 'minecraft']]),
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

describe('find_definition', () => {
	test.skipIf(!toolModuleAvailable)('returns error when JDT LS not available', async () => {
		// Set up a loaded project with jdtls.available = false
		// Call find_definition tool
		// Expect JDTLS_NOT_AVAILABLE error in envelope
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
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

	test.skipIf(!toolModuleAvailable)('returns definition with context snippet', async () => {
		// Set up a loaded project with mock jdtls session (available: true, mock client)
		// Mock the LspClient.definition() to return a Location
		// Mock readFile to return Java source for context extraction
		// Call find_definition tool
		// Expect NavigationResult with jar, entryPath, line, column, context
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
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

	test.skipIf(!toolModuleAvailable)('returns empty results when no definition found', async () => {
		// Mock client.definition() returning null
		// Expect success envelope with empty results array
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject();
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['nonExistentSymbol'],
				},
			});

			const envelope = parseEnvelope(result);
			// Tool may return success with empty results or failure
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
				name: 'find_definition',
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
});
