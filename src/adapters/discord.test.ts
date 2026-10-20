import { test, expect, describe } from 'bun:test';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { DiscordAdapter } from './discord.js';
import { MemoryStateStore } from '../store/index.js';
import { MediaProxy, MemoryMediaStore } from '../media/index.js';
import { noopSafety } from '../safety/index.js';
import { noopLogger } from '../logger.js';
import type { AdapterContext, ConnectionUpdate, InboundRequest } from '../adapter.js';

function ctx(): AdapterContext & { conns: ConnectionUpdate[] } {
	const conns: ConnectionUpdate[] = [];
	return {
		store: new MemoryStateStore(),
		media: new MediaProxy(new MemoryMediaStore()),
		logger: noopLogger,
		safety: noopSafety,
		events: { message: () => {}, reaction: () => {}, status: () => {}, connection: (u) => conns.push(u), presence: () => {}, error: () => {} },
		conns
	};
}

/** A minimal discord.js stand-in exposing the events the adapter subscribes to. */
function mockDiscord() {
	const handlers = new Map<string, Array<(...a: any[]) => unknown>>();
	const add = (e: string, h: (...a: any[]) => unknown): void => {
		const list = handlers.get(e) ?? [];
		list.push(h);
		handlers.set(e, list);
	};
	let ready = false;
	class Client {
		once(e: string, h: (...a: any[]) => unknown): void { add(e, h); }
		on(e: string, h: (...a: any[]) => unknown): void { add(e, h); }
		async login(): Promise<void> { ready = true; }
		isReady(): boolean { return ready; }
		async destroy(): Promise<void> { ready = false; }
	}
	const Events = {
		ClientReady: 'ready',
		ShardResume: 'shardResume',
		ShardReconnecting: 'shardReconnecting',
		ShardDisconnect: 'shardDisconnect',
		Error: 'error',
		InteractionCreate: 'interactionCreate',
		TypingStart: 'typingStart',
		MessageCreate: 'messageCreate',
		MessageReactionAdd: 'messageReactionAdd'
	};
	const passthrough = new Proxy({}, { get: () => 1 });
	const module = { Client, GatewayIntentBits: passthrough, Partials: passthrough, Events };
	const emit = (e: string, ...args: any[]): void => (handlers.get(e) ?? []).forEach((h) => h(...args));
	return { module, emit };
}

describe('DiscordAdapter health', () => {
	test('tracks gateway lifecycle and counts resumes as reconnects', async () => {
		const { module, emit } = mockDiscord();
		const a = new DiscordAdapter({ token: 't', discordModule: module });
		const c = ctx();
		await a.start(c);

		emit('ready');
		let h = a.health();
		expect(h.platform).toBe('discord');
		expect(h.state).toBe('open');
		expect(h.connectedSince).not.toBeNull();
		expect(h.lastConnectedAt).not.toBeNull();
		expect(h.reconnects).toBe(0);
		expect(h.terminal).toBe(false);

		emit('shardDisconnect');
		expect(a.health().state).toBe('closed');
		expect(a.health().connectedSince).toBeNull();

		emit('shardResume');
		h = a.health();
		expect(h.state).toBe('open');
		expect(h.reconnects).toBe(1);
		expect(c.conns.map((u) => u.state)).toEqual(['connecting', 'open', 'closed', 'open']);
	});
});

/** A fetch that records calls and answers each with `reply(call)`. */
function recordingFetch(reply: (url: string, init: RequestInit) => unknown = () => ({})) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return new Response(JSON.stringify(reply(url, init)), { status: 200, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

function signer() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const publicHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
	return {
		publicHex,
		request(body: unknown, tamper = false, ageS = 0): InboundRequest {
			const raw = JSON.stringify(body);
			const timestamp = String(Math.floor(Date.now() / 1000) - ageS);
			const signature = cryptoSign(null, Buffer.from(timestamp + raw), privateKey).toString('hex');
			return { body: tamper ? raw + ' ' : raw, headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp } };
		}
	};
}

