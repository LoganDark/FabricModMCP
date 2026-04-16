import type { JarCategory } from '../project/types.js';
import type { LspClient, JSONRPCEndpoint } from 'ts-lsp-client';
import type { ChildProcess } from 'node:child_process';

export type SnippetKind = 'method' | 'field' | 'class' | 'fallback';

export type ContextSnippet = {
	snippet: string;       // The extracted source text
	startLine: number;     // 1-based start line in the original source
	endLine: number;       // 1-based end line in the original source
	kind: SnippetKind;     // What semantic unit was extracted
}

export type NavigationResult = {
	jar: string;                    // Jar ID (e.g., "minecraft", "fabric-api:fabric-networking-api-v1")
	category: JarCategory;         // 'minecraft' | 'mod-source' | 'fabric-api' | 'library'
	provenanceChains?: string[][];  // Dependency provenance chains (optional for compact output)
	entryPath?: string;             // Java file path within jar (optional for compact output)
	className: string;              // Fully-qualified class name (e.g., "net.minecraft.client.MinecraftClient")
	line: number;                   // 1-based line number of the target position
	column: number;                 // 1-based column number of the target position
	context?: ContextSnippet;       // Enclosing semantic unit (optional for compact output)
}

export type JdtLsSession = {
	available: boolean;
	failureReason?: string;
	tempDir: string;                // Extracted source files root
	dataDir: string;                // JDT LS data directory
	jarIdToDirName: Map<string, string>;  // jar ID -> extraction directory name
	client?: LspClient;             // LSP client (present when available=true)
	endpoint?: JSONRPCEndpoint;     // Raw JSON-RPC endpoint for direct LSP calls
	process?: ChildProcess;         // JDT LS JVM process (present when available=true)
}
