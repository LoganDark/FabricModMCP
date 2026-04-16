import StreamZip from 'node-stream-zip';
import { DomainError } from '../errors/domain-error.js';

export class JarReader {
	private handles = new Map<string, Promise<StreamZip.StreamZipAsync>>();
	private projectHandles = new Map<string, Set<string>>();

	registerProject(projectName: string, jarPaths: Set<string>): void {
		this.projectHandles.set(projectName, new Set(jarPaths));
	}

	getProjectJars(projectName: string): Set<string> | undefined {
		return this.projectHandles.get(projectName);
	}

	addProjectJar(projectName: string, jarPath: string): void {
		const paths = this.projectHandles.get(projectName);
		if (!paths) {
			throw new DomainError(
				'PROJECT_NOT_REGISTERED',
				`Project '${projectName}' is not registered with the jar reader`,
				[projectName],
				['Load the project first'],
			);
		}
		paths.add(jarPath);
	}

	async removeProjectJar(projectName: string, jarPath: string): Promise<void> {
		const paths = this.projectHandles.get(projectName);
		if (!paths) return;
		paths.delete(jarPath);

		// Check if any other project still references this jar
		let shared = false;
		for (const [otherName, otherPaths] of this.projectHandles) {
			if (otherName !== projectName && otherPaths.has(jarPath)) {
				shared = true;
				break;
			}
		}
		if (!shared) {
			await this.close(jarPath);
		}
	}

	async closeProject(projectName: string): Promise<void> {
		const paths = this.projectHandles.get(projectName);
		if (!paths) return;

		for (const jarPath of paths) {
			// Check if any other project still references this jar
			let shared = false;
			for (const [otherName, otherPaths] of this.projectHandles) {
				if (otherName !== projectName && otherPaths.has(jarPath)) {
					shared = true;
					break;
				}
			}
			if (!shared) {
				await this.close(jarPath);
			}
		}

		this.projectHandles.delete(projectName);
	}

	async readEntry(jarPath: string, entryPath: string): Promise<Buffer> {
		const zip = await this.getHandle(jarPath);
		try {
			return await zip.entryData(entryPath);
		} catch {
			throw new DomainError(
				'JAR_ENTRY_NOT_FOUND',
				`Entry '${entryPath}' not found in jar`,
				[jarPath, entryPath],
				['Check the entry path -- use list_packages and list_classes to browse available paths'],
			);
		}
	}

	async listEntries(jarPath: string): Promise<string[]> {
		const zip = await this.getHandle(jarPath);
		const entries = await zip.entries();
		return Object.keys(entries);
	}

	async close(jarPath: string): Promise<void> {
		const handlePromise = this.handles.get(jarPath);
		if (handlePromise) {
			this.handles.delete(jarPath);
			try {
				const handle = await handlePromise;
				await handle.close();
			} catch {
				// Handle failed to open -- nothing to close
			}
		}
	}

	async closeAll(): Promise<void> {
		const promises = Array.from(this.handles.values());
		this.handles.clear();
		for (const handlePromise of promises) {
			try {
				const handle = await handlePromise;
				await handle.close();
			} catch {
				// Handle failed to open -- nothing to close
			}
		}
	}

	private async getHandle(jarPath: string): Promise<StreamZip.StreamZipAsync> {
		const existing = this.handles.get(jarPath);
		if (existing) {
			return existing;
		}

		const handlePromise = (async () => {
			const zip = new StreamZip.async({ file: jarPath, storeEntries: true });
			// Force open by accessing entries (validates the file exists and is a valid ZIP)
			await zip.entries();
			return zip;
		})();
		this.handles.set(jarPath, handlePromise);

		try {
			return await handlePromise;
		} catch {
			this.handles.delete(jarPath);
			throw new DomainError(
				'JAR_OPEN_FAILED',
				`Failed to open jar: ${jarPath}`,
				[jarPath],
				['Check that the file exists and is a valid JAR/ZIP file'],
			);
		}
	}
}
