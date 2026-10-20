/**
 * The `MediaStore` port and the `MediaProxy` that adapters use. ChatKit proxies
 * media both ways:
 *
 *   - inbound: the adapter downloads bytes from the platform, the proxy stores
 *     them and hands back a stable URL/handle for `content.media.url` (native
 *     URLs are often TTL'd or auth'd);
 *   - outbound: the proxy resolves a consumer URL / handle / raw bytes into bytes
 *     the adapter re-uploads, validating size & format against the platform's
 *     capability *before* sending.
 */

import type { CapabilityDescriptor, MediaType, OutboundContent } from '../schema.js';
import { CapabilityError } from '../capability.js';

export interface StoredMedia {
	id: string;
	/** A stable handle/URL for `content.media.url`. Resolvable by the same store. */
	url: string;
	mime?: string;
	filename?: string;
	size_bytes: number;
}

export interface MediaBlob {
	data: Uint8Array;
	mime?: string;
	filename?: string;
}

/** Metadata carried alongside a streamed blob (size is discovered while streaming). */
export interface MediaMeta {
	mime?: string;
	filename?: string;
}

/** A byte stream plus the metadata a store recorded for it. */
export interface MediaReadStream extends MediaMeta {
	stream: AsyncIterable<Uint8Array>;
	size_bytes: number;
}

export interface MediaStore {
	put(blob: MediaBlob): Promise<StoredMedia>;
	get(id: string): Promise<(MediaBlob & { size_bytes: number }) | null>;
	delete(id: string): Promise<void>;
	/** Recover the media id from a URL this store issued, or `null` if foreign. */
	idFromUrl(url: string): string | null;

	/**
	 * Optional streaming ingest: persist bytes as they arrive without ever holding the
	 * whole payload in memory. A store that omits this is driven through {@link put}
	 * with a buffered fallback. Disk-backed stores should implement it — it is what
	 * keeps a few concurrent large media from spiking RAM (`exp.txt`: "meledup server").
	 */
	putStream?(source: AsyncIterable<Uint8Array>, meta?: MediaMeta): Promise<StoredMedia>;

	/** Optional streaming read for a stored handle, or `null` if unknown/foreign. */
	openRead?(id: string): Promise<MediaReadStream | null>;
}

/** Buffer an async byte stream into a single `Uint8Array` (fallback path). */
async function collectStream(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of source) {
		chunks.push(chunk);
		total += chunk.byteLength;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/** Per-platform outbound media size ceilings (bytes), best-effort and generous. */
const SIZE_LIMITS: Record<string, number> = {
	telegram: 50 * 1024 * 1024,
	whatsapp_baileys: 100 * 1024 * 1024,
	whatsapp_cloud: 100 * 1024 * 1024,
	discord: 25 * 1024 * 1024,
	slack: 1024 * 1024 * 1024
};

export interface MediaProxyOptions {
	/** Hard cap applied on top of per-platform limits. */
	maxBytes?: number;
	/** Override the per-platform fetch used for external URLs (tests). */
	fetchImpl?: typeof fetch;
}

/**
 * Wraps a {@link MediaStore} with the inbound/outbound proxy logic and
 * capability-aware validation. `ChatKit` constructs one and injects it into
 * every adapter via the {@link AdapterContext}.
 */
export class MediaProxy {
	readonly store: MediaStore;
	private readonly maxBytes?: number;
	private readonly fetchImpl: typeof fetch;

	constructor(store: MediaStore, options?: MediaProxyOptions) {
		this.store = store;
		this.maxBytes = options?.maxBytes;
		this.fetchImpl = options?.fetchImpl ?? fetch;
	}

	/** Inbound: persist downloaded bytes and return a stable handle. */
	ingest(blob: MediaBlob): Promise<StoredMedia> {
		return this.store.put(blob);
	}

	/**
	 * Inbound (streaming): persist a byte stream and return a stable handle. Uses the
	 * store's `putStream` when available (no full-payload buffering); otherwise buffers
	 * the stream and falls back to {@link ingest}. Adapters should prefer this for
	 * platform downloads that expose a stream (e.g. Baileys `downloadMediaMessage`).
	 */
	async ingestStream(source: AsyncIterable<Uint8Array>, meta?: MediaMeta): Promise<StoredMedia> {
		if (this.store.putStream) return this.store.putStream(source, meta);
		const data = await collectStream(source);
		return this.store.put({ data, mime: meta?.mime, filename: meta?.filename });
	}

	/**
	 * Outbound (streaming): a byte stream for `content` when it resolves to a handle in
	 * a stream-capable store, else `null` (caller falls back to {@link resolveOutbound}).
	 * Inline `data` and external URLs are not streamed — only our own stored handles.
	 */
	async openOutboundStream(content: Extract<OutboundContent, { type: 'media' }>): Promise<MediaReadStream | null> {
		if (content.data || !content.url || !this.store.openRead) return null;
		const id = this.store.idFromUrl(content.url);
		if (!id) return null;
		return this.store.openRead(id);
	}

	/**
	 * Outbound: resolve `content` to raw bytes for re-upload. Accepts inline
	 * `data`, a handle issued by our store, or an external URL (fetched).
	 */
	async resolveOutbound(content: Extract<OutboundContent, { type: 'media' }>): Promise<MediaBlob> {
		if (content.data) {
			return { data: content.data, mime: content.mime, filename: content.filename };
		}
		if (!content.url) {
			throw new Error('Outbound media requires either `data` or `url`.');
		}
		const id = this.store.idFromUrl(content.url);
		if (id) {
			const stored = await this.store.get(id);
			if (!stored) throw new Error(`Media handle not found in store: ${content.url}`);
			return { data: stored.data, mime: content.mime ?? stored.mime, filename: content.filename ?? stored.filename };
		}
		const res = await this.fetchImpl(content.url);
		if (!res.ok) throw new Error(`Failed to fetch outbound media (${res.status}): ${content.url}`);
		const data = new Uint8Array(await res.arrayBuffer());
		const mime = content.mime ?? res.headers.get('content-type') ?? undefined;
		return { data, mime, filename: content.filename };
	}

	/**
	 * Validate an outbound media payload against a platform's capabilities and
	 * size limits. Throws a {@link CapabilityError} (unsupported type) or a plain
	 * `Error` (too large) — fail early, never a silent no-op.
	 */
	validate(
		descriptor: CapabilityDescriptor,
		content: Extract<OutboundContent, { type: 'media' }>,
		sizeBytes: number
	): void {
		const m = content.media_type as MediaType;
		if (!descriptor.supports.media.includes(m)) {
			throw new CapabilityError(descriptor.platform, `media type "${m}"`, `supported: [${descriptor.supports.media.join(', ')}]`);
		}
		const platformLimit = SIZE_LIMITS[descriptor.platform] ?? Number.POSITIVE_INFINITY;
		const limit = Math.min(platformLimit, this.maxBytes ?? Number.POSITIVE_INFINITY);
		if (sizeBytes > limit) {
			throw new Error(
				`Media is ${sizeBytes} bytes, over the ${limit}-byte limit for ${descriptor.platform}.`
			);
		}
	}
}

export { MemoryMediaStore } from './memory.js';
export { FileMediaStore, type FileMediaStoreOptions } from './file.js';
