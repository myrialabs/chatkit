/**
 * Shared zod schemas and the TypeScript types inferred from them. This module is
 * the single source of truth for ChatKit's universal message contract: the
 * envelope, addressing, content types, capability descriptor and the outbound
 * message shape. Every other module imports its types from here so validation
 * and types never drift apart.
 *
 * Field naming follows the universal schema:
 * the envelope is a cross-platform *data contract*, so its fields are
 * `snake_case` (wire-like) on purpose. Library option objects elsewhere use
 * `camelCase` per the kit style guide.
 */

import { z } from 'zod';

/**
 * The platforms ChatKit can speak. Baileys and Cloud API are distinct platforms
 * because their behaviour and capabilities genuinely differ.
 */
export const PLATFORM_IDS = [
	'telegram',
	'whatsapp_baileys',
	'whatsapp_cloud',
	'discord',
	'slack'
] as const;

export const platformIdSchema = z.enum(PLATFORM_IDS);
export type PlatformId = z.infer<typeof platformIdSchema>;

/** Media kinds in the universal core (intersection across platforms). */
export const MEDIA_TYPES = ['image', 'video', 'audio', 'voice', 'document', 'sticker'] as const;
export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const directionSchema = z.enum(['inbound', 'outbound']);
export type Direction = z.infer<typeof directionSchema>;

/** Universal delivery status. Only `accepted`/`sent` are promised everywhere. */
export const sendStatusSchema = z.enum(['accepted', 'sent', 'delivered', 'read', 'failed']);
export type SendStatus = z.infer<typeof sendStatusSchema>;

// ---------------------------------------------------------------------------
// Addressing — the three-layer model.
// ---------------------------------------------------------------------------

/**
 * A conversation address: `(platform, account, conversation_id[, thread_id])`.
 * `conversation_id` is the *native* id (JID / chat_id / channel_id) kept verbatim
 * so replies are reversible — never normalised or hashed.
 */
export const addressSchema = z.object({
	platform: platformIdSchema,
	/** The consumer-owned credential instance that owns this connection. */
	account: z.string().min(1),
	/** Native conversation id, kept as-is. */
	conversation_id: z.string().min(1),
	/** Slack `thread_ts` / Discord thread. Null where the platform has no threads. */
	thread_id: z.string().nullable().optional()
});
export type Address = z.infer<typeof addressSchema>;

/** An individual sender/recipient. Native ids, best-effort display name. */
export const participantSchema = z.object({
	platform: platformIdSchema,
	account: z.string().min(1),
	user_id: z.string(),
	display_name: z.string().nullable().optional(),
	/** True when this participant is the library's own account. */
	is_self: z.boolean().optional()
});
export type Participant = z.infer<typeof participantSchema>;

// ---------------------------------------------------------------------------
// Content types — the safe intersection ("core").
// ---------------------------------------------------------------------------

/**
 * A universal *mention* target. The `id` is the platform-native user identifier
 * (Telegram numeric id, Slack `U…`, Discord snowflake, WhatsApp phone/JID) — it is
 * deliberately not portable across platforms, but a single run shape lets a
 * handler build "@someone" once and each adapter render it natively (or degrade to
 * `display` text where the platform can't mention inside free-form text).
 */
export const mentionSchema = z.object({
	id: z.string(),
	display: z.string().optional()
});
export type Mention = z.infer<typeof mentionSchema>;

/**
 * One styled span of text. Rich text is modelled as an ordered array of runs
 * (not offset entities) so it is trivial to build programmatically and safe under
 * Unicode. Every mark is optional and best-effort: an adapter drops the marks its
 * platform can't render and keeps the text. See `src/format.ts` for the per-platform
 * support matrix and rendering.
 */
export const textRunSchema = z.object({
	text: z.string(),
	bold: z.boolean().optional(),
	italic: z.boolean().optional(),
	strike: z.boolean().optional(),
	underline: z.boolean().optional(),
	/** Inline monospace. */
	code: z.boolean().optional(),
	/** Fenced code block (rendered as `pre`/```…``` where supported). */
	pre: z.boolean().optional(),
	/** Language of a `pre` block (`ts`, `python`…), for platforms that highlight it. */
	language: z.string().optional(),
	/**
	 * Part of a quotation. Consecutive quoted runs form ONE quote — a quote that
	 * contains a bold word is three runs, and rendering each as its own quote
	 * would split it into three.
	 */
	blockquote: z.boolean().optional(),
	spoiler: z.boolean().optional(),
	/** Hyperlink URL; the run's `text` is the visible label. */
	link: z.string().optional(),
	/** Mention target; `text` (or `mention.display`) is the visible label. */
	mention: mentionSchema.optional()
});
export type TextRun = z.infer<typeof textRunSchema>;

export const textContentSchema = z.object({
	type: z.literal('text'),
	/** Canonical plain text — always present (used for dedup, storage, fallback). */
	text: z.string(),
	/** Optional styled representation. When set, adapters render it to native markup. */
	rich: z.array(textRunSchema).optional()
});

/**
 * Inbound/normalised media. `url` points at a stable, proxied handle served by
 * the consumer's `MediaStore` (native platform URLs are often TTL'd / auth'd).
 */
export const mediaContentSchema = z.object({
	type: z.literal('media'),
	media_type: mediaTypeSchema,
	url: z.string().optional(),
	mime: z.string().optional(),
	caption: z.string().optional(),
	/** Optional styled caption; rendered like {@link textRunSchema}. */
	caption_rich: z.array(textRunSchema).optional(),
	filename: z.string().optional(),
	size_bytes: z.number().int().nonnegative().optional()
});

