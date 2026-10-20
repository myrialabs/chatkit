/**
 * WhatsApp Cloud API adapter — the official, *stateless webhook* path. Implements {@link WhatsAppAdapter}, so a
 * consumer can swap Baileys ↔ Cloud per account without touching the schema. No
 * SDK: raw Graph API over `fetch`. Inbound media is fetched via `media_id`;
 * outbound media is uploaded to obtain a `media_id` (or sent by link).
 *
 * Templates / interactive messages are platform-specific and go through
 * passthrough (`platform_meta.whatsapp_cloud`), respecting the 24-hour window.
 */

import { capabilities as buildCapabilities, emptySupport } from '../capability.js';
import { inbound, newId } from '../envelope.js';
import { renderWhatsApp } from '../format.js';
import { retryable } from '../queue/index.js';
import { verifyWhatsAppCloud, whatsAppCloudChallenge } from '../verify/index.js';
import { responseBytes } from './util/stream.js';
import type { Adapter, AdapterContext, InboundRequest, MessageTarget, WhatsAppAdapter } from '../adapter.js';
import type {
	Address,
	CapabilityDescriptor,
	MediaType,
	MessageContent,
	OutboundMessage,
	Participant,
	SendResult,
	UniversalMessage
} from '../schema.js';

export interface WhatsAppCloudAdapterOptions {
	/** Consumer-owned account id (typically `wa:<number>`). */
	account: string;
	/** WABA phone number id (the sender). */
	phoneNumberId: string;
	/** System user access token. */
	token: string;
	/** App secret, for `X-Hub-Signature-256` verification. */
	appSecret?: string;
	/**
	 * Accept webhook POSTs even though no `appSecret` is set — anyone who finds the
	 * URL can then inject messages and statuses. For local experiments only.
	 * Default `false`: without a secret, `verifyInbound` rejects every POST.
	 */
	allowUnverified?: boolean;
	/** Verify token used in the GET webhook handshake. */
	verifyToken?: string;
	/** Graph API base. Default `https://graph.facebook.com`. */
	graphBase?: string;
	/**
	 * WhatsApp Business Account id. Needed only by the account-level helpers
	 * (`subscribeApp`, templates); sending and receiving do not use it.
	 */
	businessAccountId?: string;
	/** Graph API version. Default `v21.0`. */
	apiVersion?: string;
	/** Override fetch (tests). */
	fetchImpl?: typeof fetch;
}

const TYPE_TO_MEDIA: Record<string, MediaType> = {
	image: 'image',
	video: 'video',
	audio: 'audio',
	document: 'document',
	sticker: 'sticker'
};

/** The sending number as WhatsApp sees it. */
export interface WhatsAppCloudPhoneNumber {
	id: string;
	display_phone_number: string;
	verified_name: string;
	/** `GREEN` / `YELLOW` / `RED` — falls when users block or report the number. */
	quality_rating?: string;
	/** Daily business-initiated conversation tier, e.g. `TIER_1K`. */
	messaging_limit_tier?: string;
	[extra: string]: unknown;
}

/** One entry of `listTemplates`. */
export interface WhatsAppCloudTemplate {
	id: string;
	name: string;
	language: string;
	/** `APPROVED` / `PENDING` / `REJECTED` / … */
	status: string;
	category: string;
	components?: Array<Record<string, unknown>>;
	[extra: string]: unknown;
}

/** A template to submit for review (`createTemplate`), exactly as Graph takes it. */
export interface WhatsAppCloudTemplateDraft {
	name: string;
	language: string;
	category: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
	components: Array<Record<string, unknown>>;
	/** Any other field Graph accepts, e.g. `allow_category_change`. */
	[extra: string]: unknown;
}

export class WhatsAppCloudAdapter implements WhatsAppAdapter {
	readonly platform = 'whatsapp_cloud' as const;
	readonly account: string;
	private readonly opts: Required<Omit<WhatsAppCloudAdapterOptions, 'appSecret' | 'verifyToken' | 'businessAccountId' | 'allowUnverified' | 'fetchImpl'>> &
		Pick<WhatsAppCloudAdapterOptions, 'appSecret' | 'verifyToken' | 'businessAccountId' | 'allowUnverified'>;
	private readonly fetchImpl: typeof fetch;

