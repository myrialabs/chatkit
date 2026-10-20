/**
 * Discord adapter — `discord.js` Gateway WebSocket, a *persistent* connection
 * (the second persistent class after Baileys).
 * Requires the privileged **Message Content Intent** to read message text.
 * discord.js manages RESUME-vs-IDENTIFY on reconnect internally. Rich content
 * (embeds/components) is sent via passthrough `platform_meta.discord`.
 */

import { capabilities as buildCapabilities, emptySupport } from '../capability.js';
import { inbound, newId } from '../envelope.js';
import { renderDiscord } from '../format.js';
import { retryable } from '../queue/index.js';
import { verifyDiscord, withinReplayWindow } from '../verify/index.js';
import { ConnectionTracker } from './util/connection.js';
import { loadPeer } from './util/peer.js';
import { responseBytes } from './util/stream.js';
import type {
	Adapter,
	AdapterContext,
	Connection,
	ConnectionHealth,
	EditTarget,
	InboundRequest,
	MessageTarget,
	WebhookReply
} from '../adapter.js';
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
	return loadPeer(specifier, 'Discord');
}

export interface DiscordAdapterOptions {
	/** Bot token. */
	token: string;
	/** Consumer-owned account id. Default `bot`. */
	account?: string;
	/**
	 * Application public key (hex, Developer Portal), to verify HTTP Interactions.
	 * Required for webhook mode; without it `verifyInbound` rejects everything.
	 */
	publicKey?: string;
	/** Application id, for command registration. Looked up from the token when omitted. */
	applicationId?: string;
	/**
	 * Hold the Gateway WebSocket open on `start()`. Set `false` for webhook-only
	 * mode (HTTP Interactions + REST send, no `discord.js`, no regular messages).
	 * Default `true`.
	 */
	gateway?: boolean;
	/**
	 * How a slash command is acknowledged inside Discord's 3-second window.
	 * `'deferred'` (default) shows "thinking…" until you {@link DiscordAdapter.followUp};
	 * a string replies at once with that text, leaving nothing to close.
	 */
	commandAck?: 'deferred' | (string & {});
	/**
	 * Decide the *initial* response to an interaction yourself — the only moment
	 * Discord lets you open a modal (`{ type: 9, data }`), update the pressed
	 * message in place (`{ type: 7, data }`) or reply with a full message
	 * (`{ type: 4, data }`). Return nothing to keep the default ack. Synchronous: it
	 * runs inside the 3-second window. The interaction is still delivered as a message.
	 */
	respond?: (interaction: DiscordInteraction) => DiscordInteractionResponse | null | undefined | void;
	/**
	 * Acknowledge slash commands as ephemeral (only the invoker sees the reply),
	 * so every `followUp` stays private. Default `false`.
	 */
	ephemeralCommands?: boolean;
	/** Discord REST base. Default `https://discord.com/api/v10`. */
	apiBase?: string;
	/** Override the discord.js module (tests). */
	discordModule?: any;
	/** Override fetch (REST calls and media download; tests). */
	fetchImpl?: typeof fetch;
}

/** One application (slash) command for {@link DiscordAdapter.registerCommands}. */
export interface DiscordCommand {
	/** 1-32 characters, lower-case. */
	name: string;
	/** 1-100 characters. */
	description: string;
	/** Options / subcommands, exactly as the REST API takes them. */
	options?: Array<Record<string, unknown>>;
	[extra: string]: unknown;
}

/** `GET /users/@me` — the bot's own identity. */
export interface DiscordBotInfo {
	id: string;
	username: string;
	discriminator?: string;
	bot?: boolean;
}

/**
 * A slash command, button / menu press or modal submit, whichever transport it
 * came by (Gateway or HTTP) — the shape {@link DiscordAdapterOptions.respond} sees.
 */
