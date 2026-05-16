/**
 * Java Discovery — Locate a Java 21+ installation for JDT LS.
 *
 * Owns the priority-chain discovery API (`discoverJava`) and the byte-identical
 * v1.5 sync API (`detectJava`). Module-state `configuredJavaHome` is set via
 * `setJavaHome(s)` and consulted by both APIs.
 *
 * Slot order for `discoverJava`:
 *   1. `--java-home` (module-state `configuredJavaHome`)
 *   2. `org.gradle.java.home` from `<projectRoot>/gradle.properties`
 *   3. `JAVA_HOME` env var
 *   4. `java` on PATH (libuv handles PATH lookup + PATHEXT on Windows)
 *   5. Scan common install locations from `commonJavaLocations()` with
 *      vendor-aware layout map
 *
 * Per-candidate probe: `execFile(java, ['--version'], { timeout: 3_000 })`.
 * Skip-on-fail semantics: a candidate with Java < 21 does NOT abort the
 * chain; only when every slot fails does `discoverJava` synthesize a
 * multi-line `Java not found.` error.
 */

import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logging/logger.js';
import { javaBinaryName, javaBinaryInHome, commonJavaLocations, isWindows } from '../platform/index.js';
import { parseGradleProperties } from '../project/gradle-parser.js';

const execFileAsync = promisify(execFile);

export type JavaDetected = {
	javaPath: string;
	version: number;
}

export type JavaNotFound = {
	javaPath: null;
	error: string;
}

export type JavaDetectResult = JavaDetected | JavaNotFound;

let configuredJavaHome: string | undefined;

/**
 * Override the Java home used by detectJava / discoverJava. Takes precedence
 * over JAVA_HOME. Pass undefined to clear the override.
 */
export function setJavaHome(javaHome: string | undefined): void {
	configuredJavaHome = javaHome;
}

/**
 * Detect a Java 21+ installation (sync, v1.5 byte-identical).
 *
 * Checks the configured override (set via setJavaHome) first, then JAVA_HOME,
 * then falls back to java on PATH. Does NOT consult `org.gradle.java.home`
 * and does NOT scan common install locations — that's `discoverJava`.
 * Returns the java binary path and major version, or an error message.
 */
