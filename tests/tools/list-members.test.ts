import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';

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


describe.skipIf(!toolModuleAvailable)('list_members', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
	});

	test('returns error when JDT LS not available', async () => {
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

	test('returns error when class not found in jar', async () => {
		mockReadEntry.mockRejectedValue(new Error('Entry not found'));

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
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

	test('returns tree of members from DocumentSymbol response', async () => {
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
					jar: 'testmod/minecraft',
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

	test('enriched method members have memberFqn, parameters, returnType with details flag', async () => {
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
					jar: 'testmod/minecraft',
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

	test('enriched field members have memberFqn and fieldType with details flag', async () => {
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
					jar: 'testmod/minecraft',
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

	test('enriched class container has no memberFqn, children are enriched', async () => {
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
					jar: 'testmod/minecraft',
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

	test('enriched constructor has memberFqn with class simple name and () with details flag', async () => {
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
					jar: 'testmod/minecraft',
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

	test('maps SymbolKind numeric to human-readable string', async () => {
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
					jar: 'testmod/minecraft',
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

	test('returns compact results by default (no detail fields)', async () => {
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
					jar: 'testmod/minecraft',
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

	test('compact output includes fqn on class-kind symbols including inner classes', async () => {
		const INNER_CLASS_SOURCE = `package net.minecraft.client;

public class MinecraftClient {
	public static class Options {
		private int width;
	}
}
`;
		mockReadEntry.mockResolvedValue(Buffer.from(INNER_CLASS_SOURCE));
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 6, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				children: [
					{
						name: 'Options',
						kind: 5, // class
						detail: '',
						range: { start: { line: 3, character: 1 }, end: { line: 5, character: 2 } },
						selectionRange: { start: { line: 3, character: 22 }, end: { line: 3, character: 29 } },
						children: [
							{
								name: 'width',
								kind: 8, // field
								detail: 'int',
								range: { start: { line: 4, character: 2 }, end: { line: 4, character: 19 } },
								selectionRange: { start: { line: 4, character: 14 }, end: { line: 4, character: 19 } },
							},
						],
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
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);

			const outerClass = envelope.data.members[0];
			expect(outerClass.name).toBe('MinecraftClient');
			expect(outerClass.fqn).toBe('net.minecraft.client.MinecraftClient');

			const innerClass = outerClass.children[0];
			expect(innerClass.name).toBe('Options');
			expect(innerClass.fqn).toBe('net.minecraft.client.MinecraftClient$Options');

			// Inner class's child (field) should NOT have fqn
			const field = innerClass.children[0];
			expect(field.fqn).toBeUndefined();
			expect(field.memberFqn).toBeDefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns empty members array when documentSymbol returns null', async () => {
		mockDocumentSymbol.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'list_members',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
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

	// REGRESSION: content body bug (2026-05-26) — list_members must render
	// the member tree in content[] as a body block.
	test('REGRESSION: content body renders the member tree', async () => {
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
						name: 'running',
						kind: 8,
						detail: 'boolean',
						range: { start: { line: 3, character: 1 }, end: { line: 3, character: 25 } },
						selectionRange: { start: { line: 3, character: 17 }, end: { line: 3, character: 24 } },
					},
					{
						name: 'run()',
						kind: 6,
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
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const r = result as any;
			expect(r.content.length).toBeGreaterThanOrEqual(2);
			expect(r.content[0].text).toMatch(/^Found \d+ member/);
			const bodyText = r.content.slice(1).map((c: any) => c.text).join('\n');
			expect(bodyText).toContain('MinecraftClient');
			expect(bodyText).toContain('running');
			expect(bodyText).toContain('run()');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	// REGRESSION: list-members-only-two (2026-05-26) — JDT LS returns Java
	// files with a hierarchical outline whose top level is `[Package, Class]`
	// (the package declaration is a top-level DocumentSymbol of kind=4).
	// list_members must (a) drop the package symbol from the structured payload
	// and the rendered body, and (b) report the count of CLASS BODY members
	// in the summary — NOT the raw count of LSP top-level entries. Pre-fix,
	// users on lifesteal saw "Found 2 top-level members" for classes with
	// 100+ methods (ServerPlayer, StoredUserEntry, StoredUserList) because
	// the count reflected `[Package, Class]` and not the actual member set.
	test('REGRESSION: drops top-level package symbol and counts class-body members', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/server/players/StoredUserEntry.java']);
		mockReadEntry.mockResolvedValue(Buffer.from(`package net.minecraft.server.players;

public abstract class StoredUserEntry<T> {
	private final T user;

	public StoredUserEntry(T user) { this.user = user; }
	public T getUser() { return this.user; }
	public boolean hasExpired() { return false; }
	protected abstract void serialize(Object o);
}
`));
		// Mirror the actual live JDT LS reply shape for StoredUserEntry.java,
		// captured via scripts/diagnose-list-members.ts (see debug session
		// list-members-only-two evidence-1).
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'net.minecraft.server.players',
				kind: 4, // package
				detail: '',
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 37 } },
				selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 37 } },
			},
			{
				name: 'StoredUserEntry<T>',
				kind: 5, // class
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 9, character: 1 } },
				selectionRange: { start: { line: 2, character: 22 }, end: { line: 2, character: 37 } },
				children: [
					{
						name: 'user',
						kind: 8, // field
						detail: '',
						range: { start: { line: 3, character: 1 }, end: { line: 3, character: 22 } },
						selectionRange: { start: { line: 3, character: 17 }, end: { line: 3, character: 21 } },
					},
					{
						name: 'StoredUserEntry(T)',
						kind: 9, // constructor
						detail: '',
						range: { start: { line: 5, character: 1 }, end: { line: 5, character: 50 } },
						selectionRange: { start: { line: 5, character: 8 }, end: { line: 5, character: 23 } },
					},
					{
						name: 'getUser()',
						kind: 6, // method
						detail: ' : T',
						range: { start: { line: 6, character: 1 }, end: { line: 6, character: 40 } },
						selectionRange: { start: { line: 6, character: 10 }, end: { line: 6, character: 17 } },
					},
					{
						name: 'hasExpired()',
						kind: 6, // method
						detail: ' : boolean',
						range: { start: { line: 7, character: 1 }, end: { line: 7, character: 45 } },
						selectionRange: { start: { line: 7, character: 16 }, end: { line: 7, character: 26 } },
					},
					{
						name: 'serialize(Object)',
						kind: 6, // method
						detail: ' : void',
						range: { start: { line: 8, character: 1 }, end: { line: 8, character: 50 } },
						selectionRange: { start: { line: 8, character: 25 }, end: { line: 8, character: 34 } },
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
					jar: 'testmod/minecraft',
					class: 'net.minecraft.server.players.StoredUserEntry',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);

			// Structured payload: only the class, package symbol is filtered.
			expect(envelope.data.members).toHaveLength(1);
			const cls = envelope.data.members[0];
			expect(cls.kind).toBe('class');
			expect(cls.name).toBe('StoredUserEntry<T>');
			expect(cls.children).toHaveLength(5);

			// Summary: counts the 5 class-body members, NOT the raw 2 LSP top
			// level entries.
			const r = result as any;
			expect(r.content[0].text).toMatch(/^Found 5 members in /);

			// Body block: renders the class and its children — and does NOT
			// include the dropped package symbol.
			const bodyText = r.content.slice(1).map((c: any) => c.text).join('\n');
			expect(bodyText).toContain('StoredUserEntry');
			expect(bodyText).toContain('getUser()');
			expect(bodyText).toContain('hasExpired()');
			expect(bodyText).toContain('serialize');
			// The package symbol's name is the dotted package path — it must
			// NOT appear as a rendered top-level entry.
			expect(bodyText).not.toMatch(/^1\. package net\.minecraft/);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	// REGRESSION: type rendering (2026-05-26) — TypeReference is a tagged
	// union (kind/name/elementType/rawType), not an object with a `display`
	// field. The renderer used to cast it to `{ display: string }` and read
	// `.display`, producing lines like `LOGGER: undefined` for every field
	// and method. The rendered body must format types via the union shape.
	test('REGRESSION: rendered body formats TypeReference union, no "undefined"', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/server/level/ServerPlayer.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'ServerPlayer',
				kind: 5,
				detail: '',
				range: { start: { line: 2, character: 0 }, end: { line: 20, character: 1 } },
				selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 25 } },
				children: [
					{
						name: 'LOGGER',
						kind: 14, // constant
						detail: 'Logger',
						range: { start: { line: 3, character: 1 }, end: { line: 3, character: 30 } },
						selectionRange: { start: { line: 3, character: 20 }, end: { line: 3, character: 26 } },
					},
					{
						name: 'tick()',
						kind: 6, // method
						detail: ' : void',
						range: { start: { line: 5, character: 1 }, end: { line: 7, character: 2 } },
						selectionRange: { start: { line: 5, character: 14 }, end: { line: 5, character: 18 } },
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
					jar: 'testmod/minecraft',
					class: 'net.minecraft.server.level.ServerPlayer',
					details: { signatures: true },
				},
			});

			const r = result as any;
			const bodyText = r.content.slice(1).map((c: any) => c.text).join('\n');
			// Most important: no literal "undefined" anywhere in the body.
			expect(bodyText).not.toContain('undefined');
			// Field renders with its resolved type, not `: undefined`.
			expect(bodyText).toMatch(/LOGGER: Logger/);
			// Method return type renders as `: void`, not `: undefined`.
			expect(bodyText).toMatch(/tick.*: void/);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