export const locationContentSchema = z.object({
	type: z.literal('location'),
	lat: z.number(),
	lng: z.number(),
	name: z.string().optional()
});

export const contactContentSchema = z.object({
	type: z.literal('contact'),
	name: z.string(),
	phone: z.string()
});

export const reactionContentSchema = z.object({
	type: z.literal('reaction'),
	emoji: z.string(),
	target_message_id: z.string()
});

/** Pure escape hatch: the real payload lives in `platform_meta.<platform>`. */
export const passthroughContentSchema = z.object({
	type: z.literal('passthrough')
});

/**
 * An inbound interaction callback: a button press or list selection. The universal
 * shape is intentionally small — a developer-defined `data` payload plus the visible
 * `title` — so every platform's interactive replies normalise to one thing. Outbound
 * rich controls are built with the per-platform typed helpers (`/interactive`).
 */
export const postbackContentSchema = z.object({
	type: z.literal('postback'),
	data: z.string(),
	title: z.string().optional()
});

export const contentSchema = z.discriminatedUnion('type', [
	textContentSchema,
	mediaContentSchema,
	locationContentSchema,
	contactContentSchema,
	reactionContentSchema,
	passthroughContentSchema,
	postbackContentSchema
]);
export type MessageContent = z.infer<typeof contentSchema>;

export const reactionSchema = z.object({
	emoji: z.string(),
	from: participantSchema.optional()
});
export type Reaction = z.infer<typeof reactionSchema>;

// ---------------------------------------------------------------------------
// Universal message envelope.
// ---------------------------------------------------------------------------

export const universalMessageSchema = z.object({
	/** Canonical ChatKit id (used for idempotency). */
	id: z.string(),
	/** Native platform id (for reply / edit / status correlation). */
	platform_message_id: z.string().nullable().optional(),
	/**
	 * Native id of the inbound EVENT, when it differs from the message it concerns —
	 * a button press, an edit or a reaction all point at an existing message, so
	 * `platform_message_id` alone cannot tell two of them apart. Dedup keys on this
	 * when present.
	 */
	event_id: z.string().nullable().optional(),
	direction: directionSchema,
	address: addressSchema,
	from: participantSchema.optional(),
	to: participantSchema.optional(),
	timestamp: z.string(),
	content: contentSchema,
	reply_to: z.string().nullable().optional(),
	/**
	 * The sender edited an earlier message: `platform_message_id` is that
	 * message and `content` its new content. Without this a consumer cannot
	 * tell an edit from a new message carrying the same id.
	 */
	edited: z.boolean().optional(),
	reactions: z.array(reactionSchema).optional(),
	/** Passthrough: per-platform native payloads. Not promised portable. */
	platform_meta: z.record(z.string(), z.unknown()).optional(),
	/** Original platform payload, for debug / advanced consumers. */
	raw: z.unknown().optional()
});
export type UniversalMessage = z.infer<typeof universalMessageSchema>;

// ---------------------------------------------------------------------------
// Outbound — what a consumer hands to `chat.send()`.
// ---------------------------------------------------------------------------

/**
 * Outbound media accepts a stable URL *or* raw bytes; the adapter re-uploads per
 * platform (e.g. `media_id` for WA Cloud, multipart for Slack).
 */
export const outboundMediaContentSchema = z.object({
	type: z.literal('media'),
	media_type: mediaTypeSchema,
	url: z.string().optional(),
	// `z.custom` (not `z.instanceof`) keeps the inferred type as a plain
	// `Uint8Array` rather than the runtime-narrowed `Uint8Array<ArrayBuffer>`.
	data: z.custom<Uint8Array>((val) => val instanceof Uint8Array).optional(),
	mime: z.string().optional(),
	caption: z.string().optional(),
	/** Optional styled caption; rendered like {@link textRunSchema}. */
	caption_rich: z.array(textRunSchema).optional(),
	filename: z.string().optional()
});

export const outboundContentSchema = z.discriminatedUnion('type', [
	textContentSchema,
	outboundMediaContentSchema,
	locationContentSchema,
	contactContentSchema,
	reactionContentSchema,
	passthroughContentSchema
]);
export type OutboundContent = z.infer<typeof outboundContentSchema>;

export const outboundMessageSchema = z.object({
	to: addressSchema,
	content: outboundContentSchema,
	/** Native message id to reply/quote. */
	reply_to: z.string().nullable().optional(),
	/** Per-platform native payloads; wins over core content for that platform. */
	platform_meta: z.record(z.string(), z.unknown()).optional(),
	/** Optional consumer-supplied idempotency key for the outbound dispatcher. */
	idempotency_key: z.string().optional()
});
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

export const sendResultSchema = z.object({
	id: z.string(),
	platform_message_id: z.string().nullable(),
	status: sendStatusSchema,
	timestamp: z.string(),
	raw: z.unknown().optional()
});
export type SendResult = z.infer<typeof sendResultSchema>;

// ---------------------------------------------------------------------------
// Capability descriptor.
// ---------------------------------------------------------------------------

export const capabilitySupportSchema = z.object({
	delivery_receipt: z.boolean(),
	read_receipt: z.boolean(),
	reactions: z.boolean(),
	threads: z.boolean(),
	buttons: z.boolean(),
	typing: z.boolean(),
	rich_layout: z.boolean(),
	templates: z.boolean(),
	edit: z.boolean(),
	location: z.boolean(),
	contact: z.boolean(),
	media: z.array(mediaTypeSchema)
});
export type CapabilitySupport = z.infer<typeof capabilitySupportSchema>;

export const capabilityDescriptorSchema = z.object({
	platform: platformIdSchema,
	supports: capabilitySupportSchema
});
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;
