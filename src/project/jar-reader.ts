import StreamZip from 'node-stream-zip';
import { DomainError } from '../errors/domain-error.js';

export class JarReader {
	private handles = new Map<string, StreamZip.StreamZipAsync>();

	async readEntry(jarPath: string, entryPath: string): Promise<Buffer> {
		const zip = await this.getHandle(jarPath);
		try {
			return await zip.entryData(entryPath);
		} catch {
			throw new DomainError(
				'JAR_ENTRY_NOT_FOUND',
				`Entry '${entryPath}' not found in jar`,
				[jarPath, entryPath],
				['Check the entry path -- use listEntries to see available paths'],
			);
		}
	}

	async listEntries(jarPath: string): Promise<string[]> {
		const zip = await this.getHandle(jarPath);
		const entries = await zip.entries();
		return Object.keys(entries);
	}

	async close(jarPath: string): Promise<void> {
		const handle = this.handles.get(jarPath);
		if (handle) {
			await handle.close();
			this.handles.delete(jarPath);
		}
	}

	async closeAll(): Promise<void> {
		for (const [, handle] of this.handles) {
			await handle.close();
		}
		this.handles.clear();
	}

	private async getHandle(jarPath: string): Promise<StreamZip.StreamZipAsync> {
		let handle = this.handles.get(jarPath);
		if (!handle) {
			try {
				handle = new StreamZip.async({ file: jarPath, storeEntries: true });
				// Force open by accessing entries (validates the file exists and is a valid ZIP)
				await handle.entries();
				this.handles.set(jarPath, handle);
			} catch {
				throw new DomainError(
					'JAR_OPEN_FAILED',
					`Failed to open jar: ${jarPath}`,
					[jarPath],
					['Check that the file exists and is a valid JAR/ZIP file'],
				);
			}
		}
		return handle;
	}
}
