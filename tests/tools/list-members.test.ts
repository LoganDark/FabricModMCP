import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
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
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
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
			// Compact by default: detail, parameters, returnType, fieldType, selectionRange stripped
			expect(field.detail).toBeUndefined();
			// Ranges should be 1-based, compact range has lines only (no character)
			expect(field.range.start.line).toBe(4); // 0-based 3 + 1
			expect(field.range.start.character).toBeUndefined();

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

	test.skipIf(!toolModuleAvailable)('enriched method members have memberFqn, parameters, returnType with details flag', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 12, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				children: [
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					details: { signatures: true },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);

			const cls = envelope.data.members[0];
			const method = cls.children[0];
			expect(method.name).toBe('run()');
			expect(method.memberFqn).toBe('net.minecraft.client.MinecraftClient#run()');
			expect(method.parameters).toEqual([]);
			expect(method.returnType).toEqual({ kind: 'void' });
			// detail string present with signatures flag
			expect(method.detail).toBe('void');
			// selectionRange present with signatures flag
			expect(method.selectionRange).toBeDefined();
			// full range with characters present
			expect(method.range.start.character).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('enriched field members have memberFqn and fieldType with details flag', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
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
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					details: { signatures: true },
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);

			const cls = envelope.data.members[0];
			const field = cls.children[0];
			expect(field.name).toBe('running');
			expect(field.memberFqn).toBe('net.minecraft.client.MinecraftClient#running:');
			expect(field.fieldType).toEqual({ kind: 'primitive', name: 'boolean' });
			// detail string present with signatures flag
			expect(field.detail).toBe('boolean');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('enriched class container has no memberFqn, children are enriched', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 12, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				children: [
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
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
			const cls = envelope.data.members[0];
			// Class containers do NOT have memberFqn
			expect(cls.memberFqn).toBeUndefined();
			// But children are enriched
			expect(cls.children[0].memberFqn).toBe('net.minecraft.client.MinecraftClient#run()');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('enriched constructor has memberFqn with class simple name and () with details flag', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 12, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				children: [
					{
						name: 'MinecraftClient()',
						kind: 9, // constructor
						detail: null,
						range: { start: { line: 4, character: 1 }, end: { line: 6, character: 2 } },
						selectionRange: { start: { line: 4, character: 8 }, end: { line: 4, character: 23 } },
					},
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					details: { signatures: true },
				},
			});

			const envelope = parseEnvelope(result);
			const cls = envelope.data.members[0];
			const ctor = cls.children[0];
			expect(ctor.memberFqn).toBe('net.minecraft.client.MinecraftClient#MinecraftClient()');
			expect(ctor.parameters).toEqual([]);
			expect(ctor.returnType).toBeNull();
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
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
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

	test.skipIf(!toolModuleAvailable)('returns compact results by default (no detail fields)', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5,
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 12, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				children: [
					{
						name: 'run()',
						kind: 6,
						detail: 'void',
						range: { start: { line: 5, character: 1 }, end: { line: 7, character: 2 } },
						selectionRange: { start: { line: 5, character: 13 }, end: { line: 5, character: 16 } },
					},
					{
						name: 'running',
						kind: 8,
						detail: 'boolean',
						range: { start: { line: 3, character: 1 }, end: { line: 3, character: 25 } },
						selectionRange: { start: { line: 3, character: 17 }, end: { line: 3, character: 24 } },
					},
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
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

			const cls = envelope.data.members[0];
			const method = cls.children[0];
			// Compact: no detail, parameters, returnType, selectionRange
			expect(method.detail).toBeUndefined();
			expect(method.parameters).toBeUndefined();
			expect(method.returnType).toBeUndefined();
			expect(method.selectionRange).toBeUndefined();
			// Compact range: lines only, no character
			expect(method.range.start.line).toBeDefined();
			expect(method.range.start.character).toBeUndefined();
			// But name, kind, memberFqn still present
			expect(method.name).toBe('run()');
			expect(method.kind).toBe('method');
			expect(method.memberFqn).toBeDefined();

			const field = cls.children[1];
			expect(field.detail).toBeUndefined();
			expect(field.fieldType).toBeUndefined();
			expect(field.selectionRange).toBeUndefined();
			expect(field.name).toBe('running');
			expect(field.memberFqn).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns empty members array when documentSymbol returns null', async () => {
		mockDocumentSymbol.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
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
