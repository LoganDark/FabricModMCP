import type { JarCategory } from '../project/types.js';

export interface PackageEntry {
	name: string;          // dot-separated: "net.minecraft.client"
	classCount: number;    // top-level classes only (no inner classes)
	jars: string[];        // jar IDs that contain this package
}

export interface ClassReference {
	name: string;      // simple name
	fqn: string;       // fully qualified name
	kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
}

export interface InnerClassInfo {
	name: string;      // dollar-separated: "MinecraftClient$Options"
	fqn: string;       // "net.minecraft.client.MinecraftClient$Options"
	kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
	access: string;    // "public" | "protected" | "private" | "package-private"
	modifiers: string[];
}

export interface ClassInfo {
	name: string;
	fqn: string;
	kind: string;
	access: string;
	modifiers: string[];
	jars: Array<{ id: string; category: JarCategory }>;
	innerClasses?: InnerClassInfo[];
}
