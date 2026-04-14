import type { JdtLsSession } from '../jdtls/types.js';

export type MappingEra = 'mapped' | 'unmapped';

export interface DependencyCoordinate {
	configuration: string;  // "minecraft", "mappings", "modImplementation", "implementation", etc.
	group: string;          // "com.mojang", "net.fabricmc"
	artifact: string;       // "minecraft", "yarn", "fabric-loader"
	version: string;        // "1.21.11", "1.21.11+build.4"
	raw: string;            // "com.mojang:minecraft:1.21.11"
}

export interface GradleConfig {
	minecraftVersion: string;
	mappingEra: MappingEra;
	yarnMappings?: string;
	loaderVersion?: string;
	fabricApiVersion?: string;
	dependencies: DependencyCoordinate[];
}

export interface FabricModJson {
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

export interface ResolvedJar {
	path: string;
	exists: boolean;
}

export type JarCategory = 'minecraft' | 'mod-source' | 'fabric-api' | 'library' | 'study';

export interface DependencyEntry {
	id: string;           // "minecraft", "src", or "group:artifact"
	group: string;
	artifact: string;
	version: string;
	category: JarCategory;
	sourcesJarPath: string | null;  // null = sources not available
	available: boolean;             // true if sourcesJarPath exists on disk
	provenanceChains: string[][];   // paths of dependency IDs that led to this entry; seed entries have []
}

export interface FilterConfig {
	mode: 'include-all' | 'exclude-all';
	patterns: string[];  // glob patterns matching jar IDs
}

export interface StudyJarStats {
	totalEntries: number;
	packageCount: number;
	classCount: number;
}

export interface StudyJar {
	name: string;
	jarPath: string;
	mtime: number;
	size: number;
	autoInclude: boolean;
	stats: StudyJarStats;
}

export interface LoadedProject {
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, DependencyEntry>;
	filterConfig: FilterConfig;
	studyJars: Map<string, StudyJar>;
	jdtls?: JdtLsSession;
}
