import { describe, it, expect, vi, afterEach } from 'vitest';
import { pathToFileUri, fileUriToPath } from '../../src/platform/uri.js';

// Capture host environment once so afterEach can restore it. uri.ts has no
// module-load-time platform state today, but we mirror Phase 35's scaffolding
// (D-21) so future platform-flipped describes can use the same shape.

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
	setPlatform(originalPlatform);
	vi.resetModules();
});

describe('UNIX-02 round-trip identity', () => {
	// Run on the host platform (no setPlatform flip). pathToFileURL /
	// fileURLToPath are byte-identical inverses for POSIX-shaped inputs on
	// every supported host, so the round-trip identity is platform-agnostic.

	it('round-trips /tmp/foo', () => {
		const input = '/tmp/foo';
		expect(fileUriToPath(pathToFileUri(input))).toBe(input);
	});

	it('round-trips /private/var/folders/x y/file.java (space → %20)', () => {
		const input = '/private/var/folders/x y/file.java';
		// Space must be percent-encoded in the URI form…
		expect(pathToFileUri(input)).toContain('%20');
		// …but the inverse must decode back to the original byte-for-byte.
		expect(fileUriToPath(pathToFileUri(input))).toBe(input);
	});

	it('round-trips /tmp/path%with#odd$chars (literal % and #)', () => {
		const input = '/tmp/path%with#odd$chars';
		expect(fileUriToPath(pathToFileUri(input))).toBe(input);
	});
});

describe('WIN-03 three-slash form (Windows-mocked)', () => {
	it('Windows: pathToFileUri emits file:///… (three-slash form)', async () => {
		setPlatform('win32');
		vi.resetModules();
		const { pathToFileUri } = await import('../../src/platform/uri.js');
		// Dynamic re-import does not change uri.ts behavior (no module-load-time
		// platform state), but is kept for D-21 scaffolding consistency. The
		// three-slash form is emitted by Node's pathToFileURL regardless of host
		// — for a POSIX-shaped input it produces `file:///<path>`.
		const uri = pathToFileUri('/tmp/foo');
		expect(uri).toMatch(/^file:\/\/\//);
		// URL constructor accepts the result (sanity)
		expect(new URL(uri).protocol).toBe('file:');
	});
});

describe('WIN-03 percent-encoding', () => {
	it('encodes spaces as %20 (not literal space)', () => {
		const uri = pathToFileUri('/tmp/x y');
		expect(uri).toContain('%20');
		// No raw spaces after the scheme — the entire URI must be
		// URL-component-safe.
		const afterScheme = uri.slice('file://'.length);
		expect(afterScheme).not.toContain(' ');
	});
});
