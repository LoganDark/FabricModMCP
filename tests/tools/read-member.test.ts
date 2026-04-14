import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject } from '../../src/project/types.js';

const toolModuleAvailable = await import('../../src/tools/read-member.js').then(() => true).catch(() => false);

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

/**
 * Called every tick.
 */
public void tick() {
    this.doStuff();
}

public int count;
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


describe('read_member', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		projectStore.clear();
		mockReadEntry.mockResolvedValue(Buffer.from(FAKE_SOURCE));
	});

	test.skipIf(!toolModuleAvailable)('returns INVALID_FQN for malformed FQN (no #)', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					memberFqn: 'invalid-no-hash',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
			expect(envelope.error.code).toBe('INVALID_FQN');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns INVALID_FQN for malformed FQN (no () or : suffix)', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					memberFqn: 'Class#noSuffix',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
			expect(envelope.error.code).toBe('INVALID_FQN');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns JDTLS_NOT_AVAILABLE when JDT LS not initialized', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject(); // no jdtls
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					memberFqn: 'net.minecraft.client.MinecraftClient#tick()',
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

	test.skipIf(!toolModuleAvailable)('returns CLASS_NOT_FOUND when class not in jar', async () => {
		mockReadEntry.mockRejectedValue(new Error('Entry not found'));

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					memberFqn: 'net.minecraft.client.DoesNotExist#tick()',
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

	test.skipIf(!toolModuleAvailable)('returns method source with Javadoc for valid method FQN', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
				selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 28 } },
				children: [
					{
						name: 'tick()',
						kind: 6, // method
						detail: 'void',
						// 0-based: line 5 = "public void tick() {"
						range: { start: { line: 5, character: 0 }, end: { line: 7, character: 1 } },
						selectionRange: { start: { line: 5, character: 12 }, end: { line: 5, character: 16 } },
					},
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					memberFqn: 'net.minecraft.client.MinecraftClient#tick()',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.members).toHaveLength(1);

			const member = envelope.data.members[0];
			expect(member.memberFqn).toBe('net.minecraft.client.MinecraftClient#tick()');
			expect(member.kind).toBe('method');
			expect(member.source).toContain('/**');
			expect(member.source).toContain('Called every tick.');
			expect(member.source).toContain('public void tick()');
			expect(member.jar).toBe('minecraft');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns field source for valid field FQN', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
				selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 28 } },
				children: [
					{
						name: 'count',
						kind: 8, // field
						detail: 'int',
						// 0-based: line 9 = "public int count;"
						range: { start: { line: 9, character: 0 }, end: { line: 9, character: 17 } },
						selectionRange: { start: { line: 9, character: 11 }, end: { line: 9, character: 16 } },
					},
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					memberFqn: 'net.minecraft.client.MinecraftClient#count:',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.members).toHaveLength(1);

			const member = envelope.data.members[0];
			expect(member.memberFqn).toBe('net.minecraft.client.MinecraftClient#count:');
			expect(member.kind).toBe('field');
			expect(member.source).toContain('public int count;');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns MEMBER_NOT_FOUND when member does not exist in class', async () => {
		mockListEntries.mockResolvedValue(['net/minecraft/client/MinecraftClient.java']);
		mockDocumentSymbol.mockResolvedValue([
			{
				name: 'MinecraftClient',
				kind: 5, // class
				detail: '',
				range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
				selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 28 } },
				children: [
					{
						name: 'tick()',
						kind: 6, // method
						detail: 'void',
						range: { start: { line: 5, character: 0 }, end: { line: 7, character: 1 } },
						selectionRange: { start: { line: 5, character: 12 }, end: { line: 5, character: 16 } },
					},
				],
			},
		]);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient()) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'read_member',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					memberFqn: 'net.minecraft.client.MinecraftClient#nonexistent()',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(false);
			expect(envelope.error.code).toBe('MEMBER_NOT_FOUND');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
