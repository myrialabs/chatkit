import { test, expect, describe } from 'bun:test';
import { WhatsAppCloudAdapter } from './whatsapp-cloud.js';

function recordingFetch(reply: unknown = {}) {
	const calls: Array<{ method: string; url: string; body?: any }> = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body as string) : undefined });
		return new Response(JSON.stringify(reply), { status: 200 });
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

const base = { account: 'wa:cloud', phoneNumberId: 'P1', token: 'tok' };

describe('WhatsAppCloudAdapter Graph helpers', () => {
	test('getPhoneNumber reads the sending number', async () => {
		const { calls, fetchImpl } = recordingFetch({ id: 'P1', display_phone_number: '+62 811', verified_name: 'Acme', quality_rating: 'GREEN' });
		const a = new WhatsAppCloudAdapter({ ...base, fetchImpl });
		expect((await a.getPhoneNumber()).quality_rating).toBe('GREEN');
		expect(calls[0]!.url).toStartWith('https://graph.facebook.com/v21.0/P1?fields=');
	});

	test('account-level helpers need businessAccountId', async () => {
		const a = new WhatsAppCloudAdapter(base);
		await expect(a.subscribeApp()).rejects.toThrow('businessAccountId');
		await expect(a.listTemplates()).rejects.toThrow('businessAccountId');
	});

	test('subscribeApp and the template helpers hit the WABA edges', async () => {
		const { calls, fetchImpl } = recordingFetch({ data: [{ id: 't1', name: 'order_update', status: 'APPROVED' }] });
		const a = new WhatsAppCloudAdapter({ ...base, businessAccountId: 'W1', fetchImpl });
		await a.subscribeApp();
		const list = await a.listTemplates({ status: 'APPROVED', limit: 10 });
		expect(list[0]!.name).toBe('order_update');
		await a.createTemplate({ name: 'hello', language: 'en_US', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi' }] });
		await a.deleteTemplate('hello');
		expect(calls.map((c) => `${c.method} ${c.url.replace('https://graph.facebook.com/v21.0/', '')}`)).toEqual([
			'POST W1/subscribed_apps',
			'GET W1/message_templates?limit=10&status=APPROVED',
			'POST W1/message_templates',
			'DELETE W1/message_templates?name=hello'
		]);
		expect(calls[2]!.body.name).toBe('hello');
	});

	test('listTemplates follows paging up to the limit', async () => {
		const pages = [
			{ data: [{ name: 'a' }, { name: 'b' }], paging: { cursors: { after: 'c1' }, next: 'https://next' } },
			{ data: [{ name: 'c' }], paging: { cursors: { after: 'c2' } } }
		];
		const urls: string[] = [];
		const fetchImpl = (async (url: string) => {
			urls.push(url);
			return new Response(JSON.stringify(pages.shift()));
		}) as unknown as typeof fetch;
		const a = new WhatsAppCloudAdapter({ ...base, businessAccountId: 'W1', fetchImpl });
		expect((await a.listTemplates()).map((t) => t.name)).toEqual(['a', 'b', 'c']);
		expect(urls[1]).toContain('after=c1');
		pages.push({ data: [{ name: 'a' }, { name: 'b' }], paging: { cursors: { after: 'c1' }, next: 'x' } } as any);
		expect((await a.listTemplates({ limit: 1 })).map((t) => t.name)).toEqual(['a']);
	});

	test('api reaches any endpoint; Graph errors throw, 429 is retryable', async () => {
		const { calls, fetchImpl } = recordingFetch({ ok: 1 });
		const a = new WhatsAppCloudAdapter({ ...base, fetchImpl });
		await a.api('POST', '/P1/whatsapp_business_profile', { messaging_product: 'whatsapp', about: 'hi' });
		expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/P1/whatsapp_business_profile');
		const limited = new WhatsAppCloudAdapter({ ...base, fetchImpl: (async () => new Response('{"error":{"message":"x"}}', { status: 429 })) as unknown as typeof fetch });
		const error = await limited.getPhoneNumber().catch((e) => e);
		expect(error.retryable).toBe(true);
	});
});

describe('WhatsAppCloudAdapter webhook verification default', () => {
	test('without an app secret POSTs are rejected unless allowUnverified; the GET handshake needs none', () => {
		const post = { method: 'POST', body: '{}', headers: {} };
		expect(new WhatsAppCloudAdapter(base).verifyInbound(post)).toBe(false);
		expect(new WhatsAppCloudAdapter({ ...base, allowUnverified: true }).verifyInbound(post)).toBe(true);
		expect(new WhatsAppCloudAdapter(base).verifyInbound({ method: 'GET', body: '', headers: {} })).toBe(true);
	});
});