	constructor(options: WhatsAppCloudAdapterOptions) {
		if (!options.account || !options.phoneNumberId || !options.token) {
			throw new Error('WhatsAppCloudAdapter requires account, phoneNumberId and token.');
		}
		this.account = options.account;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.opts = {
			account: options.account,
			phoneNumberId: options.phoneNumberId,
			token: options.token,
			appSecret: options.appSecret,
			verifyToken: options.verifyToken,
			businessAccountId: options.businessAccountId,
			allowUnverified: options.allowUnverified,
			graphBase: options.graphBase ?? 'https://graph.facebook.com',
			apiVersion: options.apiVersion ?? 'v21.0'
		};
	}

	capabilities(): CapabilityDescriptor {
		return buildCapabilities('whatsapp_cloud', {
			...emptySupport(),
			delivery_receipt: true,
			read_receipt: true,
			reactions: true,
			buttons: true,
			typing: false,
			templates: true,
			location: true,
			contact: true,
			media: ['image', 'video', 'audio', 'voice', 'document', 'sticker']
		});
	}

	verifyInbound(req: InboundRequest): boolean {
		if ((req.method ?? 'POST').toUpperCase() === 'GET') return true; // handshake, no signature
		if (!this.opts.appSecret) return this.opts.allowUnverified === true;
		return verifyWhatsAppCloud(req.body, req.headers['x-hub-signature-256'], this.opts.appSecret);
	}

	/** Echo value for the GET verification handshake, or `null` if not a handshake. */
	webhookChallenge(req: InboundRequest): string | null {
		if (!this.opts.verifyToken || !req.query) return null;
		return whatsAppCloudChallenge(req.query, this.opts.verifyToken);
	}

	async handleInbound(req: InboundRequest, ctx: AdapterContext): Promise<UniversalMessage | null> {
		if ((req.method ?? 'POST').toUpperCase() === 'GET') return null; // handshake handled separately
		const body = JSON.parse(typeof req.body === 'string' ? req.body : Buffer.from(req.body).toString('utf8'));
		const messages: UniversalMessage[] = [];

		for (const entry of body.entry ?? []) {
			for (const change of entry.changes ?? []) {
				const value = change.value ?? {};
				const profileName = value.contacts?.[0]?.profile?.name as string | undefined;
				for (const status of value.statuses ?? []) {
					ctx.events.status({
						platform_message_id: status.id,
						status: status.status,
						address: this.address(status.recipient_id),
						timestamp: new Date(Number(status.timestamp) * 1000).toISOString(),
						raw: status
					});
				}
				for (const message of value.messages ?? []) {
					const msg = await this.normalize(message, profileName, ctx);
					if (msg) messages.push(msg);
				}
			}
		}

		// Emit extras directly; return the first so receive() delivers exactly one.
		for (let i = 1; i < messages.length; i++) ctx.events.message(messages[i]!);
		return messages[0] ?? null;
	}

