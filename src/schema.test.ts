import { test, expect, describe } from 'bun:test';
import { inbound, text, media, encodeRef, decodeRef, parseMessage, messageKey, reply } from './envelope.js';
import { address, participant, conversationKey, sameConversation } from './address.js';
import { universalMessageSchema, outboundMessageSchema } from './schema.js';

describe('envelope', () => {
	test('inbound builds a valid universal message', () => {
		const msg = inbound({
			platformMessageId: '42',
			address: address({ platform: 'telegram', account: 'bot', conversationId: '100' }),
			from: participant({ platform: 'telegram', account: 'bot', userId: '7', displayName: 'Budi' }),
			content: text('hello') as any
		});
		expect(msg.direction).toBe('inbound');
		expect(msg.content).toEqual({ type: 'text', text: 'hello' });
		expect(() => universalMessageSchema.parse(msg)).not.toThrow();
		expect(msg.id).toBeTruthy();
	});

	test('rejects malformed content', () => {
		expect(() => parseMessage({ id: 'x', direction: 'inbound', timestamp: 't', address: { platform: 'telegram', account: 'a', conversation_id: 'c' }, content: { type: 'nope' } })).toThrow();
	});

	test('native ref codec round-trips', () => {
		const ref = { platform: 'whatsapp_baileys' as const, account: 'wa:1', conversation_id: '62@s.whatsapp.net', message_id: 'ABCD' };
		expect(decodeRef(encodeRef(ref))).toEqual(ref);
	});

	test('messageKey is stable and unique per id', () => {
		expect(messageKey('telegram', 'bot', '1')).toBe('telegram|bot|1');
		expect(messageKey('telegram', 'bot', '1')).not.toBe(messageKey('telegram', 'bot', '2'));
	});
});

describe('content builders & validation', () => {
	test('media builder + outbound schema', () => {
		const out = {
			to: address({ platform: 'discord', account: 'bot', conversationId: 'chan' }),
			content: media({ mediaType: 'image', url: 'https://x/y.png', caption: 'hi' })
		};
		expect(() => outboundMessageSchema.parse(out)).not.toThrow();
	});

	test('media accepts raw bytes', () => {
		const out = {
			to: address({ platform: 'telegram', account: 'bot', conversationId: 'c' }),
			content: media({ mediaType: 'document', data: new Uint8Array([1, 2, 3]), filename: 'a.bin' })
		};
		const parsed = outboundMessageSchema.parse(out);
		expect((parsed.content as any).data).toBeInstanceOf(Uint8Array);
	});

	test('reply targets the source conversation and quotes its native id', () => {
		const msg = inbound({
			platformMessageId: 'native-9',
			address: address({ platform: 'telegram', account: 'bot', conversationId: '100' }),
			content: text('hi') as any
		});
		const out = reply(msg, text('echo'), { idempotencyKey: 'k1' });
		expect(out.to).toEqual(msg.address);
		expect(out.reply_to).toBe('native-9');
		expect(out.idempotency_key).toBe('k1');
		expect(() => outboundMessageSchema.parse(out)).not.toThrow();
	});

	test('reply tolerates a missing native id', () => {
		const msg = inbound({
			address: address({ platform: 'slack', account: 'w', conversationId: 'C1' }),
			content: text('hi') as any
		});
		const out = reply(msg, text('echo'));
		expect(out.reply_to).toBeUndefined();
		expect(() => outboundMessageSchema.parse(out)).not.toThrow();
	});
});

describe('addressing', () => {
	test('conversationKey includes thread', () => {
		const a = address({ platform: 'slack', account: 'w', conversationId: 'C1', threadId: 'T1' });
		const b = address({ platform: 'slack', account: 'w', conversationId: 'C1' });
		expect(conversationKey(a)).toBe('slack:w:C1:T1');
		expect(sameConversation(a, b)).toBe(false);
	});
});
