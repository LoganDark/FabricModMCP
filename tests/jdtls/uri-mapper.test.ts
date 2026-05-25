import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	jarIdToDirName,
	dirNameToJarId,
	entryPathToClassName,
	createUriMapper,
} from '../../src/jdtls/uri-mapper.js';

// Capture host environment once so afterEach can restore it. `isWindows` in
// src/platform/index.ts is a module-load-time const, so every Windows-mocked
// describe MUST call vi.resetModules() AND re-import src/jdtls/uri-mapper.js
// AFTER setPlatform('win32') has run — only then does uri-mapper.ts see
// `isWindows === true` and take the drive-letter case-fold branch (D-21).
const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
	setPlatform(originalPlatform);
	vi.resetModules();
});

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

	it('replaces slash with double dashes for namespace separator', () => {
		expect(jarIdToDirName('my-mod/minecraft')).toBe('my-mod--minecraft');
	});

	it('handles both slash and colon separators', () => {
		expect(jarIdToDirName('my-mod/net.fabricmc:fabric-api')).toBe('my-mod--net.fabricmc__fabric-api');
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

	it('replaces double dashes with slash for namespace separator', () => {
		expect(dirNameToJarId('my-mod--minecraft')).toBe('my-mod/minecraft');
	});

	it('handles both double dashes and double underscores', () => {
		expect(dirNameToJarId('my-mod--net.fabricmc__fabric-api')).toBe('my-mod/net.fabricmc:fabric-api');
	});
});

describe('round-trip jarId <-> dirName', () => {
	const ids = [
		'minecraft',
		'fabric-api:fabric-networking-api-v1',
		'net.fabricmc:fabric-loader',
		'com.mojang:brigadier',
		'my-mod/minecraft',
		'my-mod/net.fabricmc:fabric-api',
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

// =========================================================================
// Phase 36 Plan 03 — Windows drive-letter case-fold (WIN-05 / D-09 / D-11)
//
// Per Phase 36 RESEARCH §"Drive-Letter Case-Fold Logic" and the user's
// directive in 36-CONTEXT.md D-09: "absolutely everything except the drive
// letter itself should be treated as completely case sensitive". The case-
// fold is surgical — only byte 8 of three-slash drive-letter URIs, only on
// Windows. UNC, DOS device, Win32-namespace, and Unix URIs all use byte-
// exact compare (D-11). The path tail (jar-entry segments) is always byte-
// exact (D-09).
//
// All describes below dynamically re-import src/jdtls/uri-mapper.js AFTER
// setPlatform('win32') so the module-load-time `isWindows` const captures
// `true` and the SUT takes the case-fold branch. uri-mapper internally
// calls `pathToFileUri(normalizedTempDir, { windows: isWindows })` so its
// `prefix` matches Windows-flavor shape on a darwin/linux host CI (Plan 01
// §A2 — `pathToFileURL` does not auto-detect drive-letter shape; the opt-in
// is mandatory to construct a Windows-flavor URI on a non-Windows host).
// =========================================================================

describe('Windows: fromFileUri accepts uppercase or lowercase drive letter', () => {
	it('accepts uppercase drive letter (stored prefix uppercase, inbound uppercase)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		expect(mapper.fromFileUri('file:///C:/Users/test/Temp/xyz/minecraft/foo/Bar.java'))
			.toEqual({ jar: 'minecraft', entryPath: 'foo/Bar.java' });
	});

	it('accepts lowercase drive letter when stored prefix is uppercase (the WIN-05 motivating case)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		// JDT LS may return file:///c:/... even when we sent file:///C:/...
		expect(mapper.fromFileUri('file:///c:/Users/test/Temp/xyz/minecraft/foo/Bar.java'))
			.toEqual({ jar: 'minecraft', entryPath: 'foo/Bar.java' });
	});
});

describe('Windows: fromFileUri rejects different drive letter', () => {
	it('rejects D: URI against C: prefix (drive identity preserved, only case is loose)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		expect(mapper.fromFileUri('file:///D:/Users/test/Temp/xyz/minecraft/foo/Bar.java')).toBeNull();
	});

	it('rejects lowercase d: URI against C: prefix (case-fold does not collapse drive identity)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		expect(mapper.fromFileUri('file:///d:/Users/test/Temp/xyz/minecraft/foo/Bar.java')).toBeNull();
	});
});

