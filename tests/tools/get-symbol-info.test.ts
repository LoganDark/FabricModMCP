import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createTestPair, type TestPair } from '../helpers/client.js';
import { projectStore } from '../../src/state/project-store.js';
import type { LoadedProject, DependencyEntry } from '../../src/project/types.js';
import type { JdtLsSession } from '../../src/jdtls/types.js';

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

function parseEnvelope(result: Awaited<ReturnType<TestPair['client']['callTool']>>): any {
	return (result as any).structuredContent;
}

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

describe('get_symbol_info', () => {
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
				name: 'get_symbol_info',
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

	test.skipIf(!toolModuleAvailable)('returns markdown hover content for a valid symbol', async () => {
		mockHover.mockResolvedValue({
			contents: {
				kind: 'markdown',
				value: '```java\npublic void run()\n```\nRuns the client.',
			},
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'minecraft',
					class: 'net.minecraft.client.MinecraftClient',
					patterns: ['public void run\\('],
				},
			});

			const envelope = parseEnvelope(result);
			expect(envelope.success).toBe(true);
			expect(envelope.data.hover).toContain('public void run()');
			expect(envelope.data).toHaveProperty('javadoc');
			expect(envelope.data.position).toBeDefined();
			expect(envelope.data.position.jar).toBe('minecraft');

			expect(mockDidOpen).toHaveBeenCalledOnce();
			expect(mockDidClose).toHaveBeenCalledOnce();
		} finally {
			await pair.cleanup();
			projectStore.clear();
		}
	});

	test.skipIf(!toolModuleAvailable)('returns all hover results when multiple are returned', async () => {
		mockHover.mockResolvedValue({
			contents: [
				{ language: 'java', value: 'public void run()' },
				'Runs the client main loop.',
			],
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'minecraft',
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

	test.skipIf(!toolModuleAvailable)('returns empty result when hover lands on import declaration', async () => {
		mockHover.mockResolvedValue({
			contents: {
				kind: 'markdown',
				value: 'import net.minecraft.util.Identifier',
			},
		});

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'minecraft',
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

	test.skipIf(!toolModuleAvailable)('returns cascade failure when patterns do not match', async () => {
		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
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

	test.skipIf(!toolModuleAvailable)('returns null hover when LSP returns null', async () => {
		mockHover.mockResolvedValue(null);

		const pair = await createTestPair();
		try {
			const fake = makeFakeProject({ jdtls: makeJdtlsSession() });
			projectStore.set('test', fake);

			const result = await pair.client.callTool({
				name: 'get_symbol_info',
				arguments: {
					project: 'test',
					jar: 'minecraft',
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
