/**
 * Shared webhook plumbing for the framework adapters. ChatKit's inbound
 * verification needs the *raw* request body, so each adapter passes the
 * unparsed body straight through. The flow is uniform across frameworks:
 *
 *   1. if the adapter exposes a handshake challenge (WA Cloud GET / Slack
 *      `url_verification`), echo it;
 *   2. if it exposes a `webhookReply` (Discord interactions, which must be
 *      answered in the HTTP response), send that — after `receive()` when the
 *      reply says the request is also a message to deliver;
 *   3. otherwise verify + normalise via `chat.receive()` and ack.
 */

import type { ChatKit } from '../chatkit.js';
import type { InboundRequest, WebhookReply } from '../adapter.js';
import type { PlatformId } from '../schema.js';

export interface WebhookHandlerOptions {
	chat: ChatKit;
	platform: PlatformId;
	/**
	 * The registered account this route feeds — a fixed id, or a function of the
	 * request for one URL shared by several accounts (a Slack app installed in many
	 * workspaces: `account: (req) => slackTeamId(req) ?? 'unknown'`).
	 */
	account: string | ((req: InboundRequest) => string);
}

export interface WebhookResult {
	status: number;
	body: string;
	contentType?: string;
}

/** Optional webhook hooks an adapter may expose (duck-typed, like `handleInbound`). */
export interface WebhookAdapter {
	webhookChallenge?(req: InboundRequest): string | null;
	webhookReply?(req: InboundRequest): WebhookReply | null;
}

/** Lower-case a header bag (string | string[] | undefined values). */
export function normalizeHeaders(headers: Record<string, unknown> | Headers): Record<string, string> {
	const out: Record<string, string> = {};
	if (typeof (headers as Headers).forEach === 'function' && (headers as Headers).get) {
		(headers as Headers).forEach((value, key) => {
			out[key.toLowerCase()] = value;
		});
		return out;
	}
	for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
		if (value == null) continue;
		out[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
	}
	return out;
}

/** Coerce a query bag to `Record<string,string>`. */
export function normalizeQuery(query: Record<string, unknown> | URLSearchParams | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!query) return out;
	if (query instanceof URLSearchParams) {
		for (const [k, v] of query) out[k] = v;
		return out;
	}
	for (const [k, v] of Object.entries(query)) {
		if (v == null) continue;
		out[k] = Array.isArray(v) ? String(v[0]) : String(v);
	}
	return out;
}

/** Run the shared webhook flow and return a framework-agnostic result. */
export async function processWebhook(options: WebhookHandlerOptions, req: InboundRequest): Promise<WebhookResult> {
	const { chat, platform } = options;
	const account = typeof options.account === 'function' ? options.account(req) : options.account;
	const adapter = chat.adapterFor(platform, account) as WebhookAdapter | undefined;
	const challenge = adapter?.webhookChallenge?.(req);
	if (challenge != null) {
		return { status: 200, body: challenge, contentType: 'text/plain' };
	}
	const reply = adapter?.webhookReply?.(req);
	if (reply && !reply.deliver) return reply;
	try {
		await chat.receive(platform, account, req);
		return reply ? { status: reply.status, body: reply.body, contentType: reply.contentType } : { status: 200, body: '' };
	} catch (error) {
		const message = (error as Error).message ?? '';
		if (/verification failed/i.test(message)) return { status: 401, body: 'verification failed' };
		return { status: 400, body: 'bad request' };
	}
}
