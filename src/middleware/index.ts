/**
 * Optional HTTP webhook adapters for popular frameworks. Each returns a handler
 * that verifies the inbound request (signature / secret), answers any handshake
 * challenge, and routes the event into ChatKit's pipeline.
 *
 * ```ts
 * import { hono, express, fastify, elysia } from '@myrialabs/chatkit/middleware';
 * ```
 *
 * The core verification primitives live in `@myrialabs/chatkit/verify`; this
 * module is sugar over `chat.receive()` for the webhook-class adapters
 * (Telegram, WhatsApp Cloud, Slack Events API).
 */

export { hono } from './hono.js';
export { express } from './express.js';
export { fastify } from './fastify.js';
export { elysia } from './elysia.js';
export {
	processWebhook,
	normalizeHeaders,
	normalizeQuery,
	type WebhookHandlerOptions,
	type WebhookResult
} from './shared.js';
