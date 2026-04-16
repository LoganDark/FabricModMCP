import { describe, it, expect } from 'vitest';
import { enrichSymbols } from '../../src/browsing/member-enrichment.js';
import type { TransformedSymbol } from '../../src/browsing/types.js';

const dummyRange = {
	start: { line: 0, character: 0 },
	end: { line: 0, character: 0 },
};

function makeSym(overrides: Partial<TransformedSymbol> & { name: string; kind: string }): TransformedSymbol {
	return {
		detail: null,
		deprecated: false,
		range: dummyRange,
		selectionRange: dummyRange,
		children: [],
		...overrides,
	};
}

const sourceText = `package net.minecraft.client;

import net.minecraft.util.math.BlockPos;

public class MinecraftClient {
}`;

const noopResolvePackage = async (_pkg: string): Promise<string[]> => [];

describe('enrichSymbols', () => {
	it('enriches a method symbol with void return type', async () => {
		const symbols = [makeSym({ name: 'tick()', kind: 'method', detail: 'void' })];
		const result = await enrichSymbols(symbols, sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		expect(result).toHaveLength(1);
		const method = result[0];
		expect(method).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient#tick()');
		expect(method).toHaveProperty('parameters', []);
		expect(method).toHaveProperty('returnType', { kind: 'void' });
		expect(method.children).toEqual([]);
	});

	it('enriches a field symbol with resolved type', async () => {
		const resolvePackage = async (pkg: string): Promise<string[]> => {
			if (pkg === 'net.minecraft.client') return ['MinecraftClient', 'Window'];
			return [];
		};
		const symbols = [makeSym({ name: 'instance', kind: 'field', detail: 'MinecraftClient' })];
		const result = await enrichSymbols(symbols, sourceText, 'net.minecraft.client.MinecraftClient', resolvePackage);

		expect(result).toHaveLength(1);
		const field = result[0];
		expect(field).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient#instance:');
		expect(field).toHaveProperty('fieldType', { kind: 'class', name: 'MinecraftClient', fqn: 'net.minecraft.client.MinecraftClient' });
	});

	it('enriches a constructor symbol', async () => {
		const symbols = [makeSym({ name: 'MinecraftClient()', kind: 'constructor', detail: '(int)' })];
		const result = await enrichSymbols(symbols, sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		expect(result).toHaveLength(1);
		const ctor = result[0];
		expect(ctor).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient#MinecraftClient()');
		expect(ctor).toHaveProperty('parameters');
		expect((ctor as any).parameters).toEqual([{ name: null, type: { kind: 'primitive', name: 'int' } }]);
		expect(ctor).toHaveProperty('returnType', null);
	});

	it('enriches a class symbol as container with enriched children', async () => {
		const methodChild = makeSym({ name: 'tick()', kind: 'method', detail: 'void' });
		const fieldChild = makeSym({ name: 'running', kind: 'field', detail: 'boolean' });
		const symbols = [makeSym({
			name: 'MinecraftClient',
			kind: 'class',
			detail: null,
			children: [methodChild, fieldChild],
		})];
		const result = await enrichSymbols(symbols, sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		expect(result).toHaveLength(1);
		const cls = result[0];
		// Class symbols should NOT have memberFqn
		expect(cls).not.toHaveProperty('memberFqn');
		expect(cls.children).toHaveLength(2);

		// Children should be enriched
		const enrichedMethod = cls.children[0];
		expect(enrichedMethod).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient#tick()');
		const enrichedField = cls.children[1];
		expect(enrichedField).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient#running:');
	});

	it('handles nested inner class with $ separator in FQN', async () => {
		const innerMethod = makeSym({ name: 'getWidth()', kind: 'method', detail: 'int' });
		const innerClass = makeSym({
			name: 'Options',
			kind: 'class',
			detail: null,
			children: [innerMethod],
		});
		const outerClass = makeSym({
			name: 'MinecraftClient',
			kind: 'class',
			detail: null,
			children: [innerClass],
		});
		const result = await enrichSymbols([outerClass], sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		const enrichedOuter = result[0];
		const enrichedInner = enrichedOuter.children[0];
		// Inner class should NOT have memberFqn
		expect(enrichedInner).not.toHaveProperty('memberFqn');

		// Inner class's children should use $ separator FQN
		const innerMethodEnriched = enrichedInner.children[0];
		expect(innerMethodEnriched).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient$Options#getWidth()');
	});

	it('sets fqn on class-kind symbols including inner classes', async () => {
		const innerClass = makeSym({
			name: 'Options',
			kind: 'class',
			detail: null,
			children: [],
		});
		const outerClass = makeSym({
			name: 'MinecraftClient',
			kind: 'class',
			detail: null,
			children: [innerClass],
		});
		const result = await enrichSymbols([outerClass], sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		const enrichedOuter = result[0];
		expect(enrichedOuter).toHaveProperty('fqn', 'net.minecraft.client.MinecraftClient');

		const enrichedInner = enrichedOuter.children[0];
		expect(enrichedInner).toHaveProperty('fqn', 'net.minecraft.client.MinecraftClient$Options');
	});

	it('handles null detail gracefully (class kind)', async () => {
		const symbols = [makeSym({ name: 'MinecraftClient', kind: 'class', detail: null })];
		const result = await enrichSymbols(symbols, sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		expect(result).toHaveLength(1);
		const cls = result[0];
		expect(cls).not.toHaveProperty('memberFqn');
		expect(cls).not.toHaveProperty('parameters');
		expect(cls).not.toHaveProperty('fieldType');
	});

	it('treats constant as field with colon suffix FQN', async () => {
		const symbols = [makeSym({ name: 'MAX_COUNT', kind: 'constant', detail: 'int' })];
		const result = await enrichSymbols(symbols, sourceText, 'net.minecraft.client.MinecraftClient', noopResolvePackage);

		const constant = result[0];
		expect(constant).toHaveProperty('memberFqn', 'net.minecraft.client.MinecraftClient#MAX_COUNT:');
		expect(constant).toHaveProperty('fieldType', { kind: 'primitive', name: 'int' });
	});

	it('treats enumMember as field with colon suffix FQN', async () => {
		const enumSource = `package net.minecraft.server;

public enum Status {
}`;
		const symbols = [makeSym({ name: 'ONLINE', kind: 'enumMember', detail: 'Status' })];
		const resolvePackage = async (pkg: string): Promise<string[]> => {
			if (pkg === 'net.minecraft.server') return ['Status'];
			return [];
		};
		const result = await enrichSymbols(symbols, enumSource, 'net.minecraft.server.Status', resolvePackage);

		const member = result[0];
		expect(member).toHaveProperty('memberFqn', 'net.minecraft.server.Status#ONLINE:');
		expect(member).toHaveProperty('fieldType');
	});
});
