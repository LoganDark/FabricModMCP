import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { parseCli } from '../../src/cli/args.js';

describe('parseCli', () => {
	it('multiple --project flags returns array', () => {
		const args = parseCli(['--project', '/path/a', '--project', '/path/b']);
		expect(args.projects).toEqual([resolve('/path/a'), resolve('/path/b')]);
	});

	it('zero --project flags returns empty array', () => {
		const args = parseCli([]);
		expect(args.projects).toEqual([]);
	});

	it('single --project returns single-element array', () => {
		const args = parseCli(['--project', '/path/a']);
		expect(args.projects).toEqual([resolve('/path/a')]);
	});
});
