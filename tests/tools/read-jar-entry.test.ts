import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { parseEnvelope, makeFakeProject } from '../helpers/factories.js';
import { projectStore } from '../../src/state/project-store.js';

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
		readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
	};
});

const FAKE_SOURCE = `package net.minecraft.client;

public class MinecraftClient {
    public void run() { }
}
`;

describe('read_jar_entry tool', () => {
	let pair: TestPair;

	beforeEach(async () => {
		projectStore.clear();
		mockListEntries.mockReset();
		mockReadEntry.mockReset();

		mockListEntries.mockResolvedValue([]);
		mockReadEntry.mockImplementation(async (jarPath: string, entryPath: string) => {
			if (entryPath === 'net/minecraft/client/MinecraftClient.java') {
				return Buffer.from(FAKE_SOURCE, 'utf-8');
			}
			throw new Error(`Entry not found: ${entryPath}`);
		});

		pair = await createTestPair();
	});

	afterEach(async () => {
		await pair.cleanup();
		projectStore.clear();
	});

	it('reads a source jar entry by path and returns content in envelope', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_jar_entry',
			arguments: {
				project: 'test',
				jar: 'testmod/minecraft',
				path: 'net/minecraft/client/MinecraftClient.java',
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(true);
		expect(envelope.data.content).toContain('public class MinecraftClient');
		expect(envelope.data.source).toBe('sources');
		expect(envelope.data.entryPath).toBe('net/minecraft/client/MinecraftClient.java');
	});

	it('returns JAR_NOT_FOUND for unknown jar id', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_jar_entry',
			arguments: {
				project: 'test',
				jar: 'no-such-jar',
				path: 'foo/Bar.java',
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('JAR_NOT_FOUND');
	});

	it('returns JAR_ENTRY_NOT_FOUND when path missing from jar', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_jar_entry',
			arguments: {
				project: 'test',
				jar: 'testmod/minecraft',
				path: 'does/not/Exist.java',
			},
		});

		const envelope = parseEnvelope(result);
		expect(envelope.success).toBe(false);
		expect(envelope.error.code).toBe('JAR_ENTRY_NOT_FOUND');
	});

	// --- Regression tests for empty-body bug (2026-05-26) ---
	// See .planning/debug/resolved/read-source-empty-body.md.
	// Asserts on result.content[*].text to ensure the file body is actually
	// rendered into the text-content blocks, not just into structuredContent.

	it('REGRESSION: response content includes the file body, not just a header', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_jar_entry',
			arguments: {
				project: 'test',
				jar: 'testmod/minecraft',
				path: 'net/minecraft/client/MinecraftClient.java',
			},
		});

		const r = result as any;
		expect(Array.isArray(r.content)).toBe(true);
		expect(r.content.length).toBeGreaterThanOrEqual(2);
		expect(r.content[0].text).toMatch(/^Read .* from .* \(\d+ bytes\)/);
		const bodyText = r.content.slice(1).map((c: any) => c.text).join('\n');
		expect(bodyText).toContain('public class MinecraftClient');
		expect(bodyText).toContain('public void run()');
	});

	it('REGRESSION: error responses still emit just an error message in content', async () => {
		const fake = makeFakeProject();
		projectStore.set('test', fake);

		const result = await pair.client.callTool({
			name: 'read_jar_entry',
			arguments: {
				project: 'test',
				jar: 'testmod/minecraft',
				path: 'does/not/Exist.java',
			},
		});

		const r = result as any;
		expect(r.content.length).toBe(1);
		expect(r.content[0].text).toMatch(/Error \[JAR_ENTRY_NOT_FOUND\]/);
	});
});