export interface DiscordInteraction {
	kind: 'command' | 'component' | 'modal';
	id: string;
	applicationId?: string;
	/** Valid for 15 minutes; what {@link DiscordAdapter.followUp} needs. */
	token?: string;
	channelId: string;
	/** The raw user object (`id`, `username`, `globalName`, …). */
	user: any;
	/** The message a component was attached to. */
	messageId?: string;
	/** A component's or modal's `custom_id`. */
	customId?: string;
	/** Selected values of a select menu. */
	values?: string[];
	command?: { name: string; options?: any[] };
	/** Submitted modal inputs, `custom_id` → value. */
	fields?: Record<string, string>;
	/** The interaction's `data` as received: typed option values, `resolved`, `target_id`. */
	data?: unknown;
}

/** An interaction response in the REST API's own shape (`type` + `data`). */
export interface DiscordInteractionResponse {
	type: number;
	data?: Record<string, unknown>;
}

// Interaction types and response types of the HTTP Interactions protocol.
const INTERACTION_PING = 1;
const INTERACTION_COMMAND = 2;
const INTERACTION_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED = 5;
const RESPONSE_DEFERRED_UPDATE = 6;
const RESPONSE_AUTOCOMPLETE = 8;
const INTERACTION_AUTOCOMPLETE = 4;
const INTERACTION_MODAL = 5;
const RESPONSE_MESSAGE = 4;
const RESPONSE_UPDATE_MESSAGE = 7;
const RESPONSE_MODAL = 9;
const FLAG_EPHEMERAL = 64;
/** A signed request older than this is a replay, not a delivery (seconds). */
const REPLAY_WINDOW_S = 300;

export class DiscordAdapter implements Adapter {
	readonly platform = 'discord' as const;
	readonly account: string;
	private readonly token: string;
	private readonly publicKey?: string;
	private applicationId?: string;
	private readonly gateway: boolean;
	private readonly ephemeralCommands: boolean;
	private readonly commandAck: 'deferred' | string;
	private readonly respond?: DiscordAdapterOptions['respond'];
	private readonly apiBase: string;
	private readonly discordModule?: any;
	private readonly fetchImpl: typeof fetch;
	private readonly conn: ConnectionTracker;
	private client: any = null;

	constructor(options: DiscordAdapterOptions) {
		if (!options.token) throw new Error('DiscordAdapter requires a bot token.');
		this.token = options.token;
		this.account = options.account ?? 'bot';
		this.publicKey = options.publicKey;
		this.applicationId = options.applicationId;
		this.gateway = options.gateway ?? true;
		this.ephemeralCommands = options.ephemeralCommands ?? false;
		this.commandAck = options.commandAck ?? 'deferred';
		this.respond = options.respond;
		this.apiBase = options.apiBase ?? 'https://discord.com/api/v10';
		this.discordModule = options.discordModule;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.conn = new ConnectionTracker(this.platform, this.account);
	}

	capabilities(): CapabilityDescriptor {
		return buildCapabilities('discord', {
			...emptySupport(),
			reactions: true,
			threads: true,
			buttons: true,
			typing: true,
			edit: true,
			rich_layout: true,
			media: ['image', 'video', 'audio', 'document', 'sticker']
		});
	}

	/** Verifies the Ed25519 signature of an HTTP interaction. Webhook mode only. */
	verifyInbound(req: InboundRequest): boolean {
		if (!this.publicKey) return false;
		// The timestamp is part of the signed payload, so a captured request stays
		// valid forever unless its age is checked too.
		if (!withinReplayWindow(Number(req.headers['x-signature-timestamp']), REPLAY_WINDOW_S)) return false;
		return verifyDiscord({
			body: req.body,
			signature: req.headers['x-signature-ed25519'],
			timestamp: req.headers['x-signature-timestamp'],
			publicKey: this.publicKey
		});
	}

