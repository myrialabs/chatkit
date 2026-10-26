/**
 * Telegram adapter — raw Bot API over `fetch`, no SDK (Telegram first, zero
 * extra deps). Supports both connection styles: webhook
 * (`handleInbound` + `verifyInbound` secret token) and long polling (`start`).
 * Media is proxied both ways through the injected `MediaProxy`.
 */

import { capabilities as buildCapabilities, emptySupport } from '../capability.js';
import { inbound, newId } from '../envelope.js';
import { renderTelegramEntities, telegramEntitiesToRuns } from '../format.js';
import { retryable } from '../queue/index.js';
import { verifyTelegram } from '../verify/index.js';
import { ConnectionTracker } from './util/connection.js';
import { responseBytes } from './util/stream.js';
import type {
	Adapter,
	AdapterContext,
	Connection,
	ConnectionHealth,
	EditTarget,
	InboundRequest,
	MessageTarget
} from '../adapter.js';
import type {
	Address,
	CapabilityDescriptor,
	MediaType,
	MessageContent,
	OutboundMessage,
	Participant,
	SendResult
} from '../schema.js';

export interface TelegramAdapterOptions {
	/** Bot token from BotFather. */
	token: string;
	/** Consumer-owned account id for addressing. Default `bot`. */
	account?: string;
	/** Secret token set on `setWebhook`; verified on each inbound POST. */
	secretToken?: string;
	/**
	 * Accept webhook requests even though no `secretToken` is set — anyone who finds
	 * the URL can then inject messages. For local experiments only. Default `false`:
	 * without a secret, `verifyInbound` rejects everything.
	 */
	allowUnverified?: boolean;
	/** Use long polling on `start()` instead of webhooks. Default `false`. */
	polling?: boolean;
	/**
	 * Update kinds to receive while polling, and the default for
	 * {@link TelegramAdapter.setWebhook}. Telegram omits `message_reaction` unless
	 * it is asked for by name, so the default lists it. Default
	 * {@link TELEGRAM_DEFAULT_ALLOWED_UPDATES}.
	 */
	allowedUpdates?: string[];
	/** Override the API base (for testing). Default `https://api.telegram.org`. */
	apiBase?: string;
	/** Override fetch (for testing). */
	fetchImpl?: typeof fetch;
}

/** The update kinds this adapter normalises — everything it can turn into a message. */
export const TELEGRAM_DEFAULT_ALLOWED_UPDATES = [
	'message',
	'edited_message',
	'channel_post',
	'edited_channel_post',
	'callback_query',
	'message_reaction'
];

/** Long-poll window in seconds; also bounds how long a stop can take without an abort. */
const POLL_TIMEOUT_S = 30;

/** `getMe` — the bot's own identity. `username` is what `t.me/<username>` links need. */
export interface TelegramBotInfo {
	id: number;
	username: string;
	first_name: string;
	can_join_groups?: boolean;
	can_read_all_group_messages?: boolean;
}

/** `getWebhookInfo` — what Telegram believes about the registered webhook. */
export interface TelegramWebhookInfo {
	url: string;
	has_custom_certificate: boolean;
	pending_update_count: number;
	last_error_date?: number;
	last_error_message?: string;
	max_connections?: number;
	allowed_updates?: string[];
}

/** One entry of the bot's command menu (`setMyCommands`). */
export interface TelegramBotCommand {
	/** 1-32 characters: lowercase letters, digits and underscores. */
	command: string;
	/** 1-256 characters, shown next to the command in the menu. */
	description: string;
}

/**
 * Who a command menu is for (`BotCommandScope`). Telegram shows the most
 * specific menu that matches: a chat's own, then its chat type's, then the
 * default. Omitting the scope sets the default menu.
 */
export type TelegramCommandScope =
	| { type: 'default' }
	| { type: 'all_private_chats' }
	| { type: 'all_group_chats' }
	| { type: 'all_chat_administrators' }
	| { type: 'chat'; chat_id: number | string }
	| { type: 'chat_administrators'; chat_id: number | string }
	| { type: 'chat_member'; chat_id: number | string; user_id: number };

