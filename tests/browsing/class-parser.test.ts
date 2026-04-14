import { describe, it, expect } from 'vitest';
import { parseClassDeclaration } from '../../src/browsing/class-parser.js';

describe('parseClassDeclaration', () => {
	describe('class types', () => {
		it('parses public class', () => {
			const result = parseClassDeclaration('package net.minecraft;\n\npublic class Foo {\n}');
			expect(result).toEqual({
				access: 'public',
				modifiers: [],
				kind: 'class',
				name: 'Foo',
			});
		});

		it('parses interface', () => {
			const result = parseClassDeclaration('package net.minecraft;\n\ninterface Bar {\n}');
			expect(result).toEqual({
				access: 'package-private',
				modifiers: [],
				kind: 'interface',
				name: 'Bar',
			});
		});

		it('parses public enum', () => {
			const result = parseClassDeclaration('package net.minecraft;\n\npublic enum GameMode {\n}');
			expect(result).toEqual({
				access: 'public',
				modifiers: [],
				kind: 'enum',
				name: 'GameMode',
			});
		});

		it('parses public record', () => {
			const result = parseClassDeclaration('package net.minecraft;\n\npublic record ChunkPos(int x, int z) {\n}');
			expect(result).toEqual({
				access: 'public',
				modifiers: [],
				kind: 'record',
				name: 'ChunkPos',
			});
		});

		it('parses @interface (annotation type)', () => {
			const result = parseClassDeclaration('package net.minecraft;\n\n@interface Environment {\n}');
			expect(result).toEqual({
				access: 'package-private',
				modifiers: [],
				kind: '@interface',
				name: 'Environment',
			});
		});
	});

	describe('access modifiers', () => {
		it('parses public access', () => {
			const result = parseClassDeclaration('public class Foo {}');
			expect(result!.access).toBe('public');
		});

		it('parses protected access', () => {
			const result = parseClassDeclaration('protected class Foo {}');
			expect(result!.access).toBe('protected');
		});

		it('parses private access', () => {
			const result = parseClassDeclaration('private class Foo {}');
			expect(result!.access).toBe('private');
		});

		it('defaults to package-private when no access modifier', () => {
			const result = parseClassDeclaration('class Foo {}');
			expect(result!.access).toBe('package-private');
		});
	});

	describe('modifiers', () => {
		it('parses abstract', () => {
			const result = parseClassDeclaration('public abstract class Baz {}');
			expect(result).toEqual({
				access: 'public',
				modifiers: ['abstract'],
				kind: 'class',
				name: 'Baz',
			});
		});

		it('parses final', () => {
			const result = parseClassDeclaration('public final class Foo {}');
			expect(result!.modifiers).toEqual(['final']);
		});

		it('parses static', () => {
			const result = parseClassDeclaration('public static class Inner {}');
			expect(result).toEqual({
				access: 'public',
				modifiers: ['static'],
				kind: 'class',
				name: 'Inner',
			});
		});

		it('parses sealed', () => {
			const result = parseClassDeclaration('public sealed class Foo permits Bar {}');
			expect(result).toEqual({
				access: 'public',
				modifiers: ['sealed'],
				kind: 'class',
				name: 'Foo',
			});
		});

		it('parses non-sealed', () => {
			const result = parseClassDeclaration('public non-sealed class Bar extends Foo {}');
			expect(result).toEqual({
				access: 'public',
				modifiers: ['non-sealed'],
				kind: 'class',
				name: 'Bar',
			});
		});

		it('parses strictfp', () => {
			const result = parseClassDeclaration('public strictfp class Precise {}');
			expect(result!.modifiers).toEqual(['strictfp']);
		});

		it('parses multiple modifiers', () => {
			const result = parseClassDeclaration('public static final class Constants {}');
			expect(result!.modifiers).toEqual(['static', 'final']);
		});
	});

	describe('edge cases', () => {
		it('returns null for non-Java content', () => {
			expect(parseClassDeclaration('This is not Java code at all.')).toBeNull();
			expect(parseClassDeclaration('')).toBeNull();
		});

		it('only scans first 4KB of source text', () => {
			// Put the class declaration beyond the 4096-byte mark
			const padding = '// ' + 'x'.repeat(4100) + '\n';
			const source = padding + 'public class Hidden {}';
			expect(parseClassDeclaration(source)).toBeNull();
		});

		it('finds class declaration within first 4KB', () => {
			// Put the class declaration within the 4096-byte mark
			const padding = '// ' + 'x'.repeat(4000) + '\n';
			const source = padding + 'public class Visible {}';
			expect(parseClassDeclaration(source)).toEqual({
				access: 'public',
				modifiers: [],
				kind: 'class',
				name: 'Visible',
			});
		});

		it('handles class with annotations before declaration', () => {
			const source = `package net.minecraft;

import java.lang.annotation.*;

@Deprecated
@SuppressWarnings("unchecked")
public final class AnnotatedClass {
}`;
			expect(parseClassDeclaration(source)).toEqual({
				access: 'public',
				modifiers: ['final'],
				kind: 'class',
				name: 'AnnotatedClass',
			});
		});
	});
});
