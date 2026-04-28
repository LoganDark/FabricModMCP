import type { JdtLsSession } from '../jdtls/types.js';

export type MappingEra = 'mapped' | 'unmapped';

export type DependencyCoordinate = {
	configuration: string;  // "minecraft", "mappings", "modImplementation", "implementation", etc.
	group: string;          // "com.mojang", "net.fabricmc"
	artifact: string;       // "minecraft", "yarn", "fabric-loader"
	version: string;        // "1.21.11", "1.21.11+build.4"
	raw: string;            // "com.mojang:minecraft:1.21.11"
}

export type GradleConfig = {
	minecraftVersion: string;
	mappingEra: MappingEra;
	yarnMappings?: string;
	loaderVersion?: string;
	fabricApiVersion?: string;
	dependencies: DependencyCoordinate[];
	// Absolute filesystem paths of file:// Maven repositories declared in
	// build.gradle.kts repositories { ... }, in declaration order.
	// Includes mavenLocal() (mapped to ~/.m2/repository). Empty when no
	// local repos are declared. Used by source-jar-finder / dependency-discovery
	// to probe Maven layout (group-as-path) before falling back to modules-2.
	mavenRoots: string[];
}

export type FabricModJson = {
	schemaVersion: number;
	id: string;
	version: string;
	name: string;
	description: string;
	authors: (string | { name: string })[];
	license: string;
	environment: string;
	mixins: string[];
	depends: Record<string, string>;
}

export type ResolvedJar = {
	path: string;
	exists: boolean;
}

export type JarCategory = 'minecraft' | 'mod-source' | 'fabric-api' | 'library' | 'study';

export type DependencyEntry = {
	id: string;           // "minecraft", "src", or "group:artifact"
	group: string;
	artifact: string;
	version: string;
	category: JarCategory;
	sourcesJarPath: string | null;  // null = sources not available
	compiledJarPath: string | null; // null = compiled jar not available
	available: boolean;             // true if sourcesJarPath exists on disk
	provenanceChains: string[][];   // paths of dependency IDs that led to this entry; seed entries have []
}

export type FilterConfig = {
	mode: 'include-all' | 'exclude-all';
	patterns: string[];  // glob patterns matching jar IDs
}

export type StudyJarStats = {
	totalEntries: number;
	packageCount: number;
	classCount: number;
}

export type StudyJar = {
	name: string;
	jarPath: string;
	compiledJarPath?: string;
	mtime: number;
	size: number;
	autoInclude: boolean;
	stats: StudyJarStats;
}

export type FabricModChild = {
	kind: 'fabric-mod';
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	compiledJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, DependencyEntry>;
	filterConfig: FilterConfig;
}

export type StudyJarChild = {
	kind: 'study-jar';
	name: string;
	jarPath: string;
	compiledJarPath?: string;
	mtime: number;
	size: number;
	autoInclude: boolean;
	stats: StudyJarStats;
}

export type ProjectChild = FabricModChild | StudyJarChild;

export type Project = {
	name: string;
	activeChild?: string;
	children: Map<string, ProjectChild>;
	jdtls?: JdtLsSession;
}
