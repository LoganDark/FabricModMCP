import { describe, it, expect } from 'vitest';
import { EntryIndex, decomposeEntryPath } from '../../src/browsing/entry-index.js';

describe('decomposeEntryPath', () => {
	it('returns null for non-.java files', () => {
		expect(decomposeEntryPath('META-INF/MANIFEST.MF')).toBeNull();
		expect(decomposeEntryPath('net/minecraft/data.json')).toBeNull();
	});

	it('excludes package-info.java', () => {
		expect(decomposeEntryPath('net/minecraft/package-info.java')).toBeNull();
	});

	it('excludes module-info.java', () => {
		expect(decomposeEntryPath('module-info.java')).toBeNull();
	});

	it('decomposes a top-level class', () => {
		const result = decomposeEntryPath('net/minecraft/client/MinecraftClient.java');
		expect(result).toEqual({
			packageName: 'net.minecraft.client',
			className: 'MinecraftClient',
			isInnerClass: false,
			outerClassName: null,
			isAnonymous: false,
		});
	});

	it('decomposes an inner class', () => {
		const result = decomposeEntryPath('net/minecraft/client/MinecraftClient$Options.java');
		expect(result).toEqual({
			packageName: 'net.minecraft.client',
			className: 'MinecraftClient$Options',
			isInnerClass: true,
			outerClassName: 'MinecraftClient',
			isAnonymous: false,
		});
	});

	it('detects anonymous inner classes', () => {
		const result = decomposeEntryPath('net/minecraft/client/MinecraftClient$1.java');
		expect(result).toEqual({
			packageName: 'net.minecraft.client',
			className: 'MinecraftClient$1',
			isInnerClass: true,
			outerClassName: 'MinecraftClient',
			isAnonymous: true,
		});
	});

	it('deeply nested inner classes use outermost class', () => {
		const result = decomposeEntryPath('net/minecraft/client/Foo$Bar$Baz.java');
		expect(result).toEqual({
			packageName: 'net.minecraft.client',
			className: 'Foo$Bar$Baz',
			isInnerClass: true,
			outerClassName: 'Foo',
			isAnonymous: false,
		});
	});

	it('handles root-level class with no package', () => {
		const result = decomposeEntryPath('Foo.java');
		expect(result).toEqual({
			packageName: '',
			className: 'Foo',
			isInnerClass: false,
			outerClassName: null,
			isAnonymous: false,
		});
	});
});

