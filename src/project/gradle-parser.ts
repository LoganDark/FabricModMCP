import { homedir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '../errors/domain-error.js';
import type { DependencyCoordinate, GradleConfig, MappingEra } from './types.js';

/**
 * Strip a `//` line comment from a single line, ignoring `//` that occur
 * inside double-quoted string literals. Preserves URL schemes (`file://`,
 * `http://`, `https://`, etc.) that appear inside Kotlin string literals.
 */
function stripLineComment(line: string): string {
	let inString = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '\\' && i + 1 < line.length) {
			// Skip escape sequence (e.g. \" inside a string)
			i++;
			continue;
		}
		if (c === '"') {
			inString = !inString;
			continue;
		}
		if (!inString && c === '/' && line[i + 1] === '/') {
			return line.slice(0, i);
		}
	}
	return line;
}

/**
 * Convert a `file://` URI (already user-home-substituted) into an absolute
 * filesystem path. Strips the `file://` scheme; if the remainder begins with
 * `~/`, substitutes homedir().
 */
function fileUriToPath(uri: string): string {
	let path = uri.replace(/^file:\/\//, '');
	if (path.startsWith('~/')) {
		path = join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Extract absolute filesystem paths of file:// Maven repositories (and
 * mavenLocal()) from a `repositories { ... }` block. Returns an empty array
 * when no such block exists or when no local-file repos are declared.
 */
function extractMavenRoots(substituted: string): string[] {
	const repoMatch = substituted.match(/repositories\s*\{([\s\S]*?)\n\}/);
	if (!repoMatch) return [];

	// Expand the Kotlin-DSL placeholder ${System.getProperty("user.home")}
	// (or single-quoted variant) BEFORE running the URI regexes. This is a
	// literal substring substitution -- the existing properties map only
	// handles ${var_name} style, which is unrelated.
	const home = homedir();
	const repoBlock = repoMatch[1]
		.replace(/\$\{System\.getProperty\("user\.home"\)\}/g, home)
		.replace(/\$\{System\.getProperty\('user\.home'\)\}/g, home);

	// Track ordered insertions, deduplicated by absolute path.
	const seen = new Set<string>();
	const order: { index: number; path: string }[] = [];

	function addAt(index: number, path: string): void {
		if (seen.has(path)) return;
		seen.add(path);
		order.push({ index, path });
	}

	// a) Block form with uri() wrapper: maven { ... url = uri("file://...") }
	const blockUriRegex = /maven\s*\{[^{}]*?\burl\s*=\s*uri\(\s*"(file:[^"]+)"\s*\)/g;
	for (let m: RegExpExecArray | null; (m = blockUriRegex.exec(repoBlock)) !== null;) {
		addAt(m.index, fileUriToPath(m[1]));
	}

	// b) Block form with plain string: maven { ... url = "file://..." }
	const blockStrRegex = /maven\s*\{[^{}]*?\burl\s*=\s*"(file:[^"]+)"/g;
	for (let m: RegExpExecArray | null; (m = blockStrRegex.exec(repoBlock)) !== null;) {
		addAt(m.index, fileUriToPath(m[1]));
	}

	// c) Shorthand call form: maven("file://...")
	const shorthandRegex = /\bmaven\(\s*"(file:[^"]+)"\s*\)/g;
	for (let m: RegExpExecArray | null; (m = shorthandRegex.exec(repoBlock)) !== null;) {
		addAt(m.index, fileUriToPath(m[1]));
	}

	// d) mavenLocal() -> ~/.m2/repository
	const mavenLocalRegex = /\bmavenLocal\s*\(\s*\)/g;
	for (let m: RegExpExecArray | null; (m = mavenLocalRegex.exec(repoBlock)) !== null;) {
		addAt(m.index, join(home, '.m2', 'repository'));
	}

	// Preserve declaration (textual) order across all four kinds.
	order.sort((a, b) => a.index - b.index);
	return order.map(o => o.path);
}

export function parseGradleProperties(content: string): Map<string, string> {
	const props = new Map<string, string>();
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		props.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
	}
	return props;
}

export function parseBuildGradle(content: string, properties: Map<string, string>): GradleConfig {
	// Step 1: Substitute ${var_name} references using properties map
	let substituted = content.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
		return properties.get(varName) ?? _match;
	});

	// Step 2: Strip comments
	// Line comments: only strip `//` that are NOT inside a string literal.
	// A pragmatic approach: scan each line and find the first `//` that is
	// not enclosed in double quotes. This preserves URL schemes like
	// file:///, http://, https:// inside string literals (which the prior
	// blanket strip mangled into a known parser bug).
	substituted = substituted.split('\n').map(stripLineComment).join('\n');
	substituted = substituted.replace(/\/\*[\s\S]*?\*\//g, '');

	// Step 3: Extract Maven repository roots from repositories { ... } block
	const mavenRoots = extractMavenRoots(substituted);

	// Step 4: Extract dependencies block
	const depsMatch = substituted.match(/dependencies\s*\{([\s\S]*?)\n\}/);
	const depsBlock = depsMatch ? depsMatch[1] : '';

	// Step 4: Extract individual dependency calls
	const depCallRegex = /(\w+)\(\s*"([^"]+)"\s*\)/g;
	const dependencies: DependencyCoordinate[] = [];
	let match: RegExpExecArray | null;

	while ((match = depCallRegex.exec(depsBlock)) !== null) {
		const configuration = match[1];
		const coordinate = match[2];
		const parts = coordinate.split(':');
		if (parts.length >= 3) {
			dependencies.push({
				configuration,
				group: parts[0],
				artifact: parts[1],
				version: parts[2],
				raw: coordinate,
			});
		}
	}

	// Step 5: Era detection
	const hasMappings = dependencies.some(d => d.configuration === 'mappings');
	const mappingEra: MappingEra = hasMappings ? 'mapped' : 'unmapped';

	// Step 6: Extract convenience fields
	const minecraftDep = dependencies.find(d => d.configuration === 'minecraft');
	if (!minecraftDep) {
		throw new DomainError(
			'GRADLE_PARSE_MISSING_MINECRAFT',
			'No minecraft(...) dependency found in build.gradle.kts dependencies block',
			['Searched dependencies block for minecraft(...) call'],
			['Ensure build.gradle.kts has a minecraft("com.mojang:minecraft:VERSION") dependency'],
		);
	}

	const mappingsDep = dependencies.find(d => d.configuration === 'mappings');
	const loaderDep = dependencies.find(d => d.artifact === 'fabric-loader');
	const fabricApiDep = dependencies.find(d => d.artifact === 'fabric-api');

	return {
		minecraftVersion: minecraftDep.version,
		mappingEra,
		yarnMappings: mappingsDep?.version,
		loaderVersion: loaderDep?.version,
		fabricApiVersion: fabricApiDep?.version,
		dependencies,
		mavenRoots,
	};
}
