import type { TypeReference } from './member-types.js';
import type { EntryIndex } from './entry-index.js';

const IMPORT_RE = /^import\s+(?!static\s)([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/gm;
const PACKAGE_RE = /^package\s+([a-zA-Z_][\w.]*)\s*;/m;

const JAVA_PRIMITIVES = new Set([
	"boolean", "byte", "char", "short", "int", "long", "float", "double",
]);

const JAVA_LANG_TYPES = new Set([
	"Object", "String", "Integer", "Long", "Float", "Double", "Boolean",
	"Byte", "Short", "Character", "Number", "Math", "System", "Thread",
	"Throwable", "Exception", "RuntimeException", "Error", "Class", "Enum",
	"Record", "Comparable", "Iterable", "AutoCloseable", "Cloneable",
	"Runnable", "StringBuilder", "StringBuffer", "Override", "Deprecated",
	"SuppressWarnings", "FunctionalInterface", "Void",
]);

export type ImportInfo = {
	explicitImports: Map<string, string>;  // simpleName -> fqn
	starPackages: string[];                 // package names for star imports
	currentPackage: string | null;          // from package declaration
}

/**
 * Extract imports and package declaration from Java source text.
 * Static imports are ignored (they import values, not types).
 */
export function extractImports(sourceText: string): ImportInfo {
	const explicitImports = new Map<string, string>();
	const starPackages: string[] = [];

	const packageMatch = sourceText.match(PACKAGE_RE);
	const currentPackage = packageMatch ? packageMatch[1] : null;

	let match: RegExpExecArray | null;
	// Reset lastIndex since IMPORT_RE has /g flag
	IMPORT_RE.lastIndex = 0;
	while ((match = IMPORT_RE.exec(sourceText)) !== null) {
		const imported = match[1];
		if (imported.endsWith('.*')) {
			starPackages.push(imported.slice(0, -2));
		} else {
			const simpleName = imported.substring(imported.lastIndexOf('.') + 1);
			explicitImports.set(simpleName, imported);
		}
	}

	return { explicitImports, starPackages, currentPackage };
}

/**
 * Create a type name resolver that converts simple Java class names to
 * fully qualified TypeReference values using a four-stage cascade:
 *
 * 1. Primitives (int, boolean, etc.) -> PrimitiveType
 * 2. "void" -> VoidType
 * 3. Explicit imports -> ClassType
 * 4. Star imports (via resolvePackage callback, cached) -> ClassType
 * 5. Same-package (via resolvePackage for currentPackage, cached) -> ClassType
 * 6. java.lang.* hardcoded set -> ClassType
 * 7. Fallback -> UnresolvedType
 */
export function createTypeResolver(
	imports: ImportInfo,
	resolvePackage: (packageName: string) => Promise<string[]>,
): (simpleName: string) => Promise<TypeReference> {
	const packageCache = new Map<string, Promise<string[]>>();

	function getCachedPackage(pkg: string): Promise<string[]> {
		let cached = packageCache.get(pkg);
		if (!cached) {
			cached = resolvePackage(pkg);
			packageCache.set(pkg, cached);
		}
		return cached;
	}

	return async (simpleName: string): Promise<TypeReference> => {
		// Stage 1: Primitives
		if (JAVA_PRIMITIVES.has(simpleName)) {
			return { kind: 'primitive', name: simpleName };
		}

		// Stage 2: void
		if (simpleName === 'void') {
			return { kind: 'void' };
		}

		// Stage 3: Explicit imports
		const fqn = imports.explicitImports.get(simpleName);
		if (fqn) {
			return { kind: 'class', name: simpleName, fqn };
		}

		// Stage 4: Star imports
		for (const pkg of imports.starPackages) {
			const classes = await getCachedPackage(pkg);
			if (classes.includes(simpleName)) {
				return { kind: 'class', name: simpleName, fqn: `${pkg}.${simpleName}` };
			}
		}

		// Stage 5: Same-package
		if (imports.currentPackage) {
			const classes = await getCachedPackage(imports.currentPackage);
			if (classes.includes(simpleName)) {
				return { kind: 'class', name: simpleName, fqn: `${imports.currentPackage}.${simpleName}` };
			}
		}

		// Stage 6: java.lang.*
		if (JAVA_LANG_TYPES.has(simpleName)) {
			return { kind: 'class', name: simpleName, fqn: `java.lang.${simpleName}` };
		}

		// Stage 7: Unresolved
		return { kind: 'unresolved', rawType: simpleName };
	};
}

export function createResolvePackage(
	entryIndex: EntryIndex,
): (packageName: string) => Promise<string[]> {
	return async (packageName: string): Promise<string[]> => {
		const entries = entryIndex.getClasses(packageName);
		return entries.map(e => e.className);
	};
}
