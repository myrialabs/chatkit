/**
 * `ChatKit` — the one unified API. It owns the adapter registry, the capability
 * registry, the shared ports (`StateStore`, `MediaProxy`, `SafetyController`), the
 * outbound dispatcher, and the consumer-facing event emitter. Inbound platform
 * events flow in through each adapter and out to `chat.on('message', …)`;
 * outbound `chat.send()` calls are capability-gated, idempotent, media-proxied,
 * and dispatched in order per account.
 */

import { assertSupportedRuntime } from './runtime.js';
import { assertSupported, CapabilityError, CapabilityRegistry } from './capability.js';
import { accountKey, addressAccountKey } from './address.js';
import { inboundKey } from './envelope.js';
import { noopLogger, prefixedLogger, type Logger } from './logger.js';
import { MediaProxy, MemoryMediaStore, type MediaStore } from './media/index.js';
import { OutboundQueue, type OutboundQueueOptions, type RateLimit } from './queue/index.js';
import { BaileysSafety, type SafetyController, type SafetyOptions, type SafetyStats } from './safety/index.js';
import { MemoryStateStore, type StateStore } from './store/index.js';
import {
	outboundMessageSchema,
	type Address,
	type CapabilityDescriptor,
	type OutboundMessage,
	type PlatformId,
	type SendResult,
	type UniversalMessage
} from './schema.js';
import type {
	Adapter,
	AdapterContext,
	AdapterEvents,
	Connection,
	ConnectionHealth,
	ConnectionUpdate,
	EditTarget,
	InboundRequest,
	MessageTarget,
	PresenceUpdate,
	StatusUpdate
} from './adapter.js';

/** A connection-health snapshot, with the safety snapshot attached for WhatsApp. */
export interface AccountHealth extends ConnectionHealth {
	safety?: SafetyStats;
}

/** Per-platform outbound rate ceilings for the dispatcher. */
const RATE_LIMITS: Record<PlatformId, RateLimit> = {
	telegram: { perSecond: 25 },
	whatsapp_baileys: { perSecond: 2 },
	whatsapp_cloud: { perSecond: 60 },
	discord: { perSecond: 4 },
	slack: { perSecond: 1 }
};

/** Default TTL for inbound dedup keys (24h) — platforms may redeliver. */
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

export interface ChatKitErrorEvent {
	account?: string;
	platform?: PlatformId;
	error: Error;
}

interface EventMap {
	message: UniversalMessage;
	reaction: UniversalMessage;
	status: StatusUpdate;
	presence: PresenceUpdate;
	connection: ConnectionUpdate;
	error: ChatKitErrorEvent;
}

type Handler<T> = (payload: T) => void;

export interface ChatKitOptions {
	/** State backend. Default in-memory; use `SqliteStore` to persist. */
	store?: StateStore;
	/** Media backend or a pre-built proxy. Default in-memory. */
	media?: MediaStore | MediaProxy;
	/** Diagnostics sink. Default silent. */
	logger?: Logger;
	/** Passphrase for at-rest secret encryption (forwarded to a default store). */
	stateKey?: string;
	/** Baileys safety configuration, or a custom controller. */
	safety?: SafetyOptions | SafetyController;
	/** Outbound dispatcher tuning. */
	queue?: OutboundQueueOptions;
}

interface Registration {
	adapter: Adapter;
	context: AdapterContext;
	connection?: Connection;
}

export class ChatKit {
	readonly store: StateStore;
	readonly media: MediaProxy;
	readonly logger: Logger;
	readonly safety: SafetyController;
	private readonly queue: OutboundQueue;
	private readonly capabilities_ = new CapabilityRegistry();
	private readonly registrations = new Map<string, Registration>();
	private readonly handlers: { [K in keyof EventMap]: Set<Handler<EventMap[K]>> } = {
		message: new Set(),
		reaction: new Set(),
		status: new Set(),
		presence: new Set(),
		connection: new Set(),
		error: new Set()
	};
	private started = false;

	constructor(options: ChatKitOptions = {}) {
		assertSupportedRuntime();
		this.logger = options.logger ?? noopLogger;
		if (options.store && options.stateKey) {
			// A supplied store owns its own codec; the passphrase would otherwise be
			// dropped without a trace and secrets written in plaintext or not at all.
			this.logger.warn('ChatKit `stateKey` is ignored when a `store` is supplied — pass it to the store instead.');
		}
		this.store = options.store ?? new MemoryStateStore({ stateKey: options.stateKey });
		this.media = options.media instanceof MediaProxy ? options.media : new MediaProxy(options.media ?? new MemoryMediaStore());
		this.queue = new OutboundQueue(options.queue);
		this.safety = isController(options.safety)
			? options.safety
			: new BaileysSafety(this.store, this.logger, options.safety);
	}

