import { describe, it, expect } from 'vitest';
import type { TypeReference } from '../../src/browsing/member-types.js';
import { parseDetail } from '../../src/browsing/detail-parser.js';

// Mock resolver that resolves known names and returns UnresolvedType for unknowns
function mockResolver(knownTypes: Record<string, string>): (name: string) => Promise<TypeReference> {
	const JAVA_PRIMITIVES = new Set([
		"boolean", "byte", "char", "short", "int", "long", "float", "double",
	]);

	return async (name) => {
		if (JAVA_PRIMITIVES.has(name)) return { kind: "primitive", name };
		if (name === "void") return { kind: "void" };
		const fqn = knownTypes[name];
		if (fqn) return { kind: "class", name, fqn };
		return { kind: "unresolved", rawType: name };
	};
}

const resolver = mockResolver({
	BlockPos: "net.minecraft.util.math.BlockPos",
	BlockState: "net.minecraft.block.BlockState",
	String: "java.lang.String",
	Map: "java.util.Map",
	List: "java.util.List",
	Integer: "java.lang.Integer",
});

const unresolvedResolver = mockResolver({});

describe('parseDetail', () => {
	describe('fields', () => {
		it('parses primitive field type', async () => {
			const result = await parseDetail("boolean", "field", resolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "primitive", name: "boolean" },
			});
		});

		it('parses resolved class field type', async () => {
			const result = await parseDetail("BlockState", "field", resolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "class", name: "BlockState", fqn: "net.minecraft.block.BlockState" },
			});
		});

		it('parses array field type', async () => {
			const result = await parseDetail("int[]", "field", resolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "array", elementType: { kind: "primitive", name: "int" } },
			});
		});

		it('parses generic field type by stripping type args', async () => {
			const result = await parseDetail("List<String>", "field", resolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "class", name: "List", fqn: "java.util.List" },
			});
		});

		it('strips annotation from field type', async () => {
			const result = await parseDetail("@Nullable BlockState", "field", resolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "class", name: "BlockState", fqn: "net.minecraft.block.BlockState" },
			});
		});

		it('returns FieldReference for constant kind', async () => {
			const result = await parseDetail("int", "constant", resolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "primitive", name: "int" },
			});
		});

		it('returns FieldReference for enumMember kind', async () => {
			const result = await parseDetail("GameMode", "enumMember", unresolvedResolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "unresolved", rawType: "GameMode" },
			});
		});
	});

	describe('methods', () => {
		it('parses no-arg method with void return', async () => {
			const result = await parseDetail("void", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [],
				returnType: { kind: "void" },
			});
		});

		it('parses method with params and class return type', async () => {
			const result = await parseDetail("(BlockPos, int) : BlockState", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "class", name: "BlockPos", fqn: "net.minecraft.util.math.BlockPos" } },
					{ name: null, type: { kind: "primitive", name: "int" } },
				],
				returnType: { kind: "class", name: "BlockState", fqn: "net.minecraft.block.BlockState" },
			});
		});

		it('parses method with one param and void return', async () => {
			const result = await parseDetail("(String) : void", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "class", name: "String", fqn: "java.lang.String" } },
				],
				returnType: { kind: "void" },
			});
		});
	});

	describe('constructors', () => {
		it('parses constructor with params and null return type', async () => {
			const result = await parseDetail("(int, int, int)", "constructor", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "primitive", name: "int" } },
					{ name: null, type: { kind: "primitive", name: "int" } },
					{ name: null, type: { kind: "primitive", name: "int" } },
				],
				returnType: null,
			});
		});
	});

	describe('annotations', () => {
		it('strips @Nullable from method parameter', async () => {
			const result = await parseDetail("(@Nullable BlockPos) : BlockState", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "class", name: "BlockPos", fqn: "net.minecraft.util.math.BlockPos" } },
				],
				returnType: { kind: "class", name: "BlockState", fqn: "net.minecraft.block.BlockState" },
			});
		});
	});

	describe('generics', () => {
		it('strips nested generics from method parameter', async () => {
			const result = await parseDetail("(Map<String, List<Integer>>) : void", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "class", name: "Map", fqn: "java.util.Map" } },
				],
				returnType: { kind: "void" },
			});
		});

		it('correctly splits params at depth-0 commas only', async () => {
			const result = await parseDetail("(Map<String, Integer>, int) : void", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "class", name: "Map", fqn: "java.util.Map" } },
					{ name: null, type: { kind: "primitive", name: "int" } },
				],
				returnType: { kind: "void" },
			});
		});
	});

	describe('arrays and varargs', () => {
		it('parses array parameter', async () => {
			const result = await parseDetail("(int[]) : void", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "array", elementType: { kind: "primitive", name: "int" } } },
				],
				returnType: { kind: "void" },
			});
		});

		it('parses varargs parameter', async () => {
			const result = await parseDetail("(String...) : void", "method", resolver);
			expect(result).toEqual({
				kind: "method",
				parameters: [
					{ name: null, type: { kind: "vararg", elementType: { kind: "class", name: "String", fqn: "java.lang.String" } } },
				],
				returnType: { kind: "void" },
			});
		});
	});

	describe('unresolved types', () => {
		it('returns FieldReference with UnresolvedType for unknown type', async () => {
			const result = await parseDetail("TotallyUnknown", "field", unresolvedResolver);
			expect(result).toEqual({
				kind: "field",
				fieldType: { kind: "unresolved", rawType: "TotallyUnknown" },
			});
		});
	});

	describe('edge cases', () => {
		it('returns null for null detail', async () => {
			const result = await parseDetail(null, "method", resolver);
			expect(result).toBeNull();
		});

		it('returns null for empty detail string', async () => {
			const result = await parseDetail("", "class", resolver);
			expect(result).toBeNull();
		});

		it('returns null for unsupported symbol kind', async () => {
			const result = await parseDetail("something", "class", resolver);
			expect(result).toBeNull();
		});
	});
});
