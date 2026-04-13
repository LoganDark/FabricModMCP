export interface DecomposedEntry {
	packageName: string;
	className: string;
	isInnerClass: boolean;
	outerClassName: string | null;
	isAnonymous: boolean;
}

export function decomposeEntryPath(entryPath: string): DecomposedEntry | null {
	if (!entryPath.endsWith('.java')) return null;

	const parts = entryPath.split('/');
	const fileName = parts[parts.length - 1];

	if (fileName === 'package-info.java' || fileName === 'module-info.java') return null;

	const className = fileName.replace('.java', '');
	const packageParts = parts.slice(0, -1);
	const packageName = packageParts.join('.');

	const dollarIndex = className.indexOf('$');
	const isInnerClass = dollarIndex !== -1;
	const outerClassName = isInnerClass ? className.substring(0, dollarIndex) : null;
	const innerPart = isInnerClass ? className.substring(dollarIndex + 1) : null;
	// Anonymous if the part after the LAST $ is purely numeric
	const lastDollar = className.lastIndexOf('$');
	const lastInnerPart = isInnerClass ? className.substring(lastDollar + 1) : null;
	const isAnonymous = isInnerClass && /^\d+$/.test(lastInnerPart!);

	return { packageName, className, isInnerClass, outerClassName, isAnonymous };
}

export interface ClassInfo {
	className: string;
	innerClassNames: string[];
}

export class EntryIndex {
	private packages = new Map<string, Set<string>>();
	private innerClasses = new Map<string, string[]>();
	private allPackages = new Set<string>();

	constructor(entries: string[]) {
		for (const entry of entries) {
			const decomposed = decomposeEntryPath(entry);
			if (!decomposed) continue;

			const { packageName, className, isInnerClass, outerClassName, isAnonymous } = decomposed;

			// Register the package and all ancestor packages
			if (packageName) {
				this.registerPackageHierarchy(packageName);
			} else {
				// Root-level class (empty package)
				this.allPackages.add('');
			}

			if (isInnerClass) {
				// Group under outer class FQN
				const outerFqn = packageName ? `${packageName}.${outerClassName}` : outerClassName!;
				if (!isAnonymous) {
					const existing = this.innerClasses.get(outerFqn) ?? [];
					existing.push(className);
					this.innerClasses.set(outerFqn, existing);
				}
			} else {
				// Top-level class
				const pkgClasses = this.packages.get(packageName) ?? new Set<string>();
				pkgClasses.add(className);
				this.packages.set(packageName, pkgClasses);
			}
		}
	}

	private registerPackageHierarchy(packageName: string): void {
		this.allPackages.add(packageName);
		const parts = packageName.split('.');
		for (let i = 1; i < parts.length; i++) {
			this.allPackages.add(parts.slice(0, i).join('.'));
		}
	}

	getPackages(prefix?: string, depth: number = 1): string[] {
		const result: string[] = [];
		const prefixDepth = prefix ? prefix.split('.').length : 0;

		for (const pkg of this.allPackages) {
			if (pkg === '') continue; // skip root

			const pkgDepth = pkg.split('.').length;
			const relativeDepth = pkgDepth - prefixDepth;

			if (prefix) {
				if (!pkg.startsWith(prefix + '.')) continue;
				if (relativeDepth < 1 || relativeDepth > depth) continue;
			} else {
				if (relativeDepth < 1 || relativeDepth > depth) continue;
			}

			result.push(pkg);
		}

		return result.sort();
	}

	getClasses(packageName: string): ClassInfo[] {
		const classNames = this.packages.get(packageName);
		if (!classNames) return [];

		const result: ClassInfo[] = [];
		for (const className of classNames) {
			const fqn = packageName ? `${packageName}.${className}` : className;
			const innerClassNames = this.innerClasses.get(fqn) ?? [];
			result.push({ className, innerClassNames });
		}

		return result.sort((a, b) => a.className.localeCompare(b.className));
	}

	getClassCount(packageName: string): number {
		return this.packages.get(packageName)?.size ?? 0;
	}
}