export interface TelegramCommandMenuOptions {
	scope?: TelegramCommandScope;
	/** Two-letter ISO 639-1 code; the menu then shows only to users with that language. */
	languageCode?: string;
}

export interface TelegramSetWebhookOptions {
	url: string;
	/** Echoed back in `X-Telegram-Bot-Api-Secret-Token`. Default: the adapter's `secretToken`. */
	secretToken?: string;
	/** Default: the adapter's `allowedUpdates`. */
	allowedUpdates?: string[];
	dropPendingUpdates?: boolean;
	maxConnections?: number;
}

const PHOTO_MEDIA: Record<string, MediaType> = {
	photo: 'image',
	video: 'video',
	audio: 'audio',
	voice: 'voice',
	document: 'document',
	sticker: 'sticker'
};

export class TelegramAdapter implements Adapter {
	readonly platform = 'telegram' as const;
	readonly account: string;
	private readonly token: string;
	private readonly secretToken?: string;
	private readonly allowUnverified: boolean;
	private readonly polling: boolean;
	private readonly allowedUpdates: string[];
	private readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;
	private pollAbort = false;
	private pollController: AbortController | null = null;
	private pollLoop: Promise<void> | null = null;
	private readonly conn: ConnectionTracker;

	constructor(options: TelegramAdapterOptions) {
		if (!options.token) throw new Error('TelegramAdapter requires a bot token.');
		this.token = options.token;
		this.account = options.account ?? 'bot';
		this.secretToken = options.secretToken;
		this.allowUnverified = options.allowUnverified ?? false;
		this.polling = options.polling ?? false;
		this.allowedUpdates = options.allowedUpdates ?? TELEGRAM_DEFAULT_ALLOWED_UPDATES;
		this.apiBase = options.apiBase ?? 'https://api.telegram.org';
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.conn = new ConnectionTracker(this.platform, this.account);
	}

	capabilities(): CapabilityDescriptor {
		return buildCapabilities('telegram', {
			...emptySupport(),
			reactions: true,
			buttons: true,
			typing: true,
			edit: true,
			location: true,
			contact: true,
			media: ['image', 'video', 'audio', 'voice', 'document', 'sticker']
		});
	}

	verifyInbound(req: InboundRequest): boolean {
		if (!this.secretToken) return this.allowUnverified;
		const header = req.headers['x-telegram-bot-api-secret-token'];
		return verifyTelegram(header, this.secretToken);
	}

	async handleInbound(req: InboundRequest, ctx: AdapterContext): Promise<ReturnType<typeof inbound> | null> {
		const update = JSON.parse(typeof req.body === 'string' ? req.body : Buffer.from(req.body).toString('utf8'));
		return this.normalizeUpdate(update, ctx);
	}

