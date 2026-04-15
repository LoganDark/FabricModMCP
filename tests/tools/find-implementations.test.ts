import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

const toolModuleAvailable = await import('../../src/tools/find-implementations.js').then(() => true).catch(() => false);

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

const FAKE_IMPL_SOURCE = `package net.minecraft.client.render;

public class GameRenderer {
	public void render(float tickDelta) {
		// rendering logic
	}
}
`;

const mockDefinition = vi.fn();
const mockReferences = vi.fn();
const mockHover = vi.fn();
const mockDidOpen = vi.fn().mockResolvedValue(undefined);
const mockDidClose = vi.fn().mockResolvedValue(undefined);
const mockEndpointSend = vi.fn();

function makeMockClient() {
	return {
		definition: mockDefinition,
		references: mockReferences,
		hover: mockHover,
		didOpen: mockDidOpen,
		didClose: mockDidClose,
	};
}

describe.skipIf(!toolModuleAvailable)('find_implementations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
		mockReadFile.mockResolvedValue(FAKE_SOURCE);
	});

	test('returns error when JDT LS not available', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls property
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_implementations',
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

	test('returns NavigationResult array with provenance and context', async () => {
		// Mock endpoint.send for textDocument/implementation
		mockEndpointSend.mockResolvedValue([
			{
				uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/GameRenderer.java',
				range: {
					start: { line: 3, character: 13 },
					end: { line: 3, character: 19 },
				},
			},
		]);
		mockReadFile.mockResolvedValue(FAKE_IMPL_SOURCE);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_implementations',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(1);
			expect(envelope.data.results[0].jar).toBe('minecraft');
			// Compact by default: entryPath, context, provenanceChains are stripped
			expect(envelope.data.results[0].entryPath).toBeUndefined();
			expect(envelope.data.results[0].line).toBe(4); // 1-based
			expect(envelope.data.results[0].context).toBeUndefined();
			expect(envelope.data.sourcePosition).toBeDefined();

			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
			expect(mockEndpointSend).toHaveBeenCalledWith('textDocument/implementation', expect.any(Object));
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns full results with context when details: { lineContent: true } is passed', async () => {
		mockEndpointSend.mockResolvedValue([
			{
				uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/GameRenderer.java',
				range: {
					start: { line: 3, character: 13 },
					end: { line: 3, character: 19 },
				},
			},
		]);
		mockReadFile.mockResolvedValue(FAKE_IMPL_SOURCE);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_implementations',
				arguments: {
					project: 'test',
					jar: 'minecraft',
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

	test('returns empty results when implementation returns null', async () => {
		mockEndpointSend.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_implementations',
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

			const text = (result as any).content[0].text;
			expect(text).toContain('No implementations found');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	describe('pagination', () => {
		test('no pagination params returns all results with hasMore=false', async () => {
			mockEndpointSend.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/GameRenderer.java',
					range: { start: { line: 3, character: 13 }, end: { line: 3, character: 19 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/WorldRenderer.java',
					range: { start: { line: 4, character: 13 }, end: { line: 4, character: 19 } },
				},
			]);
			mockReadFile.mockResolvedValue(FAKE_IMPL_SOURCE);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_implementations',
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

		test('limit returns a subset with correct metadata', async () => {
			mockEndpointSend.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/GameRenderer.java',
					range: { start: { line: 3, character: 13 }, end: { line: 3, character: 19 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/WorldRenderer.java',
					range: { start: { line: 4, character: 13 }, end: { line: 4, character: 19 } },
				},
			]);
			mockReadFile.mockResolvedValue(FAKE_IMPL_SOURCE);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_implementations',
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

		test('offset skips results', async () => {
			mockEndpointSend.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/GameRenderer.java',
					range: { start: { line: 3, character: 13 }, end: { line: 3, character: 19 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/WorldRenderer.java',
					range: { start: { line: 4, character: 13 }, end: { line: 4, character: 19 } },
				},
			]);
			mockReadFile.mockResolvedValue(FAKE_IMPL_SOURCE);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
				projectStore.set('test', fake);

				const result = await pair.client.callTool({
					name: 'find_implementations',
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

		test('text summary reflects pagination state', async () => {
			mockEndpointSend.mockResolvedValue([
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/GameRenderer.java',
					range: { start: { line: 3, character: 13 }, end: { line: 3, character: 19 } },
				},
				{
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/render/WorldRenderer.java',
					range: { start: { line: 4, character: 13 }, end: { line: 4, character: 19 } },
				},
			]);
			mockReadFile.mockResolvedValue(FAKE_IMPL_SOURCE);

			const pair = await createTestPair();
			try {
				const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
				projectStore.set('test', fake);

				// Paginated
				const paginatedResult = await pair.client.callTool({
					name: 'find_implementations',
					arguments: {
						project: 'test',
						jar: 'minecraft',
						class: 'net.minecraft.client.MinecraftClient',
						patterns: ['public void run\\('],
						limit: 1,
					},
				});
				expect((paginatedResult as any).content[0].text).toContain('showing');

				// Full
				const fullResult = await pair.client.callTool({
					name: 'find_implementations',
					arguments: {
						project: 'test',
						jar: 'minecraft',
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'find_implementations',
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
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