export function detectJava(): JavaDetectResult {
	const candidates: string[] = [];

	const javaHome = configuredJavaHome ?? process.env.JAVA_HOME;
	if (javaHome) {
		candidates.push(javaBinaryInHome(javaHome));
	}
	candidates.push(javaBinaryName());

	for (const candidate of candidates) {
		const javaPath = resolveJavaExecutable(candidate);
		if (javaPath === null) continue;
		try {
			const output = execSync(`"${javaPath}" --version`, {
				encoding: 'utf-8',
				timeout: 10_000,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			const version = parseJavaVersion(output);
			if (version === null) {
				continue;
			}

			if (version < 21) {
				return {
					javaPath: null,
					error: `Java ${version} found but JDT LS requires Java 21+`,
				};
			}

			return { javaPath, version };
		} catch {
			continue;
		}
	}

	return {
		javaPath: null,
		error: 'Java not found. Set JAVA_HOME or add java to PATH.',
	};
}

/**
 * Resolve a Java candidate path to a file that `child_process.spawn` can exec.
 *
 * Bare names (no path separator) pass through unchanged — libuv applies PATHEXT
 * for PATH lookups in `spawn` on Windows even though it does NOT for absolute
 * paths (see nodejs/node#6671). On Windows, candidates with a separator are
 * probed via `existsSync`: returned as-is if present, suffixed with `.exe` and
 * re-probed otherwise (case-insensitive guard against `.exe.exe`), or returned
 * as `null` so the caller skips this candidate cleanly instead of letting
 * `spawn` fail later with ENOENT. On non-Windows platforms the candidate is
 * returned byte-identical with NO `existsSync` call — UNIX-01 commitment so
 * existing v1.5 `detectJava` tests that assert exact fake paths like
 * `'/cli/java/bin/java'` continue to pass without modification.
 */
export function resolveJavaExecutable(candidate: string): string | null {
	const hasSeparator = candidate.includes('/') || candidate.includes('\\');
	if (!hasSeparator) return candidate;

	if (isWindows) {
		if (existsSync(candidate)) return candidate;
		if (!candidate.toLowerCase().endsWith('.exe') && existsSync(candidate + '.exe')) {
			return candidate + '.exe';
		}
		return null;
	}
	return candidate;
}

/**
 * Parse the major version number from `java --version` output.
 * Handles formats like "openjdk 21.0.1 2023-10-17" and "java 21 2023-09-19".
 */
export function parseJavaVersion(output: string): number | null {
	// Match version patterns like "21.0.1", "17.0.8", "1.8.0_381"
	const match = output.match(/(?:version\s+")?([\d]+)(?:\.([\d]+))?/);
	if (!match) return null;

	const major = parseInt(match[1], 10);
	// Handle legacy 1.x versioning (1.8 = Java 8)
	if (major === 1 && match[2]) {
		return parseInt(match[2], 10);
	}
	return major;
}

/**
 * Decode a single Java Properties value escape sequence per the
 * `java.util.Properties` spec:
 *   `\\` → `\`, `\:` → `:`, `\=` → `=`,
 *   `\t` → tab, `\n` → LF, `\r` → CR, `\f` → FF,
 *   `\uXXXX` (exactly 4 hex digits) → UTF-16 code unit,
 *   `\X` (unknown) → `X` (backslash dropped).
 *
 * Implemented as a single-pass scanner so `\\u0043` decodes to literal `C`
 * (NOT the C character) — chained `replace()` calls cannot honor this.
 */
export function unescapePropertiesValue(value: string): string {
	let out = '';
	const len = value.length;
	for (let i = 0; i < len; i++) {
		const c = value[i];
		if (c !== '\\') {
			out += c;
			continue;
		}
		// Backslash — peek next character
		if (i + 1 >= len) {
			// Trailing backslash with nothing after — drop it (spec is silent;
			// behave like an unknown-escape `\<EOF>` which would be empty).
			break;
		}
		const next = value[i + 1];
		switch (next) {
			case '\\': out += '\\'; i++; break;
			case ':':  out += ':';  i++; break;
			case '=':  out += '=';  i++; break;
			case 't':  out += '\t'; i++; break;
			case 'n':  out += '\n'; i++; break;
			case 'r':  out += '\r'; i++; break;
			case 'f':  out += '\f'; i++; break;
			case 'u': {
				// Need exactly 4 hex digits AFTER the 'u'
				if (i + 5 < len) {
					const hex = value.slice(i + 2, i + 6);
					if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
						out += String.fromCharCode(parseInt(hex, 16));
						i += 5;  // consume 'u' + 4 hex chars
						break;
					}
				}
				// Not a valid \uXXXX — fall through to unknown-escape (drop \)
				out += 'u';
				i++;
				break;
			}
			default:
				// Unknown escape: drop the backslash, keep the literal char
				out += next;
				i++;
				break;
		}
	}
	return out;
}

/**
 * Vendor-aware layout map: which path shape inside `<parent>/<entry>/` is the
 * java binary?
 *
 * - `depth1` — `<entry>/bin/java[.exe]` (Adoptium, Microsoft, Oracle, Corretto,
 *   Zulu, IntelliJ ~/.jdks, /usr/lib/jvm, /opt)
 * - `mac-bundle` — `<entry>/Contents/Home/bin/java` (macOS
 *   /Library/Java/JavaVirtualMachines and per-user equivalent)
 * - `homebrew` — `<entry>/libexec/openjdk.jdk/Contents/Home/bin/java`
 *   (/opt/homebrew/opt and /usr/local/opt — `openjdk*` only)
 * - `scoop` — `<entry>/current/bin/java.exe` (~/scoop/apps — `current` is
 *   Scoop's version pointer)
 */
type VendorLayout = 'depth1' | 'mac-bundle' | 'homebrew' | 'scoop';

function vendorLayoutFor(parent: string): VendorLayout {
	if (parent.endsWith('/scoop/apps') || parent.endsWith('\\scoop\\apps')) return 'scoop';
	if (parent === '/opt/homebrew/opt' || parent === '/usr/local/opt') return 'homebrew';
	if (parent === '/Library/Java/JavaVirtualMachines'
		|| parent.endsWith('/Library/Java/JavaVirtualMachines')) return 'mac-bundle';
	return 'depth1';
}

function candidateFromEntry(parent: string, entry: string, layout: VendorLayout): string {
	const javaBin = javaBinaryName();
	switch (layout) {
		case 'depth1':     return join(parent, entry, 'bin', javaBin);
		case 'mac-bundle': return join(parent, entry, 'Contents', 'Home', 'bin', javaBin);
		case 'homebrew':   return join(parent, entry, 'libexec', 'openjdk.jdk', 'Contents', 'Home', 'bin', javaBin);
		case 'scoop':      return join(parent, entry, 'current', 'bin', javaBin);
	}
}

/**
 * Vendor-aware entry filter.
 *
 * `/opt` on Linux typically contains many non-Java packages — accept only
 * entries matching JDK naming conventions (D-16). Homebrew opt prefixes hold
 * many non-Java formulae — accept only `openjdk*` entries. `/usr/lib/jvm`
 * passes through unfiltered: by Linux convention that directory holds JDKs
 * only.
 */
function acceptEntry(parent: string, entry: string, layout: VendorLayout): boolean {
	if (parent === '/opt') {
		return /^(jdk-|.*-jdk|temurin-|zulu-|corretto-|openjdk-)/.test(entry);
	}
	if (layout === 'homebrew') return entry.startsWith('openjdk');
	return true;
}

/**
 * Extract a best-effort major version from a JDK directory entry name for
 * sort-order purposes only. The real version comes from `--version`.
 *
 * Returns 0 when no digit is found — such entries sort last but are still
 * probed.
 */
function parseVersionHint(entry: string): number {
	const m = entry.match(/\b(\d+)(?:[.\d_-]+)?/);
	return m ? parseInt(m[1], 10) : 0;
}

/**
 * Per-candidate outcome taxonomy (D-22). The `success` variant short-circuits
 * the chain; every other outcome feeds the multi-line failure synthesizer.
 */
type CandidateOutcome =
	| { kind: 'success'; javaPath: string; version: number }
	| { kind: 'not-set' }
	| { kind: 'file-not-found' }
	| { kind: 'version-too-old'; version: number }
	| { kind: 'timed-out' }
	| { kind: 'probe-failed'; message: string };

/**
 * Run `<candidate> --version` with a 3s timeout and classify the outcome.
 */
async function probeCandidate(candidate: string): Promise<CandidateOutcome> {
	const resolved = resolveJavaExecutable(candidate);
	if (resolved === null) return { kind: 'file-not-found' };
	try {
		const { stdout, stderr } = await execFileAsync(resolved, ['--version'], {
			timeout: 3_000,
			encoding: 'utf-8',
		});
		const output = (stdout + stderr) || '';
		const version = parseJavaVersion(output);
		if (version === null) return { kind: 'probe-failed', message: 'unparseable --version output' };
		if (version < 21) return { kind: 'version-too-old', version };
		return { kind: 'success', javaPath: resolved, version };
	} catch (err) {
		const e = err as NodeJS.ErrnoException & { signal?: string; killed?: boolean };
		if (e.signal === 'SIGTERM' || e.signal === 'SIGKILL' || e.killed === true) {
			return { kind: 'timed-out' };
		}
		return { kind: 'probe-failed', message: e.message ?? String(err) };
	}
}

/**
 * Enumerate candidate java binaries inside a single parent directory.
 *
 * Skips silently if the parent doesn't exist (D-12 step 1). Applies the
 * vendor-aware filter + layout map and sorts by version hint descending so
 * newer JDKs are probed first within a parent.
 */
async function enumerateParent(parent: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await readdir(parent);
	} catch {
		return [];
	}
	const layout = vendorLayoutFor(parent);
	return entries
		.filter(e => acceptEntry(parent, e, layout))
		.map(e => ({ entry: e, version: parseVersionHint(e) }))
		.sort((a, b) => b.version - a.version)
		.map(({ entry }) => candidateFromEntry(parent, entry, layout));
}

/**
 * Read `org.gradle.java.home` from `<projectRoot>/gradle.properties` and decode
 * Java-properties backslash escapes. Returns undefined when projectRoot is
 * unset, the file is missing/unreadable, or the key is absent.
 */
async function readProjectGradleJavaHome(projectRoot: string | undefined): Promise<string | undefined> {
	if (projectRoot === undefined) return undefined;
	let content: string;
	try {
		content = await readFile(join(projectRoot, 'gradle.properties'), 'utf-8');
	} catch {
		return undefined;
	}
	const props = parseGradleProperties(content);
	const raw = props.get('org.gradle.java.home');
	if (raw === undefined) return undefined;
	return unescapePropertiesValue(raw);
}

/**
 * Async priority-chain discovery of a Java 21+ installation.
 *
 * Evaluates the five slots sequentially in locked order; first success
 * short-circuits. On full failure synthesizes a multi-line `Java not found.`
 * message with per-slot reasons (D-18/D-21/D-22).
 *
 * Worst-case latency cap: 6 vendor parents × ~2 candidates × 3s = 36s (D-15).
 * Parallel probes would destroy priority semantics and are rejected.
 */
export async function discoverJava(opts: { projectRoot?: string } = {}): Promise<JavaDetectResult> {
	type SlotRecord = { label: string; outcome: CandidateOutcome };
	const outcomes: SlotRecord[] = [];

	function record(label: string, candidate: string | null, outcome: CandidateOutcome): void {
		outcomes.push({ label, outcome });
		if (outcome.kind !== 'success' && candidate !== null) {
			logger.debug('Java candidate skipped', { candidate, reason: outcome.kind });
		} else if (outcome.kind !== 'success') {
			logger.debug('Java candidate skipped', { candidate: label, reason: outcome.kind });
		}
	}

	function returnSuccess(o: Extract<CandidateOutcome, { kind: 'success' }>): JavaDetected {
		return { javaPath: o.javaPath, version: o.version };
	}

	// Slot 1: --java-home (configuredJavaHome module state)
	{
		const label = '--java-home';
		if (configuredJavaHome) {
			const candidate = javaBinaryInHome(configuredJavaHome);
			const outcome = await probeCandidate(candidate);
			record(label, candidate, outcome);
			if (outcome.kind === 'success') return returnSuccess(outcome);
		} else {
			record(label, null, { kind: 'not-set' });
		}
	}

	// Slot 2: org.gradle.java.home from <projectRoot>/gradle.properties
	{
		const label = 'org.gradle.java.home';
		const gradleHome = await readProjectGradleJavaHome(opts.projectRoot);
		if (gradleHome) {
			const candidate = javaBinaryInHome(gradleHome);
			const outcome = await probeCandidate(candidate);
			record(label, candidate, outcome);
			if (outcome.kind === 'success') return returnSuccess(outcome);
		} else {
			record(label, null, { kind: 'not-set' });
		}
	}

	// Slot 3: JAVA_HOME env var
	{
		const label = 'JAVA_HOME';
		const javaHomeEnv = process.env.JAVA_HOME;
		if (javaHomeEnv) {
			const candidate = javaBinaryInHome(javaHomeEnv);
			const outcome = await probeCandidate(candidate);
			record(label, candidate, outcome);
			if (outcome.kind === 'success') return returnSuccess(outcome);
		} else {
			record(label, null, { kind: 'not-set' });
		}
	}

	// Slot 4: java on PATH (bare name — resolveJavaExecutable passes through)
	{
		const label = 'java on PATH';
		const candidate = javaBinaryName();
		const outcome = await probeCandidate(candidate);
		record(label, candidate, outcome);
		if (outcome.kind === 'success') return returnSuccess(outcome);
	}

	// Slot 5: scan commonJavaLocations()
	for (const parent of commonJavaLocations()) {
		const candidates = await enumerateParent(parent);
		for (const candidate of candidates) {
			const outcome = await probeCandidate(candidate);
			record(candidate, candidate, outcome);
			if (outcome.kind === 'success') return returnSuccess(outcome);
		}
	}

	// All slots failed — synthesize multi-line failureReason.
	const lines: string[] = ['Java not found. Tried:'];
	for (const { label, outcome } of outcomes) {
		lines.push('  ' + formatSlotLine(label, outcome, opts.projectRoot));
	}
	lines.push('Install Java 21+ (Adoptium / Microsoft / Zulu) or set JAVA_HOME / --java-home.');
	return { javaPath: null, error: lines.join('\n') };
}

/**
 * Format a single failureReason line for a given slot label + outcome.
 *
 * Slot-label conventions per D-21; outcome-reason taxonomy per D-22.
 */
function formatSlotLine(label: string, outcome: CandidateOutcome, projectRoot: string | undefined): string {
	if (label === '--java-home') {
		if (outcome.kind === 'not-set') return '--java-home: (not set)';
		return '--java-home ' + (configuredJavaHome ?? '') + ': ' + formatReason(outcome);
	}
	if (label === 'org.gradle.java.home') {
		if (outcome.kind === 'not-set') {
			if (projectRoot === undefined) return 'org.gradle.java.home: (not set)';
			return 'org.gradle.java.home: (not set in ' + join(projectRoot, 'gradle.properties') + ')';
		}
		const gradlePropsPath = projectRoot !== undefined ? join(projectRoot, 'gradle.properties') : 'gradle.properties';
		return 'org.gradle.java.home (from ' + gradlePropsPath + '): ' + formatReason(outcome);
	}
	if (label === 'JAVA_HOME') {
		if (outcome.kind === 'not-set') return 'JAVA_HOME: (not set)';
		const v = process.env.JAVA_HOME ?? '';
		return 'JAVA_HOME=' + v + ': ' + formatReason(outcome);
	}
	if (label === 'java on PATH') {
		if (outcome.kind === 'not-set') return 'java on PATH: (not set)';
		return 'java on PATH: ' + formatReason(outcome);
	}
	// Scan slot: label is a bare absolute path
	return label + ': ' + formatReason(outcome);
}

function formatReason(outcome: CandidateOutcome): string {
	switch (outcome.kind) {
		case 'success':         return 'OK (Java ' + outcome.version + ')';
		case 'not-set':         return '(not set)';
		case 'file-not-found':  return '(file not found)';
		case 'version-too-old': return 'Java ' + outcome.version + ' (need 21+)';
		case 'timed-out':       return 'timed out after 3s';
		case 'probe-failed':    return 'probe failed: ' + outcome.message;
	}
}