	/** Register an adapter. Wires its context and records its capabilities. */
	use(adapter: Adapter): this {
		this.register(adapter);
		return this;
	}

	/**
	 * Register an adapter and, if ChatKit is already running, start it immediately.
	 * Unlike {@link use}, `add` works after `start()` — for apps that configure
	 * accounts at runtime. Throws (and rolls the registration back) if the adapter
	 * fails to start.
	 */
	async add(adapter: Adapter): Promise<this> {
		const reg = this.register(adapter);
		if (this.started && reg.adapter.start) {
			try {
				reg.connection = await reg.adapter.start(reg.context);
				this.logger.info('Adapter started', { platform: adapter.platform, account: adapter.account });
			} catch (error) {
				this.registrations.delete(accountKey(adapter.platform, adapter.account));
				this.pruneCapabilities(adapter.platform);
				this.reportError(adapter, error as Error);
				throw error;
			}
		}
		return this;
	}

	/**
	 * Stop and unregister the adapter for an account. Returns `false` if none was
	 * registered. Safe to call at runtime — the inverse of {@link add}.
	 */
	async remove(platform: PlatformId, account: string): Promise<boolean> {
		const key = accountKey(platform, account);
		const reg = this.registrations.get(key);
		if (!reg) return false;
		try {
			await reg.connection?.stop();
			await reg.adapter.stop?.();
			// Purge persistent adapter-owned state (e.g. Baileys auth) so a re-add
			// of the same account starts fresh (a new QR / pairing).
			await reg.adapter.dispose?.(reg.context);
		} catch (error) {
			this.reportError(reg.adapter, error as Error);
		}
		this.registrations.delete(key);
		this.pruneCapabilities(platform);
		this.logger.info('Adapter removed', { platform, account });
		return true;
	}

	private register(adapter: Adapter): Registration {
		const key = accountKey(adapter.platform, adapter.account);
		if (this.registrations.has(key)) {
			throw new Error(`An adapter is already registered for ${key}.`);
		}
		const context = this.buildContext(adapter);
		const reg: Registration = { adapter, context };
		this.registrations.set(key, reg);
		this.capabilities_.set(adapter.capabilities());
		this.logger.info('Adapter registered', { platform: adapter.platform, account: adapter.account });
		return reg;
	}

	/** Drop a platform's capability descriptor once no account still uses it. */
	private pruneCapabilities(platform: PlatformId): void {
		const stillUsed = [...this.registrations.values()].some((r) => r.adapter.platform === platform);
		if (!stillUsed) this.capabilities_.delete(platform);
	}

	private buildContext(adapter: Adapter): AdapterContext {
		const tag = `[${adapter.platform}:${adapter.account}]`;
		const events: AdapterEvents = {
			message: (msg) => void this.emitInbound(msg).catch((e) => this.reportError(adapter, e)),
			reaction: (msg) => void this.emitInbound(msg).catch((e) => this.reportError(adapter, e)),
			status: (update) => this.emit('status', update),
			connection: (update) => this.emit('connection', update),
			presence: (update) => this.emit('presence', update),
			error: (error) => this.reportError(adapter, error)
		};
		return {
			store: this.store,
			media: this.media,
			logger: prefixedLogger(this.logger, tag),
			safety: this.safety,
			events
		};
	}

	// --- events ---------------------------------------------------------------

