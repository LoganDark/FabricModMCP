/**
 * Shared cascading-regex-to-LSP-position resolver.
 *
 * Extracts the common pattern of: FQN -> entry path -> read source -> cascade regex -> file URI.
 * Used by get_symbol_info, find_implementations (and potentially others).
 * Avoids quadruple duplication of this logic.
 */

import type { JarCategory, Project } from '../project/types.js';
import type { CascadeStep, CascadeSuccess } from '../browsing/cascading-regex.js';
import { getAllDependencies } from '../project/dependency-resolver.js';
import { jarReader } from './shared-jar-reader.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';
import { cascadeRegex } from '../browsing/cascading-regex.js';
import { createUriMapper } from '../jdtls/uri-mapper.js';
import { classNameToEntryPath, sortByPriority, getDependenciesForTool, getRootPathForScope } from './tool-helpers.js';
import { resolveJarId } from '../project/namespace-resolver.js';

export type SymbolPositionSuccess = {
	success: true;
	sourceJarId: string;
	sourceText: string;
	cascadeResult: CascadeSuccess;
	fileUri: string;
	entryPath: string;
}

export type SymbolPositionCascadeFailure = {
	success: false;
	kind: 'cascade-failure';
	jar: string;
	category: JarCategory;
	provenanceChains: string[][];
	steps: CascadeStep[];
	failedStep: number;
	error?: string;
}

export type SymbolPositionNotFound = {
	success: false;
	kind: 'not-found';
	entryPath: string;
}

export type SymbolPositionJarError = {
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
	loadedProject: Project,
	className: string,
	patterns: string[],
	jar?: string,
	scope?: string,
): Promise<SymbolPositionResult> {
	const jdtls = loadedProject.jdtls!;
	const uriMapper = createUriMapper(jdtls.tempDir, jdtls.jarIdToDirName);

	const entryPath = classNameToEntryPath(className);
	const rootPath = getRootPathForScope(loadedProject, scope);

	if (jar !== undefined) {
		// Specific jar mode — resolve bare IDs via namespace resolver
		const resolvedJar = resolveJarId(loadedProject, jar, scope);
		const dep = getAllDependencies(loadedProject).get(resolvedJar);
		if (!dep) {
			return { success: false, kind: 'jar-not-found', jar: resolvedJar };
		}

		if (!dep.available) {
			return { success: false, kind: 'jar-not-available', jar: resolvedJar };
		}

		let sourceText: string;
		try {
			const adapter = createSourceAdapter(jarReader, dep, rootPath);
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

		const fileUri = uriMapper.toFileUri(resolvedJar, entryPath);
		return {
			success: true,
			sourceJarId: resolvedJar,
			sourceText,
			cascadeResult: rawCascade,
			fileUri,
			entryPath,
		};
	} else {
		// All-jars mode: use scope-aware getDependenciesForTool
		const filtered = getDependenciesForTool(loadedProject, undefined, scope);
		const sorted = sortByPriority(Array.from(filtered.entries()));

		const attempts = await Promise.all(sorted.map(async ([id, dep]) => {
			if (!dep.available) return null;
			try {
				const adapter = createSourceAdapter(jarReader, dep, rootPath);
				const buffer = await adapter.readEntry(entryPath);
				const text = buffer.toString('utf-8');
				const result = cascadeRegex(text, patterns);
				if (result.success) return { id, text, result };
			} catch {}
			return null;
		}));

		// Return first (highest-priority) match
		for (const attempt of attempts) {
			if (attempt) {
				const fileUri = uriMapper.toFileUri(attempt.id, entryPath);
				return {
					success: true,
					sourceJarId: attempt.id,
					sourceText: attempt.text,
					cascadeResult: attempt.result,
					fileUri,
					entryPath,
				};
			}
		}

		return { success: false, kind: 'not-found', entryPath };
	}
}
