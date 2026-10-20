import { test, expect, describe } from 'bun:test';
import { ChatKit } from './chatkit.js';
import { capabilities, emptySupport, CapabilityError } from './capability.js';
import { inbound, text, location } from './envelope.js';
import { address, participant } from './address.js';
import type { Adapter, InboundRequest } from './adapter.js';
import type { OutboundMessage, SendResult, UniversalMessage } from './schema.js';

class TestAdapter implements Adapter {
	readonly platform = 'telegram' as const;
	readonly account = 'bot';
	sent: OutboundMessage[] = [];
	private n = 0;

	edited: Array<{ id: string; text: string }> = [];
	deleted: string[] = [];
	read: string[] = [];

	capabilities() {
		return capabilities('telegram', { ...emptySupport(), reactions: true, edit: true, media: ['image'] });
	}

	async edit(target: { platform_message_id: string; content: { type: string } }): Promise<SendResult> {
		this.edited.push({ id: target.platform_message_id, text: (target as any).content.text });
		return { id: 'e1', platform_message_id: target.platform_message_id, status: 'sent', timestamp: new Date().toISOString() };
	}

	async deleteMessage(target: { platform_message_id: string }): Promise<void> {
		this.deleted.push(target.platform_message_id);
	}

	async markRead(target: { platform_message_id: string }): Promise<void> {
		this.read.push(target.platform_message_id);
	}

	verifyInbound(req: InboundRequest): boolean {
		return req.headers['x-secret'] === 'ok';
	}

	async handleInbound(req: InboundRequest): Promise<UniversalMessage | null> {
		const data = JSON.parse(String(req.body));
		return inbound({
			platformMessageId: data.id,
			address: address({ platform: 'telegram', account: 'bot', conversationId: data.chat }),
			from: participant({ platform: 'telegram', account: 'bot', userId: data.user ?? 'u' }),
			content: data.reaction ? { type: 'reaction', emoji: '👍', target_message_id: data.id } : { type: 'text', text: data.text ?? '' }
		});
	}

	async send(msg: OutboundMessage): Promise<SendResult> {
		this.sent.push(msg);
		this.n += 1;
		return { id: `ck-${this.n}`, platform_message_id: `nat-${this.n}`, status: 'sent', timestamp: new Date().toISOString() };
	}
}

describe('ChatKit orchestration', () => {
	test('routes send to the right adapter and gates capabilities', async () => {
		const chat = new ChatKit();
		const adapter = new TestAdapter();
		chat.use(adapter);

		const to = address({ platform: 'telegram', account: 'bot', conversationId: 'c1' });
		const res = await chat.send({ to, content: text('hi') });
		expect(res.platform_message_id).toBe('nat-1');
		expect(adapter.sent).toHaveLength(1);

		// Unsupported content → clear capability error, not a silent no-op.
		await expect(chat.send({ to, content: location(1, 2) })).rejects.toThrow(CapabilityError);
	});

	test('throws for an unregistered account', async () => {
		const chat = new ChatKit();
		await expect(
			chat.send({ to: address({ platform: 'discord', account: 'x', conversationId: 'c' }), content: text('hi') })
		).rejects.toThrow(/No adapter registered/);
	});

	test('idempotency replays a prior result without re-sending', async () => {
		const chat = new ChatKit();
		const adapter = new TestAdapter();
		chat.use(adapter);
		const to = address({ platform: 'telegram', account: 'bot', conversationId: 'c1' });
		const a = await chat.send({ to, content: text('hi'), idempotency_key: 'k1' });
		const b = await chat.send({ to, content: text('hi'), idempotency_key: 'k1' });
		expect(b).toEqual(a);
		expect(adapter.sent).toHaveLength(1); // only sent once
	});

	test('receive verifies, emits, and dedups duplicates', async () => {
		const chat = new ChatKit();
		chat.use(new TestAdapter());
		const got: UniversalMessage[] = [];
		chat.on('message', (m) => got.push(m));

		const req = (body: object, secret = 'ok'): InboundRequest => ({ headers: { 'x-secret': secret }, body: JSON.stringify(body) });

		await expect(chat.receive('telegram', 'bot', req({ id: '1', chat: 'c', text: 'a' }, 'bad'))).rejects.toThrow(/verification/);
		await chat.receive('telegram', 'bot', req({ id: '1', chat: 'c', text: 'a' }));
		await chat.receive('telegram', 'bot', req({ id: '1', chat: 'c', text: 'a' })); // duplicate id
		expect(got).toHaveLength(1);
		expect(got[0]!.content).toEqual({ type: 'text', text: 'a' });
	});

	test('reaction content emits a reaction event', async () => {
		const chat = new ChatKit();
		chat.use(new TestAdapter());
		const reactions: UniversalMessage[] = [];
		chat.on('reaction', (m) => reactions.push(m));
		await chat.receive('telegram', 'bot', { headers: { 'x-secret': 'ok' }, body: JSON.stringify({ id: '9', chat: 'c', reaction: true }) });
		expect(reactions).toHaveLength(1);
		expect(reactions[0]!.content.type).toBe('reaction');
	});

	test('capabilities() exposes the registered descriptor', () => {
		const chat = new ChatKit();
		chat.use(new TestAdapter());
		expect(chat.capabilities('telegram')?.supports.reactions).toBe(true);
		expect(chat.capabilities('discord')).toBeUndefined();
	});

	test('stop() drains and is safe to call', async () => {
		const chat = new ChatKit();
		chat.use(new TestAdapter());
		const to = address({ platform: 'telegram', account: 'bot', conversationId: 'c1' });
		void chat.send({ to, content: text('a') });
		void chat.send({ to, content: text('b') });
		await chat.stop();
		expect(chat.pending()).toBe(0);
	});

	test('records id mapping after send', async () => {
		const chat = new ChatKit();
		chat.use(new TestAdapter());
		const to = address({ platform: 'telegram', account: 'bot', conversationId: 'c1' });
		const res = await chat.send({ to, content: text('hi') });
		expect(await chat.store.getPlatformMessageId('bot', res.id)).toBe(res.platform_message_id);
	});

	test('edit / deleteMessage / markRead route to the adapter', async () => {
		const chat = new ChatKit();
		const adapter = new TestAdapter();
		chat.use(adapter);
		const addr = address({ platform: 'telegram', account: 'bot', conversationId: 'c1' });
		await chat.edit({ address: addr, platform_message_id: 'nat-1', content: text('fixed') });
		await chat.deleteMessage({ address: addr, platform_message_id: 'nat-2' });
		await chat.markRead({ address: addr, platform_message_id: 'nat-3' });
		expect(adapter.edited).toEqual([{ id: 'nat-1', text: 'fixed' }]);
		expect(adapter.deleted).toEqual(['nat-2']);
		expect(adapter.read).toEqual(['nat-3']);
	});

	test('presence and connection events reach consumers', async () => {
		const chat = new ChatKit();
		const adapter = new TestAdapter();
		chat.use(adapter);
		const seen: string[] = [];
		chat.on('presence', (p) => seen.push(`presence:${p.state}`));
		chat.on('connection', (c) => seen.push(`connection:${c.state}`));
		// Reach the injected context the same way an adapter would.
		const ctx = (chat as any).registrations.get('telegram:bot').context;
		ctx.events.presence({ platform: 'telegram', account: 'bot', conversation_id: 'c1', state: 'typing', timestamp: 't' });
		ctx.events.connection({ platform: 'telegram', account: 'bot', state: 'open', timestamp: 't' });
		expect(seen).toEqual(['presence:typing', 'connection:open']);
	});
});