	async start(ctx: AdapterContext): Promise<Connection> {
		const emitConn = (state: 'connecting' | 'open' | 'closed', detail?: string): void => this.conn.set(ctx, state, detail);

		if (!this.polling) {
			// Webhook mode: nothing to hold open. Inbound arrives via receive().
			emitConn('open');
			return { platform: this.platform, account: this.account, status: () => this.conn.state, stop: async () => emitConn('closed') };
		}
		this.pollAbort = false;
		emitConn('connecting');
		// getUpdates answers 409 for as long as a webhook is set, so polling must
		// clear it first — the webhook is not ours to keep while we poll. Pending
		// updates are kept: they are exactly what the loop is about to read.
		await this.deleteWebhook();
		// The offset is persisted so a restart neither replays the last 24h of
		// updates (offset 0 re-reads everything unconfirmed) nor loses any.
		const offsetKey = `${this.account}`;
		const stored = await ctx.store.kvGet('telegram:offset', offsetKey);
		let offset = stored ? Number(stored) || 0 : 0;
		const controller = new AbortController();
		this.pollController = controller;
		const loop = async () => {
			while (!this.pollAbort) {
				try {
					const updates = await this.call(
						'getUpdates',
						{ offset, timeout: POLL_TIMEOUT_S, allowed_updates: this.allowedUpdates },
						controller.signal
					);
					// Announce open on the first successful poll, and again whenever we recover
					// from an error state — so a long-poll outage is reflected in health().
					if (this.conn.state !== 'open') emitConn('open');
					for (const update of updates as any[]) {
						offset = update.update_id + 1;
						const msg = await this.normalizeUpdate(update, ctx);
						if (msg) ctx.events.message(msg);
					}
					if ((updates as any[]).length) await ctx.store.kvSet('telegram:offset', offsetKey, String(offset));
				} catch (error) {
					if (this.pollAbort) break; // the abort from stop() — not an outage
					// A poll failure: count it as a reconnect and reflect the drop, but only
					// transition (and log) once per outage, not on every retry.
					if (this.conn.state === 'open') {
						this.conn.reconnecting(ctx);
					}
					ctx.events.error(error as Error);
					await abortableSleep(1000, controller.signal);
				}
			}
		};
		this.pollLoop = loop();
		return {
			platform: this.platform,
			account: this.account,
			status: () => this.conn.state,
			stop: async () => {
				this.pollAbort = true;
				// Abort the in-flight long-poll and wait for the loop to unwind: a
				// getUpdates left running for up to 30s makes an immediate re-add (a
				// token change, a restart) collide with it as 409 Conflict.
				this.pollController?.abort();
				await this.pollLoop?.catch(() => {});
				this.pollLoop = null;
				emitConn('closed');
			}
		};
	}

	// --- Bot API helpers ------------------------------------------------------
	//
	// Not part of the universal `Adapter` contract: setting up a bot is
	// Telegram-specific, and these are what a consumer needs to do it without
	// hand-rolling Bot API calls (verify a token, build a `t.me` link, point the
	// bot at a webhook, and tell why a webhook is not receiving).

	/** The bot's identity. Doubles as a token check — an invalid token throws. */
	async getMe(): Promise<TelegramBotInfo> {
		return this.call('getMe', {});
	}

	/** Point the bot at a webhook URL. Telegram requires HTTPS on 443/80/88/8443. */
	async setWebhook(options: TelegramSetWebhookOptions): Promise<void> {
		const secret = options.secretToken ?? this.secretToken;
		await this.call('setWebhook', {
			url: options.url,
			...(secret ? { secret_token: secret } : {}),
			allowed_updates: options.allowedUpdates ?? this.allowedUpdates,
			...(options.dropPendingUpdates != null ? { drop_pending_updates: options.dropPendingUpdates } : {}),
			...(options.maxConnections != null ? { max_connections: options.maxConnections } : {})
		});
	}

	/** Remove the webhook (required before polling). Pending updates are kept unless asked. */
	async deleteWebhook(options: { dropPendingUpdates?: boolean } = {}): Promise<void> {
		await this.call('deleteWebhook', { drop_pending_updates: options.dropPendingUpdates ?? false });
	}

	/**
	 * Publish the command menu users see when they type `/`. Replaces the whole
	 * list for `scope` (the default menu when omitted); pass `[]` to clear it.
	 */
	async setMyCommands(commands: TelegramBotCommand[], options: TelegramCommandMenuOptions = {}): Promise<void> {
		await this.call('setMyCommands', { commands, ...menuParams(options) });
	}

	/**
	 * Remove the menu set for `scope`, so the next less specific one shows
	 * again — a chat's own menu falls back to the default.
	 */
	async deleteMyCommands(options: TelegramCommandMenuOptions = {}): Promise<void> {
		await this.call('deleteMyCommands', menuParams(options));
	}

	/** Telegram's view of the webhook — `last_error_message` is why deliveries are failing. */
	async getWebhookInfo(): Promise<TelegramWebhookInfo> {
		return this.call('getWebhookInfo', {});
	}

