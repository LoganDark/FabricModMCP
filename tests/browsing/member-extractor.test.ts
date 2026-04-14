import { describe, it, expect } from 'vitest';
import { parseMemberFqn, findDecorationsStart, extractMemberSource } from '../../src/browsing/member-extractor.js';
import type { EnrichedSymbol, EnrichedMethodSymbol, EnrichedFieldSymbol, EnrichedClassSymbol } from '../../src/browsing/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMethodSymbol(overrides: {
	name: string;
	memberFqn: string;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	selectionRange?: { start: { line: number; character: number }; end: { line: number; character: number } };
}): EnrichedMethodSymbol {
	return {
		name: overrides.name,
		kind: 'method',
		detail: 'void',
		deprecated: false,
		range: overrides.range,
		selectionRange: overrides.selectionRange ?? overrides.range,
		children: [],
		memberFqn: overrides.memberFqn,
		parameters: [],
		returnType: { kind: 'void' },
	};
}

function makeFieldSymbol(overrides: {
	name: string;
	memberFqn: string;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
}): EnrichedFieldSymbol {
	return {
		name: overrides.name,
		kind: 'field',
		detail: 'int',
		deprecated: false,
		range: overrides.range,
		selectionRange: overrides.range,
		children: [],
		memberFqn: overrides.memberFqn,
		fieldType: { kind: 'primitive', name: 'int' },
	};
}

function makeClassSymbol(overrides: {
	name: string;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	children: EnrichedSymbol[];
}): EnrichedClassSymbol {
	return {
		name: overrides.name,
		kind: 'class',
		detail: null,
		deprecated: false,
		range: overrides.range,
		selectionRange: overrides.range,
		children: overrides.children,
	};
}

// ─── parseMemberFqn ─────────────────────────────────────────────────────────

describe('parseMemberFqn', () => {
	it('parses a method FQN', () => {
		const result = parseMemberFqn('net.minecraft.client.MinecraftClient#tick()');
		expect(result).toEqual({
			className: 'net.minecraft.client.MinecraftClient',
			memberName: 'tick',
			isMethod: true,
			isField: false,
		});
	});

	it('parses a field FQN', () => {
		const result = parseMemberFqn('net.minecraft.client.MinecraftClient#instance:');
		expect(result).toEqual({
			className: 'net.minecraft.client.MinecraftClient',
			memberName: 'instance',
			isMethod: false,
			isField: true,
		});
	});

	it('parses a constructor FQN', () => {
		const result = parseMemberFqn('net.minecraft.client.MinecraftClient#MinecraftClient()');
		expect(result).toEqual({
			className: 'net.minecraft.client.MinecraftClient',
			memberName: 'MinecraftClient',
			isMethod: true,
			isField: false,
		});
	});

	it('parses an inner class member FQN with $', () => {
		const result = parseMemberFqn('net.minecraft.client.MinecraftClient$Options#fullscreen:');
		expect(result).toEqual({
			className: 'net.minecraft.client.MinecraftClient$Options',
			memberName: 'fullscreen',
			isMethod: false,
			isField: true,
		});
	});

	it('returns null for FQN without # separator', () => {
		expect(parseMemberFqn('invalid-no-hash')).toBeNull();
	});

	it('returns null for FQN without type suffix', () => {
		expect(parseMemberFqn('Class#noSuffix')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseMemberFqn('')).toBeNull();
	});
});

// ─── findDecorationsStart ───────────────────────────────────────────────────

describe('findDecorationsStart', () => {
	it('finds Javadoc block above the range start', () => {
		const lines = [
			'package test;',           // 0
			'',                        // 1
			'/**',                     // 2
			' * Does a thing.',        // 3
			' */',                     // 4
			'public void tick() {',    // 5
			'}',                       // 6
		];
		expect(findDecorationsStart(lines, 5)).toBe(2);
	});

	it('returns rangeStartIdx when no Javadoc above', () => {
		const lines = [
			'package test;',           // 0
			'',                        // 1
			'public void tick() {',    // 2
			'}',                       // 3
		];
		expect(findDecorationsStart(lines, 2)).toBe(2);
	});

	it('skips blank lines between Javadoc closing and range start', () => {
		const lines = [
			'package test;',           // 0
			'/**',                     // 1
			' * Docs.',                // 2
			' */',                     // 3
			'',                        // 4
			'public void tick() {',    // 5
			'}',                       // 6
		];
		expect(findDecorationsStart(lines, 5)).toBe(1);
	});

	it('returns rangeStartIdx when annotation-only (JDT LS range includes annotations)', () => {
		// JDT LS range.start already includes annotations, so rangeStartIdx
		// should point at the annotation line. No Javadoc above it.
		const lines = [
			'package test;',           // 0
			'',                        // 1
			'@Override',               // 2
			'public void tick() {',    // 3
			'}',                       // 4
		];
		// rangeStartIdx is 2 (the @Override line, which JDT LS includes in range)
		expect(findDecorationsStart(lines, 2)).toBe(2);
	});

	it('returns rangeStartIdx 0 when at first line', () => {
		const lines = [
			'public void tick() {',    // 0
			'}',                       // 1
		];
		expect(findDecorationsStart(lines, 0)).toBe(0);
	});
});

