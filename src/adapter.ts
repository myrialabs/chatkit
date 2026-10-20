/**
 * The uniform adapter contract. Every platform implements {@link Adapter}; the
 * two WhatsApp paths additionally share {@link WhatsAppAdapter} so Baileys and
 * the Cloud API can be swapped per-account without touching the schema. The two
 * connection classes map onto the optional
 * `start()` (persistent) and `handleInbound()` (webhook) methods.
 */

import type { Logger } from './logger.js';
import type {
	Address,
	CapabilityDescriptor,
	OutboundContent,
	OutboundMessage,
	PlatformId,
	SendResult,
	SendStatus,
	UniversalMessage
} from './schema.js';
import type { StateStore } from './store/index.js';
import type { MediaProxy } from './media/index.js';
import type { SafetyController } from './safety/index.js';

/** A framework-agnostic inbound HTTP request, for webhook adapters. */
export interface InboundRequest {
	method?: string;
	headers: Record<string, string>;
	/** Raw, unparsed body bytes/string — required for signature verification. */
	body: string | Uint8Array;
	/** Parsed query string params (e.g. Cloud API verification handshake). */
	query?: Record<string, string>;
}

/** A status transition for an outbound (or known) message. */
export interface StatusUpdate {
	id?: string;
	platform_message_id: string;
	status: SendStatus;
	address: Address;
	timestamp: string;
	raw?: unknown;
}

/** A connection lifecycle transition for a persistent adapter. */
export interface ConnectionUpdate {
	platform: PlatformId;
	account: string;
	state: 'connecting' | 'qr' | 'authenticated' | 'open' | 'closed';
	/** QR string when `state === 'qr'` (pair by scanning). */
	qr?: string;
	/** Human-readable detail (e.g. disconnect reason). */
	detail?: string;
	timestamp: string;
}

/**
 * An adapter's own HTTP answer to a webhook request, for platforms that need one
 * beyond a bare 200 (Discord's PING and interaction acks). Optional hook:
 * `webhookReply(req)` on a webhook adapter.
 */
export interface WebhookReply {
	status: number;
	body: string;
	contentType?: string;
	/** Also run the request through `chat.receive()` (it carries a message). */
	deliver?: boolean;
}

/** A point-in-time connection-health snapshot for a persistent adapter. */
export interface ConnectionHealth {
	platform: PlatformId;
	account: string;
	state: 'connecting' | 'open' | 'closed';
	/** ISO timestamp the current connection opened, or `null` when not open. */
	connectedSince: string | null;
	/** ISO timestamp of the most recent successful open, or `null` if never. */
	lastConnectedAt: string | null;
	/** Reconnect attempts since the adapter last started. */
	reconnects: number;
	/** True once the adapter has permanently given up (needs `reconnect()`). */
	terminal: boolean;
}

/** A presence / typing signal for a conversation or participant. */
export interface PresenceUpdate {
	platform: PlatformId;
	account: string;
	conversation_id: string;
	user_id?: string;
	state: 'typing' | 'recording' | 'online' | 'offline' | 'paused';
	timestamp: string;
}

/** Identifies a specific delivered message for edit/delete/read. */
export interface MessageTarget {
	address: Address;
	/** Native id of the message to act on. */
	platform_message_id: string;
}

/** An edit request: a target plus the replacement content. */
export interface EditTarget extends MessageTarget {
	content: OutboundContent;
}

/** Sink for adapter-originated events, injected by `ChatKit` via the context. */
export interface AdapterEvents {
	/** Emit a normalised inbound message. */
	message(msg: UniversalMessage): void;
	/** Emit a delivery/read status transition. */
	status(update: StatusUpdate): void;
	/** Emit a reaction event (also surfaced via `message` when appropriate). */
	reaction(msg: UniversalMessage): void;
	/** Emit a connection lifecycle change (persistent adapters). */
	connection(update: ConnectionUpdate): void;
	/** Emit a presence / typing signal. */
	presence(update: PresenceUpdate): void;
	/** Report a non-fatal adapter error (isolated per account). */
	error(error: Error): void;
}

/** Everything an adapter needs, injected by `ChatKit` at registration. */
export interface AdapterContext {
	readonly store: StateStore;
	readonly media: MediaProxy;
	readonly logger: Logger;
	/** Baileys safety layer (throttle/jitter/warming/opt-in). WhatsApp only. */
	readonly safety: SafetyController;
	readonly events: AdapterEvents;
}

/** A handle to a live persistent connection (Baileys / Discord / Slack Socket). */
export interface Connection {
	readonly platform: PlatformId;
	readonly account: string;
	/** Current connection state. */
	status(): 'connecting' | 'open' | 'closed';
	/** Tear the connection down gracefully. */
	stop(): Promise<void>;
}

export interface Adapter {
	readonly platform: PlatformId;
	/** The consumer-owned credential instance this adapter drives. */
	readonly account: string;

	/** What this platform can do — gates `send()`. */
	capabilities(): CapabilityDescriptor;

	/**
	 * Persistent adapters hold a live socket here and push inbound events through
	 * `ctx.events`. Returns a handle used by `chat.stop()` to drain.
	 */
	start?(ctx: AdapterContext): Promise<Connection>;

	/**
	 * Webhook adapters normalise a single inbound HTTP request into a message
	 * (or `null` for handshakes / non-message events). Verify first.
	 */
	handleInbound?(req: InboundRequest, ctx: AdapterContext): Promise<UniversalMessage | null>;

	/** Pure inbound verification (signature / secret token). */
	verifyInbound?(req: InboundRequest): boolean;

	/** Send an outbound message; honours `platform_meta` passthrough. */
	send(msg: OutboundMessage, ctx: AdapterContext): Promise<SendResult>;

	/** Best-effort typing/presence indicator (capability-gated). */
	setTyping?(address: Address, on: boolean, ctx: AdapterContext): Promise<void>;

	/** Edit a previously sent message (capability-gated by `edit`). */
	edit?(target: EditTarget, ctx: AdapterContext): Promise<SendResult>;

	/** Delete / revoke a previously sent message. */
	deleteMessage?(target: MessageTarget, ctx: AdapterContext): Promise<void>;

	/** Mark an inbound message (and prior) as read. Best-effort, never throws upstream. */
	markRead?(target: MessageTarget, ctx: AdapterContext): Promise<void>;

	/**
	 * Purge any persistent, adapter-owned state for this account (e.g. Baileys auth
	 * keys) when the account is removed — so a re-add starts fresh. Best-effort.
	 */
	dispose?(ctx: AdapterContext): Promise<void>;

	/** Graceful teardown of any adapter-owned resources. */
	stop?(): Promise<void>;

	/** A connection-health snapshot (persistent adapters), for monitoring. */
	health?(): ConnectionHealth;

	/**
	 * Re-arm the connection after a *terminal* stop (e.g. logged out, forbidden, or
	 * the pre-pair failure cap). Returns `true` if a resume was triggered. Persistent
	 * adapters only; a no-op / absent elsewhere.
	 */
	reconnect?(): boolean;
}

/**
 * Shared interface for the two WhatsApp adapters. Identical to {@link Adapter}
 * but pinned to a WhatsApp platform id, which lets a consumer keep one variable
 * typed as `WhatsAppAdapter` and swap Baileys ↔ Cloud underneath.
 */
export interface WhatsAppAdapter extends Adapter {
	readonly platform: 'whatsapp_baileys' | 'whatsapp_cloud';
}
