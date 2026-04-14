import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchClasses } from '../../src/browsing/search.js';
import type { DependencyEntry, JarCategory } from '../../src/project/types.js';
import type { JarReader } from '../../src/project/jar-reader.js';
import { filterDependenciesByJarPattern } from '../../src/tools/tool-helpers.js';

// Helper to create a mock DependencyEntry
function makeDep(overrides: Partial<DependencyEntry> & { id: string; category: JarCategory }): DependencyEntry {
	return {
		group: '',
		artifact: '',
		version: '1.0',
		sourcesJarPath: `/fake/${overrides.id}.jar`,
		available: true,
		provenanceChains: [],
		...overrides,
	};
}

// Mock jar data: jar ID -> list of Java entry paths
const jarEntries: Record<string, string[]> = {
	'minecraft': [
		'net/minecraft/client/MinecraftClient.java',
		'net/minecraft/client/MinecraftClient$Options.java',
		'net/minecraft/client/MinecraftClient$1.java',
		'net/minecraft/client/gui/Screen.java',
		'net/minecraft/server/MinecraftServer.java',
		'net/minecraft/Bootstrap.java',
	],
	'fabric-api:fabric-networking': [
		'net/fabricmc/fabric/api/networking/NetworkHandler.java',
	],
	'some-lib': [
		'com/example/util/StringUtils.java',
		'com/example/util/MathHelper.java',
	],
};

// Mock source content for parseClassDeclaration
const sourceContent: Record<string, string> = {
	'net/minecraft/client/MinecraftClient.java': 'public class MinecraftClient {',
	'net/minecraft/client/MinecraftClient$Options.java': 'public class MinecraftClient$Options {',
	'net/minecraft/client/gui/Screen.java': 'public abstract class Screen {',
	'net/minecraft/server/MinecraftServer.java': 'public class MinecraftServer {',
	'net/minecraft/Bootstrap.java': 'public class Bootstrap {',
	'net/fabricmc/fabric/api/networking/NetworkHandler.java': 'public interface NetworkHandler {',
	'com/example/util/StringUtils.java': 'public final class StringUtils {',
	'com/example/util/MathHelper.java': 'public class MathHelper {',
};

// Create a mock JarReader that returns canned data
function createMockJarReader(): JarReader {
	return {
		listEntries: vi.fn(async (jarPath: string) => {
			// Reverse-lookup: find which dep has this jarPath
			for (const [id, entries] of Object.entries(jarEntries)) {
				if (jarPath === `/fake/${id}.jar`) {
					return entries;
				}
			}
			return [];
		}),
		readEntry: vi.fn(async (jarPath: string, entryPath: string) => {
			const content = sourceContent[entryPath];
			if (content) {
				return Buffer.from(content);
			}
			throw new Error(`Entry not found: ${entryPath}`);
		}),
	} as unknown as JarReader;
}

// Standard dependencies map
function createDeps(): Map<string, DependencyEntry> {
	const deps = new Map<string, DependencyEntry>();
	deps.set('minecraft', makeDep({ id: 'minecraft', category: 'minecraft' }));
	deps.set('fabric-api:fabric-networking', makeDep({ id: 'fabric-api:fabric-networking', category: 'fabric-api' }));
	deps.set('some-lib', makeDep({ id: 'some-lib', category: 'library' }));
	return deps;
}


