import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';

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


describe.skipIf(!toolModuleAvailable)('find_definition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		// Default: jar source reads return FAKE_SOURCE
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
		// Default: readFile for extracted temp files returns FAKE_SOURCE
		mockReadFile.mockResolvedValue(FAKE_SOURCE);
	});

	test('returns error when JDT LS not available', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls property
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
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

	test('returns definition with context snippet', async () => {
		// Mock definition returns a location in the same file
		mockDefinition.mockResolvedValue({
			uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
			range: {
				start: { line: 5, character: 13 }, // "run" method, 0-based
				end: { line: 5, character: 16 },
			},
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data).toBeDefined();
			expect(envelope.data.results).toHaveLength(1);
			expect(envelope.data.results[0].jar).toBe('testmod/minecraft');
			// Compact by default: entryPath, context, provenanceChains are stripped
			expect(envelope.data.results[0].entryPath).toBeUndefined();
			expect(envelope.data.results[0].line).toBe(6); // 1-based
			expect(envelope.data.results[0].context).toBeUndefined();

			// Verify didOpen/didClose were called
			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns full results with context when details: { lineContent: true } is passed', async () => {
		mockDefinition.mockResolvedValue({
			uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
			range: {
				start: { line: 5, character: 13 },
				end: { line: 5, character: 16 },
			},
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
					details: { lineContent: true },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(1);
			expect(envelope.data.results[0].context).toBeDefined();
			expect(envelope.data.results[0].entryPath).toBeDefined();
			expect(typeof envelope.data.results[0].entryPath).toBe('string');
			expect(envelope.data.results[0].context.snippet).toBeDefined();
			expect(typeof envelope.data.results[0].context.snippet).toBe('string');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns empty results when no definition found', async () => {
		// Mock definition returns null
		mockDefinition.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
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

	describe('pagination', () => {
		test('no pagination params returns all results with hasMore=false', async () => {
			mockDefinition.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 9, character: 13 }, end: { line: 9, character: 17 } },
				},
			]);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_definition',
					arguments: {
						project: 'test',
						jar: 'testmod/minecraft',
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

		test('limit returns a subset with correct metadata', async () => {
			mockDefinition.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 9, character: 13 }, end: { line: 9, character: 17 } },
				},
			]);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_definition',
					arguments: {
						project: 'test',
						jar: 'testmod/minecraft',
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

		test('offset skips results', async () => {
			mockDefinition.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 9, character: 13 }, end: { line: 9, character: 17 } },
				},
			]);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_definition',
					arguments: {
						project: 'test',
						jar: 'testmod/minecraft',
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

		test('text summary reflects pagination state', async () => {
			mockDefinition.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 9, character: 13 }, end: { line: 9, character: 17 } },
				},
			]);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
				projectStore.set('test', fake);

				// Paginated
				const paginatedResult = await pair.client.callTool({
					name: 'find_definition',
					arguments: {
						project: 'test',
						jar: 'testmod/minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
						limit: 1,
					},
				});
				expect((paginatedResult as any).content[0].text).toContain('showing');

				// Full
				const fullResult = await pair.client.callTool({
					name: 'find_definition',
					arguments: {
						project: 'test',
						jar: 'testmod/minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
					},
				});
				expect((fullResult as any).content[0].text).not.toContain('showing');
			} finally {
				await pair.cleanup();
				projectStore.clear();
			}
		});
	});

	test('returns cascade failure when patterns do not match', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_definition',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
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
});
