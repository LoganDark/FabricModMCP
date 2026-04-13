import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JarReader } from '../project/jar-reader.js';
import type { DependencyEntry } from '../project/types.js';
import { DomainError } from '../errors/domain-error.js';

export interface SourceAdapter {
	listJavaEntries(): Promise<string[]>;
	readEntry(entryPath: string): Promise<Buffer>;
}

export function createJarAdapter(jarReader: JarReader, jarPath: string): SourceAdapter {
	return {
		async listJavaEntries(): Promise<string[]> {
			const entries = await jarReader.listEntries(jarPath);
			return entries.filter(e => e.endsWith('.java'));
		},
		async readEntry(entryPath: string): Promise<Buffer> {
			return jarReader.readEntry(jarPath, entryPath);
		},
	};
}

export function createFsAdapter(rootPath: string): SourceAdapter {
	const baseDir = join(rootPath, 'src', 'main', 'java');

	return {
		async listJavaEntries(): Promise<string[]> {
			try {
				const entries = await readdir(baseDir, { recursive: true });
				return entries
					.filter(e => e.endsWith('.java'))
					.map(e => e.replaceAll('\\', '/'));
			} catch (err: any) {
				if (err.code === 'ENOENT') return [];
				throw err;
			}
		},
		async readEntry(entryPath: string): Promise<Buffer> {
			const fullPath = join(baseDir, entryPath);
			try {
				return await readFile(fullPath);
			} catch (err: any) {
				if (err.code === 'ENOENT') {
					throw new DomainError(
						'SOURCE_FILE_NOT_FOUND',
						`Source file not found: ${entryPath}`,
						[fullPath],
						['Check that the file path is correct'],
					);
				}
				throw err;
			}
		},
	};
}

export function createSourceAdapter(
	jarReader: JarReader,
	dep: DependencyEntry,
	rootPath: string,
): SourceAdapter {
	if (dep.id === 'src') {
		return createFsAdapter(rootPath);
	}

	if (dep.sourcesJarPath !== null) {
		return createJarAdapter(jarReader, dep.sourcesJarPath);
	}

	throw new DomainError(
		'JAR_NOT_AVAILABLE',
		`Sources jar not available for ${dep.id}`,
		[dep.id],
		['The dependency does not have a sources jar available'],
	);
}
