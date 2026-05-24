import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Recursively walk a directory yielding every .ts file path.
 *
 * The walker MUST stay strictly within the `src` tree — passing 'src'
 * keeps the scan scope opaque to this test file (which itself contains
 * the literal `process.env.HOME` inside the regex source below). See
 * Phase 38 RESEARCH §"Common Pitfalls" Pitfall 5.
 */
async function* walk(dir: string): AsyncGenerator<string> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(p);
		} else if (entry.isFile() && p.endsWith('.ts')) {
			yield p;
		}
	}
}

describe('process.env.HOME regression gate', () => {
	it('src/**/*.ts contains no references to process.env.HOME (Phase 38 D-09)', async () => {
		const offenders: string[] = [];
		const pattern = /process\.env\.HOME\b/;
		for await (const file of walk('src')) {
			const content = await readFile(file, 'utf-8');
			if (pattern.test(content)) {
				offenders.push(file);
			}
		}
		expect(offenders, 'use os.homedir() instead — see Phase 38 D-08/D-09').toEqual([]);
	});
});
