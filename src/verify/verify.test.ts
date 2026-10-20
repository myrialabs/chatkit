import { test, expect, describe } from 'bun:test';
import { createHmac, generateKeyPairSync, sign as edSign } from 'node:crypto';
import {
	hmacSha256Hex,
	safeEqual,
	verifyWhatsAppCloud,
	whatsAppCloudChallenge,
	verifySlack,
	slackUrlVerification,
	verifyTelegram,
	verifyDiscord,
	withinReplayWindow
} from './index.js';

describe('hmac family', () => {
	test('safeEqual is length-safe', () => {
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
		expect(safeEqual('abc', 'abcd')).toBe(false);
	});

	test('WhatsApp Cloud signature', () => {
		const body = '{"hello":"world"}';
		const secret = 'app-secret';
		const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
		expect(verifyWhatsAppCloud(body, sig, secret)).toBe(true);
		expect(verifyWhatsAppCloud(body, sig, 'wrong')).toBe(false);
		expect(verifyWhatsAppCloud(body, undefined, secret)).toBe(false);
		expect(hmacSha256Hex(body, secret)).toHaveLength(64);
	});

	test('WhatsApp Cloud GET challenge', () => {
		const q = { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '12345' };
		expect(whatsAppCloudChallenge(q, 'vt')).toBe('12345');
		expect(whatsAppCloudChallenge(q, 'nope')).toBeNull();
	});
});

describe('slack', () => {
	const secret = 'slack-signing-secret';
	const body = 'token=x&team_id=T';
	const ts = String(Math.floor(Date.now() / 1000));
	const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');

	test('valid signature within window', () => {
		expect(verifySlack({ body, timestamp: ts, signature: sig, signingSecret: secret })).toBe(true);
	});

	test('rejects replay outside window', () => {
		const old = String(Math.floor(Date.now() / 1000) - 10_000);
		const oldSig = 'v0=' + createHmac('sha256', secret).update(`v0:${old}:${body}`).digest('hex');
		expect(verifySlack({ body, timestamp: old, signature: oldSig, signingSecret: secret })).toBe(false);
	});

	test('rejects tampered body', () => {
		expect(verifySlack({ body: body + 'x', timestamp: ts, signature: sig, signingSecret: secret })).toBe(false);
	});

	test('url_verification challenge', () => {
		expect(slackUrlVerification({ type: 'url_verification', challenge: 'abc' })).toBe('abc');
		expect(slackUrlVerification({ type: 'event_callback' })).toBeNull();
	});
});

describe('telegram', () => {
	test('secret token compare', () => {
		expect(verifyTelegram('s3cret', 's3cret')).toBe(true);
		expect(verifyTelegram('s3cret', 'other')).toBe(false);
		expect(verifyTelegram(undefined, 's3cret')).toBe(false);
	});
});

describe('discord ed25519', () => {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
	const body = '{"type":1}';
	const timestamp = '1700000000';
	const signature = edSign(null, Buffer.from(timestamp + body), privateKey).toString('hex');

	test('verifies a valid signature', () => {
		expect(verifyDiscord({ body, signature, timestamp, publicKey: rawPub })).toBe(true);
	});

	test('rejects tampered body / bad key', () => {
		expect(verifyDiscord({ body: body + 'x', signature, timestamp, publicKey: rawPub })).toBe(false);
		expect(verifyDiscord({ body, signature, timestamp, publicKey: '00'.repeat(32) })).toBe(false);
		expect(verifyDiscord({ body, signature: undefined, timestamp, publicKey: rawPub })).toBe(false);
	});
});

describe('anti-replay', () => {
	test('window check', () => {
		const now = 1000;
		expect(withinReplayWindow(1000, 300, now)).toBe(true);
		expect(withinReplayWindow(600, 300, now)).toBe(false);
	});
});
