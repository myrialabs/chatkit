/**
 * The inbox server: one Bun + Elysia process that runs ChatKit, persists history
 * to SQLite, and exposes a small REST + SSE API the Svelte client drives.
 * Channels are configured at runtime via /api/accounts (no `.env`); credentials
 * are encrypted at rest. In production it also serves the built client.
 *
 *   bun run dev     # this server (watch) + Vite dev client
 *   bun run start   # this server, serving the built client from dist/client
 */

import { Elysia } from 'elysia';
import {
	address,
	conversationKey,
	text,
	richText,
	plainText,
	media,
	reaction,
	location,
	contact,
	telegramButtons,
	telegramPoll,
	telegramDice,
	telegramVenue,
	slackButtons,
	slack,
	discordButtons,
	discordEmbeds,
	discordSelect,
	discordPoll,
	whatsappCloudButtons,
	whatsappCloudList,
	whatsappCloudCtaUrl,
	whatsappCloudTemplate,
	whatsappBaileysPoll,
	slackBlocks,
	type Button,
	type ListSection,
	type InteractiveFragment,
	type MediaType,
	type PlatformId,
	type TextRun
} from '@myrialabs/chatkit';
import { processWebhook } from '@myrialabs/chatkit/middleware';
import { createChat } from './chatkit';
import { loadSecrets } from './secrets';
import { InboxDb } from './db';
import { AccountManager } from './accounts';
import { PLATFORM_SPECS } from './adapters';
import { wireIngest, recordOutbound } from './ingest';
import { sseResponse } from './events';

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = 'dist/client';

function mediaKindFromMime(mime: string): MediaType {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/')) return 'video';
	if (mime.startsWith('audio/')) return 'audio';
	return 'document';
}

/**
 * Parse a lightweight markdown subset (`*bold*`, `_italic_`, `~strike~`, `` `code` ``,
 * `[label](url)`) into universal {@link TextRun}s. Returns `null` when there is no
 * markup, so the caller can send plain text. This is intentionally minimal — a demo
 * of how a UI can feed ChatKit's cross-platform formatting.
 */
function parseRuns(input: string): TextRun[] | null {
	const pattern = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))/g;
	const runs: TextRun[] = [];
	let last = 0;
	let match: RegExpExecArray | null;
	let found = false;
	while ((match = pattern.exec(input))) {
		if (match.index > last) runs.push({ text: input.slice(last, match.index) });
		const tok = match[0];
		if (tok.startsWith('*')) runs.push({ text: tok.slice(1, -1), bold: true });
		else if (tok.startsWith('_')) runs.push({ text: tok.slice(1, -1), italic: true });
		else if (tok.startsWith('~')) runs.push({ text: tok.slice(1, -1), strike: true });
		else if (tok.startsWith('`')) runs.push({ text: tok.slice(1, -1), code: true });
		else {
			const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
			if (link) runs.push({ text: link[1]!, link: link[2]! });
		}
		last = pattern.lastIndex;
		found = true;
	}
	if (!found) return null;
	if (last < input.length) runs.push({ text: input.slice(last) });
	return runs;
}

function destinationId(platform: PlatformId, input: string): string {
	const value = input.trim();
	if (!value) throw new Error('destination is required');
	if (platform === 'whatsapp_baileys') {
		if (value.includes('@')) return value;
		const digits = value.replace(/[^\d]/g, '');
		if (!digits) throw new Error('WhatsApp number must include country code digits');
		return `${digits}@s.whatsapp.net`;
	}
	if (platform === 'whatsapp_cloud') {
		const digits = value.replace(/[^\d]/g, '');
		if (!digits) throw new Error('WhatsApp Cloud recipient must include country code digits');
		return digits;
	}
	return value;
}

const { key, codec, generated } = loadSecrets();
const db = new InboxDb(process.env.INBOX_DB ?? 'inbox.db');

// A fresh master key + pre-existing channels means the old .inbox-key was lost:
// every saved channel is now undecryptable. Explain it once here; loadOnBoot then
// prunes the orphaned rows so the app comes up clean and you can re-add them.
if (generated && db.allAccounts().length > 0) {
	console.warn(
		'[secrets] a new master key was generated but saved channels already exist — the previous .inbox-key was ' +
			'lost, so those channels can no longer be decrypted and will be dropped. Re-add them from the UI.'
	);
}

const chat = createChat(key);
wireIngest(chat, db);

await chat.start();
const accounts = new AccountManager(chat, db, codec);
await accounts.loadOnBoot();

