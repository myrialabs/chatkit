import { test, expect, describe } from 'bun:test';
import { MediaProxy, MemoryMediaStore, releaseStream, type MediaStore } from './index.js';
import { FileMediaStore } from './file.js';
import { capabilities, emptySupport } from '../capability.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** An async byte stream that records whether its iterator was ended early. */
function tracked(bytes: number[]): AsyncIterable<Uint8Array> & { released: boolean } {
	const stream = {
		released: false,
		[Symbol.asyncIterator]() {
			let done = false;
			return {
				next: async () => {
					if (done) return { done: true as const, value: undefined };
					done = true;
					return { done: false as const, value: new Uint8Array(bytes) };
				},
				return: async () => {
					stream.released = true;
					return { done: true as const, value: undefined };
				}
			};
		}
	};
	return stream;
}

const cap = capabilities('telegram', { ...emptySupport(), media: ['image'] });

describe('MediaProxy', () => {
	test('ingest stores bytes and returns a resolvable handle', async () => {
		const proxy = new MediaProxy(new MemoryMediaStore());
		const stored = await proxy.ingest({ data: new Uint8Array([1, 2, 3]), mime: 'image/png' });
		expect(stored.size_bytes).toBe(3);
		const blob = await proxy.resolveOutbound({ type: 'media', media_type: 'image', url: stored.url });
		expect(Array.from(blob.data)).toEqual([1, 2, 3]);
	});

	test('resolveOutbound passes through inline data', async () => {
		const proxy = new MediaProxy(new MemoryMediaStore());
		const blob = await proxy.resolveOutbound({ type: 'media', media_type: 'image', data: new Uint8Array([9]) });
		expect(Array.from(blob.data)).toEqual([9]);
	});

	test('resolveOutbound fetches external URLs', async () => {
		const fetchImpl = (async () =>
			new Response(new Uint8Array([7, 7]), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
		const proxy = new MediaProxy(new MemoryMediaStore(), { fetchImpl });
		const blob = await proxy.resolveOutbound({ type: 'media', media_type: 'image', url: 'https://example.com/a.jpg' });
		expect(Array.from(blob.data)).toEqual([7, 7]);
		expect(blob.mime).toBe('image/jpeg');
	});

	test('validate rejects unsupported type and oversize', () => {
		const proxy = new MediaProxy(new MemoryMediaStore(), { maxBytes: 10 });
		expect(() => proxy.validate(cap, { type: 'media', media_type: 'video' }, 5)).toThrow();
		expect(() => proxy.validate(cap, { type: 'media', media_type: 'image' }, 50)).toThrow(/limit/);
		expect(() => proxy.validate(cap, { type: 'media', media_type: 'image' }, 5)).not.toThrow();
	});
});

describe('FileMediaStore', () => {
	test('persists to disk and resolves back', async () => {
		const dir = './.tmp-media-test';
		const store = new FileMediaStore({ dir });
		const stored = await store.put({ data: new Uint8Array([1, 2, 3, 4]), mime: 'application/pdf', filename: 'a.pdf' });
		const id = store.idFromUrl(stored.url);
		expect(id).toBe(stored.id);
		const back = await store.get(stored.id);
		expect(back?.size_bytes).toBe(4);
		expect(back?.mime).toBe('application/pdf');
		await rm(dir, { recursive: true, force: true });
	});

	test('streams bytes in and back out without buffering the whole payload', async () => {
		const dir = './.tmp-media-stream-test';
		const store = new FileMediaStore({ dir });
		async function* source() {
			yield new Uint8Array([1, 2]);
			yield new Uint8Array([3, 4, 5]);
		}
		const stored = await store.putStream(source(), { mime: 'video/mp4', filename: 'v.mp4' });
		expect(stored.size_bytes).toBe(5);
		expect(stored.mime).toBe('video/mp4');

		const read = await store.openRead(stored.id);
		expect(read).not.toBeNull();
		expect(read!.size_bytes).toBe(5);
		const chunks: number[] = [];
		for await (const c of read!.stream) chunks.push(...c);
		expect(chunks).toEqual([1, 2, 3, 4, 5]);

		expect(await store.openRead('nope')).toBeNull();
		await rm(dir, { recursive: true, force: true });
	});
});

describe('MediaProxy streaming', () => {
	test('ingestStream buffers into a store without putStream (fallback)', async () => {
		const proxy = new MediaProxy(new MemoryMediaStore());
		async function* source() {
			yield new Uint8Array([1]);
			yield new Uint8Array([2, 3]);
		}
		const stored = await proxy.ingestStream(source(), { mime: 'image/png' });
		expect(stored.size_bytes).toBe(3);
		const blob = await proxy.resolveOutbound({ type: 'media', media_type: 'image', url: stored.url });
		expect(Array.from(blob.data)).toEqual([1, 2, 3]);
	});

	test('openOutboundStream streams from a stream-capable store, else null', async () => {
		const dir = './.tmp-media-out-test';
		try {
			const proxy = new MediaProxy(new FileMediaStore({ dir }));
			async function* source() {
				yield new Uint8Array([8, 9]);
			}
			const stored = await proxy.ingestStream(source(), { mime: 'video/mp4' });
			const out = await proxy.openOutboundStream({ type: 'media', media_type: 'video', url: stored.url });
			expect(out?.size_bytes).toBe(2);
			const chunks: number[] = [];
			for await (const c of out!.stream) chunks.push(...c);
			expect(chunks).toEqual([8, 9]);

			// Inline data and foreign URLs are never streamed.
			expect(await proxy.openOutboundStream({ type: 'media', media_type: 'video', data: new Uint8Array([1]) })).toBeNull();
			expect(await proxy.openOutboundStream({ type: 'media', media_type: 'video', url: 'https://x/y.mp4' })).toBeNull();

			// A store without openRead returns null (fallback to buffered resolveOutbound).
			const memProxy = new MediaProxy(new MemoryMediaStore());
			const memStored = await memProxy.ingest({ data: new Uint8Array([1]), mime: 'video/mp4' });
			expect(await memProxy.openOutboundStream({ type: 'media', media_type: 'video', url: memStored.url })).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('openOutboundStream returns null when the blob vanished behind its sidecar', async () => {
		const dir = './.tmp-media-missing-test';
		try {
			const store = new FileMediaStore({ dir });
			const proxy = new MediaProxy(store);
			const stored = await store.put({ data: new Uint8Array([1, 2]), mime: 'video/mp4' });
			await rm(join(dir, stored.id));
			expect(await proxy.openOutboundStream({ type: 'media', media_type: 'video', url: stored.url })).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('openOutboundStream releases the stream when the check throws', async () => {
		const read = { stream: tracked([1]), mime: 'video/mp4', size_bytes: 1 };
		const store = { idFromUrl: () => 'x', openRead: async () => read } as unknown as MediaStore;
		const proxy = new MediaProxy(store);
		const tooBig = new Error('too big');
		await expect(
			proxy.openOutboundStream({ type: 'media', media_type: 'video', url: 'chatkit-media://x' }, () => {
				throw tooBig;
			})
		).rejects.toBe(tooBig);
		expect(read.stream.released).toBe(true);
	});

	test('releaseStream ends an unconsumed stream', async () => {
		const stream = tracked([1, 2]);
		await releaseStream(stream);
		expect(stream.released).toBe(true);
	});
});
