import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

const toolModuleAvailable = await import('../../src/tools/get-symbol-info.js').then(() => true).catch(() => false);

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

import net.minecraft.util.Identifier;

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

const mockHover = vi.fn();
const mockDefinition = vi.fn();
const mockReferences = vi.fn();
const mockDidOpen = vi.fn().mockResolvedValue(undefined);
const mockDidClose = vi.fn().mockResolvedValue(undefined);

function makeMockClient() {
	return {
		hover: mockHover,
		definition: mockDefinition,
		references: mockReferences,
		didOpen: mockDidOpen,
		didClose: mockDidClose,
	};
}

describe.skipIf(!toolModuleAvailable)('get_symbol_info', () => {
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
				name: 'get_symbol_info',
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

	test('returns markdown hover content for a valid symbol', async () => {
		mockHover.mockResolvedValue({
			contents: {
				kind: 'markdown',
				value: '```java\npublic void run()\n```\nRuns the client.',
			},
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.hover).toContain('public void run()');
			expect(envelope.data).toHaveProperty('javadoc');
			expect(envelope.data.position).toBeDefined();
			expect(envelope.data.position.jar).toBe('testmod/minecraft');

			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns all hover results when multiple are returned', async () => {
		mockHover.mockResolvedValue({
			contents: [
				{ language: 'java', value: 'public void run()' },
				'Runs the client main loop.',
			],
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.hover).toContain('public void run()');
			expect(envelope.data.hover).toContain('Runs the client main loop.');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns empty result when hover lands on import declaration', async () => {
		mockHover.mockResolvedValue({
			contents: {
				kind: 'markdown',
				value: 'import net.minecraft.util.Identifier',
			},
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['import net.minecraft.util.Identifier'],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.hover).toBeNull();

			const text = (result as any).content[0].text;
			expect(text).toContain('import');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns cascade failure when patterns do not match', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
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
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns null hover when LSP returns null', async () => {
		mockHover.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.hover).toBeNull();
			expect(envelope.data.javadoc).toBe('');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
