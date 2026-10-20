/**
 * WhatsApp adapter via Baileys — a *persistent* connection, with
 * the mandatory safety layer active by default. Auth state (creds +
 * signal keys) is persisted **encrypted** through the `StateStore`, so a restart
 * does not force a re-pair (re-pairing raises ban risk). Implements
 * {@link WhatsAppAdapter} so it is interchangeable with the Cloud API adapter.
 *
 * Baileys is a heavy, Node-only SDK; it is imported dynamically so consumers who
 * never touch WhatsApp do not load it. ⚠️ Use a TEST number — ban risk is real.
 */

import { capabilities as buildCapabilities, emptySupport } from '../capability.js';
import { inbound, newId } from '../envelope.js';
import { renderWhatsApp } from '../format.js';
import { retryable } from '../queue/index.js';
import { loadPeer } from './util/peer.js';
import type { Adapter, AdapterContext, Connection, ConnectionHealth, EditTarget, MessageTarget, WhatsAppAdapter } from '../adapter.js';
import type { StateStore } from '../store/index.js';
import type {
	Address,
	CapabilityDescriptor,
	MediaType,
	MessageContent,
	OutboundMessage,
	Participant,
	SendResult
} from '../schema.js';

/** Hide the specifier so TS/the bundler does not require the SDK to be installed. */
function loadModule(specifier: string): Promise<any> {
	return loadPeer(specifier, 'WhatsApp (Baileys)');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Canonicalise a WhatsApp JID so the *same* peer always yields the *same* string
 * across inbound and outbound. Strips the device/agent suffix (`user:12@…`) and
 * folds the legacy `@c.us` domain to `@s.whatsapp.net`. Crucially it leaves the
 * `@lid` domain intact: under WhatsApp's LID addressing a peer's chat JID and its
 * sender JID can be different identifiers, which is why session/opt-in state must
 * be keyed consistently (see `send()` / `recordInbound`).
 */
function normalizeJid(jid: string | undefined | null): string {
	if (!jid) return '';
	const at = jid.indexOf('@');
	if (at === -1) return jid;
	const user = jid.slice(0, at).split(':')[0];
	const domain = jid.slice(at + 1);
	return `${user}@${domain === 'c.us' ? 's.whatsapp.net' : domain}`;
}

/** Best-effort phone extraction from a shared vCard (prefers the WhatsApp `waid`). */
function phoneFromVcard(vcard: string | undefined | null): string {
	if (!vcard) return '';
	const waid = vcard.match(/waid=(\d+)/);
	if (waid) return waid[1];
	const tel = vcard.match(/TEL[^:\n]*:([+\d][\d\s()-]*)/i);
	return tel ? tel[1].replace(/[^\d+]/g, '') : '';
}

/** Map a Baileys presence string to a universal presence state. */
function presenceState(p: string | undefined): 'typing' | 'recording' | 'online' | 'offline' | 'paused' {
	switch (p) {
		case 'composing':
			return 'typing';
		case 'recording':
			return 'recording';
		case 'available':
			return 'online';
		case 'unavailable':
			return 'offline';
		default:
			return 'paused';
	}
}

/** A pino-shaped silent logger so Baileys produces no output of its own. */
const silentBaileysLogger: any = {
	level: 'silent',
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	child() {
		return silentBaileysLogger;
	}
};

export interface WhatsAppBaileysAdapterOptions {
	/** Consumer-owned account id (typically `wa:<number>`). */
	account: string;
	/** Called with the QR string when pairing is required (render it yourself). */
	onQR?: (qr: string) => void;
	/** Request a pairing code for this E.164 number instead of a QR. */
	pairingNumber?: string;
	/** Called with the pairing code once requested. */
	onPairingCode?: (code: string) => void;
	/**
	 * Treat the number as warming until this epoch-ms (restricts cold sends and ramps
	 * the send rate). If omitted, the adapter auto-warms a *freshly paired* number for
	 * {@link warmupDurationMs} from the moment it pairs — a new number blasting on day
	 * one is the single biggest ban trigger.
	 */
	warmupUntil?: number;
	/**
	 * How long a freshly paired number auto-warms, in ms. Default 7 days. The send rate
	 * ramps gradually from the safety layer's warmup ceiling to its steady-state ceiling
	 * across this window. Ignored when {@link warmupUntil} is set explicitly.
	 */
	warmupDurationMs?: number;
	/**
	 * Pin the WhatsApp-web client version announced in the handshake. By default the
	 * adapter resolves the current version at `start()` — WhatsApp rejects a stale
	 * version with `405 Connection Failure` *before* pairing, and the version Baileys
	 * bundles drifts out of date. Set this to pin a known-good version (or to avoid
	 * the network lookup in an offline/mirrored environment).
	 */
	version?: [number, number, number];
	/**
	 * Consecutive failed reconnects (without an intervening successful connection)
	 * before the adapter gives up instead of looping forever. Default `5`. A
	 * persistent pre-pair failure — e.g. a `405` pairing rate-limit from WhatsApp —
	 * must not become an endless reconnect storm that deepens the block.
	 */
	maxReconnectAttempts?: number;
	/** Override the Baileys module (tests). */
	baileysModule?: any;
}

const NS_AUTH = (account: string) => `wa-auth:${account}`;
/** Namespace for small per-account adapter metadata (e.g. the pairing timestamp). */
const NS_META = (account: string) => `wa-meta:${account}`;
const META_PAIRED_AT = 'paired-at';

/**
 * Cap on consecutive *pre-pair* failed reconnects before giving up. This only bounds
 * failures that happen before the socket has ever opened — the classic `405` pairing
 * rate-limit, where retrying deepens the block. Once a connection has opened at least
 * once, drops are treated as transient and retried indefinitely with capped backoff.
 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

/** Default auto-warm window for a freshly paired number (7 days). */
const DEFAULT_WARMUP_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Best-effort human name for a Baileys disconnect status code (for logs). */
function disconnectReasonName(code: number | undefined, DisconnectReason: any): string {
	if (code == null) return 'unknown';
	for (const [name, value] of Object.entries(DisconnectReason ?? {})) {
		if (value === code) return name;
	}
	return `code ${code}`;
}

export class WhatsAppBaileysAdapter implements WhatsAppAdapter {
	readonly platform = 'whatsapp_baileys' as const;
	readonly account: string;
	private readonly options: WhatsAppBaileysAdapterOptions;
	private sock: any = null;
	private stopped = false;
	private connState: 'connecting' | 'open' | 'closed' = 'closed';
	/** True once the socket has opened at least once — flips reconnects to "transient". */
	private everConnected = false;
	/** Set when the adapter has permanently given up (terminal close or pre-pair cap). */
	private terminal = false;
	/** Total reconnects since `start()` — a health/observability signal. */
	private reconnectCount = 0;
	private connectedSince: number | null = null;
	private lastConnectedAt: number | null = null;
	/** Re-arm the connection loop from a terminal stop; set once `start()` has run. */
	private resume: (() => void) | null = null;

	constructor(options: WhatsAppBaileysAdapterOptions) {
		if (!options.account) throw new Error('WhatsAppBaileysAdapter requires an account id.');
		this.account = options.account;
		this.options = options;
	}

	capabilities(): CapabilityDescriptor {
		return buildCapabilities('whatsapp_baileys', {
			...emptySupport(),
			delivery_receipt: true,
			read_receipt: true,
			reactions: true,
			typing: true,
			edit: true,
			location: true,
			contact: true,
			media: ['image', 'video', 'audio', 'voice', 'document', 'sticker']
		});
	}

	async start(ctx: AdapterContext): Promise<Connection> {
		const baileys = this.options.baileysModule ?? (await loadModule('@whiskeysockets/baileys'));
		const makeWASocket = baileys.default ?? baileys.makeWASocket;
		const { DisconnectReason } = baileys;
		this.stopped = false;
		this.terminal = false;
		this.everConnected = false;
		this.reconnectCount = 0;
		await this.applyWarmup(ctx);

		// Resolve the WhatsApp-web client version once, up front. A stale version is
		// rejected with `405 Connection Failure` before pairing even gets a chance.
		const version = await this.resolveVersion(baileys, ctx);

		const emitConn = (state: 'connecting' | 'qr' | 'authenticated' | 'open' | 'closed', extra?: { qr?: string; detail?: string }): void =>
			ctx.events.connection({ platform: this.platform, account: this.account, state, timestamp: new Date().toISOString(), ...extra });

		const maxReconnectAttempts = this.options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
		let attempt = 0;
		const connect = async (): Promise<void> => {
			this.connState = 'connecting';
			emitConn('connecting');
			const { state, saveCreds, isNew } = await makeStoreAuthState(baileys, ctx.store, this.account);
			const sock = makeWASocket({
				version,
				auth: state,
				printQRInTerminal: false,
				logger: silentBaileysLogger,
				// Footprint: we keep no conversation history (inbox apps own their store),
				// so skip WhatsApp's history sync entirely — it is the biggest RAM/bandwidth
				// spike on connect. Manage presence ourselves rather than staying online 24/7.
				syncFullHistory: false,
				shouldSyncHistoryMessage: () => false,
				markOnlineOnConnect: false
			});
			this.sock = sock;
			sock.ev.on('creds.update', saveCreds);

			sock.ev.on('connection.update', async (update: any) => {
				if (update.qr) {
					emitConn('qr', { qr: update.qr });
					// A consumer's QR renderer must not be able to crash the connection.
					try {
						this.options.onQR?.(update.qr);
					} catch (error) {
						ctx.events.error(error as Error);
					}
					if (this.options.pairingNumber && this.options.onPairingCode) {
						try {
							const code = await sock.requestPairingCode(this.options.pairingNumber);
							this.options.onPairingCode(code);
						} catch (error) {
							ctx.events.error(error as Error);
						}
					}
				}
				if (update.connection === 'open') {
					attempt = 0;
					this.connState = 'open';
					const now = Date.now();
					this.connectedSince = now;
					this.lastConnectedAt = now;
					this.everConnected = true;
					ctx.logger.info('WhatsApp connection open');
					emitConn('open');
					// A brand-new pairing: stamp the pairing time and start the warming ramp
					// now (a number that blasts on day one is the #1 ban trigger).
					if (isNew) {
						try {
							await ctx.store.kvSet(NS_META(this.account), META_PAIRED_AT, String(now));
							await this.applyWarmup(ctx);
						} catch (e) {
							ctx.logger.warn('Could not persist pairing time for warming', { error: String(e) });
						}
					}
					if (ctx.safety.humanizers().presence) {
						try {
							await sock.sendPresenceUpdate('available');
						} catch {
							// presence is best-effort
						}
					}
				}
				if (update.connection === 'close') {
					this.connState = 'closed';
					this.connectedSince = null;
					if (this.stopped) {
						emitConn('closed');
						return;
					}

					const error = update.lastDisconnect?.error;
					const code = error?.output?.statusCode;
					const reason = disconnectReasonName(code, DisconnectReason);
					emitConn('closed', { detail: reason });

					// Logged out: creds are dead. Clear them — a re-pair is required. Terminal:
					// stop looping; a consumer re-pairs then calls reconnect() (or re-adds).
					if (code === DisconnectReason?.loggedOut) {
						ctx.logger.warn('WhatsApp logged out — clearing auth state, re-pair required', { code, reason });
						await clearAuthState(ctx.store, this.account);
						this.markTerminal();
						return;
					}

					// Forbidden (403) is WhatsApp's ban / "account at risk" signal. Flag the
					// account so the safety layer halts any queued sends, and stop reconnecting.
					if (code === DisconnectReason?.forbidden) {
						ctx.logger.error('WhatsApp connection forbidden (403) — account banned or at risk', { code, reason });
						ctx.safety.flagAtRisk(this.account, 'connection forbidden (403)');
						ctx.events.error(new Error('WhatsApp connection forbidden (403); account banned or at risk. Not reconnecting.'));
						this.markTerminal();
						return;
					}

					// Session replaced by another device: reconnecting fights the takeover. Terminal.
					if (code === DisconnectReason?.connectionReplaced) {
						ctx.logger.error('WhatsApp session replaced by another device — not reconnecting', { code, reason });
						ctx.events.error(new Error(`WhatsApp connection terminated (${reason}); not reconnecting.`));
						this.markTerminal();
						return;
					}

					// Restart required is an expected step right after pairing — reconnect
					// promptly without counting it as a failure.
					if (code === DisconnectReason?.restartRequired) {
						ctx.logger.info('WhatsApp restart required — reconnecting', { code, reason });
						setTimeout(() => void connect().catch((e) => ctx.events.error(e as Error)), 0);
						return;
					}

					// Any other close is a failure, handled in two regimes:
					//  • pre-pair (never opened): a persistent failure — typically a 405
					//    pairing rate-limit — must not become an endless storm that deepens
					//    the block, so bound the attempts and give up (retry later via
					//    reconnect()).
					//  • post-open: a normal transient drop (the frequent "scan at 1, dropped
					//    at 3"). A 24/7 gateway must self-heal, so retry indefinitely with
					//    capped backoff — backoffDelay is bounded (≤ maxMs), so this is at most
					//    ~1 attempt/minute, not an abnormal reconnect storm.
					attempt += 1;
					this.reconnectCount += 1;
					if (!this.everConnected && attempt > maxReconnectAttempts) {
						this.markTerminal();
						ctx.logger.error('WhatsApp giving up after repeated pre-pair connection failures', {
							code,
							reason,
							attempts: attempt - 1
						});
						ctx.events.error(
							new Error(
								`WhatsApp connection failed ${attempt - 1} time(s) before pairing (last: ${reason}); stopping reconnects. ` +
									'A 405/Connection Failure before pairing usually means WhatsApp is rate-limiting ' +
									'pairing from this IP — wait before retrying, then call reconnect().'
							)
						);
						return;
					}
					const delay = ctx.safety.backoffDelay(attempt);
					ctx.logger.warn('WhatsApp connection closed — reconnecting with backoff', {
						code,
						reason,
						attempt,
						delay,
						mode: this.everConnected ? 'transient' : 'pre-pair'
					});
					setTimeout(() => void connect().catch((e) => ctx.events.error(e as Error)), delay);
				}
			});

			sock.ev.on('messages.upsert', async (payload: any) => {
				if (payload.type !== 'notify') return;
				for (const m of payload.messages ?? []) {
					try {
						// Human-like: open (read) the chat on receipt.
						if (ctx.safety.humanizers().readReceipts && !m.key?.fromMe && m.key) {
							try {
								await sock.readMessages([m.key]);
							} catch {
								// read receipts are best-effort
							}
						}
						const msg = await this.normalize(m, ctx, baileys);
						if (msg) {
							ctx.events.message(msg);
							// A received message means the sender just stopped typing. Baileys does
							// not reliably emit a `paused` presence after a send, so the last known
							// presence would otherwise stay `composing` and the typing indicator
							// would stick until the peer types again. Synthesise the stop here.
							ctx.events.presence({
								platform: this.platform,
								account: this.account,
								conversation_id: msg.address.conversation_id,
								user_id: msg.from?.user_id,
								state: 'paused',
								timestamp: new Date().toISOString()
							});
						}
					} catch (error) {
						ctx.events.error(error as Error);
					}
				}
			});

			// Inbound typing / online presence, surfaced as a universal event.
			sock.ev.on('presence.update', (update: any) => {
				const jid = update?.id;
				const presences = update?.presences ?? {};
				for (const participant of Object.keys(presences)) {
					const last = presences[participant]?.lastKnownPresence;
					ctx.events.presence({
						platform: this.platform,
						account: this.account,
						conversation_id: normalizeJid(jid),
						user_id: normalizeJid(participant),
						state: presenceState(last),
						timestamp: new Date().toISOString()
					});
				}
			});
		};

		// Re-arm the loop after a terminal stop (see `reconnect()`). Resets the failure
		// counters so a manual retry starts clean.
		this.resume = () => {
			attempt = 0;
			this.stopped = false;
			this.terminal = false;
			void connect().catch((e) => ctx.events.error(e as Error));
		};

		await connect();
		return {
			platform: this.platform,
			account: this.account,
			status: () => this.connState,
			stop: async () => {
				this.stopped = true;
				this.terminal = false;
				this.resume = null;
				try {
					await this.sock?.end?.(undefined);
				} catch {
					// already closed
				}
				this.connState = 'closed';
				this.connectedSince = null;
			}
		};
	}

	async send(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult> {
		if (!this.sock) throw retryable(new Error('WhatsApp socket is not connected yet.'));
		const jid = msg.to.conversation_id;
		// Key opt-in / session on the *normalised* conversation JID — the same value an
		// inbound message records its session under (see `messages.upsert`). Normalising
		// both sides makes the reply window resilient to device suffixes and to LID vs
		// phone-number identifier drift, which otherwise wrongly rejects in-session sends.
		await ctx.safety.gate({ account: this.account, userId: normalizeJid(jid), isReply: Boolean(msg.reply_to) });

		const quoted = msg.reply_to
			? { quoted: { key: { remoteJid: jid, id: msg.reply_to, fromMe: false }, message: { conversation: '' } } }
			: {};

		const payload = await this.buildPayload(msg, ctx);

		// Human-like typing: show "composing" for a text-length-derived duration.
		if (ctx.safety.humanizers().typing && msg.content.type === 'text') {
			const dur = ctx.safety.typingDurationFor(msg.content.text);
			if (dur > 0) {
				try {
					await this.sock.sendPresenceUpdate('composing', jid);
					await sleep(dur);
					await this.sock.sendPresenceUpdate('paused', jid);
				} catch {
					// presence is best-effort
				}
			}
		}

		const result = await this.sock.sendMessage(jid, payload, quoted);
		return {
			id: newId(),
			platform_message_id: result?.key?.id ?? null,
			status: 'sent',
			timestamp: new Date().toISOString(),
			raw: result
		};
	}

	async setTyping(address: Address, on: boolean): Promise<void> {
		if (!this.sock) return;
		await this.sock.sendPresenceUpdate(on ? 'composing' : 'paused', address.conversation_id);
	}

	async markRead(target: MessageTarget): Promise<void> {
		if (!this.sock) return;
		await this.sock.readMessages([{ remoteJid: target.address.conversation_id, id: target.platform_message_id, fromMe: false }]);
	}

	async deleteMessage(target: MessageTarget): Promise<void> {
		if (!this.sock) throw retryable(new Error('WhatsApp socket is not connected yet.'));
		const jid = target.address.conversation_id;
		await this.sock.sendMessage(jid, { delete: { remoteJid: jid, id: target.platform_message_id, fromMe: true } });
	}

	async edit(target: EditTarget, ctx: AdapterContext): Promise<SendResult> {
		if (!this.sock) throw retryable(new Error('WhatsApp socket is not connected yet.'));
		if (target.content.type !== 'text') throw new Error('WhatsApp edit supports text messages only.');
		const jid = target.address.conversation_id;
		const key = { remoteJid: jid, id: target.platform_message_id, fromMe: true };
		const rendered = target.content.rich ? renderWhatsApp(target.content.rich) : undefined;
		const editPayload = rendered
			? { text: rendered.text, ...(rendered.mentions.length ? { mentions: rendered.mentions } : {}), edit: key }
			: { text: target.content.text, edit: key };
		const result = await this.sock.sendMessage(jid, editPayload);
		void ctx;
		return { id: newId(), platform_message_id: result?.key?.id ?? target.platform_message_id, status: 'sent', timestamp: new Date().toISOString(), raw: result };
	}

	/** Purge encrypted auth state so a re-add of this number pairs fresh (new QR). */
	async dispose(ctx: AdapterContext): Promise<void> {
		await clearAuthState(ctx.store, this.account);
		try {
			await ctx.store.kvDelete(NS_META(this.account), META_PAIRED_AT);
		} catch {
			// best-effort; a stale pairing timestamp only affects the warming window
		}
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.terminal = false;
		this.resume = null;
		try {
			await this.sock?.end?.(undefined);
		} catch {
			// ignore
		}
	}

	/**
	 * Manually re-arm the connection after a *terminal* stop (logged out, forbidden,
	 * session replaced, or the pre-pair failure cap). Returns `false` if there is
	 * nothing to resume (never started, already live, or torn down via `stop()`).
	 * Use this once the root cause is fixed — e.g. after re-pairing, or after waiting
	 * out a `405` pairing rate-limit.
	 */
	reconnect(): boolean {
		if (!this.terminal || !this.resume) return false;
		this.resume();
		return true;
	}

	/** A point-in-time connection-health snapshot for monitoring. */
	health(): ConnectionHealth {
		return {
			platform: this.platform,
			account: this.account,
			state: this.connState,
			connectedSince: this.connectedSince != null ? new Date(this.connectedSince).toISOString() : null,
			lastConnectedAt: this.lastConnectedAt != null ? new Date(this.lastConnectedAt).toISOString() : null,
			reconnects: this.reconnectCount,
			terminal: this.terminal
		};
	}

	// --- internals ------------------------------------------------------------

	private markTerminal(): void {
		this.terminal = true;
		this.stopped = true;
		this.connState = 'closed';
		this.connectedSince = null;
	}

	/**
	 * Apply the warming ramp for this account. An explicit `warmupUntil` wins; else a
	 * freshly paired number auto-warms for `warmupDurationMs` from its pairing time
	 * (read from the store). Outside that window nothing is set — the number is "warm".
	 */
	private async applyWarmup(ctx: AdapterContext): Promise<void> {
		if (this.options.warmupUntil) {
			ctx.safety.setWarmup(this.account, this.options.warmupUntil);
			return;
		}
		const duration = this.options.warmupDurationMs ?? DEFAULT_WARMUP_DURATION_MS;
		try {
			const raw = await ctx.store.kvGet(NS_META(this.account), META_PAIRED_AT);
			if (raw == null) return;
			const pairedAt = Number(raw);
			if (!Number.isFinite(pairedAt)) return;
			const until = pairedAt + duration;
			if (Date.now() < until) {
				ctx.safety.setWarmup(this.account, until, pairedAt);
				ctx.logger.info('WhatsApp number is warming', { pairedAt: new Date(pairedAt).toISOString(), until: new Date(until).toISOString() });
			}
		} catch {
			// warming is best-effort; a store miss just means "not warming"
		}
	}

	/**
	 * The WhatsApp-web version to announce. Prefer an explicit pin, else fetch the
	 * current one from Baileys; if that lookup fails, fall back to Baileys' bundled
	 * default and warn — it may be stale enough to be rejected with a `405`.
	 */
	private async resolveVersion(
		baileys: any,
		ctx: AdapterContext
	): Promise<[number, number, number] | undefined> {
		if (this.options.version) return this.options.version;
		try {
			const { version } = await baileys.fetchLatestBaileysVersion();
			ctx.logger.info('Resolved WhatsApp web version', { version });
			return version;
		} catch (error) {
			ctx.logger.warn(
				'Could not resolve the latest WhatsApp web version — using Baileys default, which may be rejected with 405',
				{ error: String(error) }
			);
			return undefined;
		}
	}

	private async buildPayload(msg: OutboundMessage, ctx: AdapterContext): Promise<any> {
		const pass = msg.platform_meta?.whatsapp_baileys;
		if (pass) return pass;

		const content = msg.content;
		switch (content.type) {
			case 'text': {
				if (content.rich) {
					const { text, mentions } = renderWhatsApp(content.rich);
					return mentions.length ? { text, mentions } : { text };
				}
				return { text: content.text };
			}
			case 'location':
				return { location: { degreesLatitude: content.lat, degreesLongitude: content.lng, name: content.name } };
			case 'contact': {
				const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${content.name}\nTEL;type=CELL;type=VOICE;waid=${content.phone}:${content.phone}\nEND:VCARD`;
				return { contacts: { displayName: content.name, contacts: [{ vcard }] } };
			}
			case 'reaction':
				return { react: { text: content.emoji, key: { remoteJid: msg.to.conversation_id, id: content.target_message_id, fromMe: false } } };
			case 'media': {
				const rendered = content.caption_rich ? renderWhatsApp(content.caption_rich) : undefined;
				const caption = rendered ? rendered.text : content.caption;
				const mentions = rendered && rendered.mentions.length ? { mentions: rendered.mentions } : {};
				// Wrap a Baileys media value (a Buffer or a `{ stream }`) into the payload
				// shape for this media type. `mime`/`filename` come from whichever source
				// resolved the bytes (stream metadata or the buffered blob).
				const wrap = (media: any, mime?: string, filename?: string): any => {
					switch (content.media_type) {
						case 'image':
							return { image: media, caption, ...mentions };
						case 'video':
							return { video: media, caption, ...mentions };
						case 'audio':
							return { audio: media, mimetype: mime ?? 'audio/mp4' };
						case 'voice':
							return { audio: media, ptt: true, mimetype: mime ?? 'audio/ogg; codecs=opus' };
						case 'document':
							return { document: media, mimetype: mime ?? 'application/octet-stream', fileName: content.filename ?? filename };
						case 'sticker':
							return { sticker: media };
					}
				};

				// Prefer streaming straight from the store — never buffers the whole file in
				// RAM. Falls back to a buffer for inline `data` / external URLs / stores that
				// cannot stream.
				const streamed = await ctx.media.openOutboundStream(content);
				if (streamed) {
					ctx.media.validate(this.capabilities(), content, streamed.size_bytes);
					return wrap({ stream: streamed.stream }, streamed.mime, streamed.filename);
				}
				const blob = await ctx.media.resolveOutbound(content);
				ctx.media.validate(this.capabilities(), content, blob.data.byteLength);
				return wrap(Buffer.from(blob.data), blob.mime, blob.filename);
			}
			case 'passthrough':
				throw new Error('Passthrough send requires platform_meta.whatsapp_baileys.');
		}
	}

	private async normalize(m: any, ctx: AdapterContext, baileys: any): Promise<ReturnType<typeof inbound> | null> {
		if (m.key?.fromMe) return null;
		const jid = m.key?.remoteJid;
		if (!jid) return null;
		const message = m.message;
		if (!message) return null;

		const from = this.participant(m.key.participant ?? jid, m.pushName);
		const base = {
			platformMessageId: m.key.id,
			address: this.address(jid),
			from,
			timestamp: new Date((Number(m.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000),
			raw: m
		};

		// Reaction.
		if (message.reactionMessage) {
			return inbound({
				...base,
				content: {
					type: 'reaction',
					emoji: message.reactionMessage.text ?? '',
					target_message_id: message.reactionMessage.key?.id ?? ''
				}
			});
		}

		const content = await this.normalizeContent(m, ctx, baileys);
		if (!content) return null;
		const replyTo =
			message.extendedTextMessage?.contextInfo?.stanzaId ??
			message.imageMessage?.contextInfo?.stanzaId ??
			null;
		return inbound({ ...base, content, replyTo });
	}

	private async normalizeContent(m: any, ctx: AdapterContext, baileys: any): Promise<MessageContent | null> {
		const message = m.message;
		const text = message.conversation ?? message.extendedTextMessage?.text;
		if (text) return { type: 'text', text };
		if (message.locationMessage) {
			return {
				type: 'location',
				lat: message.locationMessage.degreesLatitude,
				lng: message.locationMessage.degreesLongitude,
				name: message.locationMessage.name
			};
		}

		// Shared vCard(s). Baileys sends a single `contactMessage` or, for multiple,
		// a `contactsArrayMessage`; we surface the first (the universal core carries
		// one contact — the rest remain in `raw` for advanced consumers).
		const contactMsg = message.contactMessage ?? message.contactsArrayMessage?.contacts?.[0];
		if (contactMsg) {
			return {
				type: 'contact',
				name: contactMsg.displayName ?? '',
				phone: phoneFromVcard(contactMsg.vcard)
			};
		}

		// Interactive reply (button tap / list selection / template button) → postback,
		// so a handler stays platform-agnostic regardless of how it was rendered.
		const buttonReply = message.buttonsResponseMessage;
		if (buttonReply) {
			return { type: 'postback', data: buttonReply.selectedButtonId ?? '', title: buttonReply.selectedDisplayText };
		}
		const listReply = message.listResponseMessage;
		if (listReply) {
			return { type: 'postback', data: listReply.singleSelectReply?.selectedRowId ?? '', title: listReply.title };
		}
		const templateReply = message.templateButtonReplyMessage;
		if (templateReply) {
			return { type: 'postback', data: templateReply.selectedId ?? '', title: templateReply.selectedDisplayText };
		}

		const mediaMap: Array<[string, MediaType]> = [
			['imageMessage', 'image'],
			['videoMessage', 'video'],
			['audioMessage', 'audio'],
			['documentMessage', 'document'],
			['stickerMessage', 'sticker']
		];
		for (const [key, mediaType] of mediaMap) {
			const part = message[key];
			if (!part) continue;
			const isVoice = key === 'audioMessage' && part.ptt;
			const stored = await this.ingestMedia(m, ctx, baileys, part.mimetype, part.fileName);
			return {
				type: 'media',
				media_type: isVoice ? 'voice' : mediaType,
				url: stored?.url,
				mime: part.mimetype,
				caption: part.caption,
				filename: part.fileName,
				size_bytes: part.fileLength ? Number(part.fileLength) : undefined
			};
		}
		return null;
	}

	private async ingestMedia(m: any, ctx: AdapterContext, baileys: any, mime?: string, filename?: string) {
		try {
			// Download as a stream and hand it to the media proxy, which streams it to the
			// store (disk-backed stores never buffer the whole file). The proxy buffers
			// only as a fallback for stores that cannot stream (e.g. the in-memory one).
			const stream = await baileys.downloadMediaMessage(
				m,
				'stream',
				{},
				{ logger: silentBaileysLogger, reuploadRequest: this.sock?.updateMediaMessage }
			);
			return await ctx.media.ingestStream(stream as AsyncIterable<Uint8Array>, { mime, filename });
		} catch (error) {
			ctx.logger.warn('WhatsApp media ingest failed', { error: String(error) });
			return null;
		}
	}

	private address(jid: string): Address {
		return { platform: 'whatsapp_baileys', account: this.account, conversation_id: normalizeJid(jid), thread_id: null };
	}

	private participant(jid: string, name?: string): Participant {
		return {
			platform: 'whatsapp_baileys',
			account: this.account,
			user_id: normalizeJid(jid),
			display_name: name ?? null,
			is_self: false
		};
	}
}

/** Alias so the public export name reads naturally regardless of import style. */
export type { WhatsAppAdapter } from '../adapter.js';
export const _isWhatsAppAdapter: (a: Adapter) => a is WhatsAppAdapter = (a): a is WhatsAppAdapter =>
	a.platform === 'whatsapp_baileys' || a.platform === 'whatsapp_cloud';

// --- StateStore-backed, encrypted Baileys auth state -------------------------

async function makeStoreAuthState(
	baileys: any,
	store: StateStore,
	account: string
): Promise<{ state: any; saveCreds: () => Promise<void>; isNew: boolean }> {
	const { initAuthCreds, BufferJSON, proto } = baileys;
	const ns = NS_AUTH(account);

	const readData = async (key: string): Promise<any> => {
		const raw = await store.secretGet(ns, key);
		if (!raw) return null;
		return JSON.parse(new TextDecoder().decode(raw), BufferJSON.reviver);
	};
	const writeData = async (key: string, value: any): Promise<void> => {
		await store.secretSet(ns, key, JSON.stringify(value, BufferJSON.replacer));
	};
	const removeData = async (key: string): Promise<void> => {
		await store.secretDelete(ns, key);
	};

	const existing = await readData('creds');
	const isNew = existing == null;
	const creds = existing ?? initAuthCreds();

	return {
		isNew,
		state: {
			creds,
			keys: {
				get: async (type: string, ids: string[]) => {
					const data: Record<string, any> = {};
					await Promise.all(
						ids.map(async (id) => {
							let value = await readData(`${type}-${id}`);
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value);
							}
							data[id] = value;
						})
					);
					return data;
				},
				set: async (data: Record<string, Record<string, any>>) => {
					const tasks: Array<Promise<void>> = [];
					for (const category of Object.keys(data)) {
						for (const id of Object.keys(data[category]!)) {
							const value = data[category]![id];
							const key = `${category}-${id}`;
							tasks.push(value ? writeData(key, value) : removeData(key));
						}
					}
					await Promise.all(tasks);
				}
			}
		},
		saveCreds: () => writeData('creds', creds)
	};
}

async function clearAuthState(store: StateStore, account: string): Promise<void> {
	const ns = NS_AUTH(account);
	const keys = await store.secretList(ns);
	await Promise.all(keys.map((k) => store.secretDelete(ns, k)));
}
