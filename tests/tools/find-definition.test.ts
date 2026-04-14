import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

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

function makeJdtlsSession(overrides: Partial<JdtLsSession> = {}): JdtLsSession {
	return {
		available: true,
		tempDir: '/tmp/test-jdtls',
		dataDir: '/tmp/test-jdtls-data',
		jarIdToDirName: new Map([['minecraft', 'minecraft']]),
		client: makeMockClient() as any,
		...overrides,
	};
}

describe('find_definition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		// Default: jar source reads return FAKE_SOURCE
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
		// Default: readFile for extracted temp files returns FAKE_SOURCE
		mockReadFile.mockResolvedValue(FAKE_SOURCE);
	});

	test.skipIf(!toolModuleAvailable)('returns error when JDT LS not available', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls property
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
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
			expect(envelope.data.results).toHaveLength(1);
			expect(envelope.data.results[0].jar).toBe('minecraft');
			expect(envelope.data.results[0].entryPath).toBe('net/minecraft/client/MinecraftClient.java');
			expect(envelope.data.results[0].line).toBe(6); // 1-based
			expect(envelope.data.results[0].context).toBeDefined();
			expect(envelope.data.results[0].context.kind).toBeDefined();

			// Verify didOpen/didClose were called
			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty results when no definition found', async () => {
		// Mock definition returns null
		mockDefinition.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
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
			expect(envelope.data.results).toHaveLength(0);
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
				name: 'find_definition',
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
});
