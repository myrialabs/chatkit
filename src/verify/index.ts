/**
 * Pure, framework-agnostic inbound verification (`@myrialabs/chatkit/verify`).
 * Three families cover every platform:
 *
 *   - HMAC-SHA256  — WhatsApp Cloud (`X-Hub-Signature-256`) and Slack signing;
 *   - shared secret — Telegram (`X-Telegram-Bot-Api-Secret-Token`);
 *   - Ed25519       — Discord interactions (`X-Signature-Ed25519`).
 *
 * Plus an anti-replay timestamp check. These functions never touch the network
 * and have no framework dependency — call them from any HTTP handler, or use
 * `@myrialabs/chatkit/middleware`.
 */

import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

function toBuffer(body: string | Uint8Array): Buffer {
	return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

/** Constant-time equality for two strings/buffers (length-safe). */
export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
	const ba = toBuffer(a);
	const bb = toBuffer(b);
	if (ba.length !== bb.length) return false;
	return timingSafeEqual(ba, bb);
}

/** Raw HMAC-SHA256 of `body` with `secret`, lower-case hex. */
export function hmacSha256Hex(body: string | Uint8Array, secret: string): string {
	return createHmac('sha256', secret).update(toBuffer(body)).digest('hex');
}

/**
 * Verify a WhatsApp Cloud webhook. `signatureHeader` is the raw
 * `X-Hub-Signature-256` value (`sha256=<hex>`); HMAC is keyed with the app secret
 * over the *raw* request body.
 */
export function verifyWhatsAppCloud(
	body: string | Uint8Array,
	signatureHeader: string | undefined | null,
	appSecret: string
): boolean {
	if (!signatureHeader) return false;
	const expected = 'sha256=' + hmacSha256Hex(body, appSecret);
	return safeEqual(signatureHeader, expected);
}

/**
 * Handle the WhatsApp Cloud GET verification handshake. Returns the
 * `hub.challenge` to echo back when the verify token matches, else `null`.
 */
export function whatsAppCloudChallenge(
	query: Record<string, string | undefined>,
	verifyToken: string
): string | null {
	if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
		return query['hub.challenge'] ?? null;
	}
	return null;
}

export interface SlackVerifyInput {
	body: string | Uint8Array;
	timestamp: string | undefined | null;
	signature: string | undefined | null;
	signingSecret: string;
	/** Anti-replay window in seconds. Default 300 (±5 min). */
	toleranceSec?: number;
	/** Override "now" (seconds) for testing. */
	nowSec?: number;
}

/**
 * Verify a Slack request: `X-Slack-Signature` = `v0=` + HMAC-SHA256 of
 * `v0:{timestamp}:{body}`, plus an anti-replay check on `X-Slack-Request-Timestamp`.
 */
export function verifySlack(input: SlackVerifyInput): boolean {
	if (!input.timestamp || !input.signature) return false;
	const ts = Number(input.timestamp);
	if (!Number.isFinite(ts)) return false;
	const now = input.nowSec ?? Math.floor(Date.now() / 1000);
	if (Math.abs(now - ts) > (input.toleranceSec ?? 300)) return false;

	const base = `v0:${input.timestamp}:${toBuffer(input.body).toString('utf8')}`;
	const expected = 'v0=' + createHmac('sha256', input.signingSecret).update(base).digest('hex');
	return safeEqual(input.signature, expected);
}

/** Handle the Slack `url_verification` challenge; returns the challenge or `null`. */
export function slackUrlVerification(parsedBody: unknown): string | null {
	const b = parsedBody as { type?: string; challenge?: string } | null;
	return b?.type === 'url_verification' ? (b.challenge ?? null) : null;
}

/** Verify Telegram's shared secret header against the configured secret token. */
export function verifyTelegram(headerToken: string | undefined | null, secretToken: string): boolean {
	if (!headerToken) return false;
	return safeEqual(headerToken, secretToken);
}

// DER (SPKI) prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface DiscordVerifyInput {
	body: string | Uint8Array;
	signature: string | undefined | null;
	timestamp: string | undefined | null;
	/** The application's Ed25519 public key, hex-encoded (Developer Portal). */
	publicKey: string;
}

/**
 * Verify a Discord interaction: Ed25519 signature over `timestamp + body`, using
 * the application public key. Wraps the raw 32-byte key into SPKI for `node:crypto`.
 */
export function verifyDiscord(input: DiscordVerifyInput): boolean {
	if (!input.signature || !input.timestamp) return false;
	try {
		const keyDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(input.publicKey, 'hex')]);
		const key = createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
		const message = Buffer.concat([Buffer.from(input.timestamp, 'utf8'), toBuffer(input.body)]);
		const sig = Buffer.from(input.signature, 'hex');
		return cryptoVerify(null, message, key, sig);
	} catch {
		return false;
	}
}

/**
 * Generic anti-replay check: returns `true` when `timestampSec` is within
 * `toleranceSec` of now. Pair with a `StateStore.seen()` nonce check for full
 * replay protection.
 */
export function withinReplayWindow(
	timestampSec: number,
	toleranceSec = 300,
	nowSec = Math.floor(Date.now() / 1000)
): boolean {
	return Number.isFinite(timestampSec) && Math.abs(nowSec - timestampSec) <= toleranceSec;
}