	/**
	 * The HTTP answer an interaction needs: `PONG` for Discord's endpoint check, the
	 * configured ack for a command / press / modal submit (or whatever `respond`
	 * returns), no choices for autocomplete. Anything unverified is a 401 — Discord
	 * probes for that when you save the URL.
	 */
	webhookReply(req: InboundRequest): WebhookReply | null {
		if (!this.verifyInbound(req)) return { status: 401, body: 'verification failed' };
		const raw = parseJson(req.body);
		const json = (response: DiscordInteractionResponse, deliver: boolean): WebhookReply => ({
			status: 200,
			body: JSON.stringify(response),
			contentType: 'application/json',
			deliver
		});
		if (raw?.type === INTERACTION_PING) return json({ type: RESPONSE_PONG }, false);
		// Autocomplete must be answered or the client shows an error; ChatKit has
		// nothing to suggest, so it answers with no choices (and delivers nothing).
		if (raw?.type === INTERACTION_AUTOCOMPLETE) return json({ type: RESPONSE_AUTOCOMPLETE, data: { choices: [] } }, false);
		const interaction = this.parseInteraction(raw);
		if (!interaction) return null;
		return json(this.decideAck(interaction, Boolean(raw.message)), true);
	}

	/** Normalise an HTTP interaction (slash command / button / menu / modal) to a message. */
	async handleInbound(req: InboundRequest): Promise<UniversalMessage | null> {
		const interaction = this.parseInteraction(parseJson(req.body));
		return interaction ? this.interactionMessage(interaction) : null;
	}

