/**
 * Adapter media helpers for streaming a `fetch` download into the `MediaStore`
 * without buffering the whole payload in memory. Every platform adapter pulls
 * inbound media the same way — `fetch(url)` then hand the bytes to
 * `ctx.media.ingestStream(...)` — so the web-`ReadableStream` → `AsyncIterable`
 * bridge lives here once.
 */

/**
 * Yield a `fetch` Response body as `Uint8Array` chunks. Uses the reader API so it
 * works uniformly on Node and Bun (whose `res.body` is a web `ReadableStream`).
 * Falls back to a single buffered chunk when a body stream is unavailable (e.g. a
 * mocked Response in tests), so callers never need a separate code path.
 */
export async function* responseBytes(res: Response): AsyncIterable<Uint8Array> {
	const body = res.body as ReadableStream<Uint8Array> | null | undefined;
	if (!body || typeof body.getReader !== 'function') {
		yield new Uint8Array(await res.arrayBuffer());
		return;
	}
	const reader = body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) yield value;
		}
	} finally {
		reader.releaseLock?.();
	}
}
