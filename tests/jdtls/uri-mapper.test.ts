import { describe, it, expect } from 'vitest';
import {
	jarIdToDirName,
	dirNameToJarId,
	entryPathToClassName,
	createUriMapper,
} from '../../src/jdtls/uri-mapper.js';

describe('jarIdToDirName', () => {
	it('returns unchanged name when no colons', () => {
		expect(jarIdToDirName('minecraft')).toBe('minecraft');
	});

	it('replaces colons with double underscores', () => {
		expect(jarIdToDirName('fabric-api:fabric-networking-api-v1'))
			.toBe('fabric-api__fabric-networking-api-v1');
	});

	it('handles multiple colons', () => {
		expect(jarIdToDirName('a:b:c')).toBe('a__b__c');
	});
});

describe('dirNameToJarId', () => {
	it('returns unchanged name when no double underscores', () => {
		expect(dirNameToJarId('minecraft')).toBe('minecraft');
	});

	it('replaces double underscores with colons', () => {
		expect(dirNameToJarId('fabric-api__fabric-networking-api-v1'))
			.toBe('fabric-api:fabric-networking-api-v1');
	});

	it('handles multiple double underscores', () => {
		expect(dirNameToJarId('a__b__c')).toBe('a:b:c');
	});
});

describe('round-trip jarId <-> dirName', () => {
	const ids = [
		'minecraft',
		'fabric-api:fabric-networking-api-v1',
		'net.fabricmc:fabric-loader',
		'com.mojang:brigadier',
	];

	for (const id of ids) {
		it(`round-trips correctly for "${id}"`, () => {
			expect(dirNameToJarId(jarIdToDirName(id))).toBe(id);
		});
	}
});

describe('entryPathToClassName', () => {
	it('converts path to fully-qualified class name', () => {
		expect(entryPathToClassName('net/minecraft/client/MinecraftClient.java'))
			.toBe('net.minecraft.client.MinecraftClient');
	});

	it('handles default package (just filename)', () => {
		expect(entryPathToClassName('Foo.java')).toBe('Foo');
	});

	it('handles deeply nested package', () => {
		expect(entryPathToClassName('com/example/mod/util/helpers/StringHelper.java'))
			.toBe('com.example.mod.util.helpers.StringHelper');
	});
});

describe('createUriMapper', () => {
	const tempDir = '/tmp/jdtls-test';
	const jarMap = new Map([
		['minecraft', 'minecraft'],
		['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1'],
	]);

	describe('toFileUri', () => {
		it('builds correct URI for minecraft jar', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const uri = mapper.toFileUri('minecraft', 'net/minecraft/client/MinecraftClient.java');
			expect(uri).toBe('file:///tmp/jdtls-test/minecraft/net/minecraft/client/MinecraftClient.java');
		});

		it('builds correct URI for jar with colon in ID', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const uri = mapper.toFileUri(
				'fabric-api:fabric-networking-api-v1',
				'net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java',
			);
			expect(uri).toBe(
				'file:///tmp/jdtls-test/fabric-api__fabric-networking-api-v1/net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java',
			);
		});

		it('handles tempDir with trailing slash', () => {
			const mapper = createUriMapper('/tmp/jdtls-test/', jarMap);
			const uri = mapper.toFileUri('minecraft', 'net/minecraft/client/MinecraftClient.java');
			expect(uri).toBe('file:///tmp/jdtls-test/minecraft/net/minecraft/client/MinecraftClient.java');
		});
	});

	describe('fromFileUri', () => {
		it('parses URI back to jar ID and entry path', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const result = mapper.fromFileUri(
				'file:///tmp/jdtls-test/minecraft/net/minecraft/client/MinecraftClient.java',
			);
			expect(result).toEqual({
				jar: 'minecraft',
				entryPath: 'net/minecraft/client/MinecraftClient.java',
			});
		});

		it('parses URI with colon-containing jar ID', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const result = mapper.fromFileUri(
				'file:///tmp/jdtls-test/fabric-api__fabric-networking-api-v1/net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java',
			);
			expect(result).toEqual({
				jar: 'fabric-api:fabric-networking-api-v1',
				entryPath: 'net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java',
			});
		});

		it('returns null for URIs outside temp dir', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const result = mapper.fromFileUri('file:///other/path/minecraft/Foo.java');
			expect(result).toBeNull();
		});

		it('returns null for URIs with unknown jar directory', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const result = mapper.fromFileUri('file:///tmp/jdtls-test/unknown-jar/Foo.java');
			expect(result).toBeNull();
		});

		it('returns null for non-file URIs', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const result = mapper.fromFileUri('https://example.com/file.java');
			expect(result).toBeNull();
		});
	});

	describe('round-trip toFileUri -> fromFileUri', () => {
		it('round-trips correctly', () => {
			const mapper = createUriMapper(tempDir, jarMap);
			const jarId = 'fabric-api:fabric-networking-api-v1';
			const entryPath = 'net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java';

			const uri = mapper.toFileUri(jarId, entryPath);
			const result = mapper.fromFileUri(uri);

			expect(result).toEqual({ jar: jarId, entryPath });
		});
	});
});
