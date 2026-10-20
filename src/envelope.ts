/**
 * The universal message envelope: construction helpers, content builders and a
 * reversible native-reference codec. Adapters call {@link inbound} to normalise
 * platform events into a validated {@link UniversalMessage}; consumers use the
 * content builders ({@link text}, {@link media}, …) when calling `chat.send()`.
 */

import {
	universalMessageSchema,
	type Address,
	type MediaType,
	type MessageContent,
	type OutboundContent,
	type OutboundMessage,
	type Participant,
	type PlatformId,
	type Reaction,
	type TextRun,
	type UniversalMessage
} from './schema.js';
import { plainText } from './format.js';

export type { UniversalMessage } from './schema.js';

/** Generate a canonical ChatKit id (used for idempotency). Cross-runtime. */
export function newId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	// Fallback for older Node without a global WebCrypto.
	return 'ck_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
}

/**
 * A stable dedup/idempotency key for an inbound platform event. The platform may
 * redeliver the same message; keying on `(platform, account, conversation, id)`
 * lets the `StateStore` reject duplicates. Pass the conversation whenever native
 * ids are only unique per chat (Telegram's `message_id` is) — without it, message
 * #50 from one user would drop message #50 from another.
 */
export function messageKey(platform: PlatformId, account: string, platformMessageId: string, conversationId?: string): string {
	return conversationId != null
		? `${platform}|${account}|${conversationId}|${platformMessageId}`
		: `${platform}|${account}|${platformMessageId}`;
}

/**
 * The dedup key for an inbound message: its event id when the adapter supplied
 * one (a button press or an edit of an existing message), otherwise its native
 * message id scoped to the conversation. `null` when it carries neither.
 */
export function inboundKey(msg: UniversalMessage): string | null {
	const { platform, account, conversation_id } = msg.address;
	if (msg.event_id) return messageKey(platform, account, `event:${msg.event_id}`);
	if (msg.platform_message_id) return messageKey(platform, account, msg.platform_message_id, conversation_id);
	return null;
}

/**
 * A reversible token that packs a native message reference into one opaque
 * string and back. Useful for passing a reply target around as a single value.
 * Reversible by construction — nothing is hashed or normalised.
 */
export interface NativeRef {
	platform: PlatformId;
	account: string;
	conversation_id: string;
	message_id: string;
}

