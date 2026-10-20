/**
 * Slack adapter — Events API over HTTP is the primary path (`handleInbound` +
 * `verifyInbound` signing-secret check + `url_verification`); Socket Mode is the
 * optional persistent path via `start()`. Web API
 * calls go over raw `fetch` (a thin client). Rich Block Kit is sent via
 * passthrough `platform_meta.slack`.
 */

import { capabilities as buildCapabilities, emptySupport } from '../capability.js';
import { inbound, newId } from '../envelope.js';
import { renderSlackMrkdwn } from '../format.js';
import { retryable } from '../queue/index.js';
import { slackUrlVerification, verifySlack } from '../verify/index.js';
import { ConnectionTracker } from './util/connection.js';
import { loadPeer } from './util/peer.js';
import { responseBytes } from './util/stream.js';
import type { Adapter, AdapterContext, Connection, ConnectionHealth, EditTarget, InboundRequest, MessageTarget } from '../adapter.js';
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

function loadModule(specifier: string): Promise<any> {
	return loadPeer(specifier, 'Slack');
}

export interface SlackAdapterOptions {
	/** Bot token (`xoxb-…`). */
	botToken: string;
	/** Signing secret, for request verification. */
	signingSecret?: string;
	/**
	 * The workspace this adapter serves. Events, commands and presses from any other
	 * workspace are ignored — the guard for one Request URL shared by several
	 * adapters (see {@link slackTeamId}). Default: accept any.
	 */
	teamId?: string;
	/**
	 * Accept Events API requests even though no `signingSecret` is set — anyone who
	 * finds the URL can then inject events. For local experiments only. Default
	 * `false`: without a secret, `verifyInbound` rejects everything.
	 */
	allowUnverified?: boolean;
	/** App token (`xapp-…`), required only for Socket Mode. */
	appToken?: string;
	/** Use Socket Mode on `start()` instead of the Events API webhook. */
	socketMode?: boolean;
	/** Consumer-owned account id. Default `workspace`. */
	account?: string;
	/** Slack Web API base. Default `https://slack.com/api`. */
	apiBase?: string;
	/** Override fetch (tests). */
	fetchImpl?: typeof fetch;
	/** Override the @slack/socket-mode module (tests). */
	socketModeModule?: any;
}

/** `auth.test` — the identity behind the bot token. */
export interface SlackAuthInfo {
	ok: true;
	url: string;
	team: string;
	team_id: string;
	user: string;
	user_id: string;
	bot_id?: string;
	[extra: string]: unknown;
}

export class SlackAdapter implements Adapter {
	readonly platform = 'slack' as const;
	readonly account: string;
	private readonly botToken: string;
	private readonly signingSecret?: string;
	private readonly allowUnverified: boolean;
	private readonly teamId?: string;
	private readonly appToken?: string;
	private readonly socketMode: boolean;
	private readonly apiBase: string;
	private readonly fetchImpl: typeof fetch;
	private readonly socketModeModule?: any;
	private socket: any = null;
	private readonly conn: ConnectionTracker;

	constructor(options: SlackAdapterOptions) {
		if (!options.botToken) throw new Error('SlackAdapter requires a bot token.');
		this.botToken = options.botToken;
		this.signingSecret = options.signingSecret;
		this.allowUnverified = options.allowUnverified ?? false;
		this.teamId = options.teamId;
		this.appToken = options.appToken;
		this.socketMode = options.socketMode ?? false;
		this.account = options.account ?? 'workspace';
		this.apiBase = options.apiBase ?? 'https://slack.com/api';
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.socketModeModule = options.socketModeModule;
		this.conn = new ConnectionTracker(this.platform, this.account);
	}

	capabilities(): CapabilityDescriptor {
		return buildCapabilities('slack', {
			...emptySupport(),
			reactions: true,
			threads: true,
			buttons: true,
			edit: true,
			rich_layout: true,
			media: ['image', 'video', 'audio', 'document']
		});
	}

	verifyInbound(req: InboundRequest): boolean {
		if (!this.signingSecret) return this.allowUnverified;
		return verifySlack({
			body: req.body,
			timestamp: req.headers['x-slack-request-timestamp'],
			signature: req.headers['x-slack-signature'],
			signingSecret: this.signingSecret
		});
	}

	/** Echo value for the `url_verification` challenge, or `null`. */
	webhookChallenge(req: InboundRequest): string | null {
		try {
			const body = JSON.parse(typeof req.body === 'string' ? req.body : Buffer.from(req.body).toString('utf8'));
			return slackUrlVerification(body);
		} catch {
			return null;
		}
	}

