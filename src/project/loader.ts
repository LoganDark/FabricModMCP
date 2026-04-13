import { readFile, stat, access } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { DomainError } from '../errors/domain-error.js';
import { logger } from '../logging/logger.js';
import { parseGradleProperties, parseBuildGradle } from './gradle-parser.js';
import { resolveSourcesJarPath } from './loom-cache.js';
import { parseFabricMod } from './fabric-mod.js';
import { discoverDependencies } from './dependency-discovery.js';
import type { LoadedProject } from './types.js';

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function loadProject(projectPath: string): Promise<LoadedProject> {
	const absolutePath = resolve(projectPath);
	const name = basename(absolutePath);

	// Validate directory exists
	let dirStat;
	try {
		dirStat = await stat(absolutePath);
	} catch {
		throw new DomainError(
			'PROJECT_NOT_FOUND',
			'Project directory does not exist',
			[absolutePath],
			['Check the path and try again'],
		);
	}

	// Validate it's a directory
	if (!dirStat.isDirectory()) {
		throw new DomainError(
			'PROJECT_NOT_DIRECTORY',
			'Path is not a directory',
			[absolutePath],
		);
	}

	// Read gradle.properties
	let propertiesContent: string;
	const propertiesPath = join(absolutePath, 'gradle.properties');
	try {
		propertiesContent = await readFile(propertiesPath, 'utf-8');
	} catch {
		throw new DomainError(
			'GRADLE_PROPERTIES_NOT_FOUND',
			'gradle.properties not found -- is this a Gradle project?',
			[propertiesPath],
			['Ensure this is a Fabric/Loom project root directory'],
		);
	}

	// Parse properties
	const properties = parseGradleProperties(propertiesContent);

	// Read build.gradle.kts
	let buildGradleContent: string;
	const buildGradlePath = join(absolutePath, 'build.gradle.kts');
	try {
		buildGradleContent = await readFile(buildGradlePath, 'utf-8');
	} catch {
		throw new DomainError(
			'BUILD_GRADLE_NOT_FOUND',
			'build.gradle.kts not found',
			[buildGradlePath],
			['This server only supports Kotlin DSL (build.gradle.kts), not Groovy (build.gradle)'],
		);
	}

	// Parse gradle config
	const gradleConfig = parseBuildGradle(buildGradleContent, properties);

	// Resolve sources jar path
	const sourcesJarPath = resolveSourcesJarPath(gradleConfig);

	// Check sources jar exists
	const sourcesJarExists = await fileExists(sourcesJarPath);
	if (!sourcesJarExists) {
		throw new DomainError(
			'SOURCES_JAR_NOT_FOUND',
			"Couldn't find Minecraft sources jar -- have you run genSources?",
			[sourcesJarPath],
			[
				'Run ./gradlew genSources in your project directory',
				'Check that your Loom cache is at ~/.gradle/caches/fabric-loom/',
			],
		);
	}

	// Read fabric.mod.json
	let fabricModContent: string;
	const fabricModPath = join(absolutePath, 'src', 'main', 'resources', 'fabric.mod.json');
	try {
		fabricModContent = await readFile(fabricModPath, 'utf-8');
	} catch {
		throw new DomainError(
			'FABRIC_MOD_NOT_FOUND',
			'fabric.mod.json not found',
			[fabricModPath],
			['Ensure this is a Fabric mod project with src/main/resources/fabric.mod.json'],
		);
	}

	// Parse fabric mod
	const fabricMod = parseFabricMod(fabricModContent);

	// Discover dependencies
	const discovery = await discoverDependencies(gradleConfig, sourcesJarPath, absolutePath);
	logger.info(`Dependency discovery: ${discovery.summary.total} dependencies found (${discovery.summary.withSources} with sources, ${discovery.summary.withoutSources} without)`);

	return {
		name,
		rootPath: absolutePath,
		gradleConfig,
		sourcesJar: { path: sourcesJarPath, exists: true },
		fabricMod,
		dependencyJars: discovery.dependencies,
		filterConfig: { mode: 'include-all', patterns: [] },
	};
}
