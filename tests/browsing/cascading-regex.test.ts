import { describe, it, expect } from 'vitest';
import { cascadeRegex } from '../../src/browsing/cascading-regex.js';
import type { CascadeSuccess, CascadeFailure } from '../../src/browsing/cascading-regex.js';

const JAVA_SOURCE = `package net.minecraft.client;

import net.minecraft.util.Identifier;

public class MinecraftClient {
	private final String name = "Minecraft";
	private int tickCount = 0;

	public void tick() {
		this.tickCount++;
		this.world.tick();
		this.render();
	}

	public void render() {
		// rendering logic
	}

	public static class Options {
		public boolean fullscreen = false;
	}
}
`;

describe('cascadeRegex', () => {
	describe('multi-step cascade', () => {
		it('3-step cascade returns correct final offset, line, column, and full step trace', () => {
			const result = cascadeRegex(JAVA_SOURCE, [
				'class MinecraftClient \\{[\\s\\S]*?\\}\\s*\\}',
				'public void tick\\(\\)[\\s\\S]*?\\}',
				'this\\.world',
			]);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.steps).toHaveLength(3);
			expect(success.steps.every(s => s.status === 'success')).toBe(true);

			// Verify offset is absolute (points to "this.world" in original source)
			const expectedOffset = JAVA_SOURCE.indexOf('this.world');
			expect(success.offset).toBe(expectedOffset);
			expect(success.steps[2].offset).toBe(expectedOffset);
			expect(success.steps[2].matched).toBe('this.world');
			expect(success.steps[2].length).toBe('this.world'.length);

			// Line/column should be 1-based
			expect(success.line).toBeGreaterThan(1);
			expect(success.column).toBeGreaterThanOrEqual(1);
		});
	});

	describe('single-step cascade', () => {
		it('single pattern returns correct offset with line=1-based, column=1-based', () => {
			const result = cascadeRegex(JAVA_SOURCE, ['MinecraftClient']);
			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;

			expect(success.steps).toHaveLength(1);
			expect(success.offset).toBe(JAVA_SOURCE.indexOf('MinecraftClient'));
			// line 1 = "package...", line 5 = "public class MinecraftClient {"
			expect(success.line).toBeGreaterThan(1);
			expect(success.column).toBeGreaterThanOrEqual(1);
		});
	});

	describe('failure at step N', () => {
		it('pattern at step 2 fails -> result has success:false, failedStep=2, steps[0] success, steps[1] failed', () => {
			const result = cascadeRegex(JAVA_SOURCE, [
				'class MinecraftClient',
				'nonexistent_method_xyz',
			]);

			expect(result.success).toBe(false);
			const failure = result as CascadeFailure;
			expect(failure.failedStep).toBe(2);
			expect(failure.steps).toHaveLength(2);
			expect(failure.steps[0].status).toBe('success');
			expect(failure.steps[1].status).toBe('failed');
			expect(failure.steps[1].matched).toBeUndefined();
			expect(failure.steps[1].offset).toBeUndefined();
			expect(failure.steps[1].length).toBeUndefined();
		});
	});

	describe('inline flag prefixes', () => {
		it('(?i) prefix flag makes match case-insensitive', () => {
			const source = 'public CLASS MinecraftClient {';
			const result = cascadeRegex(source, ['(?i)class']);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.steps[0].matched).toBe('CLASS');
		});

		it('(?s) prefix flag enables dotAll (dot matches newlines)', () => {
			const source = 'start\nmiddle\nend';
			const result = cascadeRegex(source, ['(?s)start.+end']);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.steps[0].matched).toBe('start\nmiddle\nend');
		});

		it('(?im) combined prefix flags work correctly', () => {
			const source = 'line1\nCLASS Foo {\nline3';
			// (?i) for case-insensitive, (?m) for multiline ^ anchor
			const result = cascadeRegex(source, ['(?im)^class']);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.steps[0].matched).toBe('CLASS');
		});
	});

	describe('invalid regex', () => {
		it('invalid regex syntax at step N returns error result identifying step N and SyntaxError message', () => {
			const result = cascadeRegex(JAVA_SOURCE, [
				'class MinecraftClient',
				'[invalid(regex',
			]);

			expect(result.success).toBe(false);
			const failure = result as CascadeFailure;
			expect(failure.failedStep).toBe(2);
			expect(failure.error).toBeDefined();
			expect(typeof failure.error).toBe('string');
			expect(failure.steps).toHaveLength(2);
			expect(failure.steps[0].status).toBe('success');
			expect(failure.steps[1].status).toBe('failed');
		});
	});

	describe('empty patterns', () => {
		it('empty patterns array returns an error', () => {
			const result = cascadeRegex(JAVA_SOURCE, []);

			expect(result.success).toBe(false);
			const failure = result as CascadeFailure;
			expect(failure.failedStep).toBe(0);
			expect(failure.error).toBe('No patterns provided');
			expect(failure.steps).toHaveLength(0);
		});
	});

	describe('absolute offset tracking', () => {
		it('offset is absolute relative to original source, not substring', () => {
			// Match deep in the file to verify offsets are absolute
			const result = cascadeRegex(JAVA_SOURCE, [
				'public void render\\(\\)[\\s\\S]*?\\}',
				'rendering logic',
			]);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			const expectedOffset = JAVA_SOURCE.indexOf('rendering logic');
			expect(success.offset).toBe(expectedOffset);
		});
	});

	describe('line/column computation', () => {
		it('offset 0 = line 1 column 1', () => {
			const source = 'hello world';
			const result = cascadeRegex(source, ['hello']);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.offset).toBe(0);
			expect(success.line).toBe(1);
			expect(success.column).toBe(1);
		});

		it('offset after first newline = line 2 column 1', () => {
			const source = 'line1\nline2';
			const result = cascadeRegex(source, ['line2']);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.offset).toBe(6); // 'line1\n' = 6 chars
			expect(success.line).toBe(2);
			expect(success.column).toBe(1);
		});

		it('column within a line is computed correctly', () => {
			const source = 'abcdef\n  target';
			const result = cascadeRegex(source, ['target']);

			expect(result.success).toBe(true);
			const success = result as CascadeSuccess;
			expect(success.line).toBe(2);
			expect(success.column).toBe(3); // 2 spaces + 1 for 1-based = column 3
		});
	});
});
