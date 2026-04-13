export interface PackageEntry {
	name: string;          // dot-separated: "net.minecraft.client"
	classCount: number;    // top-level classes only (no inner classes)
	jars: string[];        // jar IDs that contain this package
}

export interface ClassMetadata {
	access: string;        // "public" | "protected" | "private" | "package-private"
	modifiers: string[];   // ["abstract"], ["final"], ["static"], ["sealed"], ["non-sealed"], etc.
	type: string;          // "class" | "interface" | "enum" | "record" | "@interface"
}

export interface ClassEntry {
	name: string;          // simple name: "MinecraftClient"
	fqn: string;           // fully qualified: "net.minecraft.client.MinecraftClient"
	metadata: ClassMetadata | null;  // null if source unparseable
	jars: string[];        // jar IDs where this class exists
	innerClasses: InnerClassEntry[];
}

export interface InnerClassEntry {
	name: string;          // dollar-separated: "MinecraftClient$Options"
	fqn: string;           // "net.minecraft.client.MinecraftClient$Options"
	metadata: ClassMetadata | null;
}
