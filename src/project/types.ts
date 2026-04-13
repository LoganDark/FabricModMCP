export type MappingEra = 'yarn' | 'unobfuscated';

export interface DependencyCoordinate {
	configuration: string;  // "minecraft", "mappings", "modImplementation", etc.
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

export interface LoadedProject {
	name: string;
	rootPath: string;
	gradleConfig: GradleConfig;
	sourcesJar: ResolvedJar;
	fabricMod: FabricModJson;
	dependencyJars: Map<string, ResolvedJar>;
}
