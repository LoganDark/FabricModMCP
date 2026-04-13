import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

const toolModuleAvailable = await import('../../src/tools/list-members.js').then(() => true).catch(() => false);

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

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	return (result as any).structuredContent;
}

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

const mockDocumentSymbol = vi.fn();
const mockDidOpen = vi.fn().mockResolvedValue(undefined);
const mockDidClose = vi.fn().mockResolvedValue(undefined);

function makeMockClient() {
	return {
		definition: vi.fn(),
		references: vi.fn(),
		documentSymbol: mockDocumentSymbol,
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

describe('list_members', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
	});

	test.skipIf(!toolModuleAvailable)('returns error when JDT LS not available', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls property
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					class: 'net.minecraft.client.MinecraftClient',
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

	test.skipIf(!toolModuleAvailable)('returns error when class not found in jar', async () => {
		mockReadEntry.mockRejectedValue(new Error('Entry not found'));

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.DoesNotExist',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
			expect(envelope.error.code).toBe('CLASS_NOT_FOUND');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns tree of members from DocumentSymbol response', async () => {
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 12, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				children: [
					{
						name: 'running',
						kind: 8, // field
						detail: 'boolean',
						range: { start: { line: 3, character: 1 }, end: { line: 3, character: 25 } },
						selectionRange: { start: { line: 3, character: 17 }, end: { line: 3, character: 24 } },
					},
					{
						name: 'run()',
						kind: 6, // method
						detail: 'void',
						range: { start: { line: 5, character: 1 }, end: { line: 7, character: 2 } },
						selectionRange: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
					},
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.members).toHaveLength(1);

			const cls = envelope.data.members[0];
			expect(cls.name).toBe('MinecraftClient');
			expect(cls.kind).toBe('class');
			expect(cls.children).toHaveLength(2);

			const field = cls.children[0];
			expect(field.name).toBe('running');
			expect(field.kind).toBe('field');
			expect(field.detail).toBe('boolean');
			// Ranges should be 1-based
			expect(field.range.start.line).toBe(4); // 0-based 3 + 1

			const method = cls.children[1];
			expect(method.name).toBe('run()');
			expect(method.kind).toBe('method');

			// Verify didOpen/didClose were called
			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('maps SymbolKind numeric to human-readable string', async () => {
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'TestField',
				kind: 8, // field
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
				selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
			},
			{
				name: 'TestMethod',
				kind: 6, // method
				range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
				selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.members[0].kind).toBe('field');
			expect(envelope.data.members[1].kind).toBe('method');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty members array when documentSymbol returns null', async () => {
		mockDocumentSymbol.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.members).toHaveLength(0);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