// ─── extractMemberSource ────────────────────────────────────────────────────

describe('extractMemberSource', () => {
	const sourceWithJavadoc = `package net.minecraft.client;

/**
 * Called every tick.
 */
public void tick() {
    this.doStuff();
}

public int count;`;

	it('extracts a method with Javadoc, signature, and body', () => {
		const symbols: EnrichedSymbol[] = [
			makeMethodSymbol({
				name: 'tick()',
				memberFqn: 'net.minecraft.client.MinecraftClient#tick()',
				range: {
					start: { line: 6, character: 0 },
					end: { line: 8, character: 1 },
				},
			}),
			makeFieldSymbol({
				name: 'count',
				memberFqn: 'net.minecraft.client.MinecraftClient#count:',
				range: {
					start: { line: 10, character: 0 },
					end: { line: 10, character: 18 },
				},
			}),
		];

		const results = extractMemberSource(sourceWithJavadoc, symbols, 'net.minecraft.client.MinecraftClient#tick()');
		expect(results).toHaveLength(1);
		expect(results[0].memberFqn).toBe('net.minecraft.client.MinecraftClient#tick()');
		expect(results[0].kind).toBe('method');
		expect(results[0].source).toContain('/**');
		expect(results[0].source).toContain('Called every tick.');
		expect(results[0].source).toContain('public void tick()');
		expect(results[0].source).toContain('this.doStuff()');
		expect(results[0].startLine).toBe(3);
		expect(results[0].endLine).toBe(8);
	});

	it('extracts a field without Javadoc', () => {
		const symbols: EnrichedSymbol[] = [
			makeFieldSymbol({
				name: 'count',
				memberFqn: 'net.minecraft.client.MinecraftClient#count:',
				range: {
					start: { line: 10, character: 0 },
					end: { line: 10, character: 18 },
				},
			}),
		];

		const results = extractMemberSource(sourceWithJavadoc, symbols, 'net.minecraft.client.MinecraftClient#count:');
		expect(results).toHaveLength(1);
		expect(results[0].memberFqn).toBe('net.minecraft.client.MinecraftClient#count:');
		expect(results[0].kind).toBe('field');
		expect(results[0].source).toContain('public int count;');
		expect(results[0].startLine).toBe(10);
		expect(results[0].endLine).toBe(10);
	});

	it('returns multiple results for overloaded methods', () => {
		const source = `package test;

public void process() {
    // first
}

public void process() {
    // second
}`;

		const symbols: EnrichedSymbol[] = [
			makeMethodSymbol({
				name: 'process()',
				memberFqn: 'test.Foo#process()',
				range: {
					start: { line: 3, character: 0 },
					end: { line: 5, character: 1 },
				},
			}),
			makeMethodSymbol({
				name: 'process()',
				memberFqn: 'test.Foo#process()',
				range: {
					start: { line: 7, character: 0 },
					end: { line: 9, character: 1 },
				},
			}),
		];

		const results = extractMemberSource(source, symbols, 'test.Foo#process()');
		expect(results).toHaveLength(2);
		expect(results[0].source).toContain('// first');
		expect(results[1].source).toContain('// second');
	});

	it('resolves inner class members with $ in the FQN', () => {
		const source = `package net.minecraft.client;

public class MinecraftClient {

    public static class Options {
        public boolean fullscreen;
    }
}`;

		const innerField = makeFieldSymbol({
			name: 'fullscreen',
			memberFqn: 'net.minecraft.client.MinecraftClient$Options#fullscreen:',
			range: {
				start: { line: 6, character: 0 },
				end: { line: 6, character: 30 },
			},
		});

		const innerClass = makeClassSymbol({
			name: 'Options',
			range: {
				start: { line: 5, character: 0 },
				end: { line: 7, character: 1 },
			},
			children: [innerField],
		});

		const outerClass = makeClassSymbol({
			name: 'MinecraftClient',
			range: {
				start: { line: 3, character: 0 },
				end: { line: 8, character: 1 },
			},
			children: [innerClass],
		});

		const results = extractMemberSource(source, [outerClass], 'net.minecraft.client.MinecraftClient$Options#fullscreen:');
		expect(results).toHaveLength(1);
		expect(results[0].memberFqn).toBe('net.minecraft.client.MinecraftClient$Options#fullscreen:');
		expect(results[0].source).toContain('public boolean fullscreen;');
	});

	it('returns empty array when no member matches', () => {
		const symbols: EnrichedSymbol[] = [
			makeMethodSymbol({
				name: 'tick()',
				memberFqn: 'test.Foo#tick()',
				range: {
					start: { line: 1, character: 0 },
					end: { line: 3, character: 1 },
				},
			}),
		];

		const results = extractMemberSource('public void tick() {\n}\n', symbols, 'test.Foo#nonexistent()');
		expect(results).toHaveLength(0);
	});
});