	async send(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult> {
		const to = msg.to.conversation_id;
		const context = msg.reply_to ? { context: { message_id: msg.reply_to } } : {};
		const pass = msg.platform_meta?.whatsapp_cloud as Record<string, unknown> | undefined;

		let payload: Record<string, unknown>;
		if (pass) {
			payload = { messaging_product: 'whatsapp', to, ...context, ...pass };
		} else {
			payload = { messaging_product: 'whatsapp', to, ...context, ...(await this.buildPayload(msg, ctx)) };
		}

		const result = await this.graphPost(`${this.opts.phoneNumberId}/messages`, payload);
		return {
			id: newId(),
			platform_message_id: result?.messages?.[0]?.id ?? null,
			status: 'sent',
			timestamp: new Date().toISOString(),
			raw: result
		};
	}

	async markRead(target: MessageTarget): Promise<void> {
		await this.graphPost(`${this.opts.phoneNumberId}/messages`, {
			messaging_product: 'whatsapp',
			status: 'read',
			message_id: target.platform_message_id
		});
	}

	// --- Graph API helpers ----------------------------------------------------
	//
	// Not part of the universal `Adapter` contract: the one-time setup around a
	// Cloud number — check the token and number, subscribe the app to webhooks,
	// manage message templates — plus an escape hatch for anything else.

	/** The sending number: display number, verified name, quality and tier. Doubles as a token check. */
	async getPhoneNumber(): Promise<WhatsAppCloudPhoneNumber> {
		return this.graphGet(
			`${this.opts.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier`
		);
	}

	/** Subscribe the app to this account's webhooks (without it no message ever arrives). */
	async subscribeApp(): Promise<void> {
		await this.graphPost(`${this.waba()}/subscribed_apps`, {});
	}

	/**
	 * List message templates, optionally by `status` (e.g. `APPROVED`). Follows
	 * Graph's paging up to `limit` templates in total (default 250).
	 */
	async listTemplates(options: { status?: string; limit?: number } = {}): Promise<WhatsAppCloudTemplate[]> {
		const max = options.limit ?? 250;
		const out: WhatsAppCloudTemplate[] = [];
		let after: string | undefined;
		while (out.length < max) {
			const query = new URLSearchParams({ limit: String(Math.min(max - out.length, 100)) });
			if (options.status) query.set('status', options.status);
			if (after) query.set('after', after);
			const json = await this.graphGet(`${this.waba()}/message_templates?${query}`);
			out.push(...(json.data ?? []));
			after = json.paging?.next ? json.paging?.cursors?.after : undefined;
			if (!after) break;
		}
		return out.slice(0, max);
	}

	/** Submit a template for review. Resolves to its id and initial status. */
	async createTemplate(template: WhatsAppCloudTemplateDraft): Promise<{ id: string; status: string; category: string }> {
		return this.graphPost(`${this.waba()}/message_templates`, { ...template });
	}

	/** Delete every language of the template called `name`. */
	async deleteTemplate(name: string): Promise<void> {
		await this.graph('DELETE', `${this.waba()}/message_templates?${new URLSearchParams({ name })}`);
	}

	/** Call any Graph endpoint directly (`path` is relative to the version, no leading slash). */
	async api<T = unknown>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
		return this.graph(method, path.replace(/^\/+/, ''), body);
	}

	// --- internals ------------------------------------------------------------

	private waba(): string {
		if (!this.opts.businessAccountId) throw new Error('This call needs `businessAccountId` (the WhatsApp Business Account id).');
		return this.opts.businessAccountId;
	}

	private async buildPayload(msg: OutboundMessage, ctx: AdapterContext): Promise<Record<string, unknown>> {
		const content = msg.content;
		switch (content.type) {
			case 'text':
				return { type: 'text', text: { body: content.rich ? renderWhatsApp(content.rich).text : content.text } };
			case 'location':
				return { type: 'location', location: { latitude: content.lat, longitude: content.lng, name: content.name } };
			case 'contact':
				return {
					type: 'contacts',
					contacts: [{ name: { formatted_name: content.name, first_name: content.name }, phones: [{ phone: content.phone }] }]
				};
			case 'reaction':
				return { type: 'reaction', reaction: { message_id: content.target_message_id, emoji: content.emoji } };
			case 'media': {
				const apiType = content.media_type === 'voice' ? 'audio' : content.media_type;
				// External URL (not one of our handles) → send by link, no upload.
				if (content.url && !ctx.media.store.idFromUrl(content.url)) {
					const linkCaption = content.caption_rich ? renderWhatsApp(content.caption_rich).text : content.caption;
					return { type: apiType, [apiType]: { link: content.url, caption: linkCaption } };
				}
				const blob = await ctx.media.resolveOutbound(content);
				ctx.media.validate(this.capabilities(), content, blob.data.byteLength);
				const mediaId = await this.uploadMedia(blob.data, blob.mime ?? 'application/octet-stream', content.filename);
				const media: Record<string, unknown> = { id: mediaId };
				const caption = content.caption_rich ? renderWhatsApp(content.caption_rich).text : content.caption;
				if (caption && apiType !== 'audio' && apiType !== 'sticker') media.caption = caption;
				if (apiType === 'document' && content.filename) media.filename = content.filename;
				return { type: apiType, [apiType]: media };
			}
			case 'passthrough':
				throw new Error('Passthrough send requires platform_meta.whatsapp_cloud.');
		}
	}

	private async normalize(message: any, profileName: string | undefined, ctx: AdapterContext): Promise<UniversalMessage | null> {
		const content = await this.normalizeContent(message, ctx);
		if (!content) return null;
		return inbound({
			platformMessageId: message.id,
			address: this.address(message.from),
			from: this.participant(message.from, profileName),
			timestamp: new Date(Number(message.timestamp) * 1000),
			content,
			replyTo: message.context?.id ?? null,
			raw: message
		});
	}

