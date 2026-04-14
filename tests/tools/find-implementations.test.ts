import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

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



function makeJdtlsSession(overrides: Partial<JdtLsSession> = {}): JdtLsSession {
	return {
		available: true,
		tempDir: '/tmp/test-jdtls',
		dataDir: '/tmp/test-jdtls-data',
		jarIdToDirName: new Map([['minecraft', 'minecraft']]),
		client: makeMockClient() as any,
		endpoint: { send: mockEndpointSend } as any,
		...overrides,
	};
}

describe('find_implementations', () => {
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

	test.skipIf(!toolModuleAvailable)('returns NavigationResult array with provenance and context', async () => {
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
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
			expect(envelope.data.results[0].entryPath).toBe('net/minecraft/client/render/GameRenderer.java');
			expect(envelope.data.results[0].line).toBe(4); // 1-based
			expect(envelope.data.results[0].context).toBeDefined();
			expect(envelope.data.results[0].context.kind).toBeDefined();
			expect(envelope.data.sourcePosition).toBeDefined();

			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
			expect(mockEndpointSend).toHaveBeenCalledWith('textDocument/implementation', expect.any(Object));
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty results when implementation returns null', async () => {
		mockEndpointSend.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
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

	test.skipIf(!toolModuleAvailable)('returns cascade failure when patterns do not match', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
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