	async start(ctx: AdapterContext): Promise<Connection> {
		if (!this.gateway) {
			// Webhook-only: nothing to hold open; interactions arrive via receive().
			this.conn.set(ctx, 'open');
			return { platform: this.platform, account: this.account, status: () => this.conn.state, stop: async () => this.conn.set(ctx, 'closed') };
		}
		const discord = this.discordModule ?? (await loadModule('discord.js'));
		const { Client, GatewayIntentBits, Events, Partials } = discord;
		const client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.GuildMessageTyping,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.DirectMessageTyping
			],
			partials: [Partials.Channel, Partials.Message, Partials.Reaction]
		});
		this.client = client;

		const emitConn = (state: 'connecting' | 'open' | 'closed', detail?: string): void => this.conn.set(ctx, state, detail);
		emitConn('connecting');

		client.once(Events.ClientReady, () => {
			ctx.logger.info('Discord gateway ready');
			emitConn('open');
		});
		client.on(Events.ShardResume, () => {
			ctx.logger.info('Discord session resumed (RESUME, not re-IDENTIFY)');
			this.conn.reconnects += 1;
			emitConn('open');
		});
		client.on(Events.ShardReconnecting, () => emitConn('connecting'));
		client.on(Events.ShardDisconnect, () => emitConn('closed'));
		client.on(Events.Error, (error: Error) => ctx.events.error(error));

		// Buttons, select menus, slash commands and modal submits → universal message.
		client.on(Events.InteractionCreate, async (raw: any) => {
			try {
				const interaction = this.fromGateway(raw);
				if (!interaction) return;
				const response = this.decideAck(interaction, Boolean(raw.isFromMessage?.()));
				await this.answerGateway(raw, response);
				ctx.events.message(this.interactionMessage(interaction));
			} catch (error) {
				ctx.events.error(error as Error);
			}
		});

		// An edit → the new content, flagged `edited`. Embed unfurls also fire this
		// event; they are told apart by an unchanged `content`.
		client.on(Events.MessageUpdate, async (before: any, after: any) => {
			if (after?.author?.bot) return;
			try {
				if (after.partial) after = await after.fetch();
				if (after.author?.bot || !after.editedTimestamp) return;
				if (!before?.partial && before?.content === after.content) return;
				const msg = await this.normalize(after, ctx, true);
				if (msg) ctx.events.message(msg);
			} catch (error) {
				ctx.events.error(error as Error);
			}
		});

		// Typing indicator → universal presence event.
		client.on(Events.TypingStart, (typing: any) => {
			if (typing?.user?.bot) return;
			ctx.events.presence({
				platform: this.platform,
				account: this.account,
				conversation_id: typing?.channel?.id ?? typing?.channelId ?? '',
				user_id: typing?.user?.id,
				state: 'typing',
				timestamp: new Date().toISOString()
			});
		});

		client.on(Events.MessageCreate, async (message: any) => {
			if (message.author?.bot) return;
			try {
				const msg = await this.normalize(message, ctx);
				if (msg) ctx.events.message(msg);
			} catch (error) {
				ctx.events.error(error as Error);
			}
		});

		client.on(Events.MessageReactionAdd, async (reaction: any, user: any) => {
			if (user?.bot) return;
			try {
				if (reaction.partial) await reaction.fetch();
				ctx.events.reaction(
					inbound({
						platformMessageId: reaction.message.id,
						address: this.address(reaction.message.channelId, reaction.message.guildId),
						from: this.participant(user),
						content: { type: 'reaction', emoji: reaction.emoji?.name ?? '', target_message_id: reaction.message.id },
						raw: reaction
					})
				);
			} catch (error) {
				ctx.events.error(error as Error);
			}
		});

		await client.login(this.token);
		return {
			platform: this.platform,
			account: this.account,
			status: () => (client.isReady?.() ? 'open' : 'connecting'),
			stop: async () => {
				await client.destroy();
			}
		};
	}

	/** A connection-health snapshot. discord.js self-heals, so `terminal` is never set. */
	health(): ConnectionHealth {
		return this.conn.health();
	}

	// --- REST helpers ---------------------------------------------------------
	//
	// Discord-specific setup, kept out of the universal `Adapter` contract: verify
	// a token, register the slash commands the bot answers, answer one after the
	// fact, and reach any endpoint not covered here.

	/** The bot's identity. Doubles as a token check — an invalid token throws. */
	async getMe(): Promise<DiscordBotInfo> {
		return this.rest('GET', '/users/@me');
	}

	/**
	 * Publish slash commands. Replaces the whole list (`[]` clears it). Global
	 * commands can take up to an hour to appear; pass `guildId` for instant ones.
	 */
	async registerCommands(commands: DiscordCommand[], options: { guildId?: string } = {}): Promise<void> {
		const app = await this.appId();
		const scope = options.guildId ? `/guilds/${options.guildId}` : '';
		await this.rest('PUT', `/applications/${app}${scope}/commands`, commands);
	}

	/**
	 * Answer a slash command after the fact. `interaction` is `msg.raw.interaction`
	 * of the inbound message; the first follow-up replaces the "thinking…" state.
	 * The token is valid for 15 minutes.
	 */
	async followUp(interaction: { application_id?: string; token: string }, body: Record<string, unknown>): Promise<any> {
		const app = interaction.application_id ?? (await this.appId());
		return this.rest('POST', `/webhooks/${app}/${interaction.token}?wait=true`, body);
	}

	/** Call any REST endpoint directly (`path` starts with `/`); resolves to the JSON body. */
	async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
		return this.rest(method, path, body);
	}

	async send(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult> {
		if (!this.client) return this.restSend(msg, ctx);
		const channel = await this.client.channels.fetch(msg.to.conversation_id);
		if (!channel || typeof channel.send !== 'function') {
			throw new Error(`Discord channel ${msg.to.conversation_id} is not sendable.`);
		}
		const reply = msg.reply_to ? { reply: { messageReference: msg.reply_to } } : {};

		const pass = msg.platform_meta?.discord as Record<string, unknown> | undefined;
		if (pass) {
			const sent = await channel.send({ ...pass, ...reply });
			return this.result(sent);
		}

		const content = msg.content;
		switch (content.type) {
			case 'text': {
				const body = content.rich ? renderDiscord(content.rich) : content.text;
				const sent = await channel.send({ content: body, ...reply });
				return this.result(sent);
			}
			case 'media': {
				const blob = await ctx.media.resolveOutbound(content);
				ctx.media.validate(this.capabilities(), content, blob.data.byteLength);
				const caption = content.caption_rich ? renderDiscord(content.caption_rich) : content.caption;
				const sent = await channel.send({
					content: caption,
					files: [{ attachment: Buffer.from(blob.data), name: content.filename ?? `file-${content.media_type}` }],
					...reply
				});
				return this.result(sent);
			}
			case 'reaction': {
				const target = await channel.messages.fetch(content.target_message_id);
				await target.react(content.emoji);
				return { id: newId(), platform_message_id: content.target_message_id, status: 'sent', timestamp: new Date().toISOString() };
			}
			case 'location':
			case 'contact':
			case 'passthrough':
				throw new Error(`Discord does not support content type "${content.type}" (use platform_meta.discord).`);
		}
	}

	async setTyping(address: Address, on: boolean): Promise<void> {
		if (!on) return;
		if (!this.client) {
			await this.rest('POST', `/channels/${address.conversation_id}/typing`);
			return;
		}
		const channel = await this.client.channels.fetch(address.conversation_id);
		await channel?.sendTyping?.();
	}

	async edit(target: EditTarget): Promise<SendResult> {
		if (target.content.type !== 'text') throw new Error('Discord edit supports text messages only.');
		const body = target.content.rich ? renderDiscord(target.content.rich) : target.content.text;
		if (!this.client) {
			const edited = await this.rest('PATCH', messagePath(target), { content: body });
			return this.result(edited);
		}
		const channel = await this.client.channels.fetch(target.address.conversation_id);
		const message = await channel?.messages?.fetch(target.platform_message_id);
		const edited = await message.edit({ content: body });
		return this.result(edited);
	}

	async deleteMessage(target: MessageTarget): Promise<void> {
		if (!this.client) {
			await this.rest('DELETE', messagePath(target));
			return;
		}
		const channel = await this.client.channels.fetch(target.address.conversation_id);
		const message = await channel?.messages?.fetch(target.platform_message_id);
		await message?.delete?.();
	}

	async stop(): Promise<void> {
		await this.client?.destroy?.();
	}

	// --- internals ------------------------------------------------------------

	/** Send over REST — the path for webhook-only mode (no Gateway client). */
	private async restSend(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult> {
		const channel = msg.to.conversation_id;
		const post = (body: unknown, form?: FormData) => this.rest('POST', `/channels/${channel}/messages`, body, form);
		const reply = msg.reply_to ? { message_reference: { message_id: msg.reply_to } } : {};

		const pass = msg.platform_meta?.discord as Record<string, unknown> | undefined;
		if (pass) return this.result(await post({ ...pass, ...reply }));

		const content = msg.content;
		switch (content.type) {
			case 'text':
				return this.result(await post({ content: content.rich ? renderDiscord(content.rich) : content.text, ...reply }));
			case 'media': {
				const blob = await ctx.media.resolveOutbound(content);
				ctx.media.validate(this.capabilities(), content, blob.data.byteLength);
				const caption = content.caption_rich ? renderDiscord(content.caption_rich) : content.caption;
				const form = new FormData();
				form.set('payload_json', JSON.stringify({ content: caption, ...reply }));
				form.set('files[0]', new Blob([blob.data as BlobPart]), content.filename ?? `file-${content.media_type}`);
				return this.result(await post(undefined, form));
			}
			case 'reaction':
				await this.rest(
					'PUT',
					`/channels/${channel}/messages/${content.target_message_id}/reactions/${encodeURIComponent(content.emoji)}/@me`
				);
				return { id: newId(), platform_message_id: content.target_message_id, status: 'sent', timestamp: new Date().toISOString() };
			case 'location':
			case 'contact':
			case 'passthrough':
				throw new Error(`Discord does not support content type "${content.type}" (use platform_meta.discord).`);
		}
	}

	private async appId(): Promise<string> {
		if (!this.applicationId) this.applicationId = (await this.rest('GET', '/oauth2/applications/@me')).id;
		return this.applicationId!;
	}

	private async rest(method: string, path: string, body?: unknown, form?: FormData): Promise<any> {
		const res = await this.fetchImpl(`${this.apiBase}${path}`, {
			method,
			headers: { authorization: `Bot ${this.token}`, ...(form || body === undefined ? {} : { 'content-type': 'application/json' }) },
			...(form ? { body: form } : body === undefined ? {} : { body: JSON.stringify(body) })
		});
		const json: any = await res.json().catch(() => null);
		if (!res.ok) {
			const err = new Error(`Discord ${method} ${path} failed: ${res.status} ${json?.message ?? ''}`.trim());
			if (res.status === 429 || res.status >= 500) throw retryable(err);
			throw err;
		}
		return json;
	}

	/** An HTTP interaction → {@link DiscordInteraction}, or `null` for kinds ChatKit does not deliver. */
	private parseInteraction(i: any): DiscordInteraction | null {
		const kind = i?.type === INTERACTION_COMMAND ? 'command' : i?.type === INTERACTION_COMPONENT ? 'component' : i?.type === INTERACTION_MODAL ? 'modal' : null;
		if (!kind) return null;
		const fields: Record<string, string> = {};
		for (const row of kind === 'modal' ? (i.data?.components ?? []) : [])
			for (const input of row.components ?? []) if (input.custom_id) fields[input.custom_id] = String(input.value ?? '');
		return {
			kind,
			id: i.id,
			applicationId: i.application_id,
			token: i.token,
			channelId: i.channel_id ?? i.channel?.id ?? '',
			user: i.member?.user ?? i.user,
			messageId: i.message?.id,
			customId: i.data?.custom_id,
			values: i.data?.values,
			...(kind === 'command' ? { command: { name: i.data?.name, options: i.data?.options } } : {}),
			...(kind === 'modal' ? { fields } : {}),
			data: i.data
		};
	}

	/** A discord.js interaction → {@link DiscordInteraction} (same shape as over HTTP). */
	private fromGateway(i: any): DiscordInteraction | null {
		const base = { id: i.id, applicationId: i.applicationId, token: i.token, channelId: i.channelId, user: i.user, messageId: i.message?.id };
		if (i.isChatInputCommand?.() || i.isContextMenuCommand?.()) {
			const data = { name: i.commandName, options: i.options?.data, target_id: i.targetId };
			return { ...base, kind: 'command', command: { name: i.commandName, options: i.options?.data }, data };
		}
		if (i.isModalSubmit?.()) {
			const fields: Record<string, string> = {};
			for (const f of i.fields?.fields?.values?.() ?? []) fields[f.customId] = String(f.value ?? '');
			return { ...base, kind: 'modal', customId: i.customId, fields };
		}
		const isSelect = Boolean(i.isStringSelectMenu?.() || i.isAnySelectMenu?.());
		if (isSelect || i.isButton?.()) return { ...base, kind: 'component', customId: i.customId, values: isSelect ? i.values : undefined };
		return null;
	}

	/** `respond`'s answer when it gives one — a throwing hook must not cost the ack — else the default. */
	private decideAck(i: DiscordInteraction, fromMessage: boolean): DiscordInteractionResponse {
		try {
			return this.respond?.(i) || this.defaultAck(i, fromMessage);
		} catch {
			return this.defaultAck(i, fromMessage);
		}
	}

	/**
	 * What to say inside the 3-second window when `respond` does not decide: close a
	 * press / modal submit silently, and answer a command per `commandAck`.
	 */
	private defaultAck(i: DiscordInteraction, fromMessage: boolean): DiscordInteractionResponse {
		const flags = this.ephemeralCommands ? { flags: FLAG_EPHEMERAL } : undefined;
		if (i.kind === 'command') {
			if (this.commandAck === 'deferred') return { type: RESPONSE_DEFERRED, ...(flags ? { data: flags } : {}) };
			return { type: RESPONSE_MESSAGE, data: { content: this.commandAck, ...flags } };
		}
		// A modal opened from a command has no message to update; a deferred reply is
		// the only valid close for it.
		if (i.kind === 'modal' && !fromMessage) return { type: RESPONSE_DEFERRED, ...(flags ? { data: flags } : {}) };
		return { type: RESPONSE_DEFERRED_UPDATE };
	}

	/** Send an interaction response through discord.js (the HTTP path answers in the response body). */
	private async answerGateway(i: any, r: DiscordInteractionResponse): Promise<void> {
		const data = r.data ?? {};
		if (r.type === RESPONSE_MODAL) await i.showModal?.(data);
		else if (r.type === RESPONSE_UPDATE_MESSAGE) await i.update?.(data);
		else if (r.type === RESPONSE_MESSAGE) await i.reply?.(data);
		else if (r.type === RESPONSE_DEFERRED) await i.deferReply?.(data);
		else await i.deferUpdate?.();
	}

	private interactionMessage(p: DiscordInteraction): UniversalMessage {
		const content: MessageContent = p.command
			? { type: 'text', text: slashText(p.command.name, p.command.options) }
			: { type: 'postback', data: String(p.values?.length ? p.values.join(',') : (p.customId ?? '')), title: p.customId };
		return inbound({
			platformMessageId: p.messageId ?? p.id,
			// Every press / invocation is its own event, even on the same message.
			eventId: `interaction:${p.id}`,
			address: this.address(p.channelId),
			from: this.participant(p.user),
			content,
			raw: { interaction: { id: p.id, application_id: p.applicationId, token: p.token }, customId: p.customId, data: p.data, ...(p.fields ? { fields: p.fields } : {}) }
		});
	}

	private result(sent: any): SendResult {
		return { id: newId(), platform_message_id: sent?.id ?? null, status: 'sent', timestamp: new Date().toISOString(), raw: sent };
	}

	private async normalize(message: any, ctx: AdapterContext, edited = false): Promise<UniversalMessage | null> {
		const attachment = message.attachments?.first?.();
		let content: MessageContent;
		if (attachment) {
			const stored = await this.ingest(attachment, ctx);
			content = {
				type: 'media',
				media_type: mediaTypeFor(attachment.contentType),
				url: stored?.url,
				mime: attachment.contentType ?? undefined,
				caption: message.content || undefined,
				filename: attachment.name ?? undefined,
				size_bytes: attachment.size ?? undefined
			};
		} else if (message.content) {
			content = { type: 'text', text: message.content };
		} else {
			return null;
		}

		return inbound({
			platformMessageId: message.id,
			// An edit re-uses the message id; its own event id keeps dedup from eating it.
			...(edited ? { edited: true, eventId: `edit:${message.id}:${message.editedTimestamp}` } : {}),
			address: this.address(message.channelId, message.guildId),
			from: this.participant(message.author),
			timestamp: message.createdAt ?? new Date(),
			content,
			replyTo: message.reference?.messageId ?? null,
			raw: { id: message.id, channelId: message.channelId }
		});
	}

	private async ingest(attachment: any, ctx: AdapterContext) {
		try {
			const res = await this.fetchImpl(attachment.url);
			if (!res.ok) throw new Error(`download failed: ${res.status}`);
			return await ctx.media.ingestStream(responseBytes(res), { mime: attachment.contentType ?? undefined, filename: attachment.name ?? undefined });
		} catch (error) {
			ctx.logger.warn('Discord media ingest failed', { error: String(error) });
			return null;
		}
	}

	private address(channelId: string, guildId?: string | null): Address {
		// Threads in Discord are channels of their own, so channelId already
		// identifies the conversation; guildId is kept in raw for reference.
		void guildId;
		return { platform: 'discord', account: this.account, conversation_id: channelId, thread_id: null };
	}

	private participant(user: any): Participant {
		return {
			platform: 'discord',
			account: this.account,
			user_id: user?.id ?? '',
			display_name: user?.globalName ?? user?.username ?? null,
			is_self: Boolean(user?.bot)
		};
	}
}

function parseJson(body: string | Uint8Array): any {
	try {
		return JSON.parse(typeof body === 'string' ? body : Buffer.from(body).toString('utf8'));
	} catch {
		return null;
	}
}

function messagePath(target: MessageTarget): string {
	return `/channels/${target.address.conversation_id}/messages/${target.platform_message_id}`;
}

/** `/name sub key:value` — a slash command as the text a user would have typed. */
function slashText(name: string, options: any[] | undefined): string {
	const flat = (opts: any[] | undefined): string =>
		(opts ?? []).map((o) => (o.value === undefined ? [o.name, flat(o.options)].filter(Boolean).join(' ') : `${o.name}:${o.value}`)).join(' ');
	return `/${[name, flat(options)].filter(Boolean).join(' ')}`;
}

function mediaTypeFor(contentType: string | null | undefined): MediaType {
	const ct = contentType ?? '';
	if (ct.startsWith('image/')) return 'image';
	if (ct.startsWith('video/')) return 'video';
	if (ct.startsWith('audio/')) return 'audio';
	return 'document';
}
