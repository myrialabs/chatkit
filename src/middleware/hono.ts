/**
 * Hono webhook handler. Reads the raw request text (required for signature
 * verification) and returns a `Response`.
 *
 * ```ts
 * import { hono } from '@myrialabs/chatkit/middleware';
 * app.post('/webhook/telegram', hono({ chat, platform: 'telegram', account: 'bot' }));
 * ```
 */

import { normalizeHeaders, normalizeQuery, processWebhook, type WebhookHandlerOptions } from './shared.js';

export function hono(options: WebhookHandlerOptions) {
	return async (c: any): Promise<Response> => {
		const body = await c.req.text();
		const result = await processWebhook(options, {
			method: c.req.method,
			headers: normalizeHeaders(c.req.raw.headers),
			body,
			query: normalizeQuery(c.req.query())
		});
		return c.body(result.body, result.status, result.contentType ? { 'content-type': result.contentType } : undefined);
	};
}