	/** Call any Bot API method directly; resolves to its `result`. */
	async api<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		return this.call(method, params);
	}

	/** A connection-health snapshot. The long-poll loop self-heals, so `terminal` is never set. */
	health(): ConnectionHealth {
		return this.conn.health();
	}

	async send(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult> {
		const chatId = msg.to.conversation_id;
		const replyParams = msg.reply_to ? { reply_parameters: { message_id: Number(msg.reply_to) } } : {};

		// Passthrough wins for Telegram: { method, params }.
		const pass = msg.platform_meta?.telegram as { method: string; params: Record<string, unknown> } | undefined;
		if (pass) {
			const result = await this.call(pass.method, { chat_id: chatId, ...replyParams, ...pass.params });
			return this.result(result);
		}

		const content = msg.content;
		switch (content.type) {
			case 'text': {
				const entities = content.rich ? renderTelegramEntities(content.rich).entities : undefined;
				const result = await this.call('sendMessage', {
					chat_id: chatId,
					text: content.text,
					...(entities && entities.length ? { entities } : {}),
					...replyParams
				});
				return this.result(result);
			}
			case 'location': {
				const result = await this.call('sendLocation', {
					chat_id: chatId,
					latitude: content.lat,
					longitude: content.lng,
					...replyParams
				});
				return this.result(result);
			}
			case 'contact': {
				const result = await this.call('sendContact', {
					chat_id: chatId,
					phone_number: content.phone,
					first_name: content.name,
					...replyParams
				});
				return this.result(result);
			}
			case 'reaction': {
				const result = await this.call('setMessageReaction', {
					chat_id: chatId,
					message_id: Number(content.target_message_id),
					reaction: [{ type: 'emoji', emoji: content.emoji }]
				});
				return this.result(result);
			}
			case 'media':
				return this.sendMedia(chatId, content, replyParams, ctx);
			case 'passthrough':
				throw new Error('Passthrough send requires platform_meta.telegram = { method, params }.');
		}
	}

	async setTyping(address: Address, on: boolean): Promise<void> {
		if (!on) return;
		await this.call('sendChatAction', { chat_id: address.conversation_id, action: 'typing' });
	}

	async edit(target: EditTarget): Promise<SendResult> {
		if (target.content.type !== 'text') throw new Error('Telegram edit supports text messages only.');
		const result = await this.call('editMessageText', {
			chat_id: target.address.conversation_id,
			message_id: Number(target.platform_message_id),
			text: target.content.text
		});
		return this.result(result === true ? { message_id: Number(target.platform_message_id) } : result);
	}

	async deleteMessage(target: MessageTarget): Promise<void> {
		await this.call('deleteMessage', {
			chat_id: target.address.conversation_id,
			message_id: Number(target.platform_message_id)
		});
	}

	// --- internals ------------------------------------------------------------

	private result(result: any): SendResult {
		return {
			id: newId(),
			platform_message_id: result?.message_id != null ? String(result.message_id) : null,
			status: 'sent',
			timestamp: new Date().toISOString(),
			raw: result
		};
	}

	private async sendMedia(
		chatId: string,
		content: Extract<OutboundMessage['content'], { type: 'media' }>,
		replyParams: Record<string, unknown>,
		ctx: AdapterContext
	): Promise<SendResult> {
		const method = mediaSendMethod(content.media_type);
		const field = mediaField(content.media_type);
		const captionEntities = content.caption_rich ? renderTelegramEntities(content.caption_rich).entities : undefined;
		const captionParams = captionEntities && captionEntities.length ? { caption_entities: captionEntities } : {};

		// External URL (not one of our handles) → let Telegram fetch it directly.
		if (content.url && !ctx.media.store.idFromUrl(content.url)) {
			const result = await this.call(method, {
				chat_id: chatId,
				[field]: content.url,
				caption: content.caption,
				...captionParams,
				...replyParams
			});
			return this.result(result);
		}

		const blob = await ctx.media.resolveOutbound(content);
		ctx.media.validate(this.capabilities(), content, blob.data.byteLength);
		const form = new FormData();
		form.set('chat_id', chatId);
		if (content.caption) form.set('caption', content.caption);
		if (captionEntities && captionEntities.length) form.set('caption_entities', JSON.stringify(captionEntities));
		if (msgThreadFrom(replyParams)) form.set('reply_parameters', JSON.stringify((replyParams as any).reply_parameters));
		form.set(
			field,
			new Blob([blob.data as BlobPart], { type: blob.mime ?? 'application/octet-stream' }),
			content.filename ?? field
		);
		const result = await this.callForm(method, form);
		return this.result(result);
	}

	private async normalizeUpdate(update: any, ctx: AdapterContext): Promise<ReturnType<typeof inbound> | null> {
		// Interactive callback (inline-keyboard button press) → universal postback.
		if (update.callback_query) {
			const cq = update.callback_query;
			// Stop the client-side spinner; failure here is non-fatal.
			void this.call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
			const chatId = cq.message?.chat?.id;
			if (chatId == null) return null;
			const data = cq.data ?? '';
			return inbound({
				platformMessageId: cq.message ? String(cq.message.message_id) : cq.id,
				// Every press is its own event: the message id is shared by every
				// button on it and by every later press of the same one.
				eventId: `callback:${cq.id}`,
				address: this.address(chatId, cq.message?.message_thread_id),
				from: cq.from ? this.participant(cq.from) : undefined,
				content: { type: 'postback', data, title: buttonLabel(cq.message, data) ?? data },
				raw: update
			});
		}

		// Reaction updates.
		if (update.message_reaction) {
			const mr = update.message_reaction;
			const emoji = mr.new_reaction?.[0]?.emoji ?? '';
			if (!emoji) return null;
			return inbound({
				platformMessageId: String(mr.message_id),
				eventId: update.update_id != null ? `update:${update.update_id}` : null,
				address: this.address(mr.chat.id, mr.message_thread_id),
				from: this.participant(mr.user),
				timestamp: new Date((mr.date ?? Math.floor(Date.now() / 1000)) * 1000),
				content: { type: 'reaction', emoji, target_message_id: String(mr.message_id) },
				raw: update
			});
		}

		const m = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
		if (!m) return null;
		// An edit re-sends the original message_id; without an event id of its own
		// it would dedup against the message it edits and never be delivered.
		const isEdit = Boolean(update.edited_message ?? update.edited_channel_post);

		const content = await this.normalizeContent(m, ctx);
		if (!content) return null;

		return inbound({
			platformMessageId: String(m.message_id),
			eventId: isEdit ? `edit:${m.message_id}:${m.edit_date ?? update.update_id}` : null,
			edited: isEdit,
			address: this.address(m.chat.id, m.message_thread_id),
			from: m.from ? this.participant(m.from) : undefined,
			timestamp: new Date((m.date ?? Math.floor(Date.now() / 1000)) * 1000),
			content,
			replyTo: m.reply_to_message ? String(m.reply_to_message.message_id) : null,
			raw: update
		});
	}

	private async normalizeContent(m: any, ctx: AdapterContext): Promise<MessageContent | null> {
		if (m.text) {
			const rich = telegramEntitiesToRuns(m.text, m.entities);
			return { type: 'text', text: m.text, ...(rich ? { rich } : {}) };
		}
		if (m.location) return { type: 'location', lat: m.location.latitude, lng: m.location.longitude };
		if (m.contact) return { type: 'contact', name: m.contact.first_name ?? '', phone: m.contact.phone_number ?? '' };

		for (const [key, mediaType] of Object.entries(PHOTO_MEDIA)) {
			const part = m[key];
			if (!part) continue;
			// Photos arrive as an array of sizes — take the largest.
			const fileObj = Array.isArray(part) ? part[part.length - 1] : part;
			const stored = await this.ingestFile(fileObj.file_id, ctx, fileObj.mime_type, fileObj.file_name);
			const captionRich = m.caption ? telegramEntitiesToRuns(m.caption, m.caption_entities) : undefined;
			return {
				type: 'media',
				media_type: mediaType,
				url: stored?.url,
				mime: fileObj.mime_type,
				caption: m.caption,
				...(captionRich ? { caption_rich: captionRich } : {}),
				filename: fileObj.file_name,
				size_bytes: fileObj.file_size
			};
		}
		// Captioned message with an unsupported attachment → at least keep the caption.
		if (m.caption) return { type: 'text', text: m.caption };
		return null;
	}

	private async ingestFile(fileId: string, ctx: AdapterContext, mime?: string, filename?: string) {
		try {
			const file = await this.call('getFile', { file_id: fileId });
			const url = `${this.apiBase}/file/bot${this.token}/${file.file_path}`;
			const res = await this.fetchImpl(url);
			if (!res.ok) throw new Error(`download failed: ${res.status}`);
			return await ctx.media.ingestStream(responseBytes(res), { mime, filename });
		} catch (error) {
			ctx.logger.warn('Telegram media ingest failed', { error: String(error) });
			return null;
		}
	}

	private address(chatId: number | string, threadId?: number): Address {
		return {
			platform: 'telegram',
			account: this.account,
			conversation_id: String(chatId),
			thread_id: threadId != null ? String(threadId) : null
		};
	}

	private participant(user: any): Participant {
		return {
			platform: 'telegram',
			account: this.account,
			user_id: String(user.id),
			display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || null,
			is_self: Boolean(user.is_bot)
		};
	}

	private async call(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
		const res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			...(signal ? { signal } : {})
		});
		return this.unwrap(res, method);
	}

	private async callForm(method: string, form: FormData): Promise<any> {
		const res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, { method: 'POST', body: form });
		return this.unwrap(res, method);
	}

	private async unwrap(res: Response, method: string): Promise<any> {
		let json: any;
		try {
			json = await res.json();
		} catch {
			if (res.status >= 500 || res.status === 429) throw retryable(new Error(`${method} failed: ${res.status}`));
			throw new Error(`${method} failed: ${res.status} (non-JSON response)`);
		}
		if (!json.ok) {
			const err = new Error(`Telegram ${method} failed: ${json.error_code} ${json.description}`);
			if (json.error_code === 429 || json.error_code >= 500) throw retryable(err);
			throw err;
		}
		return json.result;
	}
}

