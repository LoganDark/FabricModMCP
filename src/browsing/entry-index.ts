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

export interface ClassIndexEntry {
	className: string;
	innerClassNames: string[];
}

export interface FlatClassIndexEntry {
	fqn: string;
	className: string;
	packageName: string;
	isInnerClass: boolean;
}

export class EntryIndex {
	private packages = new Map<string, Set<string>>();
	private innerClasses = new Map<string, string[]>();
	// Tree structure: parent package → direct child packages
	private childPackages = new Map<string, Set<string>>();

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
				if (!this.childPackages.has('')) {
					this.childPackages.set('', new Set());
				}
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
		const parts = packageName.split('.');
		for (let i = parts.length; i >= 1; i--) {
			const pkg = parts.slice(0, i).join('.');
			const parent = i > 1 ? parts.slice(0, i - 1).join('.') : '';
			const siblings = this.childPackages.get(parent) ?? new Set();
			if (siblings.has(pkg)) break; // already registered this branch
			siblings.add(pkg);
			this.childPackages.set(parent, siblings);
		}
	}

	getPackages(prefix?: string, depth: number = 1): string[] {
		const root = prefix ?? '';
		const result: string[] = [];

		// BFS to requested depth
		let frontier = this.childPackages.get(root);
		if (!frontier) return result;

		for (let d = 0; d < depth; d++) {
			const nextFrontier = new Set<string>();
			for (const pkg of frontier) {
				result.push(pkg);
				const children = this.childPackages.get(pkg);
				if (children) {
					for (const child of children) {
						nextFrontier.add(child);
					}
				}
			}
			frontier = nextFrontier;
			if (frontier.size === 0) break;
		}

		return result.sort();
	}

	getClasses(packageName: string): ClassIndexEntry[] {
		const classNames = this.packages.get(packageName);
		if (!classNames) return [];

		const result: ClassIndexEntry[] = [];
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

	getAllClasses(): FlatClassIndexEntry[] {
		const result: FlatClassIndexEntry[] = [];

		for (const [packageName, classNames] of this.packages) {
			for (const className of classNames) {
				const fqn = packageName ? `${packageName}.${className}` : className;
				result.push({ fqn, className, packageName, isInnerClass: false });

				// Add non-anonymous inner classes
				const innerClassNames = this.innerClasses.get(fqn);
				if (innerClassNames) {
					for (const innerClassName of innerClassNames) {
						const innerFqn = packageName ? `${packageName}.${innerClassName}` : innerClassName;
						result.push({ fqn: innerFqn, className: innerClassName, packageName, isInnerClass: true });
					}
				}
			}
		}

		return result;
	}
}