describe('Windows: fromFileUri does NOT case-fold UNC URIs', () => {
	it('UNC-shaped prefix vs UNC-shaped URI uses byte-exact compare (D-11)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		// UNC tempDir — no drive letter; prefix becomes file://server/share/...
		// (host-as-authority form). The case-fold regex `^file:///[A-Za-z]:`
		// does not match UNC URIs, so the compare falls through to byte-exact
		// startsWith. Mismatched case in the server name MUST reject.
		const mapper = createUriMapper('\\\\server\\share\\Temp\\xyz', new Map([['mc', 'mc']]));
		expect(mapper.fromFileUri('file://SERVER/share/Temp/xyz/mc/foo.java')).toBeNull();
	});

	it('UNC-shaped prefix vs UNC-shaped URI with matching case accepts (byte-exact equality)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('\\\\server\\share\\Temp\\xyz', new Map([['mc', 'mc']]));
		// Sanity: the byte-exact match path still works for UNC. The inbound
		// URI shape must match what pathToFileUri produces for a UNC input on
		// Windows-flavor, namely `file://server/share/Temp/xyz/...`.
		const uri = mapper.toFileUri('mc', 'foo.java');
		const result = mapper.fromFileUri(uri);
		expect(result).toEqual({ jar: 'mc', entryPath: 'foo.java' });
	});
});

describe('Windows: fromFileUri preserves jar-entry tail case', () => {
	it('case-folded drive letter; mixed-case tail bytes returned byte-exact (D-09)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		// Inbound URI uses lowercase drive letter (exercises the case-fold
		// branch) AND mixed-case path tail. The tail must come back byte-exact.
		const result = mapper.fromFileUri('file:///c:/Users/test/Temp/xyz/minecraft/foo/BAR.java');
		expect(result).not.toBeNull();
		expect(result?.entryPath).toBe('foo/BAR.java'); // exact case preserved
	});

	it('foo/Bar.java and foo/bar.java map to distinct entryPaths (jar-entry tail is case-sensitive)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz', new Map([['minecraft', 'minecraft']]));
		const upper = mapper.fromFileUri('file:///C:/Users/test/Temp/xyz/minecraft/foo/Bar.java');
		const lower = mapper.fromFileUri('file:///C:/Users/test/Temp/xyz/minecraft/foo/bar.java');
		expect(upper?.entryPath).toBe('foo/Bar.java');
		expect(lower?.entryPath).toBe('foo/bar.java');
		expect(upper?.entryPath).not.toBe(lower?.entryPath);
	});
});

describe('Windows: trailing-separator normalization (CR-02)', () => {
	// `normalizedTempDir` must strip BOTH `/` and `\` so `realpathSync.native`
	// returns (backslash-separated) and any caller-synthesized tempDir ending
	// in `\` are both reduced to the same canonical form. Without this strip,
	// a trailing `\` survives into the URI prefix as a double slash, breaking
	// `prefixMatches` against JDT LS's single-slash replies.
	it('handles tempDir with trailing backslash on Windows', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz\\', new Map([['mc', 'mc']]));
		expect(mapper.toFileUri('mc', 'foo/Bar.java'))
			.toBe('file:///C:/Users/test/Temp/xyz/mc/foo/Bar.java');
	});

	it('round-trips a long path with trailing backslash on Windows', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz\\', new Map([['mc', 'mc']]));
		const uri = mapper.toFileUri('mc', 'foo/Bar.java');
		expect(mapper.fromFileUri(uri)).toEqual({ jar: 'mc', entryPath: 'foo/Bar.java' });
	});

	it('handles tempDir with mixed trailing separators on Windows', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper('C:\\Users\\test\\Temp\\xyz/\\', new Map([['mc', 'mc']]));
		expect(mapper.toFileUri('mc', 'foo/Bar.java'))
			.toBe('file:///C:/Users/test/Temp/xyz/mc/foo/Bar.java');
	});
});

