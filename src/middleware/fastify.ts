/**
 * Fastify webhook handler. Capture the raw body so signatures verify — e.g. add
 * a content-type parser that keeps the buffer:
 *
 * ```ts
 * fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
 * fastify.post('/webhook/wa', fastifyWebhook({ chat, platform: 'whatsapp_cloud', account: 'wa:1' }));
 * ```
 */

import { normalizeHeaders, normalizeQuery, processWebhook, type WebhookHandlerOptions } from './shared.js';

export function fastify(options: WebhookHandlerOptions) {
	return async (request: any, reply: any): Promise<void> => {
		const src = request.rawBody ?? request.body;
		const raw: string | Uint8Array = Buffer.isBuffer(src)
			? new Uint8Array(src)
			: typeof src === 'string'
				? src
				: JSON.stringify(src ?? {});
		const result = await processWebhook(options, {
			method: request.method,
			headers: normalizeHeaders(request.headers),
			body: raw,
			query: normalizeQuery(request.query)
		});
		if (result.contentType) reply.type(result.contentType);
		reply.code(result.status).send(result.body);
	};
}
