/**
 * Express webhook handler. Mount with a *raw* body parser so the signature is
 * computed over the unmodified bytes:
 *
 * ```ts
 * import express from 'express';
 * import { express as webhook } from '@myrialabs/chatkit/middleware';
 *
 * app.post('/webhook/slack', express.raw({ type: '*\/*' }), webhook({ chat, platform: 'slack', account: 'workspace' }));
 * ```
 */

import { normalizeHeaders, normalizeQuery, processWebhook, type WebhookHandlerOptions } from './shared.js';

export function express(options: WebhookHandlerOptions) {
	return async (req: any, res: any): Promise<void> => {
		const raw: string | Uint8Array = Buffer.isBuffer(req.body)
			? new Uint8Array(req.body)
			: typeof req.body === 'string'
				? req.body
				: JSON.stringify(req.body ?? {});
		const result = await processWebhook(options, {
			method: req.method,
			headers: normalizeHeaders(req.headers),
			body: raw,
			query: normalizeQuery(req.query)
		});
		if (result.contentType) res.type(result.contentType);
		res.status(result.status).send(result.body);
	};
}