/** A persistent adapter whose start/stop we can observe. */
class StartableAdapter implements Adapter {
	readonly platform = 'telegram' as const;
	started = false;
	stopped = false;
	constructor(
		readonly account: string,
		private readonly failStart = false
	) {}
	capabilities() {
		return capabilities('telegram', { ...emptySupport(), media: ['image'] });
	}
	async start() {
		if (this.failStart) throw new Error('boom');
		this.started = true;
		return {
			platform: this.platform,
			account: this.account,
			status: () => 'open' as const,
			stop: async () => {
				this.stopped = true;
			}
		};
	}
	async send(): Promise<SendResult> {
		return { id: 'x', platform_message_id: 'y', status: 'sent', timestamp: new Date().toISOString() };
	}
}

describe('ChatKit dynamic adapters', () => {
	test('add() starts an adapter when already running', async () => {
		const chat = new ChatKit();
		await chat.start();
		const a = new StartableAdapter('bot');
		await chat.add(a);
		expect(a.started).toBe(true);
		expect(chat.capabilities('telegram')).toBeDefined();
	});

	test('add() before start() defers to start()', async () => {
		const chat = new ChatKit();
		const a = new StartableAdapter('bot');
		await chat.add(a);
		expect(a.started).toBe(false);
		await chat.start();
		expect(a.started).toBe(true);
	});

	test('remove() stops, unregisters, and drops capabilities', async () => {
		const chat = new ChatKit();
		await chat.start();
		const a = new StartableAdapter('bot');
		await chat.add(a);
		expect(await chat.remove('telegram', 'bot')).toBe(true);
		expect(a.stopped).toBe(true);
		expect(chat.capabilities('telegram')).toBeUndefined();
		expect(await chat.remove('telegram', 'bot')).toBe(false);
	});

	test('remove() keeps a platform capability while another account uses it', async () => {
		const chat = new ChatKit();
		await chat.start();
		await chat.add(new StartableAdapter('bot1'));
		await chat.add(new StartableAdapter('bot2'));
		await chat.remove('telegram', 'bot1');
		expect(chat.capabilities('telegram')).toBeDefined();
	});

	test('add() rolls back when the adapter fails to start', async () => {
		const chat = new ChatKit();
		await chat.start();
		await expect(chat.add(new StartableAdapter('bot', true))).rejects.toThrow('boom');
		expect(chat.capabilities('telegram')).toBeUndefined();
		expect(chat.adapterFor('telegram', 'bot')).toBeUndefined();
	});
});
