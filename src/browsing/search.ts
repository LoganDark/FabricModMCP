import picomatch from 'picomatch';
import { parseClassDeclaration } from './class-parser.js';
import { getOrBuildIndex } from './entry-index-cache.js';
import { createSourceAdapter } from './source-adapter.js';
import type { ClassInfo } from './types.js';
import type { DependencyEntry, JarCategory } from '../project/types.js';
import type { JarReader } from '../project/jar-reader.js';
import { CATEGORY_PRIORITY, classNameToEntryPath, sortByPriority } from '../tools/tool-helpers.js';

export type SearchResponse = {
	results: ClassInfo[];
	offset: number;
	limit: number;
	total: number;
	hasMore: boolean;
}

export type SearchOptions = {
	query: string;
	caseSensitive?: boolean;
	kind?: string[];
	offset?: number;
	limit?: number;
}

export async function searchClasses(
	options: SearchOptions,
	resolvedDeps: Map<string, DependencyEntry>,
	rootPath: string | undefined,
	jarReaderInstance: JarReader,
): Promise<SearchResponse> {
	const offset = options.offset ?? 0;
	const limit = options.limit ?? 250;

	// Sort jars by priority
	const sortedJars = sortByPriority(Array.from(resolvedDeps.entries()));

	// Step 4: Create FQN matcher using dot-to-slash conversion
	let matchPattern = options.query.replaceAll('.', '/');
	// If the pattern has no path separators (no dots were converted),
	// allow matching at any depth by prepending {**/,}
	if (!matchPattern.includes('/')) {
		matchPattern = `{**/,}${matchPattern}`;
	}
	const isMatch = picomatch(matchPattern, { nocase: !(options.caseSensitive ?? false) });

	// Step 5-6: Enumerate classes from each jar, match against pattern, deduplicate
	const resultMap = new Map<string, {
		fqn: string;
		kind: string | null;
		access: string | null;
		modifiers: string[];
		jars: Array<{ id: string; category: JarCategory }>;
		firstJarId: string;
	}>();

	for (const [id, dep] of sortedJars) {
		if (!dep.available) continue;

		try {
			const adapter = createSourceAdapter(jarReaderInstance, dep, rootPath);
			const entries = await adapter.listJavaEntries();
			const cacheKey = dep.sourcesJarPath ?? `fs:${rootPath}:${id}`;
			const index = getOrBuildIndex(entries, cacheKey);
			const allClasses = index.getAllClasses();

			for (const cls of allClasses) {
				// Convert FQN dots to slashes for picomatch matching
				const fqnAsPath = cls.fqn.replaceAll('.', '/');
				if (!isMatch(fqnAsPath)) continue;

				const existing = resultMap.get(cls.fqn);
				if (existing) {
					// Deduplicate: add jar provenance
					if (!existing.jars.some(j => j.id === id)) {
						existing.jars.push({ id, category: dep.category });
					}
				} else {
					resultMap.set(cls.fqn, {
						fqn: cls.fqn,
						kind: null,
						access: null,
						modifiers: [],
						jars: [{ id, category: dep.category }],
						firstJarId: id,
					});
				}
			}
		} catch {
			// Skip jars that fail to read
		}
	}

	// Step 7: Read class declarations in parallel to populate kind/access
	const entries = Array.from(resultMap.entries());
	await Promise.all(entries.map(async ([fqn, entry]) => {
		const firstJarDep = resolvedDeps.get(entry.firstJarId);
		if (firstJarDep) {
			try {
				const adapter = createSourceAdapter(jarReaderInstance, firstJarDep, rootPath);
				const entryPath = classNameToEntryPath(fqn);
				const buffer = await adapter.readEntry(entryPath);
				const head = buffer.subarray(0, 4096).toString('utf-8');
				const parsed = parseClassDeclaration(head);

				if (parsed) {
					entry.kind = parsed.kind;
					entry.access = parsed.access;
					entry.modifiers = parsed.modifiers;
				} else {
					entry.kind = 'unknown';
					entry.access = 'unknown';
				}
			} catch {
				entry.kind = 'unknown';
				entry.access = 'unknown';
			}
		} else {
			entry.kind = 'unknown';
			entry.access = 'unknown';
		}
	}));

	// Apply kind filter
	if (options.kind && options.kind.length > 0) {
		for (const [fqn, entry] of entries) {
			if (!options.kind.includes(entry.kind!)) {
				resultMap.delete(fqn);
			}
		}
	}

	// Step 8: Sort results
	const sorted = Array.from(resultMap.values()).sort((a, b) => {
		const priorityA = Math.min(...a.jars.map(j => CATEGORY_PRIORITY[j.category] ?? 99));
		const priorityB = Math.min(...b.jars.map(j => CATEGORY_PRIORITY[j.category] ?? 99));
		if (priorityA !== priorityB) return priorityA - priorityB;
		return a.fqn.localeCompare(b.fqn);
	});

	// Step 9: Paginate
	const total = sorted.length;
	const sliced = sorted.slice(offset, offset + limit);

	// Step 10: Return
	return {
		results: sliced.map(r => {
			const lastDot = r.fqn.lastIndexOf('.');
			const name = lastDot === -1 ? r.fqn : r.fqn.substring(lastDot + 1);
			return {
				name,
				fqn: r.fqn,
				kind: r.kind ?? 'unknown',
				access: r.access ?? 'unknown',
				modifiers: r.modifiers,
				jars: r.jars,
			};
		}),
		offset,
		limit,
		total,
		hasMore: offset + sliced.length < total,
	};
}
