/**
 * The bridge between ChatKit's live event stream and the app's history store.
 * Every inbound message / reaction / status transition becomes a persisted row
 * and an SSE broadcast. This is exactly the boilerplate a real inbox has to
 * write today — a good candidate for an optional `ConversationRecorder` helper
 * in ChatKit itself.
 */

import { conversationKey, type UniversalMessage } from '@myrialabs/chatkit';
import type { StatusUpdate, ConnectionUpdate, PresenceUpdate } from '@myrialabs/chatkit';
import type { ChatKit } from '@myrialabs/chatkit';
import { InboxDb, type MessageRow } from './db';
import { broadcast } from './events';
import { setStatus } from './status';

/** A short, human-readable preview for the conversation list. */
function preview(m: UniversalMessage): string {
	switch (m.content.type) {
		case 'text':
			return m.content.text.slice(0, 120);
		case 'media':
			return `📎 ${m.content.media_type}${m.content.caption ? ` · ${m.content.caption}` : ''}`;
		case 'location':
			return '📍 location';
		case 'contact':
			return `👤 ${m.content.name}`;
		case 'reaction':
			return `${m.content.emoji} reacted`;
		case 'postback':
			return `↳ ${m.content.title ?? m.content.data}`;
		default:
			return '…';
	}
}

/** Structured rich payload we persist as JSON so it re-renders after a reload. */
function richMeta(m: UniversalMessage): string | null {
	const c = m.content;
	if (c.type === 'location') return JSON.stringify({ kind: 'location', lat: c.lat, lng: c.lng, name: c.name ?? null });
	if (c.type === 'contact') return JSON.stringify({ kind: 'contact', name: c.name, phone: c.phone });
	// Formatted inbound text (e.g. Telegram entities) round-trips as universal runs.
	if (c.type === 'text' && c.rich) return JSON.stringify({ kind: 'runs', runs: c.rich });
	if (c.type === 'media' && c.caption_rich) return JSON.stringify({ kind: 'runs', runs: c.caption_rich });
	return null;
}

/** Flatten a universal message into the app's row shape. */
export function toRow(m: UniversalMessage, conversationId: string): MessageRow {
	const c = m.content;
	return {
		id: m.id,
		conversation_id: conversationId,
		platform_message_id: m.platform_message_id ?? null,
		direction: m.direction,
		sender_name: m.from?.display_name ?? m.from?.user_id ?? null,
		content_type: c.type,
		text:
			c.type === 'text'
				? c.text
				: c.type === 'contact'
					? `${c.name} · ${c.phone}`
					: c.type === 'postback'
						? (c.title ?? c.data)
						: null,
		media_url: c.type === 'media' ? (c.url ?? null) : null,
		media_type: c.type === 'media' ? c.media_type : null,
		caption: c.type === 'media' ? (c.caption ?? null) : null,
		reply_to: m.reply_to ?? null,
		status: null,
		created_at: m.timestamp,
		meta: richMeta(m)
	};
}

function record(db: InboxDb, m: UniversalMessage, bumpUnread: boolean): void {
	const id = conversationKey(m.address);
	const conversation = db.upsertConversation({
		id,
		platform: m.address.platform,
		account: m.address.account,
		conversation_id: m.address.conversation_id,
		thread_id: m.address.thread_id ?? null,
		title: m.from?.display_name ?? m.from?.user_id ?? m.address.conversation_id,
		preview: preview(m),
		at: m.timestamp,
		bumpUnread
	});
	const message = toRow(m, id);
	db.insertMessage(message);
	broadcast('message', { conversation, message });
}

/**
 * Persist an outbound message the app just sent. `chat.send()` does not emit a
 * `message` event (it returns a `SendResult`), so the composer path records its
 * own row and broadcasts it, mirroring the inbound flow.
 */
export interface OutboundContent {
	content_type: string;
	text?: string | null;
	media_url?: string | null;
	media_type?: string | null;
	caption?: string | null;
	/** JSON blob of structured rich content (location, contact, interactive buttons). */
	meta?: string | null;
	preview: string;
}

export function recordOutbound(
	db: InboxDb,
	conversation: { id: string; platform: string; account: string; conversation_id: string; thread_id: string | null; title?: string },
	out: OutboundContent,
	result: { id: string; platform_message_id: string | null; status: string; timestamp: string },
	replyTo: string | null
): MessageRow {
	const message: MessageRow = {
		id: result.id,
		conversation_id: conversation.id,
		platform_message_id: result.platform_message_id,
		direction: 'outbound',
		sender_name: 'You',
		content_type: out.content_type,
		text: out.text ?? null,
		media_url: out.media_url ?? null,
		media_type: out.media_type ?? null,
		caption: out.caption ?? null,
		reply_to: replyTo,
		status: result.status,
		created_at: result.timestamp,
		meta: out.meta ?? null
	};
	const conv = db.upsertConversation({
		id: conversation.id,
		platform: conversation.platform,
		account: conversation.account,
		conversation_id: conversation.conversation_id,
		thread_id: conversation.thread_id,
		title: conversation.title ?? '',
		preview: out.preview.slice(0, 120),
		at: result.timestamp,
		bumpUnread: false
	});
	db.insertMessage(message);
	broadcast('message', { conversation: conv, message });
	return message;
}

/**
 * On a Baileys personal account, anyone who has messaged you is someone you may
 * reply to freely — so we durably opt them in (ChatKit's safety layer otherwise
 * treats a non-reply send outside the 24h window as a cold, business-initiated
 * send and refuses it). This mirrors WhatsApp's own semantics for personal
 * accounts and is exactly what `store.setOptIn` is for.
 */
function optInFromInbound(chat: ChatKit, m: UniversalMessage): void {
	if (m.direction !== 'inbound' || m.address.platform !== 'whatsapp_baileys') return;
	void chat.store.setOptIn(m.address.account, m.address.conversation_id, true).catch(() => {});
}

/** Wire ChatKit's events into the history store + SSE hub. */
export function wireIngest(chat: ChatKit, db: InboxDb): void {
	chat.on('message', (m) => {
		record(db, m, m.direction === 'inbound');
		optInFromInbound(chat, m);
	});
	chat.on('reaction', (m) => record(db, m, false));
	chat.on('status', (s: StatusUpdate) => {
		const updated = db.updateStatusByPlatformId(s.platform_message_id, s.status);
		if (updated) broadcast('status', { message: updated });
	});
	chat.on('connection', (c: ConnectionUpdate) => {
		setStatus(c.platform, c.account, c.state);
		broadcast('connection', { platform: c.platform, account: c.account, state: c.state, detail: c.detail });
	});
	chat.on('presence', (p: PresenceUpdate) => {
		broadcast('presence', {
			conversationId: conversationKey({ platform: p.platform, account: p.account, conversation_id: p.conversation_id, thread_id: null }),
			user_id: p.user_id,
			state: p.state
		});
	});
	chat.on('error', (e) => console.error('[chatkit]', e.platform ?? '', e.error.message));
}
