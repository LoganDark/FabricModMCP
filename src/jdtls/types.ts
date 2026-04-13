import type { JarCategory } from '../project/types.js';

export type SnippetKind = 'method' | 'field' | 'class' | 'fallback';

export interface ContextSnippet {
	snippet: string;       // The extracted source text
	startLine: number;     // 1-based start line in the original source
	endLine: number;       // 1-based end line in the original source
	kind: SnippetKind;     // What semantic unit was extracted
}

export interface NavigationResult {
	jar: string;                    // Jar ID (e.g., "minecraft", "fabric-api:fabric-networking-api-v1")
	category: JarCategory;         // 'minecraft' | 'mod-source' | 'fabric-api' | 'library'
	provenanceChains: string[][];   // Dependency provenance chains
	entryPath: string;              // Java file path within jar (e.g., "net/minecraft/client/MinecraftClient.java")
	className: string;              // Fully-qualified class name (e.g., "net.minecraft.client.MinecraftClient")
	line: number;                   // 1-based line number of the target position
	column: number;                 // 1-based column number of the target position
	context: ContextSnippet;        // Enclosing semantic unit
}

export interface JdtLsSession {
	available: boolean;
	failureReason?: string;
	tempDir: string;                // Extracted source files root
	jarIdToDirName: Map<string, string>;  // jar ID -> extraction directory name
}
