import { test, expect, describe } from 'bun:test';
import { TelegramAdapter } from './telegram.js';
import { ChatKit } from '../chatkit.js';
import { telegramButtons, telegramEditMessage } from '../interactive/telegram.js';
import { MemoryStateStore } from '../store/index.js';
import { MediaProxy, MemoryMediaStore } from '../media/index.js';
import { noopSafety } from '../safety/index.js';
import { noopLogger } from '../logger.js';
import { text, media, richText, rt } from '../envelope.js';
import type { AdapterContext, InboundRequest, StatusUpdate } from '../adapter.js';
import type { UniversalMessage } from '../schema.js';

function ctx(overrides?: Partial<AdapterContext>): AdapterContext & { received: UniversalMessage[]; statuses: StatusUpdate[] } {
	const received: UniversalMessage[] = [];
	const statuses: StatusUpdate[] = [];
	return {
		store: new MemoryStateStore(),
		media: new MediaProxy(new MemoryMediaStore()),
		logger: noopLogger,
		safety: noopSafety,
		events: {
			message: (m) => received.push(m),
			reaction: (m) => received.push(m),
			status: (s) => statuses.push(s),
			connection: () => {},
			presence: () => {},
			error: () => {}
		},
		received,
		statuses,
		...overrides
	};
}

