import { test, expect, describe } from 'bun:test';
import { WhatsAppBaileysAdapter } from './whatsapp.js';
import { MemoryStateStore } from '../store/index.js';
import { MediaProxy, MemoryMediaStore } from '../media/index.js';
import { noopSafety } from '../safety/index.js';
import type { Logger } from '../logger.js';
import type { AdapterContext } from '../adapter.js';

/** A logger that records every line, so tests can assert on level/message/fields. */
function recordingLogger(): Logger & { lines: Array<{ level: string; message: string; fields?: any }> } {
	const lines: Array<{ level: string; message: string; fields?: any }> = [];
	const push = (level: string) => (message: string, fields?: any) => lines.push({ level, message, fields });
	return { lines, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

function ctx(logger: Logger): AdapterContext & { errors: Error[] } {
	const errors: Error[] = [];
	return {
		store: new MemoryStateStore({ stateKey: 'test-key' }),
		media: new MediaProxy(new MemoryMediaStore()),
		logger,
		// Zero backoff so scheduled reconnects fire on the next macrotask in tests.
		safety: { ...noopSafety, backoffDelay: () => 0 },
		events: {
			message: () => {},
			reaction: () => {},
			status: () => {},
			connection: () => {},
			presence: () => {},
			error: (e) => errors.push(e)
		},
		errors
	};
}

interface MockSock {
	config: any;
	emit(event: string, payload: unknown): void;
}

/** A minimal Baileys stand-in. Each `makeWASocket` call appends a fresh sock. */
function mockBaileys(socks: MockSock[]) {
	const DisconnectReason = {
		connectionClosed: 428,
		connectionLost: 408,
		connectionReplaced: 440,
		timedOut: 408,
		loggedOut: 401,
		badSession: 500,
		restartRequired: 515,
		forbidden: 403
	};
	const makeWASocket = (config: any) => {
		const handlers = new Map<string, (payload: unknown) => unknown>();
		const sock = {
			config,
			ev: { on: (event: string, handler: (payload: unknown) => unknown) => handlers.set(event, handler) },
			emit: (event: string, payload: unknown) => handlers.get(event)?.(payload),
			end: () => {},
			sendMessage: async () => ({ key: { id: 'x' } }),
			sendPresenceUpdate: async () => {}
		};
		socks.push(sock);
		return sock;
	};
	return {
		default: makeWASocket,
		DisconnectReason,
		fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
		initAuthCreds: () => ({}),
		BufferJSON: { replacer: (_k: string, v: unknown) => v, reviver: (_k: string, v: unknown) => v },
		proto: { Message: { AppStateSyncKeyData: { fromObject: (o: unknown) => o } } }
	};
}

const close = (statusCode: number) => ({
	connection: 'close',
	lastDisconnect: { error: { output: { statusCode } } }
});

/** Let a `setTimeout(0)` reconnect (and its async auth read) run to completion. */
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('WhatsAppBaileysAdapter version resolution', () => {
	test('announces the fetched WhatsApp-web version on the socket', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });

		await adapter.start(c);
		// A stale bundled version is what causes the 405 — passing the resolved one fixes it.
		expect(socks[0]!.config.version).toEqual([2, 3000, 1]);
	});

	test('honours an explicitly pinned version', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({
			account: 'wa:1',
			version: [2, 9999, 9],
			baileysModule: mockBaileys(socks)
		});

		await adapter.start(c);
		expect(socks[0]!.config.version).toEqual([2, 9999, 9]);
	});

	test('falls back gracefully when the version lookup is unavailable', async () => {
		const socks: MockSock[] = [];
		const logger = recordingLogger();
		const c = ctx(logger);
		const mod = mockBaileys(socks);
		delete (mod as any).fetchLatestBaileysVersion; // simulate an old/partial module or offline lookup
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mod });

		await adapter.start(c);
		// Connection still attempts (with Baileys' default version) and the risk is logged.
		expect(socks).toHaveLength(1);
		expect(socks[0]!.config.version).toBeUndefined();
		expect(logger.lines.some((l) => l.level === 'warn' && /version/i.test(l.message))).toBe(true);
	});
});

