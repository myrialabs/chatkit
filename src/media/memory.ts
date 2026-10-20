/**
 * In-memory `MediaStore` — the default. Holds blobs in a `Map`, keyed by a
 * generated id and addressed by a `chatkit-media://<id>` handle. Lost on restart;
 * use {@link FileMediaStore} to persist.
 */

import { newId } from '../envelope.js';
import type { MediaBlob, MediaStore, StoredMedia } from './index.js';

const SCHEME = 'chatkit-media://';

export class MemoryMediaStore implements MediaStore {
	private readonly items = new Map<string, MediaBlob & { size_bytes: number }>();

	async put(blob: MediaBlob): Promise<StoredMedia> {
		const id = newId();
		const size_bytes = blob.data.byteLength;
		this.items.set(id, { ...blob, size_bytes });
		return { id, url: SCHEME + id, mime: blob.mime, filename: blob.filename, size_bytes };
	}

	async get(id: string): Promise<(MediaBlob & { size_bytes: number }) | null> {
		return this.items.get(id) ?? null;
	}

	async delete(id: string): Promise<void> {
		this.items.delete(id);
	}

	idFromUrl(url: string): string | null {
		return url.startsWith(SCHEME) ? url.slice(SCHEME.length) : null;
	}
}
