import { test, expect, describe } from 'bun:test';
import { SlackAdapter, slackTeamId } from './slack.js';
import { MemoryStateStore } from '../store/index.js';
import { MediaProxy, MemoryMediaStore } from '../media/index.js';
import { noopSafety } from '../safety/index.js';
import { noopLogger } from '../logger.js';
import type { AdapterContext, ConnectionUpdate } from '../adapter.js';

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

/** A minimal @slack/socket-mode stand-in. */
function mockSocketMode() {
	const handlers = new Map<string, Array<(...a: any[]) => unknown>>();
	class SocketModeClient {
		on(e: string, h: (...a: any[]) => unknown): void {
			const list = handlers.get(e) ?? [];
			list.push(h);
			handlers.set(e, list);
		}
		async start(): Promise<void> {}
		async disconnect(): Promise<void> {}
	}
	const emit = (e: string, ...args: any[]): void => (handlers.get(e) ?? []).forEach((h) => h(...args));
	return { module: { SocketModeClient }, emit };
}

describe('SlackAdapter Socket Mode health', () => {
	test('surfaces socket lifecycle and counts reconnects', async () => {
		const { module, emit } = mockSocketMode();
		const a = new SlackAdapter({ botToken: 'xoxb-t', appToken: 'xapp-t', socketMode: true, socketModeModule: module });
		const c = ctx();
		await a.start(c);

		let h = a.health();
		expect(h.platform).toBe('slack');
		expect(h.state).toBe('open'); // start() connected
		expect(h.lastConnectedAt).not.toBeNull();

		emit('disconnected');
		expect(a.health().state).toBe('closed');

		emit('reconnecting');
		h = a.health();
		expect(h.state).toBe('connecting');
		expect(h.reconnects).toBe(1);

		emit('connected');
		expect(a.health().state).toBe('open');

		// The drop/recover was observable via connection events, not just the initial open.
		const states = c.conns.map((u) => u.state);
		expect(states).toContain('closed');
		expect(states).toContain('connecting');
	});
});

function recordingFetch(reply: unknown = { ok: true }) {
	const calls: Array<{ url: string; body: any }> = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		const raw = init.body as string;
		calls.push({ url, body: raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)) });
		return new Response(JSON.stringify(reply), { status: 200 });
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

describe('SlackAdapter Web API helpers', () => {
	test('authTest and api call the Web API with the bot token', async () => {
		const { calls, fetchImpl } = recordingFetch({ ok: true, user_id: 'U1', team: 'T' });
		const a = new SlackAdapter({ botToken: 'xoxb-t', fetchImpl });
		expect((await a.authTest()).user_id).toBe('U1');
		await a.api('conversations.list', { limit: 5 });
		expect(calls.map((c) => c.url)).toEqual(['https://slack.com/api/auth.test', 'https://slack.com/api/conversations.list']);
		expect(calls[1]!.body).toEqual({ limit: '5' });
	});

	test('an ok:false response throws', async () => {
		const { fetchImpl } = recordingFetch({ ok: false, error: 'invalid_auth' });
		await expect(new SlackAdapter({ botToken: 'x', fetchImpl }).authTest()).rejects.toThrow('invalid_auth');
	});
});

describe('SlackAdapter api() encoding', () => {
	test('sends form fields (read methods ignore JSON), objects as JSON strings', async () => {
		let seen: { type: string; body: string } | undefined;
		const fetchImpl = (async (_u: string, init: RequestInit) => {
			seen = { type: (init.headers as Record<string, string>)['content-type']!, body: init.body as string };
			return new Response('{"ok":true}');
		}) as unknown as typeof fetch;
		await new SlackAdapter({ botToken: 'x', fetchImpl }).api('conversations.list', { limit: 5, types: 'public_channel', blocks: [{ type: 'divider' }], skip: null });
		expect(seen!.type).toBe('application/x-www-form-urlencoded');
		const form = new URLSearchParams(seen!.body);
		expect([form.get('limit'), form.get('types'), form.get('blocks'), form.has('skip')]).toEqual(['5', 'public_channel', '[{"type":"divider"}]', false]);
	});
});