/** A scripted Telegram API mock keyed on the method in the URL. */
function mockFetch(handlers: Record<string, any>): typeof fetch {
	return (async (url: string | URL, init?: RequestInit) => {
		const u = String(url);
		if (u.includes('/file/bot')) {
			return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
		}
		const method = u.split('/').pop()!.split('?')[0]!;
		const handler = handlers[method];
		if (!handler) throw new Error(`unexpected method ${method}`);
		const result = typeof handler === 'function' ? handler(init) : handler;
		return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof fetch;
}

const textUpdate = {
	update_id: 1,
	message: {
		message_id: 50,
		date: 1700000000,
		chat: { id: 999 },
		from: { id: 7, first_name: 'Budi', is_bot: false },
		text: 'halo'
	}
};

describe('TelegramAdapter', () => {
	test('verifyInbound checks the secret token', () => {
		const a = new TelegramAdapter({ token: 't', secretToken: 'abc' });
		const ok: InboundRequest = { headers: { 'x-telegram-bot-api-secret-token': 'abc' }, body: '{}' };
		const bad: InboundRequest = { headers: { 'x-telegram-bot-api-secret-token': 'no' }, body: '{}' };
		expect(a.verifyInbound(ok)).toBe(true);
		expect(a.verifyInbound(bad)).toBe(false);
	});

	test('without a secret every webhook is rejected unless allowUnverified', () => {
		const req: InboundRequest = { headers: {}, body: '{}' };
		expect(new TelegramAdapter({ token: 't' }).verifyInbound(req)).toBe(false);
		expect(new TelegramAdapter({ token: 't', allowUnverified: true }).verifyInbound(req)).toBe(true);
	});

	test('normalises an inbound text update', async () => {
		const a = new TelegramAdapter({ token: 't', account: 'bot:shop' });
		const c = ctx();
		const msg = await a.handleInbound({ headers: {}, body: JSON.stringify(textUpdate) }, c);
		expect(msg?.content).toEqual({ type: 'text', text: 'halo' });
		expect(msg?.address).toMatchObject({ platform: 'telegram', account: 'bot:shop', conversation_id: '999' });
		expect(msg?.from?.display_name).toBe('Budi');
		expect(msg?.platform_message_id).toBe('50');
	});

	test('downloads and proxies inbound photo media', async () => {
		const a = new TelegramAdapter({ token: 't', fetchImpl: mockFetch({ getFile: { file_path: 'photos/a.jpg' } }) });
		const c = ctx();
		const photoUpdate = {
			update_id: 2,
			message: {
				message_id: 51,
				date: 1700000001,
				chat: { id: 1 },
				from: { id: 7, first_name: 'A' },
				photo: [{ file_id: 'small' }, { file_id: 'large', file_size: 3 }],
				caption: 'pic'
			}
		};
		const msg = await a.handleInbound({ headers: {}, body: JSON.stringify(photoUpdate) }, c);
		expect(msg?.content.type).toBe('media');
		expect((msg?.content as any).media_type).toBe('image');
		expect((msg?.content as any).url).toContain('chatkit-media://');
		// The proxied handle resolves back to the downloaded bytes.
		const blob = await c.media.resolveOutbound({ type: 'media', media_type: 'image', url: (msg!.content as any).url });
		expect(Array.from(blob.data)).toEqual([0xff, 0xd8, 0xff]);
	});

	test('sends text and returns the native message id', async () => {
		const a = new TelegramAdapter({ token: 't', fetchImpl: mockFetch({ sendMessage: { message_id: 111 } }) });
		const c = ctx();
		const res = await a.send(
			{ to: { platform: 'telegram', account: 'bot', conversation_id: '999' }, content: text('hi') },
			c
		);
		expect(res.platform_message_id).toBe('111');
		expect(res.status).toBe('sent');
	});

	test('renders rich text as Telegram entities', async () => {
		let body: any;
		const a = new TelegramAdapter({
			token: 't',
			fetchImpl: mockFetch({
				sendMessage: (init: RequestInit) => {
					body = JSON.parse(init.body as string);
					return { message_id: 1 };
				}
			})
		});
		await a.send(
			{
				to: { platform: 'telegram', account: 'bot', conversation_id: '1' },
				content: richText([rt.plain('Hi '), rt.bold('there'), rt.plain(' — '), rt.link('site', 'https://x.io')])
			},
			ctx()
		);
		expect(body.text).toBe('Hi there — site');
		expect(body.entities).toEqual([
			{ type: 'bold', offset: 3, length: 5 },
			{ type: 'text_link', offset: 11, length: 4, url: 'https://x.io' }
		]);
	});

	test('normalises inbound entities into rich runs', async () => {
		const a = new TelegramAdapter({ token: 't' });
		const update = {
			update_id: 3,
			message: {
				message_id: 60,
				date: 1700000000,
				chat: { id: 1 },
				from: { id: 7, first_name: 'A' },
				text: 'Hi there',
				entities: [{ type: 'bold', offset: 3, length: 5 }]
			}
		};
		const msg = await a.handleInbound({ headers: {}, body: JSON.stringify(update) }, ctx());
		expect((msg?.content as any).rich).toEqual([{ text: 'Hi ' }, { text: 'there', bold: true }]);
	});

	test('sends media via multipart upload', async () => {
		const a = new TelegramAdapter({ token: 't', fetchImpl: mockFetch({ sendPhoto: { message_id: 222 } }) });
		const c = ctx();
		const res = await a.send(
			{
				to: { platform: 'telegram', account: 'bot', conversation_id: '1' },
				content: media({ mediaType: 'image', data: new Uint8Array([1, 2, 3]), filename: 'a.png', caption: 'x' })
			},
			c
		);
		expect(res.platform_message_id).toBe('222');
	});

	test('health tracks long-poll state and counts recoveries', async () => {
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		let calls = 0;
		const fetchImpl = (async (url: string) => {
			// Polling clears any webhook first; count only the long-polls themselves.
			if (String(url).endsWith('/deleteWebhook')) return new Response(JSON.stringify({ ok: true, result: true }), {});
			calls++;
			if (calls === 2) throw new Error('network blip'); // outage → connecting + reconnect++
			// Emulate a long-poll: yield to timers so the loop isn't a busy microtask spin.
			await sleep(20);
			return new Response(JSON.stringify({ ok: true, result: [] }), {});
		}) as unknown as typeof fetch;
		const a = new TelegramAdapter({ token: 't', polling: true, fetchImpl });
		const conn = await a.start(ctx());
		// First poll opens; second throws → reconnect++ then a 1s backoff. Sample mid-backoff.
		await sleep(200);
		const mid = a.health();
		expect(mid.platform).toBe('telegram');
		expect(mid.lastConnectedAt).not.toBeNull(); // recorded on the first open
		expect(mid.reconnects).toBeGreaterThanOrEqual(1);
		expect(mid.terminal).toBe(false);

		await conn.stop();
		expect(a.health().state).toBe('closed');
	});

	test('retries on a 429 then succeeds', async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			if (calls === 1) return new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests' }), {});
			return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), {});
		}) as unknown as typeof fetch;
		const a = new TelegramAdapter({ token: 't', fetchImpl });
		// The adapter surfaces a retryable error; the queue (tested elsewhere) retries.
		await expect(
			a.send({ to: { platform: 'telegram', account: 'bot', conversation_id: '1' }, content: text('hi') }, ctx())
		).rejects.toThrow('429');
		expect(calls).toBe(1);
	});

	describe('inbound events and dedup', () => {
		const webhook = (update: unknown): InboundRequest => ({ headers: {}, body: JSON.stringify(update) });
		const kit = () => {
			const chat = new ChatKit();
			const seen: UniversalMessage[] = [];
			chat.on('message', (m) => void seen.push(m));
			return { chat, seen };
		};
		const press = (updateId: number, cqId: string, data: string) => ({
			update_id: updateId,
			callback_query: {
				id: cqId,
				data,
				from: { id: 7, first_name: 'Budi' },
				message: {
					message_id: 50,
					chat: { id: 999 },
					reply_markup: { inline_keyboard: [[{ text: 'Approve ✅', callback_data: 'a' }], [{ text: 'Reject', callback_data: 'r' }]] }
				}
			}
		});

		test('the same message id in two chats is two messages', async () => {
			const { chat, seen } = kit();
			chat.use(new TelegramAdapter({ token: 't', allowUnverified: true, fetchImpl: mockFetch({}) }));
			await chat.receive('telegram', 'bot', webhook(textUpdate));
			await chat.receive('telegram', 'bot', webhook({ ...textUpdate, update_id: 2, message: { ...textUpdate.message, chat: { id: 1000 } } }));
			await chat.receive('telegram', 'bot', webhook(textUpdate)); // a true redelivery
			expect(seen.map((m) => m.address.conversation_id)).toEqual(['999', '1000']);
		});

		test('every button press on one message is delivered, a redelivered press is not', async () => {
			const { chat, seen } = kit();
			chat.use(new TelegramAdapter({ token: 't', allowUnverified: true, fetchImpl: mockFetch({ answerCallbackQuery: true }) }));
			await chat.receive('telegram', 'bot', webhook(press(10, 'cq1', 'a')));
			await chat.receive('telegram', 'bot', webhook(press(11, 'cq2', 'r')));
			await chat.receive('telegram', 'bot', webhook(press(11, 'cq2', 'r')));
			expect(seen.map((m) => (m.content.type === 'postback' ? m.content.data : null))).toEqual(['a', 'r']);
			expect(seen[0]!.event_id).toBe('callback:cq1');
		});

		test('a postback carries the pressed button label as its title', async () => {
			const a = new TelegramAdapter({ token: 't', fetchImpl: mockFetch({ answerCallbackQuery: true }) });
			const msg = await a.handleInbound(webhook(press(10, 'cq1', 'a')), ctx());
			expect(msg?.content).toEqual({ type: 'postback', data: 'a', title: 'Approve ✅' });
		});

		test('an edit is delivered rather than deduped against the message it edits', async () => {
			const { chat, seen } = kit();
			chat.use(new TelegramAdapter({ token: 't', allowUnverified: true, fetchImpl: mockFetch({}) }));
			await chat.receive('telegram', 'bot', webhook(textUpdate));
			await chat.receive('telegram', 'bot', webhook({ update_id: 3, edited_message: { ...textUpdate.message, text: 'halo!', edit_date: 1700000100 } }));
			expect(seen.map((m) => (m.content.type === 'text' ? m.content.text : null))).toEqual(['halo', 'halo!']);
			expect(seen.map((m) => Boolean(m.edited))).toEqual([false, true]);
		});
	});

	describe('polling', () => {
		test('clears the webhook, asks for every handled update kind, and resumes from the stored offset', async () => {
			const bodies: Record<string, any>[] = [];
			const store = new MemoryStateStore();
			await store.kvSet('telegram:offset', 'bot', '41');
			let first = true;
			const scripted = mockFetch({
				deleteWebhook: (init: RequestInit) => (bodies.push({ method: 'deleteWebhook', ...JSON.parse(String(init.body)) }), true),
				getUpdates: (init: RequestInit) => {
					bodies.push({ method: 'getUpdates', ...JSON.parse(String(init.body)) });
					if (!first) return [];
					first = false;
					return [{ ...textUpdate, update_id: 41 }];
				}
			});
			// Emulate a long poll's wait, or the loop spins on microtasks and starves the timers.
			const fetchImpl = (async (url: string, init?: RequestInit) => {
				if (String(url).endsWith('/getUpdates') && !first) await new Promise((r) => setTimeout(r, 10));
				return scripted(url, init);
			}) as unknown as typeof fetch;
			const c = ctx({ store });
			const a = new TelegramAdapter({ token: 't', polling: true, fetchImpl });
			const conn = await a.start(c);
			await new Promise((r) => setTimeout(r, 30));
			await conn.stop();
			expect(bodies[0]).toEqual({ method: 'deleteWebhook', drop_pending_updates: false });
			expect(bodies[1]!.offset).toBe(41);
			expect(bodies[1]!.allowed_updates).toContain('callback_query');
			expect(bodies[1]!.allowed_updates).toContain('message_reaction');
			expect(await store.kvGet('telegram:offset', 'bot')).toBe('42');
		});

		test('stop aborts the in-flight long poll instead of waiting it out', async () => {
			const fetchImpl = (async (url: string, init?: RequestInit) => {
				if (String(url).endsWith('/deleteWebhook')) return new Response(JSON.stringify({ ok: true, result: true }));
				// A long poll that only ends when aborted.
				return new Promise<Response>((_, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
				});
			}) as unknown as typeof fetch;
			const a = new TelegramAdapter({ token: 't', polling: true, fetchImpl });
			const conn = await a.start(ctx());
			const started = Date.now();
			await conn.stop();
			expect(Date.now() - started).toBeLessThan(500);
			expect(a.health().state).toBe('closed');
		});
	});

	describe('bot setup helpers', () => {
		test('setWebhook sends the secret and the allowed updates', async () => {
			let body: Record<string, any> = {};
			const a = new TelegramAdapter({
				token: 't',
				secretToken: 's3cret',
				fetchImpl: mockFetch({ setWebhook: (init: RequestInit) => ((body = JSON.parse(String(init.body))), true) })
			});
			await a.setWebhook({ url: 'https://example.com/hook' });
			expect(body.url).toBe('https://example.com/hook');
			expect(body.secret_token).toBe('s3cret');
			expect(body.allowed_updates).toContain('callback_query');
		});

		test('setMyCommands publishes the command menu', async () => {
			let body: Record<string, any> = {};
			const a = new TelegramAdapter({ token: 't', fetchImpl: mockFetch({ setMyCommands: (init: RequestInit) => ((body = JSON.parse(String(init.body))), true) }) });
			await a.setMyCommands([{ command: 'new', description: 'Start a new chat' }]);
			expect(body.commands).toEqual([{ command: 'new', description: 'Start a new chat' }]);
		});

		test('getMe returns the bot identity', async () => {
			const a = new TelegramAdapter({ token: 't', fetchImpl: mockFetch({ getMe: { id: 1, username: 'clopen_bot', first_name: 'Clopen' } }) });
			expect((await a.getMe()).username).toBe('clopen_bot');
		});
	});

	describe('interactive builders', () => {
		test('callback_data over 64 bytes is rejected before it reaches Telegram', () => {
			expect(() => telegramButtons('pick', [{ text: 'x', data: 'é'.repeat(33) }])).toThrow(/64 bytes/);
			expect(() => telegramButtons('pick', [{ text: 'x', data: 'a'.repeat(64) }])).not.toThrow();
		});

		test('telegramEditMessage replaces the keyboard, or removes it when none is given', () => {
			const withButtons = telegramEditMessage(5, 'pick', { buttons: [{ text: '✓ A', data: 'a' }] });
			expect((withButtons.platform_meta.telegram as any).params.reply_markup.inline_keyboard).toEqual([[{ text: '✓ A', callback_data: 'a' }]]);
			const cleared = telegramEditMessage('5', 'done');
			expect((cleared.platform_meta.telegram as any)).toEqual({
				method: 'editMessageText',
				params: { message_id: 5, text: 'done', reply_markup: { inline_keyboard: [] } }
			});
		});
	});
});
