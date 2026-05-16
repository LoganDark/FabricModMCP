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

describe('A2: host-darwin auto-detection of Windows-shaped paths', () => {
	// Phase 36 RESEARCH §A2 (MEDIUM-risk assumption) — RESOLVED IN FAIL DIRECTION.
	//
	// Original assumption: on a darwin host, pathToFileURL('C:\\foo') would
	// auto-detect the drive-letter prefix and emit `file:///C:/foo` without
	// needing the `{ windows: true }` option.
	//
	// Empirical outcome (Phase 36 Plan 01, Task 3): A2 does NOT hold on darwin.
	// pathToFileURL parses `'C:\\foo'` as a relative POSIX path → resolved
	// against cwd → URL contains `C:%5Cfoo` as a tail segment, not `/C:/foo`.
	//
	// Mitigation applied per RESEARCH §A2: pathToFileUri's signature was
	// upgraded to accept `opts?: { windows?: boolean }`. Default branch is
	// unchanged (host-detected); opt-in flips Node into Windows-flavor mode.
	// Plan 03's Windows-mocked fixtures will pass `{ windows: true }` at
	// fixture-construction sites.
	//
	// Test below exercises BOTH the failure of host auto-detection AND the
	// success of the explicit `{ windows: true }` opt-in. Intentionally NO
	// setPlatform flip — we interrogate Node's stdlib behavior on the actual
	// host plus the wrapper's options pass-through.

	it("host default: pathToFileUri('C:\\\\foo') does NOT auto-detect Windows shape on non-Windows host", () => {
		// Documents the empirical A2-fails behavior so this regression is
		// caught loudly if Node ever changes auto-detection on darwin/linux.
		if (process.platform === 'win32') {
			// On real Windows the auto-detect succeeds — assertion is the
			// opposite of the non-Windows path.
			expect(pathToFileUri('C:\\foo')).toMatch(/^file:\/\/\/C:\/foo/);
			return;
		}
		// Non-Windows host: the bare-default call treats `C:\foo` as a relative
		// POSIX path, so the result does NOT start with `file:///C:/foo`.
		expect(pathToFileUri('C:\\foo')).not.toMatch(/^file:\/\/\/C:\/foo/);
	});

	it("opt-in: pathToFileUri('C:\\\\foo', { windows: true }) produces file:///C:/foo on any host", () => {
		expect(pathToFileUri('C:\\foo', { windows: true })).toMatch(/^file:\/\/\/C:\/foo/);
	});
});