describe('SlackAdapter slash commands and edits', () => {
	const a = new SlackAdapter({ botToken: 'xoxb-t' });

	test('an HTTP slash command becomes the text the user typed', async () => {
		const body = new URLSearchParams({ command: '/deploy', text: 'prod now', channel_id: 'C1', user_id: 'U1', trigger_id: 'T1', response_url: 'https://hooks/x' });
		const msg = await a.handleInbound({ body: body.toString(), headers: {} }, ctx());
		expect(msg!.content).toEqual({ type: 'text', text: '/deploy prod now' });
		expect(msg!.address.conversation_id).toBe('C1');
		expect(msg!.event_id).toBe('command:T1');
		expect((msg!.raw as any).response_url).toBe('https://hooks/x');
	});

	test('a Socket Mode slash command is delivered as a message', async () => {
		const { module, emit } = mockSocketMode();
		const b = new SlackAdapter({ botToken: 'x', appToken: 'y', socketMode: true, socketModeModule: module });
		const seen: any[] = [];
		const c = ctx();
		c.events.message = (m) => seen.push(m);
		await b.start(c);
		emit('slack_event', { ack: async () => {}, body: { command: '/ping', text: '', channel_id: 'C1', user_id: 'U1', trigger_id: 'T2' } });
		await new Promise((r) => setTimeout(r, 0));
		expect(seen[0].content).toEqual({ type: 'text', text: '/ping' });
	});

	test('message_changed is an edit with its own event id; bot edits are ignored', async () => {
		const event = (extra = {}) =>
			JSON.stringify({
				type: 'event_callback',
				event: { type: 'message', subtype: 'message_changed', channel: 'C1', event_ts: '2', message: { ts: '1.1', user: 'U1', text: 'new', edited: { ts: '2.2' }, ...extra } }
			});
		const msg = await a.handleInbound({ body: event(), headers: {} }, ctx());
		expect(msg).toMatchObject({ edited: true, platform_message_id: '1.1', event_id: 'edit:1.1:2.2', content: { type: 'text', text: 'new' } });
		expect(await a.handleInbound({ body: event({ bot_id: 'B1' }), headers: {} }, ctx())).toBeNull();
	});

	test('a link unfurl (message_changed, same text / no edited stamp) is not an edit', async () => {
		const body = (message: object) =>
			JSON.stringify({
				type: 'event_callback',
				event: { type: 'message', subtype: 'message_changed', channel: 'C1', event_ts: '2', previous_message: { ts: '1.1', text: 'see https://x.io' }, message: { ts: '1.1', user: 'U1', text: 'see https://x.io', ...message } }
			});
		expect(await a.handleInbound({ body: body({ attachments: [{}] }), headers: {} }, ctx())).toBeNull();
		expect(await a.handleInbound({ body: body({ edited: { ts: '2.2' } }), headers: {} }, ctx())).toBeNull();
	});
});

describe('SlackAdapter webhook verification default', () => {
	test('without a signing secret every request is rejected unless allowUnverified', () => {
		const req = { body: '{}', headers: {} };
		expect(new SlackAdapter({ botToken: 'x' }).verifyInbound(req)).toBe(false);
		expect(new SlackAdapter({ botToken: 'x', allowUnverified: true }).verifyInbound(req)).toBe(true);
	});
});

describe('Slack multi-workspace', () => {
	test('slackTeamId reads events, commands and interactivity payloads', () => {
		const at = (body: string) => slackTeamId({ body, headers: {} });
		expect(at(JSON.stringify({ team_id: 'T1', type: 'event_callback' }))).toBe('T1');
		expect(at(new URLSearchParams({ command: '/x', team_id: 'T2' }).toString())).toBe('T2');
		expect(at(new URLSearchParams({ payload: JSON.stringify({ team: { id: 'T3' } }) }).toString())).toBe('T3');
		expect(at(JSON.stringify({ type: 'url_verification' }))).toBeNull();
		expect(at('not json {')).toBeNull();
	});

	test('an adapter pinned to a teamId ignores other workspaces', async () => {
		const event = (team: string) => JSON.stringify({ type: 'event_callback', team_id: team, event: { type: 'message', channel: 'C1', user: 'U1', text: 'hi', ts: '1.1' } });
		const a = new SlackAdapter({ botToken: 'x', teamId: 'T1' });
		expect(await a.handleInbound({ body: event('T2'), headers: {} }, ctx())).toBeNull();
		expect((await a.handleInbound({ body: event('T1'), headers: {} }, ctx()))!.content).toMatchObject({ text: 'hi' });
	});
});