// Backfill WhatsApp opt-in from existing inbound history: peers who messaged this
// (personal, Baileys) account before the app restarted should still be replyable
// without quoting. New inbound messages keep this current via wireIngest.
for (const peer of db.inboundPeers('whatsapp_baileys')) {
	await chat.store.setOptIn(peer.account, peer.conversation_id, true).catch(() => {});
}

async function webhook(id: string, request: Request, body: string, query: Record<string, string>): Promise<Response> {
	const row = db.getAccount(id);
	if (!row) return new Response('not found', { status: 404 });
	const result = await processWebhook(
		{ chat, platform: row.platform as PlatformId, account: row.account },
		{ method: request.method, headers: Object.fromEntries(request.headers), body, query }
	);
	return new Response(result.body, {
		status: result.status,
		headers: result.contentType ? { 'content-type': result.contentType } : undefined
	});
}

const app = new Elysia()
	// Webhook adapters verify signatures over the *raw* body, so hand it through
	// unparsed. Every other route keeps Elysia's normal JSON parsing.
	.onParse(async ({ request }) => {
		const p = new URL(request.url).pathname;
		if (request.method !== 'GET' && p.startsWith('/webhook/')) return await request.text();
	})

	// --- channels (runtime config) -------------------------------------------
	.get('/api/platform-specs', () => Object.values(PLATFORM_SPECS))
	.get('/api/accounts', () => accounts.list())
	.post('/api/accounts', async ({ body, set }) => {
		try {
			return await accounts.add(body as Parameters<AccountManager['add']>[0]);
		} catch (error) {
			set.status = 400;
			return { error: error instanceof Error ? error.message : 'failed to add channel' };
		}
	})
	.delete('/api/accounts/:id', async ({ params }) => ({ ok: await accounts.remove(params.id) }))

	// --- conversations & messages --------------------------------------------
	.get('/api/conversations', () => db.listConversations())
	.get('/api/conversations/:id/messages', ({ params }) => db.listMessages(params.id))
	.post('/api/conversations/:id/read', ({ params }) => {
		db.markRead(params.id);
		const conv = db.getConversation(params.id);
		const last = db.lastInboundPlatformId(params.id);
		if (conv && last) {
			void chat
				.markRead({
					address: address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id }),
					platform_message_id: last
				})
				.catch(() => {});
		}
		return { ok: true };
	})
	.post('/api/send', async ({ body, set }) => {
		const { conversationId, text: message, replyTo } = body as { conversationId: string; text: string; replyTo?: string };
		const conv = db.getConversation(conversationId);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		if (!message?.trim()) {
			set.status = 400;
			return { error: 'empty message' };
		}
		const to = address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			// Lightweight markdown (*bold* _italic_ ~strike~ `code` [label](url)) → universal
			// rich runs, so the same message renders formatted on every platform. Falls back
			// to plain text when the draft contains no markers.
			const runs = parseRuns(message);
			const content = runs ? richText(runs) : text(message);
			const plain = runs ? plainText(runs) : message;
			const meta = runs ? JSON.stringify({ kind: 'runs', runs }) : null;
			const result = await chat.send({ to, content, reply_to: replyTo ?? undefined });
			return { message: recordOutbound(db, conv, { content_type: 'text', text: plain, meta, preview: plain }, result, replyTo ?? null) };
		} catch (error) {
			// Surface the real reason (e.g. a WhatsApp safety/opt-in refusal) instead of a 500.
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})
	.post('/api/conversations/start', async ({ body, set }) => {
		const { accountId, destination, title, text: message } = body as {
			accountId: string;
			destination: string;
			title?: string;
			text: string;
		};
		const row = db.getAccount(accountId);
		if (!row) {
			set.status = 404;
			return { error: 'unknown channel' };
		}
		if (!message?.trim()) {
			set.status = 400;
			return { error: 'empty message' };
		}
		let conversationId: string;
		try {
			conversationId = destinationId(row.platform as PlatformId, destination);
		} catch (error) {
			set.status = 400;
			return { error: error instanceof Error ? error.message : 'invalid destination' };
		}
		const to = address({ platform: row.platform as PlatformId, account: row.account, conversationId });
		const conversation = {
			id: conversationKey(to),
			platform: row.platform,
			account: row.account,
			conversation_id: to.conversation_id,
			thread_id: to.thread_id ?? null,
			title: title?.trim() || destination.trim()
		};
		try {
			const runs = parseRuns(message);
			const content = runs ? richText(runs) : text(message);
			const plain = runs ? plainText(runs) : message;
			const meta = runs ? JSON.stringify({ kind: 'runs', runs }) : null;
			const result = await chat.send({ to, content });
			const sent = recordOutbound(db, conversation, { content_type: 'text', text: plain, meta, preview: plain }, result, null);
			return { conversation: db.getConversation(conversation.id)!, message: sent };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})
	.post('/api/conversations/:id/media', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const file = (body as { file?: File }).file;
		const caption = (body as { caption?: string }).caption;
		if (!file) {
			set.status = 400;
			return { error: 'no file' };
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		const to = address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		const mediaType = mediaKindFromMime(file.type);
		try {
			const result = await chat.send({ to, content: media({ mediaType, data: bytes, mime: file.type, filename: file.name, caption }) });
			// Keep a servable copy so the sent media renders in our own UI.
			const stored = await chat.media.ingest({ data: bytes, mime: file.type, filename: file.name });
			return {
				message: recordOutbound(
					db,
					conv,
					{ content_type: 'media', media_url: stored.url, media_type: mediaType, caption: caption ?? null, preview: `📎 ${mediaType}` },
					result,
					null
				)
			};
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})
	.post('/api/conversations/:id/typing', async ({ params, body }) => {
		const conv = db.getConversation(params.id);
		if (conv) {
			const { on } = body as { on: boolean };
			// Best-effort: forward the composer's typing state to the platform in real time.
			await chat.setTyping(conv.platform as PlatformId, conv.account, conv.conversation_id, Boolean(on));
		}
		return { ok: true };
	})
	.post('/api/conversations/:id/react', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const { targetMessageId, emoji } = body as { targetMessageId: string; emoji: string };
		const to = address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, content: reaction(emoji, targetMessageId) });
			return { message: recordOutbound(db, conv, { content_type: 'reaction', text: emoji, preview: `${emoji} reacted` }, result, targetMessageId) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'react failed' };
		}
	})

	// The platform's honesty contract: which rich features this conversation supports.
	// The composer uses this to gate its "+" menu, so it only offers what will work.
	.get('/api/conversations/:id/capabilities', ({ params, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const descriptor = chat.capabilities(conv.platform as PlatformId);
		return { platform: conv.platform, supports: descriptor?.supports ?? null };
	})

	// Share a geographic location (Telegram / WhatsApp).
	.post('/api/conversations/:id/location', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const { lat, lng, name } = body as { lat: number; lng: number; name?: string };
		const to = address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, content: location(lat, lng, name) });
			const meta = JSON.stringify({ kind: 'location', lat, lng, name: name ?? null });
			return { message: recordOutbound(db, conv, { content_type: 'location', text: name ?? null, meta, preview: '📍 location' }, result, null) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})

	// Share a contact card (Telegram / WhatsApp).
	.post('/api/conversations/:id/contact', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const { name, phone } = body as { name: string; phone: string };
		const to = address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, content: contact(name, phone) });
			const meta = JSON.stringify({ kind: 'contact', name, phone });
			return { message: recordOutbound(db, conv, { content_type: 'contact', text: `${name} · ${phone}`, meta, preview: `👤 ${name}` }, result, null) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})

	// Interactive buttons / list. The per-platform builder is chosen server-side to
	// showcase how one intent (a set of choices) maps onto each platform's native
	// control — Telegram inline keyboard, Slack/Discord action row, WA reply buttons
	// or list. Presses come back as a universal `postback` message.
	.post('/api/conversations/:id/interactive', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const { body: prompt, buttons, kind, buttonText, sections } = body as {
			body: string;
			kind: 'buttons' | 'list';
			buttons?: Button[];
			buttonText?: string;
			sections?: ListSection[];
		};
		const platform = conv.platform as PlatformId;
		let fragment: InteractiveFragment;
		try {
			if (kind === 'list') {
				if (platform !== 'whatsapp_cloud') throw new Error(`Lists are only supported on WhatsApp Cloud, not ${platform}.`);
				fragment = whatsappCloudList(prompt, buttonText ?? 'Select', sections ?? []);
			} else {
				const btns = buttons ?? [];
				switch (platform) {
					case 'telegram':
						fragment = telegramButtons(prompt, btns);
						break;
					case 'slack':
						fragment = slackButtons(prompt, btns);
						break;
					case 'discord':
						fragment = discordButtons(prompt, btns);
						break;
					case 'whatsapp_cloud':
						fragment = whatsappCloudButtons(prompt, btns);
						break;
					default:
						// WhatsApp Baileys has no reliable interactive buttons (see docs/channels/whatsapp.md).
						throw new Error(`Interactive buttons are not supported on ${platform}.`);
				}
			}
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'unsupported' };
		}
		const to = address({ platform, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, ...fragment });
			const meta = JSON.stringify({ kind, body: prompt, buttons: buttons ?? [], sections: sections ?? [], buttonText: buttonText ?? null });
			return { message: recordOutbound(db, conv, { content_type: 'interactive', text: prompt, meta, preview: `⌨︎ ${prompt}` }, result, null) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})

	// WhatsApp Cloud pre-approved template — the only compliant way to *initiate* a
	// conversation there. Renders from a template name + language on Meta's side.
	.post('/api/conversations/:id/template', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		if (conv.platform !== 'whatsapp_cloud') {
			set.status = 422;
			return { error: 'Templates are only supported on WhatsApp Cloud.' };
		}
		const { name, language } = body as { name: string; language?: string };
		const to = address({ platform: conv.platform as PlatformId, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, ...whatsappCloudTemplate(name, language ?? 'en_US') });
			const meta = JSON.stringify({ kind: 'template', name, language: language ?? 'en_US' });
			return { message: recordOutbound(db, conv, { content_type: 'template', text: `📋 ${name}`, meta, preview: `📋 ${name}` }, result, null) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})

	// Rich layout card — a Discord embed or a Slack Block Kit message. Demonstrates
	// `rich_layout`: platforms that render structured cards, not just text + buttons.
	.post('/api/conversations/:id/rich', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const { title, body: cardBody } = body as { title: string; body: string };
		const platform = conv.platform as PlatformId;
		let fragment: InteractiveFragment;
		if (platform === 'slack') {
			fragment = slackBlocks(title, [
				{ type: 'header', text: { type: 'plain_text', text: title } },
				{ type: 'section', text: { type: 'mrkdwn', text: cardBody } }
			]);
		} else if (platform === 'discord') {
			// No typed embed builder in core — a passthrough is exactly the escape hatch.
			fragment = { content: { type: 'passthrough' }, platform_meta: { discord: { embeds: [{ title, description: cardBody, color: 5793266 }] } } };
		} else {
			set.status = 422;
			return { error: `Rich cards are only supported on Discord and Slack, not ${platform}.` };
		}
		const to = address({ platform, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, ...fragment });
			const meta = JSON.stringify({ kind: 'card', title, body: cardBody });
			return { message: recordOutbound(db, conv, { content_type: 'rich', text: title, meta, preview: `🎴 ${title}` }, result, null) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})

	// Extended rich builders — polls, dice, venues, embeds, select menus, WhatsApp
	// Cloud CTA buttons and Baileys template buttons. One intent → the right typed
	// ChatKit builder per platform, mirroring `/interactive`. Presses come back as a
	// universal `postback`.
	.post('/api/conversations/:id/rich-message', async ({ params, body, set }) => {
		const conv = db.getConversation(params.id);
		if (!conv) {
			set.status = 404;
			return { error: 'unknown conversation' };
		}
		const platform = conv.platform as PlatformId;
		const spec = body as Record<string, unknown>;
		const kind = String(spec.kind);
		let fragment: InteractiveFragment;
		let preview = '';
		try {
			switch (kind) {
				case 'poll': {
					const question = String(spec.question ?? '').trim();
					const options = ((spec.options as string[]) ?? []).map((o) => String(o).trim()).filter(Boolean);
					if (!question || options.length < 2) throw new Error('A poll needs a question and at least two options.');
					if (platform === 'telegram') fragment = telegramPoll(question, options);
					else if (platform === 'discord') fragment = discordPoll(question, options.map((t) => ({ text: t })));
					else if (platform === 'whatsapp_baileys') fragment = whatsappBaileysPoll(question, options);
					else throw new Error(`Polls are not supported on ${platform}.`);
					preview = `📊 ${question}`;
					break;
				}
				case 'dice': {
					if (platform !== 'telegram') throw new Error('Dice is a Telegram feature.');
					const emoji = String(spec.emoji ?? '🎲') as '🎲' | '🎯' | '🏀' | '⚽' | '🎳' | '🎰';
					fragment = telegramDice(emoji);
					preview = `🎲 ${emoji}`;
					break;
				}
				case 'venue': {
					if (platform !== 'telegram') throw new Error('Venue is a Telegram feature.');
					const title = String(spec.title ?? '').trim();
					fragment = telegramVenue({ lat: Number(spec.lat), lng: Number(spec.lng), title, address: String(spec.address ?? '') });
					preview = `📍 ${title}`;
					break;
				}
				case 'embed': {
					const title = String(spec.title ?? '').trim();
					const description = String(spec.description ?? '');
					const fields = ((spec.fields as Array<{ label: string; value: string }>) ?? [])
						.filter((f) => f.label?.trim())
						.map((f) => ({ name: f.label, value: f.value || '—' }));
					if (platform === 'discord') {
						const color = spec.color ? parseInt(String(spec.color).replace('#', ''), 16) : undefined;
						fragment = discordEmbeds({ title, description, color, fields });
					} else if (platform === 'slack') {
						fragment = slack.message(title || 'Card', [
							slack.header(title || 'Card'),
							...(description ? [slack.section(description)] : []),
							...(fields.length ? [slack.fields(fields.map((f) => `*${f.name}*\n${f.value}`))] : [])
						]);
					} else throw new Error(`Embeds are only supported on Discord and Slack, not ${platform}.`);
					preview = `🎴 ${title}`;
					break;
				}
				case 'select': {
					const prompt = String(spec.prompt ?? '').trim();
					const placeholder = spec.placeholder ? String(spec.placeholder) : undefined;
					const options = ((spec.options as Array<{ label: string; value: string }>) ?? [])
						.filter((o) => o.label?.trim())
						.map((o) => ({ label: o.label, value: o.value || o.label }));
					if (options.length < 1) throw new Error('A select needs at least one option.');
					if (platform === 'discord') fragment = discordSelect(prompt, { data: 'select', placeholder, options });
					else if (platform === 'slack')
						fragment = slack.message(prompt, [
							slack.section(prompt, { accessory: slack.staticSelect('select', options.map((o) => ({ text: o.label, value: o.value })), { placeholder }) })
						]);
					else throw new Error(`Select menus are only supported on Discord and Slack, not ${platform}.`);
					preview = `☰ ${prompt}`;
					break;
				}
				case 'cta': {
					if (platform !== 'whatsapp_cloud') throw new Error('CTA URL buttons are a WhatsApp Cloud feature.');
					fragment = whatsappCloudCtaUrl(String(spec.body ?? ''), String(spec.displayText ?? 'Open'), String(spec.url ?? ''));
					preview = `🔗 ${String(spec.displayText ?? 'Open')}`;
					break;
				}
				default:
					throw new Error(`Unknown rich kind: ${kind}`);
			}
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'unsupported' };
		}
		const to = address({ platform, account: conv.account, conversationId: conv.conversation_id, threadId: conv.thread_id });
		try {
			const result = await chat.send({ to, ...fragment });
			return { message: recordOutbound(db, conv, { content_type: kind, text: preview, meta: JSON.stringify(spec), preview }, result, null) };
		} catch (error) {
			set.status = 422;
			return { error: error instanceof Error ? error.message : 'send failed' };
		}
	})

	.get('/events', () => sseResponse())
	.get('/media/:id', async ({ params, set }) => {
		const blob = await chat.media.store.get(params.id);
		if (!blob) {
			set.status = 404;
			return 'not found';
		}
		return new Response(blob.data as unknown as BodyInit, {
			headers: { 'content-type': blob.mime ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' }
		});
	})

	// --- webhooks (WhatsApp Cloud / Slack Events), keyed by account id --------
	.get('/webhook/:id', ({ params, request, query }) => webhook(params.id, request, '', (query as Record<string, string>) ?? {}))
	.post('/webhook/:id', ({ params, request, body, query }) =>
		webhook(params.id, request, (body as string) ?? '', (query as Record<string, string>) ?? {})
	)

	// --- SPA fallback (production) -------------------------------------------
	.get('/*', async ({ request }) => {
		const pathname = new URL(request.url).pathname;
		const wanted = pathname === '/' ? '/index.html' : pathname;
		let file = Bun.file(CLIENT_DIR + wanted);
		if (!(await file.exists())) file = Bun.file(CLIENT_DIR + '/index.html');
		if (!(await file.exists())) {
			return new Response('UI not built. In dev run `bun run dev` (Vite on :5173); for prod run `bun run build` then `bun run start`.', {
				headers: { 'content-type': 'text/plain' }
			});
		}
		return new Response(file);
	})
	.listen(PORT);

console.log(`\n  ChatKit inbox → http://localhost:${PORT}`);
const list = accounts.list();
if (list.length === 0) console.log('  No channels yet — open the app and add one from Settings (Telegram is easiest).');
else for (const a of list) console.log(`  • ${a.label} (${a.platform}:${a.account})${a.connected ? '' : ' — not connected'}`);
console.log('');

process.on('SIGINT', () => void chat.stop().then(() => process.exit(0)));
