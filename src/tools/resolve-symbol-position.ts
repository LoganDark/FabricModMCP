/**
 * Shared cascading-regex-to-LSP-position resolver.
 *
 * Extracts the common pattern of: FQN -> entry path -> read source -> cascade regex -> file URI.
 * Used by get_symbol_info, find_implementations (and potentially others).
 * Avoids quadruple duplication of this logic.
 */

import type { DependencyEntry, JarCategory, LoadedProject } from '../project/types.js';
import type { CascadeStep, CascadeSuccess } from '../browsing/cascading-regex.js';
import { getFilteredDependencies } from '../project/jar-registry.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { cascadeRegex } from '../browsing/cascading-regex.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';

// Priority order for jar categories when searching all jars
const CATEGORY_PRIORITY: Record<JarCategory, number> = {
	'minecraft': 0,
	'mod-source': 1,
	'fabric-api': 2,
	'library': 3,
};

function sortByPriority(entries: [string, DependencyEntry][]): [string, DependencyEntry][] {
	return entries.sort((a, b) => {
		const pa = CATEGORY_PRIORITY[a[1].category] ?? 99;
		const pb = CATEGORY_PRIORITY[b[1].category] ?? 99;
		if (pa !== pb) return pa - pb;
		return a[0].localeCompare(b[0]);
	});
}

export interface SymbolPositionSuccess {
	success: true;
	sourceJarId: string;
	sourceText: string;
	cascadeResult: CascadeSuccess;
	fileUri: string;
	entryPath: string;
}

export interface SymbolPositionCascadeFailure {
	success: false;
	kind: 'cascade-failure';
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	steps: CascadeStep[];
	failedStep: number;
	error?: string;
}

export interface SymbolPositionNotFound {
	success: false;
	kind: 'not-found';
	entryPath: string;
}

export interface SymbolPositionJarError {
	success: false;
	kind: 'jar-not-found' | 'jar-not-available';
	jar: string;
}

export type SymbolPositionResult = SymbolPositionSuccess | SymbolPositionCascadeFailure | SymbolPositionNotFound | SymbolPositionJarError;

/**
 * Resolve a symbol position in source using cascading regex.
 *
 * 1. Converts FQN to entry path
 * 2. If jar specified: reads source from that jar, runs cascade
 * 3. If no jar: searches all filtered jars by priority, finds first cascade match
 * 4. Returns success with { sourceJarId, sourceText, cascadeResult, fileUri, entryPath }
 *    or failure with kind indicator
 */
export async function resolveSymbolPosition(
	loadedProject: LoadedProject,
	className: string,
	patterns: string[],
	jar?: string,
): Promise<SymbolPositionResult> {
	const jdtls = loadedProject.jdtls!;
	const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

	// Convert FQN to entry path: dots to slashes, keep $ in filename
	const lastDot = className.lastIndexOf('.');
	let entryPath: string;
	if (lastDot === -1) {
		entryPath = `${className}.java`;
	} else {
		const packagePath = className.substring(0, lastDot).replaceAll('.', '/');
		const simpleNameWithInner = className.substring(lastDot + 1);
		entryPath = `${packagePath}/${simpleNameWithInner}.java`;
	}

	if (jar !== undefined) {
		// Specific jar mode
		const dep = loadedProject.dependencyJars.get(jar);
		if (!dep) {
			return { success: false, kind: 'jar-not-found', jar };
		}

		if (!dep.available) {
			return { success: false, kind: 'jar-not-available', jar };
		}

		let sourceText: string;
		try {
			const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
			const buffer = await adapter.readEntry(entryPath);
			sourceText = buffer.toString('utf-8');
		} catch {
			return { success: false, kind: 'not-found', entryPath };
		}

		const rawCascade = cascadeRegex(sourceText, patterns);
		if (!rawCascade.success) {
			return {
				success: false,
				kind: 'cascade-failure',
				jar: dep.id,
				category: dep.category,
				provenanceChains: dep.provenanceChains,
				steps: rawCascade.steps,
				failedStep: rawCascade.failedStep,
				error: rawCascade.error,
			};
		}

		const fileUri = uriMapper.toFileUri(jar, entryPath);
		return {
			success: true,
			sourceJarId: jar,
			sourceText,
			cascadeResult: rawCascade,
			fileUri,
			entryPath,
		};
	} else {
		// All-jars mode: find first jar containing the class with matching cascade
		const filtered = getFilteredDependencies(loadedProject.dependencyJars, loadedProject.filterConfig);
		const sorted = sortByPriority(Array.from(filtered.entries()));

		for (const [id, dep] of sorted) {
			if (!dep.available) continue;

			let text: string;
			try {
				const adapter = createSourceAdapter(jarReader, dep, loadedProject.rootPath);
				const buffer = await adapter.readEntry(entryPath);
				text = buffer.toString('utf-8');
			} catch {
				continue;
			}

			const result = cascadeRegex(text, patterns);
			if (result.success) {
				const fileUri = uriMapper.toFileUri(id, entryPath);
				return {
					success: true,
					sourceJarId: id,
					sourceText: text,
					cascadeResult: result,
					fileUri,
					entryPath,
				};
			}
		}

		return { success: false, kind: 'not-found', entryPath };
	}
}