describe('searchClasses', () => {
	let mockJarReader: JarReader;
	let deps: Map<string, DependencyEntry>;

	beforeEach(() => {
		mockJarReader = createMockJarReader();
		deps = createDeps();
	});

	describe('pattern matching', () => {
		it('*Client matches class name but not FQN with dots', async () => {
			const result = await searchClasses(
				{ pattern: '*Client' },
				deps, '/fake/root', mockJarReader,
			);
			// *Client should match MinecraftClient (single segment, no dots)
			expect(result.results.map(r => r.fqn)).toContain('net.minecraft.client.MinecraftClient');
		});

		it('**.*Client matches FQN with any number of package segments', async () => {
			const result = await searchClasses(
				{ pattern: '**.*Client' },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results.map(r => r.fqn)).toContain('net.minecraft.client.MinecraftClient');
		});

		it('net.minecraft.client.* matches classes directly in that package', async () => {
			const result = await searchClasses(
				{ pattern: 'net.minecraft.client.*' },
				deps, '/fake/root', mockJarReader,
			);
			const fqns = result.results.map(r => r.fqn);
			expect(fqns).toContain('net.minecraft.client.MinecraftClient');
			// Screen is in net.minecraft.client.gui, not net.minecraft.client
			expect(fqns).not.toContain('net.minecraft.client.gui.Screen');
		});

		it('net.minecraft.** matches classes in any sub-package', async () => {
			const result = await searchClasses(
				{ pattern: 'net.minecraft.**' },
				deps, '/fake/root', mockJarReader,
			);
			const fqns = result.results.map(r => r.fqn);
			expect(fqns).toContain('net.minecraft.client.MinecraftClient');
			expect(fqns).toContain('net.minecraft.client.gui.Screen');
			expect(fqns).toContain('net.minecraft.server.MinecraftServer');
			expect(fqns).toContain('net.minecraft.Bootstrap');
		});

		it('*$Options matches inner classes', async () => {
			const result = await searchClasses(
				{ pattern: '*$Options' },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results.map(r => r.fqn)).toContain('net.minecraft.client.MinecraftClient$Options');
		});
	});

	describe('case sensitivity', () => {
		it('case-insensitive by default: *client matches MinecraftClient', async () => {
			const result = await searchClasses(
				{ pattern: '*client' },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results.map(r => r.fqn)).toContain('net.minecraft.client.MinecraftClient');
		});

		it('case-sensitive when caseSensitive=true: *client does NOT match MinecraftClient', async () => {
			const result = await searchClasses(
				{ pattern: '*client', caseSensitive: true },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results.map(r => r.fqn)).not.toContain('net.minecraft.client.MinecraftClient');
		});
	});

	describe('kind filtering', () => {
		it('returns all types when kind is omitted', async () => {
			const result = await searchClasses(
				{ pattern: '**' },
				deps, '/fake/root', mockJarReader,
			);
			const types = result.results.map(r => r.kind);
			expect(types).toContain('class');
			expect(types).toContain('interface');
		});

		it('filters to only interfaces when kind=["interface"]', async () => {
			const result = await searchClasses(
				{ pattern: '**', kind: ['interface'] },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results.every(r => r.kind === 'interface')).toBe(true);
			expect(result.results.length).toBeGreaterThan(0);
		});

		it('filters to classes and enums when kind=["class", "enum"]', async () => {
			const result = await searchClasses(
				{ pattern: '**', kind: ['class', 'enum'] },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results.every(r => r.kind === 'class' || r.kind === 'enum')).toBe(true);
		});
	});

	describe('deduplication', () => {
		it('same class in multiple jars produces one result with multiple jar entries', async () => {
			// Add a second jar that has the same class
			const dupJarId = 'dup-lib';
			deps.set(dupJarId, makeDep({ id: dupJarId, category: 'library' }));
			jarEntries[dupJarId] = [
				'net/minecraft/Bootstrap.java',
			];
			sourceContent['net/minecraft/Bootstrap.java'] = 'public class Bootstrap {';

			// Also make the mock reader aware of this jar
			(mockJarReader.listEntries as any).mockImplementation(async (jarPath: string) => {
				for (const [id, entries] of Object.entries(jarEntries)) {
					if (jarPath === `/fake/${id}.jar`) return entries;
				}
				return [];
			});

			const result = await searchClasses(
				{ pattern: '**.Bootstrap' },
				deps, '/fake/root', mockJarReader,
			);

			const bootstrap = result.results.find(r => r.fqn === 'net.minecraft.Bootstrap');
			expect(bootstrap).toBeDefined();
			expect(bootstrap!.jars.length).toBeGreaterThanOrEqual(2);

			// Clean up
			delete jarEntries[dupJarId];
		});
	});

	describe('sorting', () => {
		it('sorts by jar priority (minecraft before library) then alphabetically', async () => {
			const result = await searchClasses(
				{ pattern: '**' },
				deps, '/fake/root', mockJarReader,
			);

			// Minecraft classes should come before library classes
			const mcIdx = result.results.findIndex(r => r.fqn === 'net.minecraft.Bootstrap');
			const libIdx = result.results.findIndex(r => r.fqn === 'com.example.util.MathHelper');
			expect(mcIdx).toBeLessThan(libIdx);
		});
	});

	describe('pagination', () => {
		it('defaults to offset=0, limit=250', async () => {
			const result = await searchClasses(
				{ pattern: '**' },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.offset).toBe(0);
			expect(result.limit).toBe(250);
		});

		it('total reflects count after kind filtering', async () => {
			const allResult = await searchClasses(
				{ pattern: '**' },
				deps, '/fake/root', mockJarReader,
			);
			const interfaceResult = await searchClasses(
				{ pattern: '**', kind: ['interface'] },
				deps, '/fake/root', mockJarReader,
			);
			expect(interfaceResult.total).toBeLessThan(allResult.total);
		});

		it('respects offset and limit', async () => {
			const all = await searchClasses(
				{ pattern: '**' },
				deps, '/fake/root', mockJarReader,
			);
			const page = await searchClasses(
				{ pattern: '**', offset: 1, limit: 2 },
				deps, '/fake/root', mockJarReader,
			);
			expect(page.results.length).toBe(2);
			expect(page.total).toBe(all.total);
			expect(page.offset).toBe(1);
			expect(page.limit).toBe(2);
			expect(page.results[0].fqn).toBe(all.results[1].fqn);
		});

		it('offset past end returns empty results with correct total', async () => {
			const result = await searchClasses(
				{ pattern: '**', offset: 9999 },
				deps, '/fake/root', mockJarReader,
			);
			expect(result.results).toEqual([]);
			expect(result.total).toBeGreaterThan(0);
		});
	});

	describe('jar scoping (pre-filtered deps)', () => {
		it('pre-filtered deps limits which jars to search', async () => {
			const scoped = filterDependenciesByJarPattern(deps, ['minecraft']);
			const result = await searchClasses(
				{ pattern: '**' },
				scoped, '/fake/root', mockJarReader,
			);
			// Should only have classes from the minecraft jar
			expect(result.results.every(r => r.jars.some(j => j.id === 'minecraft'))).toBe(true);
			// Should not have library classes
			expect(result.results.map(r => r.fqn)).not.toContain('com.example.util.StringUtils');
		});

		it('pre-filtered deps supports glob patterns', async () => {
			const scoped = filterDependenciesByJarPattern(deps, ['fabric-api:*']);
			const result = await searchClasses(
				{ pattern: '**' },
				scoped, '/fake/root', mockJarReader,
			);
			expect(result.results.map(r => r.fqn)).toContain('net.fabricmc.fabric.api.networking.NetworkHandler');
			expect(result.results.map(r => r.fqn)).not.toContain('net.minecraft.client.MinecraftClient');
		});
	});
});
