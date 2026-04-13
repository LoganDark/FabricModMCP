/**
 * JDT LS Workspace — Source jar extraction to temp directory and Eclipse project file generation
 *
 * Extracts .java files from all available dependency source jars into a temp directory structure
 * that JDT LS can index. Generates .project and .classpath files for Eclipse project recognition.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { JarReader } from '../project/jar-reader.js';
import type { DependencyEntry } from '../project/types.js';
import { jarIdToDirName } from './uri-mapper.js';
import { createSourceAdapter } from '../browsing/source-adapter.js';

export interface ExtractionResult {
	tempDir: string;
	jarIdToDirNameMap: Map<string, string>;
}

/**
 * Extract .java files from all available dependency source jars into a temp directory.
 *
 * Creates a directory structure like:
 *   /tmp/mcp-jdtls-{uuid}/
 *     minecraft/net/minecraft/client/MinecraftClient.java
 *     fabric-api__fabric-networking-api-v1/net/fabricmc/...
 *     src/com/example/mymod/MyMod.java
 *     .project
 *     .classpath
 */
export async function extractSourcesToTemp(
	dependencies: Map<string, DependencyEntry>,
	rootPath: string,
	jarReader: JarReader,
): Promise<ExtractionResult> {
	const tempDir = join(tmpdir(), 'mcp-jdtls-' + randomUUID());
	await mkdir(tempDir, { recursive: true });

	const jarIdToDirNameMap = new Map<string, string>();
	const extractedDirs: string[] = [];

	for (const [, dep] of dependencies) {
		if (!dep.available) continue;

		const dirName = jarIdToDirName(dep.id);
		const depDir = join(tempDir, dirName);

		try {
			const adapter = createSourceAdapter(jarReader, dep, rootPath);
			const entries = await adapter.listJavaEntries();

			for (const entryPath of entries) {
				const targetPath = join(depDir, entryPath);
				await mkdir(dirname(targetPath), { recursive: true });
				const content = await adapter.readEntry(entryPath);
				await writeFile(targetPath, content);
			}

			jarIdToDirNameMap.set(dep.id, dirName);
			extractedDirs.push(dirName);
		} catch {
			// Skip jars that fail to extract — non-fatal
			continue;
		}
	}

	// Generate .project file
	await writeFile(join(tempDir, '.project'), generateProjectFile());

	// Generate .classpath file
	await writeFile(join(tempDir, '.classpath'), generateClasspathFile(extractedDirs));

	return { tempDir, jarIdToDirNameMap };
}

/**
 * Remove a temp directory and all its contents.
 */
export async function cleanupTempDir(tempDir: string): Promise<void> {
	await rm(tempDir, { recursive: true, force: true });
}

function generateProjectFile(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>mcp-sources</name>
  <buildSpec>
    <buildCommand>
      <name>org.eclipse.jdt.core.javabuilder</name>
    </buildCommand>
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
  </natures>
</projectDescription>
`;
}

function generateClasspathFile(sourceDirs: string[]): string {
	const srcEntries = sourceDirs
		.map(dir => `  <classpathentry kind="src" path="${dir}"/>`)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
${srcEntries}
  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
  <classpathentry kind="output" path="bin"/>
</classpath>
`;
}
