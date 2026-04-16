import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject, makeJdtlsSession } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';

const toolModuleAvailable = await import('../../src/tools/type-hierarchy.js').then(() => true).catch(() => false);

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

public class MinecraftClient extends Thread implements Runnable {
	private boolean running;

	public void run() {
		this.running = true;
	}
}
`;

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

describe.skipIf(!toolModuleAvailable)('type_hierarchy', () => {
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
				name: 'type_hierarchy',
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

	test('returns error when class not found', async () => {
		mockReadEntry.mockRejectedValue(new Error('Entry not found'));

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'type_hierarchy',
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

	test('returns supertype chain with extends and implements separated', async () => {
		// prepareTypeHierarchy returns the target class
		mockEndpointSend.mockImplementation(async (method: string, params: any) => {
			if (method === 'textDocument/prepareTypeHierarchy') {
				return [{
					name: 'MinecraftClient',
					kind: 5, // class
					detail: 'net.minecraft.client',
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 2, character: 0 }, end: { line: 8, character: 1 } },
					selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
					data: { someOpaque: 'data' },
				}];
			}
			if (method === 'typeHierarchy/supertypes') {
				// First call: MinecraftClient supers -> Thread (class) + Runnable (interface)
				if (params.item.name === 'MinecraftClient') {
					return [
						{
							name: 'Thread',
							kind: 5,
							detail: 'java.lang',
							uri: 'jdt://contents/java.base/java.lang/Thread.class',
							range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							data: { thread: true },
						},
						{
							name: 'Runnable',
							kind: 11, // interface
							detail: 'java.lang',
							uri: 'jdt://contents/java.base/java.lang/Runnable.class',
							range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							data: { runnable: true },
						},
					];
				}
				// Second call: Thread supers -> Object
				if (params.item.name === 'Thread') {
					return [
						{
							name: 'Object',
							kind: 5,
							detail: 'java.lang',
							uri: 'jdt://contents/java.base/java.lang/Object.class',
							range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						},
					];
				}
				// Object has no supers
				return [];
			}
			if (method === 'typeHierarchy/subtypes') {
				return [];
			}
			return null;
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'type_hierarchy',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);

			// extends chain: Thread, Object
			expect(envelope.data.extends).toHaveLength(2);
			expect(envelope.data.extends[0].name).toBe('Thread');
			expect(envelope.data.extends[0].fqn).toBe('java.lang.Thread');
			// JDK types use jdt:// URIs which don't map to known jars
			expect(envelope.data.extends[0].jar).toBeUndefined();
			expect(envelope.data.extends[1].name).toBe('Object');

			// implements: Runnable
			expect(envelope.data.implements).toHaveLength(1);
			expect(envelope.data.implements[0].name).toBe('Runnable');
			expect(envelope.data.implements[0].fqn).toBe('java.lang.Runnable');
			expect(envelope.data.implements[0].kind).toBe('interface');
			// JDK types use jdt:// URIs which don't map to known jars
			expect(envelope.data.implements[0].jar).toBeUndefined();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns subtypes list from prepareTypeHierarchy + subtypes', async () => {
		mockEndpointSend.mockImplementation(async (method: string, params: any) => {
			if (method === 'textDocument/prepareTypeHierarchy') {
				return [{
					name: 'MinecraftClient',
					kind: 5,
					detail: 'net.minecraft.client',
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 2, character: 0 }, end: { line: 8, character: 1 } },
					selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				}];
			}
			if (method === 'typeHierarchy/supertypes') {
				return [];
			}
			if (method === 'typeHierarchy/subtypes') {
				return [
					{
						name: 'TestClient',
						kind: 5,
						detail: 'net.minecraft.client',
						uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/TestClient.java',
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					},
				];
			}
			return null;
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'type_hierarchy',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					depth: 1,
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.subtypes).toHaveLength(1);
			expect(envelope.data.subtypes[0].name).toBe('TestClient');
			expect(envelope.data.subtypes[0].fqn).toBe('net.minecraft.client.TestClient');
			// URI maps to tempDir/minecraft/ which is in jarIdToDirName
			expect(envelope.data.subtypes[0].jar).toBe('testmod/minecraft');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('JDK types produce entries with java provenance', async () => {
		mockEndpointSend.mockImplementation(async (method: string, params: any) => {
			if (method === 'textDocument/prepareTypeHierarchy') {
				return [{
					name: 'MinecraftClient',
					kind: 5,
					detail: 'net.minecraft.client',
					uri: 'file:///tmp/test-jdtls/minecraft/net/minecraft/client/MinecraftClient.java',
					range: { start: { line: 2, character: 0 }, end: { line: 8, character: 1 } },
					selectionRange: { start: { line: 2, character: 13 }, end: { line: 2, character: 28 } },
				}];
			}
			if (method === 'typeHierarchy/supertypes') {
				// Only return Object for MinecraftClient, not for Object itself
				if (params.item.name === 'MinecraftClient') {
					return [
						{
							name: 'Object',
							kind: 5,
							detail: 'java.lang',
							uri: 'jdt://contents/java.base/java.lang/Object.class',
							range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
							selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						},
					];
				}
				return []; // Object has no supertypes
			}
			if (method === 'typeHierarchy/subtypes') {
				return [];
			}
			return null;
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'type_hierarchy',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.extends[0].kind).toBe('class');
			expect(envelope.data.extends[0].fqn).toBe('java.lang.Object');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('terminates on circular supertype hierarchy without infinite loop', async () => {
		// A extends B, B extends A — cycle
		mockEndpointSend.mockImplementation(async (method: string, params: any) => {
			if (method === 'textDocument/prepareTypeHierarchy') {
				return [{
					name: 'ClassA',
					kind: 5,
					detail: 'com.example',
					uri: 'file:///tmp/test-jdtls/minecraft/com/example/ClassA.java',
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				}];
			}
			if (method === 'typeHierarchy/supertypes') {
				if (params.item.name === 'ClassA') {
					return [{
						name: 'ClassB',
						kind: 5,
						detail: 'com.example',
						uri: 'file:///tmp/test-jdtls/minecraft/com/example/ClassB.java',
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					}];
				}
				if (params.item.name === 'ClassB') {
					return [{
						name: 'ClassA',
						kind: 5,
						detail: 'com.example',
						uri: 'file:///tmp/test-jdtls/minecraft/com/example/ClassA.java',
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					}];
				}
				return [];
			}
			if (method === 'typeHierarchy/subtypes') return [];
			return null;
		});

		mockReadEntry.mockResolvedValue(Buffer.from(`package com.example;\npublic class ClassA extends ClassB {}\n`));

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'type_hierarchy',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'com.example.ClassA',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			// Should have collected ClassB before hitting cycle
			expect(envelope.data.extends).toHaveLength(1);
			expect(envelope.data.extends[0].fqn).toBe('com.example.ClassB');
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test('returns empty hierarchy when prepareTypeHierarchy returns null', async () => {
		mockEndpointSend.mockImplementation(async (method: string) => {
			if (method === 'textDocument/prepareTypeHierarchy') {
				return null;
			}
			return null;
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession(makeMockClient(), { endpoint: { send: mockEndpointSend } as any }) });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'type_hierarchy',
				arguments: {
					project: 'test',
					jar: 'testmod/minecraft',
					class: 'net.minecraft.client.MinecraftClient',
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.extends).toHaveLength(0);
			expect(envelope.data.implements).toHaveLength(0);
			expect(envelope.data.subtypes).toHaveLength(0);
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});
});
