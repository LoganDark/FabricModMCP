import { describe, it, expect } from 'vitest';
import { parseFabricMod } from '../src/project/fabric-mod.js';

const VALID_MOD_JSON = JSON.stringify({
	schemaVersion: 1,
	id: 'testmod',
	version: '1.0.0',
	name: 'Test Mod',
	description: 'A test mod',
	authors: ['Author'],
	license: 'MIT',
	environment: '*',
	mixins: [],
	depends: { fabricloader: '>=0.15.0' },
});

describe('parseFabricMod', () => {
	it('parses valid fabric.mod.json without properties (backward compat)', () => {
		const result = parseFabricMod(VALID_MOD_JSON);
		expect(result.id).toBe('testmod');
		expect(result.name).toBe('Test Mod');
	});

	it('substitutes ${} placeholders when properties are provided', () => {
		const content = JSON.stringify({
			schemaVersion: 1,
			id: '${mod_id}',
			version: '${mod_version}',
			name: '${mod_name}',
			description: 'A templated mod',
			authors: ['Author'],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		});

		const properties = new Map<string, string>([
			['mod_id', 'template'],
			['mod_version', '2.0.0'],
			['mod_name', 'Template Mod'],
		]);

		const result = parseFabricMod(content, properties);
		expect(result.id).toBe('template');
		expect(result.version).toBe('2.0.0');
		expect(result.name).toBe('Template Mod');
	});

	it('leaves unmatched ${} placeholders as-is', () => {
		const content = JSON.stringify({
			schemaVersion: 1,
			id: '${mod_id}',
			version: '${unknown_prop}',
			name: 'Test',
			description: '',
			authors: [],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		});

		const properties = new Map<string, string>([
			['mod_id', 'resolved'],
		]);

		const result = parseFabricMod(content, properties);
		expect(result.id).toBe('resolved');
		expect(result.version).toBe('${unknown_prop}');
	});

	it('works with empty properties map (no substitutions)', () => {
		const content = JSON.stringify({
			schemaVersion: 1,
			id: '${mod_id}',
			version: '1.0.0',
			name: 'Test',
			description: '',
			authors: [],
			license: 'MIT',
			environment: '*',
			mixins: [],
			depends: {},
		});

		const properties = new Map<string, string>();

		const result = parseFabricMod(content, properties);
		expect(result.id).toBe('${mod_id}');
	});
});
