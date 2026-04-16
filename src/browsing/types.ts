import type { JarCategory } from '../project/types.js';
import type { CascadeStep } from './cascading-regex.js';
import type { TypeReference, ParameterInfo } from './member-types.js';

export type PackageEntry = {
	name: string;          // dot-separated: "net.minecraft.client"
	classCount: number;    // top-level classes only (no inner classes)
	jars: string[];        // jar IDs that contain this package
}

export type ClassReference = {
	name: string;      // simple name
	fqn: string;       // fully qualified name
	kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
	jar?: string;      // jar ID when URI maps to a known jar
}

export type InnerClassInfo = {
	name: string;      // dollar-separated: "MinecraftClient$Options"
	fqn: string;       // "net.minecraft.client.MinecraftClient$Options"
	kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
	access?: string;   // "public" | "protected" | "private" | "package-private"
	modifiers?: string[];
}

export type ClassInfo = {
	name: string;
	fqn: string;
	kind: string;
	access?: string;
	modifiers?: string[];
	jars: Array<{ id: string; category: JarCategory }>;
	innerClasses?: InnerClassInfo[];
}

export type LocateResultContext = {
	text: string;
	startLine: number;
	endLine: number;
}

export type LocateResult = {
	jar: string;
	category: JarCategory;
	provenanceChains?: string[][];
	steps?: CascadeStep[];
	offset: number;
	line: number;
	column: number;
	context?: LocateResultContext;
}

export type TransformedSymbol = {
	name: string;
	kind: string;
	detail: string | null;
	deprecated: boolean;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	selectionRange: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	children: TransformedSymbol[];
}

export type EnrichedMethodSymbol = TransformedSymbol & {
	memberFqn: string;
	parameters: ParameterInfo[];
	returnType: TypeReference | null;
	children: EnrichedSymbol[];
}

export type EnrichedFieldSymbol = TransformedSymbol & {
	memberFqn: string;
	fieldType: TypeReference;
	children: EnrichedSymbol[];
}

export type EnrichedClassSymbol = TransformedSymbol & {
	fqn?: string;      // fully qualified name (e.g., "com.example.Outer$Inner" for inner classes)
	children: EnrichedSymbol[];
}

export type EnrichedSymbol = EnrichedMethodSymbol | EnrichedFieldSymbol | EnrichedClassSymbol;

export type SourceResult = {
	jar: string;
	category: JarCategory;
	provenanceChains?: string[][];
	source: string;
	startLine: number;
	endLine: number;
	totalLineCount: number;
	truncated: boolean;
	innerClass?: { name: string; startLine: number };
}

export type MemberResult = {
	jar: string;
	category: JarCategory;
	provenanceChains?: string[][];
	memberFqn: string;
	kind: string;
	source: string;
	startLine: number;
	endLine: number;
	lineCount: number;
	memberStartLine: number;
	memberEndLine: number;
}
