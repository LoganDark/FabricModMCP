/**
 * Workspace Sync -- Incremental extraction of study jar sources to JDT LS workspace
 *
 * Handles adding/removing individual study jars from the JDT LS workspace without
 * re-extracting all existing jars. Updates .classpath and notifies JDT LS of changes
 * for asynchronous re-indexing.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { jarIdToDirName } from './uri-mapper.js';
import { createJarAdapter } from '../browsing/source-adapter.js';
import { generateClasspathFile } from './workspace.js';
import type { JarReader } from '../project/jar-reader.js';
import type { StudyJar } from '../project/types.js';
import type { JdtLsSession } from './types.js';

/**
 * Extract a single study jar's .java files into the JDT LS temp directory.
 *
 * Creates a subdirectory named after the study jar ID (e.g., "study__myjar")
 * and writes all .java entries from the jar into it.
 *
 * @returns The directory name (relative to tempDir) where files were extracted
 */
export async function extractStudyJarToWorkspace(
	studyJar: StudyJar,
	tempDir: string,
	jarReader: JarReader,
): Promise<string> {
	const dirName = jarIdToDirName(studyJar.name);
	const depDir = join(tempDir, dirName);

	try {
		const adapter = createJarAdapter(jarReader, studyJar.jarPath);
		const entries = await adapter.listJavaEntries();

		for (const entryPath of entries) {
			const targetPath = join(depDir, entryPath);
			await mkdir(dirname(targetPath), { recursive: true });
			const content = await adapter.readEntry(entryPath);
			await writeFile(targetPath, content);
		}

		return dirName;
	} catch (err) {
		await rm(depDir, { recursive: true, force: true });
		throw err;
	}
}

/**
 * Remove a study jar's extracted directory from the JDT LS temp directory.
 */
export async function removeStudyJarFromWorkspace(
	studyJarName: string,
	tempDir: string,
): Promise<void> {
	const dirName = jarIdToDirName(studyJarName);
	const depDir = join(tempDir, dirName);
	await rm(depDir, { recursive: true, force: true });
}


/**
 * Check whether a study jar is currently synced to the JDT LS workspace.
 */
export function isWorkspaceSynced(
	studyJarName: string,
	jdtls: JdtLsSession | undefined,
): boolean {
	if (!jdtls?.available) return false;
	return jdtls.jarIdToDirName.has(studyJarName);
}

/**
 * Sync a study jar to the JDT LS workspace: extract sources, update .classpath,
 * and notify JDT LS for asynchronous re-indexing.
 *
 * Returns { synced: true } on success, or { synced: false, warning } when
 * JDT LS is unavailable or sync fails.
 */
export async function syncStudyJarToWorkspace(
	studyJar: StudyJar,
	jdtls: JdtLsSession | undefined,
	jarReader: JarReader,
): Promise<{ synced: boolean; warning?: string }> {
	if (!jdtls?.available || !jdtls.endpoint) {
		return { synced: false, warning: 'Note: JDT LS unavailable -- semantic navigation disabled' };
	}

	try {
		const dirName = await extractStudyJarToWorkspace(studyJar, jdtls.tempDir, jarReader);
		jdtls.jarIdToDirName.set(studyJar.name, dirName);

		const allDirs = Array.from(jdtls.jarIdToDirName.values());
		const classpathXml = generateClasspathFile(allDirs);
		const resolvedTempDir = realpathSync(jdtls.tempDir);
		await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);

		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
		});

		return { synced: true };
	} catch (err) {
		jdtls.jarIdToDirName.delete(studyJar.name);
		return {
			synced: false,
			warning: 'Workspace sync failed: ' + (err instanceof Error ? err.message : String(err)),
		};
	}
}

/**
 * Remove a study jar from the JDT LS workspace: delete extracted directory,
 * update .classpath, and notify JDT LS for asynchronous re-indexing.
 *
 * Returns { synced: true } on success, or { synced: false } when JDT LS
 * is unavailable or the operation fails.
 */
export async function unsyncStudyJarFromWorkspace(
	studyJarName: string,
	jdtls: JdtLsSession | undefined,
): Promise<{ synced: boolean }> {
	if (!jdtls?.available || !jdtls.endpoint) {
		return { synced: false };
	}

	try {
		await removeStudyJarFromWorkspace(studyJarName, jdtls.tempDir);
		jdtls.jarIdToDirName.delete(studyJarName);

		const allDirs = Array.from(jdtls.jarIdToDirName.values());
		const classpathXml = generateClasspathFile(allDirs);
		const resolvedTempDir = realpathSync(jdtls.tempDir);
		await writeFile(join(resolvedTempDir, '.classpath'), classpathXml);

		jdtls.endpoint.notify('workspace/didChangeWatchedFiles', {
			changes: [{ uri: 'file://' + resolvedTempDir + '/.classpath', type: 2 }],
		});

		return { synced: true };
	} catch {
		jdtls.jarIdToDirName.delete(studyJarName);
		return { synced: false };
	}
}
