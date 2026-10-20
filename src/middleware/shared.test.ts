import { test, expect, describe } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ChatKit } from '../chatkit.js';
import { DiscordAdapter } from '../adapters/discord.js';
import { processWebhook } from './shared.js';
import type { InboundRequest } from '../adapter.js';

function setup() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const chat = new ChatKit();
	chat.use(new DiscordAdapter({ token: 't', publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), gateway: false }));
	const seen: unknown[] = [];
	chat.on('message', (m) => void seen.push(m.content));
	const req = (body: unknown, valid = true): InboundRequest => {
		const raw = JSON.stringify(body);
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = valid ? sign(null, Buffer.from(timestamp + raw), privateKey).toString('hex') : '00'.repeat(64);
		return { body: raw, headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp } };
	};
	const run = (r: InboundRequest) => processWebhook({ chat, platform: 'discord', account: 'bot' }, r);
	return { run, req, seen };
}

describe('processWebhook with an adapter reply (Discord interactions)', () => {
	test('PING is answered with PONG and delivers nothing', async () => {
		const { run, req, seen } = setup();
		const res = await run(req({ type: 1 }));
		expect([res.status, res.contentType, JSON.parse(res.body)]).toEqual([200, 'application/json', { type: 1 }]);
		expect(seen).toEqual([]);
	});

	test('a slash command is acked in the response and still delivered', async () => {
		const { run, req, seen } = setup();
		const res = await run(req({ type: 2, id: 'i1', channel_id: 'c1', user: { id: 'u' }, data: { name: 'ping' } }));
		expect(JSON.parse(res.body)).toEqual({ type: 5 });
		await new Promise((r) => setTimeout(r, 0));
		expect(seen).toEqual([{ type: 'text', text: '/ping' }]);
	});

	test('a bad signature is a 401 and delivers nothing', async () => {
		const { run, req, seen } = setup();
		expect((await run(req({ type: 1 }, false))).status).toBe(401);
		expect((await run(req({ type: 2, id: 'i' }, false))).status).toBe(401);
		expect(seen).toEqual([]);
	});
});

describe('processWebhook with a per-request account', () => {
	test('routes one URL to the account the resolver names', async () => {
		const { run: _run, req } = setup();
		void _run;
		const chat = new ChatKit();
		const other = new DiscordAdapter({ token: 't', account: 'other', publicKey: '00'.repeat(32), gateway: false });
		chat.use(other);
		const res = await processWebhook({ chat, platform: 'discord', account: () => 'other' }, req({ type: 1 }));
		expect(res.status).toBe(401); // reached the 'other' adapter (wrong key), not a missing account
		const missing = await processWebhook({ chat, platform: 'discord', account: () => 'nobody' }, req({ type: 1 }));
		expect(missing.status).toBe(400);
	});
});
