/**
 * A tiny Server-Sent-Events hub. The inbox is push-driven: ChatKit streams live
 * platform events, the ingest layer persists them, and every connected browser
 * tab gets the new row over SSE. No websocket library, no polling.
 */

const encoder = new TextEncoder();
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function frame(event: string, payload: unknown): Uint8Array {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** Fan a named event out to every open SSE connection. */
export function broadcast(event: string, payload: unknown): void {
	const chunk = frame(event, payload);
	for (const controller of clients) {
		try {
			controller.enqueue(chunk);
		} catch {
			clients.delete(controller);
		}
	}
}

/** Open one SSE stream for a browser tab. Returns a streaming `Response`. */
export function sseResponse(): Response {
	let self: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			self = controller;
			clients.add(controller);
			controller.enqueue(frame('hello', { ok: true }));
		},
		cancel() {
			clients.delete(self);
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
}

// Keep proxies and load balancers from closing idle streams.
setInterval(() => broadcast('ping', { t: Date.now() }), 25_000);