function menuParams(options: TelegramCommandMenuOptions): Record<string, unknown> {
	return {
		...(options.scope ? { scope: options.scope } : {}),
		...(options.languageCode ? { language_code: options.languageCode } : {})
	};
}

function mediaSendMethod(type: MediaType): string {
	switch (type) {
		case 'image':
			return 'sendPhoto';
		case 'video':
			return 'sendVideo';
		case 'audio':
			return 'sendAudio';
		case 'voice':
			return 'sendVoice';
		case 'sticker':
			return 'sendSticker';
		case 'document':
			return 'sendDocument';
	}
}

function mediaField(type: MediaType): string {
	switch (type) {
		case 'image':
			return 'photo';
		case 'video':
			return 'video';
		case 'audio':
			return 'audio';
		case 'voice':
			return 'voice';
		case 'sticker':
			return 'sticker';
		case 'document':
			return 'document';
	}
}

function msgThreadFrom(replyParams: Record<string, unknown>): boolean {
	return 'reply_parameters' in replyParams;
}

/** The label of the inline button that carried `data`, read from the message it sits on. */
function buttonLabel(message: any, data: string): string | undefined {
	const rows: any[][] | undefined = message?.reply_markup?.inline_keyboard;
	if (!Array.isArray(rows)) return undefined;
	for (const row of rows) {
		for (const button of row ?? []) {
			if (button?.callback_data === data && typeof button.text === 'string') return button.text;
		}
	}
	return undefined;
}

/** Resolve after `ms`, or as soon as `signal` aborts — so a stop never waits out a backoff. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		signal.addEventListener('abort', done, { once: true });
		function done(): void {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		}
	});
}
