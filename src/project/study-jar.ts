import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import StreamZip from 'node-stream-zip';
import { decomposeEntryPath } from '../browsing/entry-index.js';
import { evictEntryIndex } from '../browsing/entry-index-cache.js';
import { DomainError } from '../errors/domain-error.js';
import type { DependencyEntry, Project, StudyJar, StudyJarStats } from './types.js';
import type { JarReader } from './jar-reader.js';
import { unsyncStudyJarFromWorkspace } from '../jdtls/workspace-sync.js';
import type { JdtLsSession } from '../jdtls/types.js';

export const STUDY_JAR_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/;

export function validateStudyJarName(name: string): void {
	if (!STUDY_JAR_NAME_PATTERN.test(name)) {
		throw new DomainError(
			'INVALID_STUDY_JAR_NAME',
			`Study jar name '${name}' contains invalid characters`,
			[name],
			['Use only alphanumeric characters, hyphens, and dots', 'Name must start with an alphanumeric character'],
		);
	}
}

export function deriveStudyJarName(jarPath: string): string {
	const base = basename(jarPath);
	const stem = base.replace(/\.jar$/i, '');
	const sanitized = stem
		.replace(/[^a-zA-Z0-9.\-]/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
	return sanitized || 'unnamed';
}

export function validateStudyJarId(name: string, project: Project): void {
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod' && child.dependencyJars.has(name)) {
			throw new DomainError(
				'STUDY_JAR_ID_COLLISION',
				`Study jar name '${name}' collides with an existing real dependency ID`,
				[name],
				['Choose a different name for the study jar'],
			);
		}
	}
}

function computeStats(entries: string[]): StudyJarStats {
	const javaEntries = entries.filter(e => e.endsWith('.java'));
	const packages = new Set<string>();
	let classCount = 0;
	for (const entry of javaEntries) {
		const decomposed = decomposeEntryPath(entry);
		if (decomposed && !decomposed.isInnerClass) {
			classCount++;
			packages.add(decomposed.packageName);
		}
	}
	return {
		totalEntries: entries.length,
		packageCount: packages.size,
		classCount,
	};
}

export async function createStudyJar(
	jarPath: string,
	name: string | undefined,
	project: Project,
): Promise<StudyJar> {
	// 1. Validate file exists
	let resolvedPath: string;
	try {
		resolvedPath = await realpath(jarPath);
	} catch {
		throw new DomainError(
			'STUDY_JAR_FILE_NOT_FOUND',
			`Study jar file not found: ${jarPath}`,
			[jarPath],
			['Check that the file path is correct', 'For dependency jars, look in ~/.gradle/caches/'],
		);
	}

	const fileStat = await stat(resolvedPath);

	// 2. Derive or validate name
	const finalName = name ?? deriveStudyJarName(resolvedPath);
	validateStudyJarName(finalName);

	// 3. Check collisions
	if (project.children.has(finalName)) {
		throw new DomainError(
			'STUDY_JAR_NAME_EXISTS',
			`Study jar with name '${finalName}' already exists on project '${project.name}'`,
			[finalName, project.name],
			['Remove the existing study jar first, or choose a different name'],
		);
	}
	validateStudyJarId(finalName, project);

	// 4. Open ZIP and compute stats
	let entries: string[];
	try {
		const zip = new StreamZip.async({ file: resolvedPath, storeEntries: true });
		const zipEntries = await zip.entries();
		entries = Object.keys(zipEntries);
		await zip.close();
	} catch {
		throw new DomainError(
			'STUDY_JAR_INVALID_ZIP',
			`Failed to open study jar as ZIP: ${resolvedPath}`,
			[resolvedPath],
			['Check that the file is a valid JAR/ZIP file', 'If this is a class-only jar, it should still be a valid ZIP'],
		);
	}

	return {
		name: finalName,
		jarPath: resolvedPath,
		mtime: fileStat.mtimeMs,
		size: fileStat.size,
		autoInclude: false,
		stats: computeStats(entries),
	};
}

export async function checkAndReopenIfStale(
	studyJar: StudyJar,
	reader: JarReader,
): Promise<boolean> {
	let fileStat;
	try {
		fileStat = await stat(studyJar.jarPath);
	} catch {
		// File no longer exists -- cannot reopen
		return false;
	}

	if (fileStat.mtimeMs === studyJar.mtime && fileStat.size === studyJar.size) {
		return false;
	}

	// File changed -- close old handle and evict cache
	await reader.close(studyJar.jarPath);
	evictEntryIndex(studyJar.jarPath);

	// Update stored mtime/size
	studyJar.mtime = fileStat.mtimeMs;
	studyJar.size = fileStat.size;

	return true;
}

export function studyJarToDependencyEntry(studyJar: StudyJar): DependencyEntry {
	return {
		id: studyJar.name,
		group: 'study',
		artifact: studyJar.name,
		version: 'local',
		category: 'study',
		sourcesJarPath: studyJar.jarPath,
		available: true,
		provenanceChains: [],
	};
}

/**
 * Auto-unload study jars whose name collides with a real dependency ID.
 * Called after dependency rediscovery (refresh_dependencies) to remove
 * study jars that are now shadowed by real dependencies.
 */
export async function autoUnloadConflictingStudyJars(
	project: Project,
	jarReader: JarReader,
	jdtls: JdtLsSession | undefined,
): Promise<string[]> {
	const unloaded: string[] = [];
	// Collect all dependency IDs from all fabric mod children
	const allDepIds = new Set<string>();
	for (const child of project.children.values()) {
		if (child.kind === 'fabric-mod') {
			for (const depId of child.dependencyJars.keys()) {
				allDepIds.add(depId);
			}
		}
	}
	// Check study jar children for collisions
	for (const [name, child] of project.children) {
		if (child.kind === 'study-jar' && allDepIds.has(name)) {
			await unsyncStudyJarFromWorkspace(name, jdtls);
			jarReader.removeProjectJar(project.name, child.jarPath);
			evictEntryIndex(child.jarPath);
			project.children.delete(name);
			unloaded.push(name);
		}
	}
	return unloaded;
}