describe('Windows: fromFileUri round-trip via toFileUri', () => {
	it('round-trip preserves jar + entryPath under Windows-flavor URIs', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
		const mapper = createUriMapper(
			'C:\\Users\\test\\Temp\\xyz',
			new Map([
				['minecraft', 'minecraft'],
				['fabric-api:fabric-networking-api-v1', 'fabric-api__fabric-networking-api-v1'],
			]),
		);
		const jarId = 'fabric-api:fabric-networking-api-v1';
		const entryPath = 'net/fabricmc/fabric/api/networking/v1/ServerPlayNetworking.java';
		const uri = mapper.toFileUri(jarId, entryPath);
		// toFileUri emits three-slash drive-letter shape on Windows-flavor:
		expect(uri).toMatch(/^file:\/\/\/C:\/Users\/test\/Temp\/xyz\//);
		expect(mapper.fromFileUri(uri)).toEqual({ jar: jarId, entryPath });
	});
});

// =========================================================================
// Windows 8.3 short-name canonicalization (Phase 39 Failure 1 root cause)
// =========================================================================
// JDT LS internally canonicalizes 8.3 short Windows filenames (`LOGAND~1`)
// to their long form (`LoganDark`) and emits Location.uri values using the
// long form. The mapper MUST resolve the input tempDir via
// `realpathSync.native` so its prefix matches JDT LS's reply shape. Without
// this, on a Windows host where `os.tmpdir()` returns a short-name path,
// `find_definition` reports a JDT LS reply count of 1 but the envelope's
// final result list is empty (the URI cannot map back to a jar ID).
//
// Only runs on a real Windows host: 8.3 short names are a Windows
// filesystem feature; on Unix `realpathSync.native(t)` is a no-op
// canonicalization and there's nothing to assert.
describe.runIf(process.platform === 'win32')('Windows: 8.3 short-name canonicalization', () => {
	it('toFileUri + prefix use the canonical (long-name) form when tempDir is an 8.3 short path', async () => {
		const { realpathSync, mkdirSync, rmSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const { randomUUID } = await import('node:crypto');

		// Create a real temp dir under os.tmpdir(). On hosts where the username
		// exceeds 8 chars, os.tmpdir() returns the 8.3 short form (the bug
		// trigger). On hosts with short usernames the test is a no-op
		// canonicalization (mapper still produces a valid URI; we just can't
		// assert the long-form-different behavior).
		const shortDir = join(tmpdir(), 'uri-mapper-83-test-' + randomUUID());
		mkdirSync(shortDir, { recursive: true });
		try {
			const longDir = realpathSync.native(shortDir);
			const wasShort = shortDir !== longDir;

			const { createUriMapper } = await import('../../src/jdtls/uri-mapper.js');
			const mapper = createUriMapper(shortDir, new Map([['minecraft', 'minecraft']]));

			// toFileUri output MUST use the long-name form so JDT LS sees the
			// same shape it would canonicalize to internally.
			const uri = mapper.toFileUri('minecraft', 'foo/Bar.java');
			const longUriPattern = longDir.replace(/\\/g, '/');
			expect(uri).toContain(longUriPattern);

			if (wasShort) {
				expect(uri).not.toContain(shortDir.replace(/\\/g, '/'));
			}

			// fromFileUri MUST recognize a JDT LS-style long-name URI back to the
			// jar ID, even though the original tempDir we passed in had the short
			// form. This is the actual production failure: JDT LS replies with
			// long form, our mapper must accept it.
			const longUri = `file:///${longDir.replace(/\\/g, '/')}/minecraft/foo/Bar.java`;
			expect(mapper.fromFileUri(longUri)).toEqual({ jar: 'minecraft', entryPath: 'foo/Bar.java' });
		} finally {
			try { rmSync(shortDir, { recursive: true, force: true }); } catch {}
		}
	});
});
