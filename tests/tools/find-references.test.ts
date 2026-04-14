import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject as makeFakeProjectBase, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';

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

const mockReadFile = vi.fn();

vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...original,
		stat: vi.fn().mockResolvedValue({ size: 12345 }),
		readdir: vi.fn().mockResolvedValue([]),
		readFile: (...args: any[]) => mockReadFile(...args),
	};
});

const FAKE_SOURCE = `package net.minecraft.client;

public class MinecraftClient {
	private boolean running;

	public void run() {
		this.running = true;
	}

	public void stop() {
		this.running = false;
	}
}
`;

const FAKE_CALLER_SOURCE = `package net.minecraft.client;

public class Main {
	public static void main(String[] args) {
		MinecraftClient client = new MinecraftClient();
		client.run();
	}
}
`;

const mockDefinition = vi.fn();
const mockReferences = vi.fn();
const mockDidOpen = vi.fn().mockResolvedValue(undefined);
const mockDidClose = vi.fn().mockResolvedValue(undefined);

function makeMockClient() {
	return {
		definition: mockDefinition,
		references: mockReferences,
		didOpen: mockDidOpen,
		didClose: mockDidClose,
	};
}

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
	return makeFakeProjectBase({ dependencyJars: deps, ...overrides });
}

describe('find_references', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
		mockReadFile.mockResolvedValue(FAKE_SOURCE);
	});

	test.skipIf(!toolModuleAvailable)('returns error when JDT LS not available', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls property
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
		// Mock references returns locations in two different files
		mockReferences.mockResolvedValue([
			{
				uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
				range: {
					start: { line: 5, character: 13 },
					end: { line: 5, character: 16 },
				},
			},
			{
				uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/Main.java',
				range: {
					start: { line: 5, character: 9 },
					end: { line: 5, character: 12 },
				},
			},
		]);

		// Return different source for the Main.java file
		mockReadFile.mockImplementation(async (path: string) => {
			if (path.includes('Main.java')) return FAKE_CALLER_SOURCE;
			return FAKE_SOURCE;
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft'], ['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1']]) }) });
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
			expect(envelope.data.results).toHaveLength(2);
			expect(envelope.data.results[0].jar).toBe('minecraft');
			expect(envelope.data.results[0].context).toBeDefined();
			expect(envelope.data.results[1].jar).toBe('minecraft');
			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty results when no references found', async () => {
		mockReferences.mockResolvedValue([]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft'], ['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1']]) }) });
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
			expect(envelope.data.results).toHaveLength(0);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns error on cascading regex failure', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft'], ['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1']]) }) });
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
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(0);
			expect(envelope.data.failures).toHaveLength(1);
			expect(envelope.data.failures[0].failedStep).toBe(1);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns references across different jars', async () => {
		// References from both minecraft and fabric-api jars
		mockReferences.mockResolvedValue([
			{
				uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
				range: {
					start: { line: 2, character: 13 },
					end: { line: 2, character: 28 },
				},
			},
			{
				uri: 'file:///tmp/test-jdtls/fabric-api__fabric-networking-api-v1/net/fabricmc/fabric/api/Networking.java',
				range: {
					start: { line: 3, character: 4 },
					end: { line: 3, character: 19 },
				},
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft'], ['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1']]) }) });
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
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toBeDefined();
			// First result from minecraft jar
			const jars = envelope.data.results.map((r: any) => r.jar);
			if (jars.length >= 2) {
				expect(jars).toContain('minecraft');
				expect(jars).toContain('fabric-api:fabric-networking-api-v1');
			}
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	describe('pagination', () => {
		test.skipIf(!toolModuleAvailable)('no pagination params returns all results with hasMore=false', async () => {
			mockReferences.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/Main.java',
					range: { start: { line: 5, character: 9 }, end: { line: 5, character: 12 } },
				},
			]);
			mockReadFile.mockImplementation(async (path: string) => {
				if (path.includes('Main.java')) return FAKE_CALLER_SOURCE;
				return FAKE_SOURCE;
			});

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft']]) }) });
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
				expect(envelope.data.hasMore).toBe(false);
				expect(envelope.data.offset).toBe(0);
				expect(envelope.data.total).toBe(envelope.data.results.length);
			} finally {
				await pair.cleanup();
				projectStore.clear();
			}
		});

		test.skipIf(!toolModuleAvailable)('limit returns a subset with correct metadata', async () => {
			mockReferences.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/Main.java',
					range: { start: { line: 5, character: 9 }, end: { line: 5, character: 12 } },
				},
			]);
			mockReadFile.mockImplementation(async (path: string) => {
				if (path.includes('Main.java')) return FAKE_CALLER_SOURCE;
				return FAKE_SOURCE;
			});

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft']]) }) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_references',
					arguments: {
						project: 'test',
						jar: 'minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
						limit: 1,
					},
				});

				const envelope = parseEnvelope(result);
				expect(envelope.success).toBe(true);
				expect(envelope.data.results).toHaveLength(1);
				expect(envelope.data.total).toBe(2);
				expect(envelope.data.hasMore).toBe(true);
				expect(envelope.data.offset).toBe(0);
			} finally {
				await pair.cleanup();
				projectStore.clear();
			}
		});

		test.skipIf(!toolModuleAvailable)('offset skips results', async () => {
			mockReferences.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/Main.java',
					range: { start: { line: 5, character: 9 }, end: { line: 5, character: 12 } },
				},
			]);
			mockReadFile.mockImplementation(async (path: string) => {
				if (path.includes('Main.java')) return FAKE_CALLER_SOURCE;
				return FAKE_SOURCE;
			});

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft']]) }) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_references',
					arguments: {
						project: 'test',
						jar: 'minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
						limit: 1,
						offset: 1,
					},
				});

				const envelope = parseEnvelope(result);
				expect(envelope.success).toBe(true);
				expect(envelope.data.results).toHaveLength(1);
				expect(envelope.data.offset).toBe(1);
				expect(envelope.data.hasMore).toBe(false);
			} finally {
				await pair.cleanup();
				projectStore.clear();
			}
		});

		test.skipIf(!toolModuleAvailable)('text summary reflects pagination state', async () => {
			mockReferences.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/Main.java',
					range: { start: { line: 5, character: 9 }, end: { line: 5, character: 12 } },
				},
			]);
			mockReadFile.mockImplementation(async (path: string) => {
				if (path.includes('Main.java')) return FAKE_CALLER_SOURCE;
				return FAKE_SOURCE;
			});

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft']]) }) });
				projectStore.set('test', fake);

				// Paginated: text should contain "showing"
				const paginatedResult = await pair.client.callTool({
					name: 'find_references',
					arguments: {
						project: 'test',
						jar: 'minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
						limit: 1,
					},
				});
				const paginatedText = (paginatedResult as any).content[0].text;
				expect(paginatedText).toContain('showing');

				// Not paginated: text should NOT contain "showing"
				const fullResult = await pair.client.callTool({
					name: 'find_references',
					arguments: {
						project: 'test',
						jar: 'minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
					},
				});
				const fullText = (fullResult as any).content[0].text;
				expect(fullText).not.toContain('showing');
			} finally {
				await pair.cleanup();
				projectStore.clear();
			}
		});
	});

	test.skipIf(!toolModuleAvailable)('includes includeDeclaration in references request', async () => {
		mockReferences.mockResolvedValue([]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { jarIdToDirName: new Map([['minecraft', 'minecraft'], ['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1']]) }) });
			projectStore.set('test', fake);

			await pair.client.callTool({
				name: 'find_references',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			expect(mockReferences).toHaveBeenCalledOnce();
			const callArgs = mockReferences.mock.calls[0][0];
			expect(callArgs.context.includeDeclaration).toBe(true);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