describe('EntryIndex', () => {
	const sampleEntries = [
		'net/minecraft/client/MinecraftClient.java',
		'net/minecraft/client/MinecraftClient$Options.java',
		'net/minecraft/client/MinecraftClient$1.java',
		'net/minecraft/client/gui/Screen.java',
		'net/minecraft/client/gui/widget/ButtonWidget.java',
		'net/minecraft/server/MinecraftServer.java',
		'net/minecraft/Bootstrap.java',
		'net/minecraft/package-info.java',
		'module-info.java',
		'META-INF/MANIFEST.MF',
		'com/mojang/math/Vector3f.java',
		'com/mojang/math/Vector3f$Inner.java',
	];

	describe('top-level packages', () => {
		it('extracts root packages from sample paths', () => {
			const index = new EntryIndex(sampleEntries);
			const roots = index.getPackages();
			expect(roots).toContain('net');
			expect(roots).toContain('com');
			expect(roots).toHaveLength(2);
		});
	});

	describe('sub-package listing', () => {
		it('lists immediate children at depth 1', () => {
			const index = new EntryIndex(sampleEntries);
			const children = index.getPackages('net', 1);
			expect(children).toEqual(['net.minecraft']);
		});

		it('lists depth 2 sub-packages', () => {
			const index = new EntryIndex(sampleEntries);
			const children = index.getPackages('net', 2);
			expect(children).toContain('net.minecraft');
			expect(children).toContain('net.minecraft.client');
			expect(children).toContain('net.minecraft.server');
		});

		it('lists children of a deeper package', () => {
			const index = new EntryIndex(sampleEntries);
			const children = index.getPackages('net.minecraft.client', 1);
			expect(children).toContain('net.minecraft.client.gui');
			expect(children).not.toContain('net.minecraft.client.gui.widget');
		});

		it('lists deeper children with depth 2', () => {
			const index = new EntryIndex(sampleEntries);
			const children = index.getPackages('net.minecraft.client', 2);
			expect(children).toContain('net.minecraft.client.gui');
			expect(children).toContain('net.minecraft.client.gui.widget');
		});
	});

	describe('class count', () => {
		it('counts only top-level classes (excludes inner classes)', () => {
			const index = new EntryIndex(sampleEntries);
			// net.minecraft.client has MinecraftClient (1 top-level class)
			// MinecraftClient$Options and $1 are inner classes
			expect(index.getClassCount('net.minecraft.client')).toBe(1);
		});

		it('excludes package-info.java from counts', () => {
			const index = new EntryIndex(sampleEntries);
			// net.minecraft has Bootstrap only (package-info.java excluded)
			expect(index.getClassCount('net.minecraft')).toBe(1);
		});
	});

	describe('inner class grouping', () => {
		it('groups inner classes under outer class', () => {
			const index = new EntryIndex(sampleEntries);
			const classes = index.getClasses('net.minecraft.client');
			expect(classes).toHaveLength(1);
			expect(classes[0].className).toBe('MinecraftClient');
			expect(classes[0].innerClassNames).toContain('MinecraftClient$Options');
		});

		it('excludes anonymous inner classes from inner class listings', () => {
			const index = new EntryIndex(sampleEntries);
			const classes = index.getClasses('net.minecraft.client');
			const mc = classes.find(c => c.className === 'MinecraftClient')!;
			expect(mc.innerClassNames).not.toContain('MinecraftClient$1');
		});

		it('handles deeply nested inner classes (Foo$Bar$Baz) under outermost', () => {
			const entries = [
				'com/example/Foo.java',
				'com/example/Foo$Bar.java',
				'com/example/Foo$Bar$Baz.java',
			];
			const index = new EntryIndex(entries);
			const classes = index.getClasses('com.example');
			expect(classes).toHaveLength(1);
			expect(classes[0].className).toBe('Foo');
			expect(classes[0].innerClassNames).toContain('Foo$Bar');
			expect(classes[0].innerClassNames).toContain('Foo$Bar$Baz');
		});
	});

	describe('getAllClasses', () => {
		it('returns top-level classes with correct FQN', () => {
			const index = new EntryIndex(sampleEntries);
			const all = index.getAllClasses();
			const topLevel = all.filter(c => !c.isInnerClass);

			expect(topLevel.map(c => c.fqn)).toContain('net.minecraft.client.MinecraftClient');
			expect(topLevel.map(c => c.fqn)).toContain('net.minecraft.client.gui.Screen');
			expect(topLevel.map(c => c.fqn)).toContain('net.minecraft.client.gui.widget.ButtonWidget');
			expect(topLevel.map(c => c.fqn)).toContain('net.minecraft.server.MinecraftServer');
			expect(topLevel.map(c => c.fqn)).toContain('net.minecraft.Bootstrap');
			expect(topLevel.map(c => c.fqn)).toContain('com.mojang.math.Vector3f');
		});

		it('returns non-anonymous inner classes', () => {
			const index = new EntryIndex(sampleEntries);
			const all = index.getAllClasses();
			const inner = all.filter(c => c.isInnerClass);

			expect(inner.map(c => c.fqn)).toContain('net.minecraft.client.MinecraftClient$Options');
			expect(inner.map(c => c.fqn)).toContain('com.mojang.math.Vector3f$Inner');
		});

		it('excludes anonymous inner classes', () => {
			const index = new EntryIndex(sampleEntries);
			const all = index.getAllClasses();
			const fqns = all.map(c => c.fqn);

			expect(fqns).not.toContain('net.minecraft.client.MinecraftClient$1');
		});

		it('has correct FQN format for inner classes', () => {
			const index = new EntryIndex(sampleEntries);
			const all = index.getAllClasses();
			const options = all.find(c => c.fqn === 'net.minecraft.client.MinecraftClient$Options');

			expect(options).toBeDefined();
			expect(options!.className).toBe('MinecraftClient$Options');
			expect(options!.packageName).toBe('net.minecraft.client');
			expect(options!.isInnerClass).toBe(true);
		});

		it('has correct isInnerClass flag for top-level classes', () => {
			const index = new EntryIndex(sampleEntries);
			const all = index.getAllClasses();
			const mc = all.find(c => c.fqn === 'net.minecraft.client.MinecraftClient');

			expect(mc).toBeDefined();
			expect(mc!.isInnerClass).toBe(false);
		});

		it('returns empty array for empty index', () => {
			const index = new EntryIndex([]);
			expect(index.getAllClasses()).toEqual([]);
		});
	});

	describe('edge cases', () => {
		it('returns empty results for empty input', () => {
			const index = new EntryIndex([]);
			expect(index.getPackages()).toEqual([]);
			expect(index.getClasses('anything')).toEqual([]);
			expect(index.getClassCount('anything')).toBe(0);
		});

		it('returns empty array for non-existent package', () => {
			const index = new EntryIndex(sampleEntries);
			expect(index.getClasses('does.not.exist')).toEqual([]);
			expect(index.getPackages('does.not.exist')).toEqual([]);
		});
	});
});