describe('DiscordAdapter REST helpers', () => {
	test('getMe, registerCommands (global + guild) and api', async () => {
		const { calls, fetchImpl } = recordingFetch((url) => (url.endsWith('/oauth2/applications/@me') ? { id: 'app1' } : { id: 'bot1', username: 'b' }));
		const a = new DiscordAdapter({ token: 'tok', fetchImpl });
		expect((await a.getMe()).id).toBe('bot1');
		expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bot tok');

		await a.registerCommands([{ name: 'ping', description: 'Ping' }]);
		await a.registerCommands([], { guildId: 'g1' });
		expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
			'GET https://discord.com/api/v10/users/@me',
			'GET https://discord.com/api/v10/oauth2/applications/@me',
			'PUT https://discord.com/api/v10/applications/app1/commands',
			'PUT https://discord.com/api/v10/applications/app1/guilds/g1/commands'
		]);
		await a.api('GET', '/gateway');
		expect(calls.at(-1)!.url).toBe('https://discord.com/api/v10/gateway');
	});

	test('a failed call throws, and 429 is marked retryable', async () => {
		const fetchImpl = (async () => new Response('{"message":"slow down"}', { status: 429 })) as unknown as typeof fetch;
		const a = new DiscordAdapter({ token: 't', fetchImpl });
		const error = await a.getMe().catch((e) => e);
		expect(error.message).toContain('429');
		expect(error.retryable).toBe(true);
	});

	test('without a gateway, send/edit/delete/react go over REST', async () => {
		const { calls, fetchImpl } = recordingFetch(() => ({ id: 'm1' }));
		const a = new DiscordAdapter({ token: 't', fetchImpl, gateway: false });
		const c = ctx();
		await a.start(c);
		expect(a.health().state).toBe('open');

		const to = { platform: 'discord' as const, account: 'bot', conversation_id: 'c1', thread_id: null };
		const sent = await a.send({ to, content: { type: 'text', text: 'hi' }, reply_to: 'r1' } as any, c);
		expect(sent.platform_message_id).toBe('m1');
		expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ content: 'hi', message_reference: { message_id: 'r1' } });
		await a.edit({ address: to, platform_message_id: 'm1', content: { type: 'text', text: 'yo' } } as any);
		await a.deleteMessage({ address: to, platform_message_id: 'm1' } as any);
		await a.send({ to, content: { type: 'reaction', emoji: '👍', target_message_id: 'm1' } } as any, c);
		expect(calls.slice(1).map((x) => `${x.init.method} ${x.url.replace('https://discord.com/api/v10', '')}`)).toEqual([
			'PATCH /channels/c1/messages/m1',
			'DELETE /channels/c1/messages/m1',
			`PUT /channels/c1/messages/m1/reactions/${encodeURIComponent('👍')}/@me`
		]);
	});
});

describe('DiscordAdapter HTTP Interactions', () => {
	const user = { id: 'u1', username: 'ann' };

	test('rejects an unsigned, tampered or key-less request', () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false });
		expect(a.verifyInbound(sig.request({ type: 1 }))).toBe(true);
		expect(a.verifyInbound(sig.request({ type: 1 }, true))).toBe(false);
		expect(a.verifyInbound({ body: '{}', headers: {} })).toBe(false);
		expect(new DiscordAdapter({ token: 't' }).verifyInbound(sig.request({ type: 1 }))).toBe(false);
		expect(a.webhookReply(sig.request({ type: 1 }, true))!.status).toBe(401);
	});

	test('a validly signed but stale request is a replay and is rejected', () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false });
		expect(a.verifyInbound(sig.request({ type: 1 }, false, 60))).toBe(true);
		expect(a.verifyInbound(sig.request({ type: 1 }, false, 3600))).toBe(false);
	});

	test('autocomplete is answered with no choices and not delivered; ephemeral commands defer privately', () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false, ephemeralCommands: true });
		const auto = a.webhookReply(sig.request({ type: 4 }))!;
		expect([JSON.parse(auto.body), auto.deliver]).toEqual([{ type: 8, data: { choices: [] } }, false]);
		expect(JSON.parse(a.webhookReply(sig.request({ type: 2 }))!.body)).toEqual({ type: 5, data: { flags: 64 } });
	});

	test('PING → PONG; command → deferred ack + delivery; button → deferred update', () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false });
		expect(JSON.parse(a.webhookReply(sig.request({ type: 1 }))!.body)).toEqual({ type: 1 });
		const cmd = a.webhookReply(sig.request({ type: 2 }))!;
		expect([JSON.parse(cmd.body).type, cmd.deliver]).toEqual([5, true]);
		const btn = a.webhookReply(sig.request({ type: 3 }))!;
		expect([JSON.parse(btn.body).type, btn.deliver]).toEqual([6, true]);
		expect(a.webhookReply(sig.request({ type: 99 }))).toBeNull();
	});

	test('a slash command becomes text with its options; the token is kept for followUp', async () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false });
		const msg = await a.handleInbound(
			sig.request({
				type: 2, id: 'i1', application_id: 'app1', token: 'itok', channel_id: 'c1', member: { user },
				data: { name: 'deploy', options: [{ name: 'env', value: 'prod' }, { name: 'sub', options: [{ name: 'x', value: 1 }] }] }
			})
		);
		expect(msg!.content).toEqual({ type: 'text', text: '/deploy env:prod sub x:1' });
		expect(msg!.address.conversation_id).toBe('c1');
		expect(msg!.event_id).toBe('interaction:i1');
		expect((msg!.raw as any).interaction).toEqual({ id: 'i1', application_id: 'app1', token: 'itok' });
	});

	test('a button or menu press becomes a postback with its own event id', async () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false });
		const press = (id: string, data: object) =>
			a.handleInbound(sig.request({ type: 3, id, channel_id: 'c1', user, message: { id: 'm1' }, data }));
		const one = await press('i1', { custom_id: 'yes' });
		const two = await press('i2', { custom_id: 'menu', values: ['a', 'b'] });
		expect(one!.content).toEqual({ type: 'postback', data: 'yes', title: 'yes' });
		expect(two!.content).toMatchObject({ type: 'postback', data: 'a,b' });
		expect(one!.platform_message_id).toBe('m1');
		expect(one!.event_id).not.toBe(two!.event_id);
		expect(await a.handleInbound(sig.request({ type: 1 }))).toBeNull();
	});

	test('followUp posts to the interaction webhook', async () => {
		const { calls, fetchImpl } = recordingFetch();
		const a = new DiscordAdapter({ token: 't', fetchImpl });
		await a.followUp({ application_id: 'app1', token: 'itok' }, { content: 'done' });
		expect(calls[0]!.url).toBe('https://discord.com/api/v10/webhooks/app1/itok?wait=true');
		expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ content: 'done' });
	});
});

