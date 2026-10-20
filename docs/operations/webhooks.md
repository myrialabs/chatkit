# Webhooks & Middleware

Inbound webhook verification is exposed two ways: **pure functions** at
`@myrialabs/chatkit/verify` (use them in any HTTP handler) and **ready handlers**
at `@myrialabs/chatkit/middleware` (Hono / Express / Fastify / Elysia). Most apps
just use the middleware.

Four mechanisms cover every platform:

| Platform | Mechanism | Function |
|---|---|---|
| WhatsApp Cloud | HMAC-SHA256 (`X-Hub-Signature-256`) + GET handshake | `verifyWhatsAppCloud`, `whatsAppCloudChallenge` |
| Slack | HMAC-SHA256 (`v0:ts:body`) + anti-replay + `url_verification` | `verifySlack`, `slackUrlVerification` |
| Telegram | shared secret header | `verifyTelegram` |
| Discord | Ed25519 over `timestamp + body` | `verifyDiscord` |

All comparisons are constant-time and length-safe.

## Pure functions

```ts
import { verifyWhatsAppCloud, verifySlack, verifyTelegram, verifyDiscord } from '@myrialabs/chatkit/verify';

// always verify against the RAW request body bytes
if (!verifyWhatsAppCloud(rawBody, req.headers['x-hub-signature-256'], appSecret)) return res.status(401).end();
if (!verifySlack({ body: rawBody, timestamp: req.headers['x-slack-request-timestamp'], signature: req.headers['x-slack-signature'], signingSecret })) return res.status(401).end();
if (!verifyTelegram(req.headers['x-telegram-bot-api-secret-token'], secretToken)) return res.status(401).end();
if (!verifyDiscord({ body: rawBody, signature: req.headers['x-signature-ed25519'], timestamp: req.headers['x-signature-timestamp'], publicKey })) return res.status(401).end();
```

## Middleware

The middleware does verification, handshakes and routing for you:

```ts
import { hono, express, fastify, elysia } from '@myrialabs/chatkit/middleware';
// `expressLib` below is the Express package itself: import expressLib from 'express';

// Hono / Elysia (Web API runtimes read the raw body natively)
app.post('/webhook/telegram', hono({ chat, platform: 'telegram', account: 'bot' }));

// Express — mount a RAW body parser first
app.post('/webhook/slack', expressLib.raw({ type: '*/*' }), express({ chat, platform: 'slack', account: 'workspace' }));

// Fastify — capture the raw buffer
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
app.post('/webhook/wa', fastify({ chat, platform: 'whatsapp_cloud', account: 'wa:1' }));
```

**Secure by default.** An adapter with no secret configured (Telegram
`secretToken`, Slack `signingSecret`, WhatsApp Cloud `appSecret`, Discord
`publicKey`) rejects every webhook with `401`; `allowUnverified: true` opts a
Telegram / Slack / WhatsApp Cloud adapter out for local experiments.

**One URL, several accounts.** `account` may be a function of the request —
`hono({ chat, platform: 'slack', account: (req) => slackTeamId(req) ?? 'unknown' })`
— for a single endpoint shared by many accounts (a Slack app in many workspaces).

A handler returns `200` (ack / challenge echo), `401` (verification failed) or
`400` (bad payload). Platforms that need more than a bare `200` — Discord's `PING`
and interaction acks, which must be answered in the HTTP response itself — expose a
`webhookReply(req)` on the adapter; the handler sends that, and still delivers the
event to `chat.on('message')` when the reply says it carries one.

## Anti-replay

`verifySlack` already enforces a ±5-minute timestamp window. For stronger
guarantees, pair a verifier with a nonce check using the store:

```ts
import { withinReplayWindow } from '@myrialabs/chatkit/verify';
if (!withinReplayWindow(ts)) reject();
if (!(await chat.store.seen(`replay:${signature}`, 5 * 60_000))) reject(); // first time only
```

> **Why the raw body matters:** signatures are computed over the exact bytes
> received. If your framework parses JSON before you verify, re-serializing will
> change whitespace/ordering and the signature will not match. Always verify
> against the unmodified body.
