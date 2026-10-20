/**
 * Filesystem `MediaStore`. Writes each blob to `<dir>/<id>` with a `<id>.json`
 * sidecar holding its mime/filename. If a `baseUrl` is configured, handles are
 * public URLs the consumer serves (e.g. from `examples/server`); otherwise a
 * `chatkit-media://<id>` handle is issued and resolved back through this store.
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { newId } from '../envelope.js';
import type { MediaBlob, MediaMeta, MediaReadStream, MediaStore, StoredMedia } from './index.js';

const SCHEME = 'chatkit-media://';

export interface FileMediaStoreOptions {
	/** Directory to hold media files. Default `./media-store`. */
	dir?: string;
	/** Public base URL the consumer serves files under (no trailing slash). */
	baseUrl?: string;
}

interface Sidecar {
	mime?: string;
	filename?: string;
	size_bytes: number;
}

export class FileMediaStore implements MediaStore {
	private readonly dir: string;
	private readonly baseUrl?: string;
	private ready: Promise<void> | null = null;

	constructor(options?: FileMediaStoreOptions) {
		this.dir = options?.dir ?? './media-store';
		this.baseUrl = options?.baseUrl?.replace(/\/$/, '');
	}

	private ensureDir(): Promise<void> {
		if (!this.ready) this.ready = mkdir(this.dir, { recursive: true }).then(() => undefined);
		return this.ready;
	}

	private urlFor(id: string): string {
		return this.baseUrl ? `${this.baseUrl}/${id}` : SCHEME + id;
	}

	async put(blob: MediaBlob): Promise<StoredMedia> {
		await this.ensureDir();
		const id = newId();
		const size_bytes = blob.data.byteLength;
		const meta: Sidecar = { mime: blob.mime, filename: blob.filename, size_bytes };
		await writeFile(join(this.dir, id), blob.data);
		await writeFile(join(this.dir, `${id}.json`), JSON.stringify(meta), 'utf8');
		return { id, url: this.urlFor(id), mime: blob.mime, filename: blob.filename, size_bytes };
	}

	async get(id: string): Promise<(MediaBlob & { size_bytes: number }) | null> {
		try {
			const data = new Uint8Array(await readFile(join(this.dir, id)));
			const meta = JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as Sidecar;
			return { data, mime: meta.mime, filename: meta.filename, size_bytes: meta.size_bytes };
		} catch {
			return null;
		}
	}

	/** Stream bytes straight to disk, counting size as we go (never fully buffered). */
	async putStream(source: AsyncIterable<Uint8Array>, meta?: MediaMeta): Promise<StoredMedia> {
		await this.ensureDir();
		const id = newId();
		const path = join(this.dir, id);
		let size_bytes = 0;
		const counting = (async function* () {
			for await (const chunk of source) {
				size_bytes += chunk.byteLength;
				yield chunk;
			}
		})();
		try {
			await pipeline(counting, createWriteStream(path));
		} catch (error) {
			await rm(path, { force: true });
			throw error;
		}
		const sidecar: Sidecar = { mime: meta?.mime, filename: meta?.filename, size_bytes };
		await writeFile(join(this.dir, `${id}.json`), JSON.stringify(sidecar), 'utf8');
		return { id, url: this.urlFor(id), mime: meta?.mime, filename: meta?.filename, size_bytes };
	}

	async openRead(id: string): Promise<MediaReadStream | null> {
		let meta: Sidecar;
		try {
			meta = JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as Sidecar;
		} catch {
			return null;
		}
		return { stream: createReadStream(join(this.dir, id)), mime: meta.mime, filename: meta.filename, size_bytes: meta.size_bytes };
	}

	async delete(id: string): Promise<void> {
		await rm(join(this.dir, id), { force: true });
		await rm(join(this.dir, `${id}.json`), { force: true });
	}

	idFromUrl(url: string): string | null {
		if (this.baseUrl && url.startsWith(this.baseUrl + '/')) return url.slice(this.baseUrl.length + 1);
		if (url.startsWith(SCHEME)) return url.slice(SCHEME.length);
		return null;
	}
}
