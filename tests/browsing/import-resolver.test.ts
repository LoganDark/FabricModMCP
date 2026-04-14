import { describe, it, expect, vi } from 'vitest';
import { extractImports, createTypeResolver } from '../../src/browsing/import-resolver.js';

describe('extractImports', () => {
	it('parses explicit import', () => {
		const result = extractImports('import net.minecraft.util.math.BlockPos;');
		expect(result.explicitImports.get('BlockPos')).toBe('net.minecraft.util.math.BlockPos');
	});

	it('parses star import', () => {
		const result = extractImports('import net.minecraft.block.*;');
		expect(result.starPackages).toContain('net.minecraft.block');
	});

	it('ignores static imports', () => {
		const result = extractImports('import static net.minecraft.block.Blocks.STONE;');
		expect(result.explicitImports.size).toBe(0);
		expect(result.starPackages).toHaveLength(0);
	});

	it('extracts package declaration', () => {
		const result = extractImports('package net.minecraft.client;');
		expect(result.currentPackage).toBe('net.minecraft.client');
	});

	it('handles source with no imports', () => {
		const result = extractImports('public class Foo {}');
		expect(result.explicitImports.size).toBe(0);
		expect(result.starPackages).toHaveLength(0);
		expect(result.currentPackage).toBeNull();
	});

	it('parses multiple imports together', () => {
		const source = `package net.minecraft.client;

import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.block.*;
import static net.minecraft.block.Blocks.STONE;

public class Test {}`;
		const result = extractImports(source);
		expect(result.currentPackage).toBe('net.minecraft.client');
		expect(result.explicitImports.get('BlockPos')).toBe('net.minecraft.util.math.BlockPos');
		expect(result.explicitImports.get('Vec3d')).toBe('net.minecraft.util.math.Vec3d');
		expect(result.starPackages).toEqual(['net.minecraft.block']);
		// static import should NOT be in explicitImports
		expect(result.explicitImports.has('STONE')).toBe(false);
	});
});

describe('createTypeResolver', () => {
	const noopResolve = async (_pkg: string): Promise<string[]> => [];

	it('resolves explicit import to ClassType', async () => {
		const imports = extractImports('import net.minecraft.util.math.BlockPos;');
		const resolve = createTypeResolver(imports, noopResolve);
		const result = await resolve('BlockPos');
		expect(result).toEqual({ kind: 'class', name: 'BlockPos', fqn: 'net.minecraft.util.math.BlockPos' });
	});

	it('resolves star import via resolvePackage callback', async () => {
		const imports = extractImports('import net.minecraft.block.*;');
		const resolvePackage = vi.fn(async (_pkg: string) => ['Block', 'BlockState', 'Blocks']);
		const resolve = createTypeResolver(imports, resolvePackage);
		const result = await resolve('Block');
		expect(result).toEqual({ kind: 'class', name: 'Block', fqn: 'net.minecraft.block.Block' });
	});

	it('resolves same-package class via resolvePackage callback', async () => {
		const imports = extractImports('package net.minecraft.client;');
		const resolvePackage = vi.fn(async (_pkg: string) => ['SomeClass', 'Other']);
		const resolve = createTypeResolver(imports, resolvePackage);
		const result = await resolve('SomeClass');
		expect(result).toEqual({ kind: 'class', name: 'SomeClass', fqn: 'net.minecraft.client.SomeClass' });
	});

	it('resolves java.lang types implicitly', async () => {
		const imports = extractImports('');
		const resolve = createTypeResolver(imports, noopResolve);
		const result = await resolve('String');
		expect(result).toEqual({ kind: 'class', name: 'String', fqn: 'java.lang.String' });
	});

	it('returns UnresolvedType for unknown names', async () => {
		const imports = extractImports('');
		const resolve = createTypeResolver(imports, noopResolve);
		const result = await resolve('TotallyUnknown');
		expect(result).toEqual({ kind: 'unresolved', rawType: 'TotallyUnknown' });
	});

	it('resolves primitives before import cascade', async () => {
		const imports = extractImports('');
		const resolve = createTypeResolver(imports, noopResolve);
		const result = await resolve('int');
		expect(result).toEqual({ kind: 'primitive', name: 'int' });
	});

	it('resolves void to VoidType', async () => {
		const imports = extractImports('');
		const resolve = createTypeResolver(imports, noopResolve);
		const result = await resolve('void');
		expect(result).toEqual({ kind: 'void' });
	});

	it('caches star import resolvePackage calls', async () => {
		const imports = extractImports('import net.minecraft.block.*;');
		const resolvePackage = vi.fn(async (_pkg: string) => ['Block', 'BlockState']);
		const resolve = createTypeResolver(imports, resolvePackage);

		await resolve('Block');
		await resolve('BlockState');

		// resolvePackage should only be called once for the same package
		expect(resolvePackage).toHaveBeenCalledTimes(1);
	});

	it('explicit import wins over star import for same name', async () => {
		const source = `import net.minecraft.util.math.BlockPos;
import net.minecraft.block.*;`;
		const imports = extractImports(source);
		// Even if star package also contains "BlockPos", explicit wins
		const resolvePackage = vi.fn(async (_pkg: string) => ['BlockPos', 'Block']);
		const resolve = createTypeResolver(imports, resolvePackage);
		const result = await resolve('BlockPos');
		expect(result).toEqual({ kind: 'class', name: 'BlockPos', fqn: 'net.minecraft.util.math.BlockPos' });
		// resolvePackage should NOT have been called since explicit matched first
		expect(resolvePackage).not.toHaveBeenCalled();
	});
});
