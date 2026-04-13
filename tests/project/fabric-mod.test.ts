import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFabricMod } from '../../src/project/fabric-mod.js';
import { DomainError } from '../../src/errors/domain-error.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '..', 'fixtures');

describe('parseFabricMod', () => {
	it('parses valid fabric.mod.json from yarn-era fixture', async () => {
		const content = await readFile(resolve(fixturesDir, 'yarn-era', 'src', 'main', 'resources', 'fabric.mod.json'), 'utf-8');
		const mod = parseFabricMod(content);
		expect(mod.id).toBe('testmod');
		expect(mod.schemaVersion).toBe(1);
		expect(mod.name).toBe('Test Mod');
		expect(mod.mixins).toContain('testmod.mixins.json');
	});

	it('handles ${version} as a literal string value', async () => {
		const content = await readFile(resolve(fixturesDir, 'yarn-era', 'src', 'main', 'resources', 'fabric.mod.json'), 'utf-8');
		const mod = parseFabricMod(content);
		expect(mod.version).toBe('${version}');
	});

	it('throws DomainError with FABRIC_MOD_INVALID_JSON for malformed JSON', () => {
		expect(() => parseFabricMod('not json {')).toThrow(DomainError);
		try {
			parseFabricMod('not json {');
		} catch (e) {
			expect((e as DomainError).code).toBe('FABRIC_MOD_INVALID_JSON');
		}
	});

	it('throws DomainError with FABRIC_MOD_VALIDATION for missing required fields', () => {
		const content = JSON.stringify({ schemaVersion: 1 });
		expect(() => parseFabricMod(content)).toThrow(DomainError);
		try {
			parseFabricMod(content);
		} catch (e) {
			expect((e as DomainError).code).toBe('FABRIC_MOD_VALIDATION');
		}
	});
});