	private async normalizeContent(message: any, ctx: AdapterContext): Promise<MessageContent | null> {
		switch (message.type) {
			case 'text':
				return { type: 'text', text: message.text.body };
			case 'location':
				return { type: 'location', lat: message.location.latitude, lng: message.location.longitude, name: message.location.name };
			case 'reaction':
				return { type: 'reaction', emoji: message.reaction.emoji ?? '', target_message_id: message.reaction.message_id };
			case 'contacts': {
				const c = message.contacts?.[0];
				return { type: 'contact', name: c?.name?.formatted_name ?? '', phone: c?.phones?.[0]?.phone ?? '' };
			}
			case 'interactive': {
				// Reply to an interactive message (button / list) → universal postback.
				const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
				if (!reply) return null;
				return { type: 'postback', data: reply.id ?? '', title: reply.title };
			}
			case 'button': {
				// Reply to a template quick-reply button.
				return { type: 'postback', data: message.button?.payload ?? message.button?.text ?? '', title: message.button?.text };
			}
			default: {
				const mediaType = TYPE_TO_MEDIA[message.type];
				if (!mediaType) return null;
				const part = message[message.type];
				const isVoice = message.type === 'audio' && part.voice;
				const stored = await this.ingestMedia(part.id, ctx, part.mime_type, part.filename);
				return {
					type: 'media',
					media_type: isVoice ? 'voice' : mediaType,
					url: stored?.url,
					mime: part.mime_type,
					caption: part.caption,
					filename: part.filename
				};
			}
		}
	}

	private async ingestMedia(mediaId: string, ctx: AdapterContext, mime?: string, filename?: string) {
		try {
			const meta = await this.graphGet(mediaId);
			const res = await this.fetchImpl(meta.url, { headers: { authorization: `Bearer ${this.opts.token}` } });
			if (!res.ok) throw new Error(`media download failed: ${res.status}`);
			return await ctx.media.ingestStream(responseBytes(res), { mime: mime ?? meta.mime_type, filename });
		} catch (error) {
			ctx.logger.warn('WhatsApp Cloud media ingest failed', { error: String(error) });
			return null;
		}
	}

	private async uploadMedia(data: Uint8Array, mime: string, filename?: string): Promise<string> {
		const form = new FormData();
		form.set('messaging_product', 'whatsapp');
		form.set('type', mime);
		form.set('file', new Blob([data as BlobPart], { type: mime }), filename ?? 'file');
		const res = await this.fetchImpl(this.url(`${this.opts.phoneNumberId}/media`), {
			method: 'POST',
			headers: { authorization: `Bearer ${this.opts.token}` },
			body: form
		});
		const json = await this.unwrap(res, 'media upload');
		return json.id;
	}

	private url(path: string): string {
		return `${this.opts.graphBase}/${this.opts.apiVersion}/${path}`;
	}

	private graphPost(path: string, body: Record<string, unknown>): Promise<any> {
		return this.graph('POST', path, body);
	}

	private graphGet(path: string): Promise<any> {
		return this.graph('GET', path);
	}

	private async graph(method: string, path: string, body?: unknown): Promise<any> {
		const res = await this.fetchImpl(this.url(path), {
			method,
			headers: { authorization: `Bearer ${this.opts.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		return this.unwrap(res, path);
	}

	private async unwrap(res: Response, what: string): Promise<any> {
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			const err = new Error(`WhatsApp Cloud ${what} failed: ${res.status} ${JSON.stringify((json as any).error ?? json)}`);
			if (res.status === 429 || res.status >= 500) throw retryable(err);
			throw err;
		}
		return json;
	}

	private address(waId: string): Address {
		return { platform: 'whatsapp_cloud', account: this.account, conversation_id: waId, thread_id: null };
	}

	private participant(waId: string, name?: string): Participant {
		return { platform: 'whatsapp_cloud', account: this.account, user_id: waId, display_name: name ?? null, is_self: false };
	}
}

export type { WhatsAppAdapter } from '../adapter.js';
// Keep `Adapter` referenced for downstream type-only consumers of this module.
export type CloudAdapter = Adapter;