describe('DiscordAdapter interaction responses', () => {
	const user = { id: 'u1', username: 'ann' };
	const cmd = { type: 2, id: 'i1', channel_id: 'c1', user, data: { name: 'ping' } };

	test('commandAck as text replies at once, ephemerally when asked', () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false, commandAck: 'On it', ephemeralCommands: true });
		expect(JSON.parse(a.webhookReply(sig.request(cmd))!.body)).toEqual({ type: 4, data: { content: 'On it', flags: 64 } });
	});

	test('respond decides the initial response (modal, update) and a throwing hook falls back to the ack', () => {
		const sig = signer();
		const respond = (i: any) => (i.command?.name === 'ask' ? { type: 9, data: { custom_id: 'm', title: 'Q', components: [] } } : i.customId === 'next' ? { type: 7, data: { content: 'page 2' } } : undefined);
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false, respond });
		const modal = a.webhookReply(sig.request({ ...cmd, data: { name: 'ask' } }))!;
		expect([JSON.parse(modal.body).type, modal.deliver]).toEqual([9, true]);
		expect(JSON.parse(a.webhookReply(sig.request({ type: 3, id: 'i2', channel_id: 'c1', user, message: { id: 'm1' }, data: { custom_id: 'next' } }))!.body)).toEqual({ type: 7, data: { content: 'page 2' } });
		expect(JSON.parse(a.webhookReply(sig.request(cmd))!.body).type).toBe(5); // respond returned nothing → default
		const boom = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false, respond: () => { throw new Error('x'); } });
		expect(JSON.parse(boom.webhookReply(sig.request(cmd))!.body).type).toBe(5);
	});

	test('a modal submit is a postback carrying its fields; closing depends on where it was opened', async () => {
		const sig = signer();
		const a = new DiscordAdapter({ token: 't', publicKey: sig.publicHex, gateway: false });
		const submit = (extra: object = {}) => ({
			type: 5, id: 'i3', channel_id: 'c1', user, ...extra,
			data: { custom_id: 'feedback', components: [{ type: 1, components: [{ type: 4, custom_id: 'name', value: 'Ann' }, { type: 4, custom_id: 'note', value: 'hi' }] }] }
		});
		const msg = await a.handleInbound(sig.request(submit()));
		expect(msg!.content).toEqual({ type: 'postback', data: 'feedback', title: 'feedback' });
		expect((msg!.raw as any).fields).toEqual({ name: 'Ann', note: 'hi' });
		expect(JSON.parse(a.webhookReply(sig.request(submit()))!.body).type).toBe(5); // from a command
		expect(JSON.parse(a.webhookReply(sig.request(submit({ message: { id: 'm' } })))!.body).type).toBe(6); // from a component
	});

	test('on the Gateway the same hook drives discord.js (showModal / reply / defer)', async () => {
		const { module, emit } = mockDiscord();
		const seen: any[] = [];
		const a = new DiscordAdapter({
			token: 't',
			discordModule: module,
			respond: (i) => (i.command?.name === 'ask' ? { type: 9, data: { title: 'Q' } } : undefined)
		});
		const c = ctx();
		c.events.message = (m) => seen.push(m);
		await a.start(c);
		const calls: string[] = [];
		const base = { id: 'g1', channelId: 'c1', user, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => false, isContextMenuCommand: () => false };
		const command = (name: string) => ({
			...base, commandName: name, isChatInputCommand: () => true,
			showModal: async () => void calls.push('modal'), deferReply: async () => void calls.push('defer')
		});
		emit('interactionCreate', command('ask'));
		emit('interactionCreate', command('plain'));
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toEqual(['modal', 'defer']);
		expect(seen.map((m) => m.content.text)).toEqual(['/ask', '/plain']);
	});
});