describe('WhatsAppBaileysAdapter inbound rich content', () => {
	/** Start an adapter and return the events it emits for a single upsert. */
	async function ingest(message: unknown, key?: Record<string, unknown>) {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const messages: any[] = [];
		const presences: any[] = [];
		c.events.message = (m) => messages.push(m);
		c.events.presence = (p) => presences.push(p);
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });
		await adapter.start(c);
		socks[0]!.emit('messages.upsert', {
			type: 'notify',
			messages: [{ key: { remoteJid: '6281@s.whatsapp.net', id: 'm1', ...key }, pushName: 'Alice', messageTimestamp: 1_700_000_000, message }]
		});
		await tick();
		return { messages, presences };
	}

	test('normalises a shared contact vCard to a contact message', async () => {
		const { messages } = await ingest({ contactMessage: { displayName: 'Bob', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Bob\nTEL;type=CELL;waid=628999:628999\nEND:VCARD' } });
		expect(messages).toHaveLength(1);
		expect(messages[0].content).toEqual({ type: 'contact', name: 'Bob', phone: '628999' });
	});

	test('normalises a button/list reply to a postback', async () => {
		const btn = await ingest({ buttonsResponseMessage: { selectedButtonId: 'yes', selectedDisplayText: 'Yes' } });
		expect(btn.messages[0].content).toEqual({ type: 'postback', data: 'yes', title: 'Yes' });
		const list = await ingest({ listResponseMessage: { title: 'Small', singleSelectReply: { selectedRowId: 'sz_s' } } });
		expect(list.messages[0].content).toEqual({ type: 'postback', data: 'sz_s', title: 'Small' });
	});


	test('an inbound message emits a paused presence so the typing indicator clears', async () => {
		const { messages, presences } = await ingest({ conversation: 'hi' });
		expect(messages[0].content).toEqual({ type: 'text', text: 'hi' });
		const paused = presences.find((p) => p.state === 'paused');
		expect(paused).toBeDefined();
		expect(paused.conversation_id).toBe('6281@s.whatsapp.net');
	});

	test('strips the device suffix so a peer keys consistently', async () => {
		const { messages } = await ingest({ conversation: 'hi' }, { remoteJid: '6281:12@s.whatsapp.net' });
		expect(messages[0].address.conversation_id).toBe('6281@s.whatsapp.net');
	});
});

describe('WhatsAppBaileysAdapter reconnect handling', () => {
	test('bounds reconnects and surfaces the disconnect status code', async () => {
		const socks: MockSock[] = [];
		const logger = recordingLogger();
		const c = ctx(logger);
		const adapter = new WhatsAppBaileysAdapter({
			account: 'wa:1',
			maxReconnectAttempts: 2,
			baileysModule: mockBaileys(socks)
		});

		await adapter.start(c);
		expect(socks).toHaveLength(1);

		// 405 is not a mapped DisconnectReason, so it is treated as a generic failure.
		socks[0]!.emit('connection.update', close(405));
		await tick();
		expect(socks).toHaveLength(2); // reconnect #1

		socks[1]!.emit('connection.update', close(405));
		await tick();
		expect(socks).toHaveLength(3); // reconnect #2

		// The third failure exceeds maxReconnectAttempts → give up, no new socket.
		socks[2]!.emit('connection.update', close(405));
		await tick();
		expect(socks).toHaveLength(3);

		// The cause is reported, not swallowed.
		expect(c.errors).toHaveLength(1);
		expect(c.errors[0]!.message).toContain('405');
		expect(c.errors[0]!.message.toLowerCase()).toContain('rate-limiting');

		// The status code reached the logs on every close.
		const warn = logger.lines.find((l) => l.level === 'warn' && l.fields?.code === 405);
		expect(warn).toBeDefined();
		expect(logger.lines.some((l) => l.level === 'error')).toBe(true);
	});

	test('clears auth state and does not reconnect on logout', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		await c.store.secretSet('wa-auth:wa:1', 'creds', '{}'); // pretend creds exist
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });

		await adapter.start(c);
		socks[0]!.emit('connection.update', close(401)); // loggedOut
		await tick();

		expect(socks).toHaveLength(1); // no reconnect
		expect(await c.store.secretList('wa-auth:wa:1')).toHaveLength(0); // auth cleared
		expect(c.errors).toHaveLength(0);
	});

	test('does not reconnect when the session is replaced', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });

		await adapter.start(c);
		socks[0]!.emit('connection.update', close(440)); // connectionReplaced
		await tick();

		expect(socks).toHaveLength(1); // no reconnect
		expect(c.errors).toHaveLength(1);
		expect(c.errors[0]!.message).toContain('connectionReplaced');
	});

	test('restartRequired reconnects without consuming the failure budget', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({
			account: 'wa:1',
			maxReconnectAttempts: 2,
			baileysModule: mockBaileys(socks)
		});

		await adapter.start(c);
		// Three restarts — more than maxReconnectAttempts — must all reconnect.
		for (let i = 0; i < 3; i++) {
			socks[socks.length - 1]!.emit('connection.update', close(515));
			await tick();
		}

		expect(socks).toHaveLength(4); // initial + 3 reconnects
		expect(c.errors).toHaveLength(0); // never gave up
	});

	test('retries transient drops indefinitely once connected (self-heals)', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', maxReconnectAttempts: 2, baileysModule: mockBaileys(socks) });

		await adapter.start(c);
		socks[0]!.emit('connection.update', { connection: 'open' }); // now "everConnected"
		// Far more failures than maxReconnectAttempts — a 24/7 gateway must keep healing.
		for (let i = 0; i < 5; i++) {
			socks[socks.length - 1]!.emit('connection.update', close(428));
			await tick();
		}
		expect(socks).toHaveLength(6); // initial + 5 reconnects, never gave up
		expect(c.errors).toHaveLength(0);
		expect(adapter.health().reconnects).toBe(5);
	});

	test('forbidden (403) flags the account at risk, stops, and can be resumed', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		let flagged: string | null = null;
		c.safety = { ...c.safety, flagAtRisk: (account: string) => { flagged = account; } };
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });

		await adapter.start(c);
		socks[0]!.emit('connection.update', close(403));
		await tick();

		expect(socks).toHaveLength(1); // terminal — no reconnect
		expect(flagged).toBe('wa:1');
		expect(c.errors[0]!.message.toLowerCase()).toContain('forbidden');
		expect(adapter.health().terminal).toBe(true);

		// Once the root cause is fixed, a manual reconnect() re-arms the connection.
		expect(adapter.reconnect()).toBe(true);
		await tick();
		expect(socks).toHaveLength(2);
		expect(adapter.health().terminal).toBe(false);
		expect(adapter.reconnect()).toBe(false); // nothing to resume anymore
	});

	test('health reports state, last-connected and reconnect count', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });

		await adapter.start(c);
		expect(adapter.health().lastConnectedAt).toBeNull();
		socks[0]!.emit('connection.update', { connection: 'open' });
		const open = adapter.health();
		expect(open.state).toBe('open');
		expect(open.connectedSince).not.toBeNull();
		expect(open.reconnects).toBe(0);

		socks[0]!.emit('connection.update', close(428));
		await tick();
		expect(adapter.health().reconnects).toBe(1);
	});

	test('auto-warms a freshly paired number', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		let warmUntil: number | null = null;
		c.safety = { ...c.safety, setWarmup: (_a: string, until: number | null) => { warmUntil = until; } };
		const adapter = new WhatsAppBaileysAdapter({ account: 'wa:1', baileysModule: mockBaileys(socks) });

		await adapter.start(c); // no stored creds → fresh pairing
		socks[0]!.emit('connection.update', { connection: 'open' });
		await tick();

		expect(warmUntil).not.toBeNull();
		expect(await c.store.kvGet('wa-meta:wa:1', 'paired-at')).not.toBeNull();
	});

	test('resets the failure budget after a successful open', async () => {
		const socks: MockSock[] = [];
		const c = ctx(recordingLogger());
		const adapter = new WhatsAppBaileysAdapter({
			account: 'wa:1',
			maxReconnectAttempts: 2,
			baileysModule: mockBaileys(socks)
		});

		await adapter.start(c);
		socks[0]!.emit('connection.update', close(428));
		await tick();
		socks[1]!.emit('connection.update', { connection: 'open' }); // recovered
		// Budget is reset, so two more failures are tolerated again.
		socks[1]!.emit('connection.update', close(428));
		await tick();
		socks[2]!.emit('connection.update', close(428));
		await tick();

		expect(socks).toHaveLength(4);
		expect(c.errors).toHaveLength(0);
	});
});