export function encodeRef(ref: NativeRef): string {
	const json = JSON.stringify([ref.platform, ref.account, ref.conversation_id, ref.message_id]);
	// base64url so the token is URL- and header-safe.
	return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeRef(token: string): NativeRef {
	const json = Buffer.from(token, 'base64url').toString('utf8');
	const [platform, account, conversation_id, message_id] = JSON.parse(json) as [
		PlatformId,
		string,
		string,
		string
	];
	return { platform, account, conversation_id, message_id };
}

// --- content builders -------------------------------------------------------

export function text(body: string): OutboundContent {
	return { type: 'text', text: body };
}

/**
 * Build a formatted text message from an array of {@link TextRun}. The plain `text`
 * is derived by concatenation (so dedup/storage/fallback still work), and `rich`
 * carries the styling for adapters to render natively. Compose runs with the {@link rt}
 * helpers:
 *
 * ```ts
 * chat.send({ to, content: richText([rt.plain('Order '), rt.bold('#42'), rt.plain(' shipped ✅')]) });
 * ```
 */
export function richText(runs: TextRun[]): OutboundContent {
	return { type: 'text', text: plainText(runs), rich: runs };
}

/**
 * Small constructors for {@link TextRun}s. Each returns a single styled run; combine
 * marks by hand-writing a run (`{ text: 'x', bold: true, italic: true }`) when you
 * need more than one. `link`/`mention` carry their target alongside the visible label.
 */
export const rt = {
	plain: (text: string): TextRun => ({ text }),
	bold: (text: string): TextRun => ({ text, bold: true }),
	italic: (text: string): TextRun => ({ text, italic: true }),
	strike: (text: string): TextRun => ({ text, strike: true }),
	underline: (text: string): TextRun => ({ text, underline: true }),
	code: (text: string): TextRun => ({ text, code: true }),
	pre: (text: string): TextRun => ({ text, pre: true }),
	spoiler: (text: string): TextRun => ({ text, spoiler: true }),
	link: (text: string, url: string): TextRun => ({ text, link: url }),
	mention: (id: string, display?: string): TextRun => ({ text: display ?? id, mention: { id, display } })
};

export function media(input: {
	mediaType: MediaType;
	url?: string;
	data?: Uint8Array;
	mime?: string;
	caption?: string;
	filename?: string;
}): OutboundContent {
	return {
		type: 'media',
		media_type: input.mediaType,
		url: input.url,
		data: input.data,
		mime: input.mime,
		caption: input.caption,
		filename: input.filename
	};
}

export function location(lat: number, lng: number, name?: string): OutboundContent {
	return { type: 'location', lat, lng, name };
}

export function contact(name: string, phone: string): OutboundContent {
	return { type: 'contact', name, phone };
}

export function reaction(emoji: string, targetMessageId: string): OutboundContent {
	return { type: 'reaction', emoji, target_message_id: targetMessageId };
}

/** A passthrough message — the real payload lives in `platform_meta.<platform>`. */
export function passthrough(): OutboundContent {
	return { type: 'passthrough' };
}

/**
 * Build an {@link OutboundMessage} that replies to an inbound message: same
 * conversation, quoting the original native id. Saves the recurring
 * `{ to: m.address, content, reply_to: m.platform_message_id ?? undefined }`.
 *
 * ```ts
 * chat.on('message', (m) => {
 *   if (m.content.type === 'text') chat.send(reply(m, text(`echo: ${m.content.text}`)));
 * });
 * ```
 */
export function reply(
	message: UniversalMessage,
	content: OutboundContent,
	options?: { idempotencyKey?: string; platformMeta?: Record<string, unknown> }
): OutboundMessage {
	return {
		to: message.address,
		content,
		reply_to: message.platform_message_id ?? undefined,
		platform_meta: options?.platformMeta,
		idempotency_key: options?.idempotencyKey
	};
}

// --- envelope construction --------------------------------------------------

export interface InboundInit {
	platformMessageId?: string | null;
	/** Native id of the event itself, when it is not a new message. See {@link UniversalMessage.event_id}. */
	eventId?: string | null;
	/** The sender edited an earlier message. See {@link UniversalMessage.edited}. */
	edited?: boolean;
	address: Address;
	from?: Participant;
	to?: Participant;
	timestamp?: string | Date;
	content: MessageContent;
	replyTo?: string | null;
	reactions?: Reaction[];
	platformMeta?: Record<string, unknown>;
	raw?: unknown;
	/** Override the generated ChatKit id (e.g. derive from a dedup key). */
	id?: string;
}

/** Normalise a platform event into a validated inbound {@link UniversalMessage}. */
export function inbound(init: InboundInit): UniversalMessage {
	const ts =
		init.timestamp instanceof Date
			? init.timestamp.toISOString()
			: (init.timestamp ?? new Date().toISOString());
	return universalMessageSchema.parse({
		id: init.id ?? newId(),
		platform_message_id: init.platformMessageId ?? null,
		...(init.eventId ? { event_id: init.eventId } : {}),
		...(init.edited ? { edited: true } : {}),
		direction: 'inbound',
		address: init.address,
		from: init.from,
		to: init.to,
		timestamp: ts,
		content: init.content,
		reply_to: init.replyTo ?? null,
		reactions: init.reactions,
		platform_meta: init.platformMeta,
		raw: init.raw
	});
}

/** Validate an arbitrary value as a {@link UniversalMessage}. Throws on mismatch. */
export function parseMessage(value: unknown): UniversalMessage {
	return universalMessageSchema.parse(value);
}
