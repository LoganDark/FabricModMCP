import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

const toolModuleAvailable = await import('../../src/tools/search-symbols.js').then(() => true).catch(() => false);

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
		readFile: vi.fn().mockResolvedValue(''),
	};
});

const mockEndpointSend = vi.fn();
const mockDidOpen = vi.fn().mockResolvedValue(undefined);
const mockDidClose = vi.fn().mockResolvedValue(undefined);

function makeMockClient() {
	return {
		definition: vi.fn(),
		references: vi.fn(),
		documentSymbol: vi.fn(),
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

const SAMPLE_SYMBOLS = [
	{
		name: 'MinecraftClient',
		kind: 5, // class
		tags: [],
		location: {
			uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
			range: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
		},
		containerName: 'net.minecraft.client',
	},
	{
		name: 'run',
		kind: 6, // method
		tags: [],
		location: {
			uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
			range: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
		},
		containerName: 'MinecraftClient',
	},
	{
		name: 'stop',
		kind: 6, // method
		tags: [1], // deprecated
		location: {
			uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
			range: { start: { line: 9, character: 13 }, end: { line: 9, character: 17 } },
		},
		containerName: 'MinecraftClient',
	},
	{
		name: 'INSTANCE',
		kind: 14, // constant
		tags: [],
		location: {
			uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
			range: { start: { line: 3, character: 30 }, end: { line: 3, character: 38 } },
		},
		containerName: 'MinecraftClient',
	},
];

describe('search_symbols', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		mockReadEntry.mockResolvedValue(Buffer.from(''));
	});

	test.skipIf(!toolModuleAvailable)('returns error when JDT LS not available', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls property
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'search_symbols',
				arguments: {
					project: 'test',
					query: 'MinecraftClient',
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

	test.skipIf(!toolModuleAvailable)('returns symbol results with name, kind, containerName, location', async () => {
		mockEndpointSend.mockResolvedValue(SAMPLE_SYMBOLS);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'search_symbols',
				arguments: {
					project: 'test',
					query: 'MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(4);

			const first = envelope.data.results[0];
			expect(first.name).toBe('MinecraftClient');
			expect(first.kind).toBe('class');
			expect(first.containerName).toBe('net.minecraft.client');
			expect(first.location.jar).toBe('minecraft');
			expect(first.location.line).toBe(3); // 0-based 2 + 1
			expect(first.location.column).toBe(14); // 0-based 13 + 1

			// Check deprecated flag
			const deprecated = envelope.data.results[2];
			expect(deprecated.name).toBe('stop');
			expect(deprecated.deprecated).toBe(true);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('filters by kind', async () => {
		mockEndpointSend.mockResolvedValue(SAMPLE_SYMBOLS);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'search_symbols',
				arguments: {
					project: 'test',
					query: 'MinecraftClient',
					kind: 'method',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			// Only run and stop are methods
			expect(envelope.data.results).toHaveLength(2);
			expect(envelope.data.results.every((r: any) => r.kind === 'method')).toBe(true);
			expect(envelope.data.total).toBe(2);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('paginates with limit and offset', async () => {
		mockEndpointSend.mockResolvedValue(SAMPLE_SYMBOLS);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'search_symbols',
				arguments: {
					project: 'test',
					query: 'MinecraftClient',
					limit: 2,
					offset: 1,
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(2);
			expect(envelope.data.results[0].name).toBe('run'); // second symbol
			expect(envelope.data.results[1].name).toBe('stop'); // third symbol
			expect(envelope.data.total).toBe(4);
			expect(envelope.data.limit).toBe(2);
			expect(envelope.data.offset).toBe(1);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty results for no matches', async () => {
		mockEndpointSend.mockResolvedValue([]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'search_symbols',
				arguments: {
					project: 'test',
					query: 'NonExistentSymbol',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.results).toHaveLength(0);
			expect(envelope.data.total).toBe(0);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
