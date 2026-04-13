import { describe, it, expect } from 'vitest';
import { extractEnclosingContext } from '../../src/jdtls/context-extractor.js';

const METHOD_SOURCE = `package net.minecraft.client;

public class MinecraftClient {
    private static MinecraftClient instance;

    @Override
    public void run() {
        while (isRunning()) {
            tick();
            if (shouldRender()) {
                render();
            }
        }
    }

    private void tick() {
        // tick logic
    }

    public static MinecraftClient getInstance() {
        return instance;
    }
}`;

const FIELD_SOURCE = `package net.minecraft.item;

public class Item {
    public static final int MAX_STACK_SIZE = 64;
    private final String translationKey;
    protected volatile boolean deprecated = false;
}`;

const CLASS_SOURCE = `package net.minecraft.block;

import net.minecraft.util.Identifier;

public abstract class AbstractBlock implements BlockBehavior {
    private final Settings settings;
}`;

const NESTED_BRACES_SOURCE = `package net.minecraft.client;

public class Renderer {
    public void renderWorld() {
        for (int i = 0; i < chunks.size(); i++) {
            if (chunks.get(i).isLoaded()) {
                chunks.get(i).render(new RenderContext() {
                    @Override
                    public void apply() {
                        // nested anonymous class
                    }
                });
            }
        }
    }
}`;

const MULTI_LINE_ANNOTATION_SOURCE = `package net.minecraft.network;

public class PacketHandler {
    @SuppressWarnings("unchecked")
    @Deprecated
    public <T extends Packet<?>> void handlePacket(
            T packet,
            NetworkState state
    ) {
        // handle it
    }
}`;

describe('extractEnclosingContext', () => {
	it('returns method body when position is inside a method', () => {
		// Line 9 is "            tick();" inside the run() method
		const result = extractEnclosingContext(METHOD_SOURCE, 9);
		expect(result.kind).toBe('method');
		expect(result.snippet).toContain('public void run()');
		expect(result.snippet).toContain('tick();');
		expect(result.startLine).toBeGreaterThanOrEqual(6); // @Override line
		expect(result.endLine).toBeGreaterThanOrEqual(14); // closing brace
	});

	it('returns field declaration when position is at a field', () => {
		// Line 4 is "    public static final int MAX_STACK_SIZE = 64;"
		const result = extractEnclosingContext(FIELD_SOURCE, 4);
		expect(result.kind).toBe('field');
		expect(result.snippet).toContain('MAX_STACK_SIZE');
		expect(result.startLine).toBe(4);
		expect(result.endLine).toBe(4);
	});

	it('returns class declaration when position is at a class line', () => {
		// Line 5 is "public abstract class AbstractBlock implements BlockBehavior {"
		const result = extractEnclosingContext(CLASS_SOURCE, 5);
		expect(result.kind).toBe('class');
		expect(result.snippet).toContain('class AbstractBlock');
	});

	it('returns method signature when position is at method declaration line', () => {
		// Line 7 is "    public void run() {"
		const result = extractEnclosingContext(METHOD_SOURCE, 7);
		expect(result.kind).toBe('method');
		expect(result.snippet).toContain('public void run()');
	});

	it('returns fallback with surrounding lines when no recognizable unit', () => {
		// Line 1 is "package net.minecraft.client;" -- not a method/field/class declaration
		const result = extractEnclosingContext(METHOD_SOURCE, 1);
		expect(result.kind).toBe('fallback');
		expect(result.startLine).toBe(1);
		expect(result.endLine).toBeLessThanOrEqual(6);
	});

	it('does not underflow when position is at line 1', () => {
		const result = extractEnclosingContext(METHOD_SOURCE, 1);
		expect(result.startLine).toBeGreaterThanOrEqual(1);
	});

	it('does not overflow when position is at last line', () => {
		const lines = METHOD_SOURCE.split('\n');
		const lastLine = lines.length;
		const result = extractEnclosingContext(METHOD_SOURCE, lastLine);
		expect(result.endLine).toBeLessThanOrEqual(lastLine);
	});

	it('includes multi-line method signature with annotations', () => {
		// Line 10 is "    ) {" (inside handlePacket method)
		const result = extractEnclosingContext(MULTI_LINE_ANNOTATION_SOURCE, 10);
		expect(result.kind).toBe('method');
		expect(result.snippet).toContain('handlePacket');
	});

	it('handles nested braces inside method body correctly', () => {
		// Line 8 is inside renderWorld which has nested braces
		const result = extractEnclosingContext(NESTED_BRACES_SOURCE, 8);
		expect(result.kind).toBe('method');
		expect(result.snippet).toContain('renderWorld');
		// The snippet should include the full method including nested braces
		expect(result.snippet).toContain('chunks.get(i).render');
	});
});