	async handleInbound(req: InboundRequest, ctx: AdapterContext): Promise<UniversalMessage | null> {
		const raw = typeof req.body === 'string' ? req.body : Buffer.from(req.body).toString('utf8');
		if (this.teamId) {
			const team = slackTeamId(req);
			if (team && team !== this.teamId) return null;
		}
		// Interactivity (button / menu) arrives form-encoded as `payload=<json>`.
		if (raw.startsWith('payload=')) {
			const payload = new URLSearchParams(raw).get('payload');
			return payload ? this.handleInteractive(JSON.parse(payload)) : null;
		}
		// A slash command is form-encoded too, but flat (`command=/deploy&text=…`).
		if (!raw.startsWith('{')) return this.handleCommand(Object.fromEntries(new URLSearchParams(raw)));
		const body = JSON.parse(raw);
		if (body.type === 'url_verification') return null;
		if (body.type !== 'event_callback') return null;
		return this.handleEvent(body.event, ctx);
	}

	async start(ctx: AdapterContext): Promise<Connection> {
		const emitConn = (state: 'connecting' | 'open' | 'closed'): void => this.conn.set(ctx, state);

		if (!this.socketMode) {
			emitConn('open');
			return { platform: this.platform, account: this.account, status: () => 'open', stop: async () => emitConn('closed') };
		}
		if (!this.appToken) throw new Error('Slack Socket Mode requires an app token (xapp-…).');
		emitConn('connecting');
		const mod = this.socketModeModule ?? (await loadModule('@slack/socket-mode'));
		const { SocketModeClient } = mod;
		const socket = new SocketModeClient({ appToken: this.appToken });
		this.socket = socket;

		// Surface the socket's own lifecycle so a drop/reconnect is observable (the SDK
		// self-heals; we only report). Without this a consumer sees `open` once and never
		// learns the socket bounced.
		socket.on?.('disconnected', () => emitConn('closed'));
		socket.on?.('reconnecting', () => this.conn.reconnecting(ctx));
		socket.on?.('connected', () => emitConn('open'));

		socket.on('slack_event', async ({ ack, body }: any) => {
			await ack?.();
			try {
				if (body?.type === 'event_callback') {
					const msg = await this.handleEvent(body.event, ctx);
					if (msg) {
						if (msg.content.type === 'reaction') ctx.events.reaction(msg);
						else ctx.events.message(msg);
					}
				} else if (body?.command) {
					const msg = this.handleCommand(body);
					if (msg) ctx.events.message(msg);
				} else if (body?.type === 'block_actions' || body?.type === 'interactive') {
					const msg = this.handleInteractive(body);
					if (msg) ctx.events.message(msg);
				}
			} catch (error) {
				ctx.events.error(error as Error);
			}
		});

		await socket.start();
		ctx.logger.info('Slack Socket Mode connected');
		emitConn('open');
		return {
			platform: this.platform,
			account: this.account,
			status: () => this.conn.state,
			stop: async () => {
				await socket.disconnect();
				emitConn('closed');
			}
		};
	}

	/** A connection-health snapshot. Socket Mode self-heals, so `terminal` is never set. */
	health(): ConnectionHealth {
		return this.conn.health();
	}

	// --- Web API helpers ------------------------------------------------------
	//
	// Not part of the universal `Adapter` contract: verify a token, learn the bot's
	// own user id (to filter its mentions), and reach any Web API method.

	/** Who the bot token belongs to. Doubles as a token check — an invalid token throws. */
	async authTest(): Promise<SlackAuthInfo> {
		return this.web('auth.test', {});
	}