	on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): this {
		this.handlers[event].add(handler);
		return this;
	}

	off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): this {
		this.handlers[event].delete(handler);
		return this;
	}

	private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
		for (const handler of this.handlers[event]) {
			try {
				// Handlers are typed sync, but an `async` one type-checks too — and its
				// rejection would otherwise escape as an unhandled rejection.
				const result: unknown = handler(payload);
				if (isThenable(result) && event !== 'error') {
					result.then(undefined, (error: unknown) => this.emit('error', { error: toError(error) }));
				}
			} catch (error) {
				// A consumer handler threw — surface it but never let it break ingest.
				if (event !== 'error') this.emit('error', { error: toError(error) });
			}
		}
	}

	private reportError(adapter: Adapter, error: Error): void {
		this.emit('error', { account: adapter.account, platform: adapter.platform, error });
	}

	/**
	 * Run an inbound message through dedup + id mapping, then deliver it to
	 * consumers. Shared by persistent adapters (`ctx.events.message`) and webhook
	 * adapters (`receive()`).
	 */
	private async emitInbound(msg: UniversalMessage): Promise<void> {
		const { account, platform } = msg.address;
		const key = inboundKey(msg);
		if (key) {
			const fresh = await this.store.seen(key, DEDUP_TTL_MS);
			if (!fresh) {
				this.logger.debug('Dropping duplicate inbound event', { platform, account, key });
				return;
			}
		}
		// Only a NEW message gets a ChatKit id of its own — an event (a button press,
		// an edit) points at a message that was mapped when it first arrived.
		if (msg.platform_message_id && !msg.event_id) {
			await this.store.putMapping(account, msg.id, msg.platform_message_id);
		}
		this.safety.recordInbound(account, msg.from?.user_id, msg.address.conversation_id);
		if (msg.content.type === 'reaction') this.emit('reaction', msg);
		else this.emit('message', msg);
	}

	// --- capabilities ---------------------------------------------------------

	/** The capability descriptor for a platform, if an adapter is registered. */
	capabilities(platform: PlatformId): CapabilityDescriptor | undefined {
		return this.capabilities_.get(platform);
	}

	/** The registered adapter for an account, if any. */
	adapterFor(platform: PlatformId, account: string): Adapter | undefined {
		return this.registrations.get(accountKey(platform, account))?.adapter;
	}

	// --- lifecycle ------------------------------------------------------------

	/** Start every persistent adapter. Per-account failures are isolated. */
	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;
		for (const reg of this.registrations.values()) {
			if (!reg.adapter.start) continue;
			try {
				reg.connection = await reg.adapter.start(reg.context);
				this.logger.info('Adapter started', { platform: reg.adapter.platform, account: reg.adapter.account });
			} catch (error) {
				this.reportError(reg.adapter, error as Error);
			}
		}
	}

	/** Drain the outbound queue, stop connections, and close the store. */
	async stop(): Promise<void> {
		await this.queue.drain();
		for (const reg of this.registrations.values()) {
			try {
				await reg.connection?.stop();
				await reg.adapter.stop?.();
			} catch (error) {
				this.reportError(reg.adapter, error as Error);
			}
		}
		await this.store.close();
		this.started = false;
	}

	// --- outbound -------------------------------------------------------------

	/**
	 * Send a message. Validates the payload, gates it against the platform's
	 * capabilities (unless a `platform_meta` passthrough is present for that
	 * platform), enforces idempotency, and dispatches in order per account.
	 */
	async send(input: OutboundMessage): Promise<SendResult> {
		const msg = outboundMessageSchema.parse(input);
		const { platform, account } = msg.to;
		const reg = this.registrations.get(accountKey(platform, account));
		if (!reg) {
			const known = [...this.registrations.keys()].join(', ') || '(none)';
			throw new Error(`No adapter registered for ${accountKey(platform, account)}. Registered: ${known}.`);
		}

		const descriptor = reg.adapter.capabilities();
		const hasPassthrough = msg.platform_meta?.[platform] !== undefined;
		if (!hasPassthrough) assertSupported(descriptor, msg.content);

		// Idempotency: replay a prior result for the same key instead of re-sending.
		const idemKey = msg.idempotency_key ? `out|${accountKey(platform, account)}|${msg.idempotency_key}` : null;
		if (idemKey) {
			const prior = await this.store.kvGet('idempotency', idemKey);
			if (prior) return JSON.parse(prior) as SendResult;
		}

		const result = await this.queue.run(
			accountKey(platform, account),
			() => reg.adapter.send(msg, reg.context),
			{ rate: RATE_LIMITS[platform] }
		);

		if (result.platform_message_id) {
			await this.store.putMapping(account, result.id, result.platform_message_id);
		}
		if (idemKey) await this.store.kvSet('idempotency', idemKey, JSON.stringify(result));
		return result;
	}

	private require(addr: Pick<Address, 'platform' | 'account'>): Registration {
		const reg = this.registrations.get(addressAccountKey(addr));
		if (!reg) throw new Error(`No adapter registered for ${addressAccountKey(addr)}.`);
		return reg;
	}

	/** Edit a previously sent message. Requires the platform's `edit` capability. */
	async edit(target: EditTarget): Promise<SendResult> {
		const reg = this.require(target.address);
		if (!reg.adapter.edit || !reg.adapter.capabilities().supports.edit) {
			throw new CapabilityError(target.address.platform, 'editing messages');
		}
		const key = addressAccountKey(target.address);
		const result = await this.queue.run(key, () => reg.adapter.edit!(target, reg.context), { rate: RATE_LIMITS[target.address.platform] });
		if (result.platform_message_id) await this.store.putMapping(target.address.account, result.id, result.platform_message_id);
		return result;
	}

	/** Delete / revoke a previously sent message, if the adapter supports it. */
	async deleteMessage(target: MessageTarget): Promise<void> {
		const reg = this.require(target.address);
		if (!reg.adapter.deleteMessage) {
			throw new Error(`Adapter for ${addressAccountKey(target.address)} does not support deleting messages.`);
		}
		const key = addressAccountKey(target.address);
		await this.queue.run(key, () => reg.adapter.deleteMessage!(target, reg.context), { rate: RATE_LIMITS[target.address.platform] });
	}

	/** Best-effort "mark as read" for an inbound message (never throws). */
	async markRead(target: MessageTarget): Promise<void> {
		const reg = this.registrations.get(addressAccountKey(target.address));
		if (!reg?.adapter.markRead) return;
		try {
			await reg.adapter.markRead(target, reg.context);
		} catch (error) {
			this.logger.debug('markRead failed (best-effort)', { error: String(error) });
		}
	}

	/** Best-effort typing/presence indicator (capability-gated, never throws). */
	async setTyping(platform: PlatformId, account: string, conversationId: string, on: boolean): Promise<void> {
		const reg = this.registrations.get(accountKey(platform, account));
		if (!reg?.adapter.setTyping) return;
		if (!reg.adapter.capabilities().supports.typing) return;
		try {
			await reg.adapter.setTyping({ platform, account, conversation_id: conversationId }, on, reg.context);
		} catch (error) {
			this.logger.debug('setTyping failed (best-effort)', { platform, account, error: String(error) });
		}
	}

	/**
	 * Verify and normalise a single inbound webhook request for a webhook adapter,
	 * routing the result through the same dedup/emit pipeline. Returns the message
	 * (or `null` for handshakes / non-message events). Throws if verification fails.
	 */
	async receive(platform: PlatformId, account: string, request: InboundRequest): Promise<UniversalMessage | null> {
		const reg = this.registrations.get(accountKey(platform, account));
		if (!reg) throw new Error(`No adapter registered for ${accountKey(platform, account)}.`);
		const { adapter, context } = reg;
		if (!adapter.handleInbound) {
			throw new Error(`Adapter ${accountKey(platform, account)} is not a webhook adapter.`);
		}
		if (adapter.verifyInbound && !adapter.verifyInbound(request)) {
			throw new Error(
				`Inbound verification failed for ${accountKey(platform, account)}. ` +
					'Check the secret/signature configured on the adapter (an adapter with no secret rejects webhooks unless `allowUnverified` is set).'
			);
		}
		const msg = await adapter.handleInbound(request, context);
		if (msg) await this.emitInbound(msg);
		return msg;
	}

	/** Outbound dispatcher stats (for diagnostics/backpressure). */
	pending(): number {
		return this.queue.totalPending();
	}

	/**
	 * Connection-health snapshots for every persistent adapter that reports one,
	 * optionally filtered by platform/account. For WhatsApp the safety snapshot
	 * (reply ratio, warming, halted, daily count) is attached. Intended for a
	 * `/health` endpoint or a monitoring loop — the raw signal behind "is my
	 * gateway actually up, and is any number at risk?".
	 */
	health(platform?: PlatformId, account?: string): AccountHealth[] {
		const out: AccountHealth[] = [];
		for (const reg of this.registrations.values()) {
			if (platform && reg.adapter.platform !== platform) continue;
			if (account && reg.adapter.account !== account) continue;
			if (!reg.adapter.health) continue;
			const snapshot = reg.adapter.health();
			out.push(
				reg.adapter.platform === 'whatsapp_baileys'
					? { ...snapshot, safety: this.safety.stats(reg.adapter.account) }
					: snapshot
			);
		}
		return out;
	}

	/**
	 * Manually re-arm a connection that has terminally stopped (e.g. a WhatsApp
	 * number that was logged out or hit a pairing rate-limit). Returns `true` if a
	 * resume was triggered. Call after fixing the root cause — re-pairing, or waiting
	 * out a `405`. Returns `false` if no adapter is registered or none needs resuming.
	 */
	reconnect(platform: PlatformId, account: string): boolean {
		const reg = this.registrations.get(accountKey(platform, account));
		return reg?.adapter.reconnect?.() ?? false;
	}
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

function isController(value: unknown): value is SafetyController {
	return typeof value === 'object' && value !== null && typeof (value as SafetyController).gate === 'function';
}
