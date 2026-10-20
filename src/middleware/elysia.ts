/**
 * Elysia webhook handler. Reads the raw body off the standard `Request` (Elysia
 * runs on Bun's Web APIs) so signature verification works.
 *
 * ```ts
 * import { Elysia } from 'elysia';
 * import { elysia as webhook } from '@myrialabs/chatkit/middleware';
 *
 * new Elysia().post('/webhook/discord', webhook({ chat, platform: 'discord', account: 'bot' }));
 * ```
 */

import { normalizeHeaders, normalizeQuery, processWebhook, type WebhookHandlerOptions } from './shared.js';

export function elysia(options: WebhookHandlerOptions) {
	return async (context: any): Promise<Response> => {
		const request: Request = context.request;
		const body = await request.text();
		const url = new URL(request.url);
		const result = await processWebhook(options, {
			method: request.method,
			headers: normalizeHeaders(request.headers),
			body,
			query: normalizeQuery(url.searchParams)
		});
		return new Response(result.body, {
			status: result.status,
			headers: result.contentType ? { 'content-type': result.contentType } : undefined
		});
	};
}