	/** Call any Web API method directly; resolves to the full response (`ok: true`). */
	async api<T = Record<string, any>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		return this.web(method, params, true);
	}

	async send(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult> {
		const channel = msg.to.conversation_id;
		const thread = msg.to.thread_id ?? msg.reply_to ?? undefined;

		const pass = msg.platform_meta?.slack as Record<string, unknown> | undefined;
		if (pass) {
			const res = await this.web('chat.postMessage', { channel, thread_ts: thread, ...pass });
			return this.result(res);
		}

		const content = msg.content;
		switch (content.type) {
			case 'text': {
				const text = content.rich ? renderSlackMrkdwn(content.rich) : content.text;
				const res = await this.web('chat.postMessage', { channel, text, thread_ts: thread });
				return this.result(res);
			}
			case 'reaction': {
				await this.web('reactions.add', {
					channel,
					name: content.emoji.replace(/:/g, ''),
					timestamp: content.target_message_id
				});
				return { id: newId(), platform_message_id: content.target_message_id, status: 'sent', timestamp: new Date().toISOString() };
			}
			case 'media':
				return this.sendMedia(channel, content, thread, ctx);
			case 'location':
			case 'contact':
			case 'passthrough':
				throw new Error(`Slack does not support content type "${content.type}" (use platform_meta.slack).`);
		}
	}

	async edit(target: EditTarget): Promise<SendResult> {
		if (target.content.type !== 'text') throw new Error('Slack edit supports text messages only.');
		const text = target.content.rich ? renderSlackMrkdwn(target.content.rich) : target.content.text;
		const res = await this.web('chat.update', { channel: target.address.conversation_id, ts: target.platform_message_id, text });
		return this.result(res);
	}

	async deleteMessage(target: MessageTarget): Promise<void> {
		await this.web('chat.delete', { channel: target.address.conversation_id, ts: target.platform_message_id });
	}

	async markRead(target: MessageTarget): Promise<void> {
		await this.web('conversations.mark', { channel: target.address.conversation_id, ts: target.platform_message_id });
	}

	async stop(): Promise<void> {
		try {
			await this.socket?.disconnect?.();
		} catch {
			// ignore
		}
	}

	// --- internals ------------------------------------------------------------

	private result(res: any): SendResult {
		return { id: newId(), platform_message_id: res?.ts ?? null, status: 'sent', timestamp: new Date().toISOString(), raw: res };
	}

	/** Normalise a Slack interactivity payload (block_actions) to a postback. */
	private handleInteractive(payload: any): UniversalMessage | null {
		if (payload?.type !== 'block_actions') return null;
		const action = payload.actions?.[0];
		if (!action) return null;
		const data =
			action.value ??
			action.selected_option?.value ??
			(Array.isArray(action.selected_options) ? action.selected_options.map((o: any) => o.value).join(',') : undefined) ??
			action.action_id;
		return inbound({
			platformMessageId: payload.message?.ts ?? payload.trigger_id ?? '',
			address: this.address(payload.channel?.id ?? '', payload.message?.thread_ts),
			from: this.participant(payload.user?.id ?? ''),
			content: { type: 'postback', data: String(data ?? ''), title: action.text?.text ?? action.action_id },
			raw: payload
		});
	}

	/**
	 * Normalise a slash command (form fields over HTTP, an object in Socket Mode)
	 * to the text the user typed. `response_url` stays in `raw` for delayed replies.
	 */
	private handleCommand(form: Record<string, string>): UniversalMessage | null {
		if (!form.command) return null;
		return inbound({
			platformMessageId: form.trigger_id,
			// Slack numbers nothing here; each invocation is its own event.
			eventId: `command:${form.trigger_id}`,
			address: this.address(form.channel_id ?? '', undefined),
			from: this.participant(form.user_id ?? ''),
			content: { type: 'text', text: [form.command, form.text].filter(Boolean).join(' ') },
			raw: form
		});
	}

	private async handleEvent(event: any, ctx: AdapterContext): Promise<UniversalMessage | null> {
		if (!event) return null;
		// An edit arrives as `message_changed` wrapping the new message; it re-uses the
		// original `ts`, so it carries its own event id to survive dedup. Link unfurls
		// and attachment updates fire the same event with the text untouched (and no
		// `edited` stamp) — those are not edits.
		if (event.type === 'message' && event.subtype === 'message_changed' && event.message?.text && !event.message.bot_id) {
			const m = event.message;
			if (!m.edited || m.text === event.previous_message?.text) return null;
			return inbound({
				platformMessageId: m.ts,
				eventId: `edit:${m.ts}:${m.edited?.ts ?? event.event_ts}`,
				edited: true,
				address: this.address(event.channel, m.thread_ts),
				from: this.participant(m.user),
				timestamp: m.ts ? new Date(Number(m.ts) * 1000) : new Date(),
				content: { type: 'text', text: m.text },
				replyTo: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null,
				raw: event
			});
		}
		if (event.type === 'reaction_added') {
			return inbound({
				platformMessageId: event.item?.ts,
				address: this.address(event.item?.channel, undefined),
				from: this.participant(event.user),
				content: { type: 'reaction', emoji: event.reaction, target_message_id: event.item?.ts ?? '' },
				raw: event
			});
		}
		if (event.type !== 'message') return null;
		if (event.bot_id || (event.subtype && event.subtype !== 'file_share')) return null;

		const content = await this.normalizeContent(event, ctx);
		if (!content) return null;
		return inbound({
			platformMessageId: event.ts,
			address: this.address(event.channel, event.thread_ts),
			from: this.participant(event.user),
			timestamp: event.ts ? new Date(Number(event.ts) * 1000) : new Date(),
			content,
			replyTo: event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : null,
			raw: event
		});
	}

	private async normalizeContent(event: any, ctx: AdapterContext): Promise<MessageContent | null> {
		const file = event.files?.[0];
		if (file) {
			const stored = await this.ingest(file, ctx);
			return {
				type: 'media',
				media_type: mediaTypeFor(file.mimetype),
				url: stored?.url,
				mime: file.mimetype,
				caption: event.text || undefined,
				filename: file.name,
				size_bytes: file.size
			};
		}
		if (event.text) return { type: 'text', text: event.text };
		return null;
	}

	private async ingest(file: any, ctx: AdapterContext) {
		try {
			const res = await this.fetchImpl(file.url_private_download ?? file.url_private, {
				headers: { authorization: `Bearer ${this.botToken}` }
			});
			if (!res.ok) throw new Error(`download failed: ${res.status}`);
			return await ctx.media.ingestStream(responseBytes(res), { mime: file.mimetype, filename: file.name });
		} catch (error) {
			ctx.logger.warn('Slack media ingest failed', { error: String(error) });
			return null;
		}
	}

	private async sendMedia(
		channel: string,
		content: Extract<OutboundMessage['content'], { type: 'media' }>,
		thread: string | undefined,
		ctx: AdapterContext
	): Promise<SendResult> {
		const blob = await ctx.media.resolveOutbound(content);
		ctx.media.validate(this.capabilities(), content, blob.data.byteLength);
		const filename = content.filename ?? `file-${content.media_type}`;

		// Current Slack upload flow: getUploadURLExternal → PUT bytes → complete.
		const upload = await this.web('files.getUploadURLExternal', {
			filename,
			length: blob.data.byteLength
		});
		const putRes = await this.fetchImpl(upload.upload_url, { method: 'POST', body: blobToForm(blob.data, filename) });
		if (!putRes.ok) throw retryable(new Error(`Slack upload failed: ${putRes.status}`));
		const complete = await this.web('files.completeUploadExternal', {
			files: [{ id: upload.file_id, title: filename }],
			channel_id: channel,
			initial_comment: content.caption_rich ? renderSlackMrkdwn(content.caption_rich) : content.caption,
			thread_ts: thread
		});
		return { id: newId(), platform_message_id: upload.file_id, status: 'sent', timestamp: new Date().toISOString(), raw: complete };
	}

	/**
	 * One Web API call. JSON is fine for the write methods ChatKit uses itself, but
	 * Slack ignores a JSON body on many read methods (`conversations.list`, …), so
	 * the public `api()` sends form fields — accepted by every method.
	 */
	private async web(method: string, body: Record<string, unknown>, form = false): Promise<any> {
		const res = await this.fetchImpl(`${this.apiBase}/${method}`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.botToken}`,
				'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8'
			},
			body: form ? formEncode(body) : JSON.stringify(body)
		});
		let json: any;
		try {
			json = await res.json();
		} catch {
			throw retryable(new Error(`Slack ${method} failed: ${res.status}`));
		}
		if (!json.ok) {
			const err = new Error(`Slack ${method} failed: ${json.error}`);
			if (json.error === 'ratelimited' || res.status === 429 || res.status >= 500) throw retryable(err);
			throw err;
		}
		return json;
	}

	private address(channel: string, threadTs?: string): Address {
		return { platform: 'slack', account: this.account, conversation_id: channel, thread_id: threadTs ?? null };
	}

	private participant(userId: string): Participant {
		return { platform: 'slack', account: this.account, user_id: userId ?? '', display_name: null, is_self: false };
	}
}

/** Form fields for a Web API call: scalars as-is, arrays/objects (blocks, …) as JSON. */
function formEncode(params: Record<string, unknown>): string {
	const out = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value == null) continue;
		out.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
	}
	return out.toString();
}

/**
 * The workspace a Slack request is for: `team_id` of an Events API payload or a
 * slash command, `team.id` of an interactivity payload. `null` when it has none
 * (e.g. the `url_verification` handshake). Use it to route one shared Request URL
 * to the right account.
 */
export function slackTeamId(req: InboundRequest): string | null {
	try {
		const raw = typeof req.body === 'string' ? req.body : Buffer.from(req.body).toString('utf8');
		if (raw.startsWith('{')) return JSON.parse(raw).team_id ?? null;
		const form = new URLSearchParams(raw);
		const payload = form.get('payload');
		return payload ? (JSON.parse(payload).team?.id ?? null) : form.get('team_id');
	} catch {
		return null;
	}
}

function blobToForm(data: Uint8Array, filename: string): FormData {
	const form = new FormData();
	form.set('file', new Blob([data as BlobPart]), filename);
	return form;
}

function mediaTypeFor(mime: string | undefined): MediaType {
	const m = mime ?? '';
	if (m.startsWith('image/')) return 'image';
	if (m.startsWith('video/')) return 'video';
	if (m.startsWith('audio/')) return 'audio';
	return 'document';
}
