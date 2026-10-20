<p align="center">
  <img src="https://chatkit.myrialabs.dev/favicon.svg" alt="ChatKit" width="72" height="72" />
</p>

<h1 align="center">ChatKit</h1>

<p align="center">
  <strong>One unified, typed API to receive and send messages across chat platforms.</strong><br />
  Telegram · WhatsApp (Baileys &amp; Cloud API) · Discord · Slack —
  a universal message envelope, honest capability descriptors, and a built-in
  WhatsApp safety layer.
</p>

<p align="center">
  <a href="https://chatkit.myrialabs.dev/">Website</a> ·
  <a href="https://www.npmjs.com/package/@myrialabs/chatkit">npm</a> ·
  <a href="./docs/reference/api.md">API reference</a> ·
  <a href="./docs/operations/runbook.md">Risk runbook</a> ·
  <a href="./examples/README.md">Examples</a> ·
  <a href="https://github.com/myrialabs/chatkit/issues">Issues</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@myrialabs/chatkit"><img src="https://img.shields.io/npm/v/@myrialabs/chatkit" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/runtime-Node%2022.13%2B%20%7C%20Bun%201.1%2B-black" alt="Node 22.13+ and Bun 1.1+" />
</p>

---

ChatKit is a **library, not a service**. You `import` it into your own process and
get one API for two-way messaging across platforms: a universal envelope for
inbound and outbound, addressing that stays stable for replies, and an honest
capability model so unsupported features fail loudly instead of silently. Rich,
platform-specific features (Slack Block Kit, Discord embeds, WhatsApp templates)
are reachable through a raw passthrough — the core stays small and truthful.

```ts
import { ChatKit, text } from '@myrialabs/chatkit';
import { TelegramAdapter, WhatsAppBaileysAdapter } from '@myrialabs/chatkit/adapters';

const chat = new ChatKit();                       // defaults: in-memory store + media

chat.use(new TelegramAdapter({ token: process.env.TELEGRAM_TOKEN!, account: 'bot:myshop' }));
chat.use(new WhatsAppBaileysAdapter({ account: 'wa:62…' }));   // safety on by default

chat.on('message', async (m) => {
  if (m.content.type === 'text') {
    await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
  }
});

await chat.start();                               // hold persistent connections open
```

## Why ChatKit

- **One envelope, every platform** — inbound events normalise to a single
  `UniversalMessage`; `chat.send()` takes the same shape back. Text, media, reply,
  reaction, location, contact, and button presses (`postback`).
- **Honest capabilities** — `chat.capabilities(platform)` tells you what's real, and
  `send()` is gated by it. Ask for something a platform can't do and you get a clear
  `CapabilityError`, never a silent no-op.
- **Two WhatsApp paths, one interface** — Baileys (free, self-hosted, ban risk) and
  the official Cloud API both implement `WhatsAppAdapter`; swap them per account
  without touching your code.
- **A real WhatsApp safety layer** — on by default: 24-hour session window, typing
  simulation, read receipts, throttling with jitter, a gradual warming ramp,
  opt-in enforcement, and an auto-halt on WhatsApp's `403` ban signal.
- **Built to stay up** — reconnects survive restarts without re-pairing, transient
  drops retry with capped backoff, and `chat.health()` exposes per-account state.
- **Light on the box** — no Chromium, no history sync, media streams to/from disk.
- **Self-contained** — no Postgres/Redis/S3 required. In-memory and SQLite state,
  in-memory and filesystem media; both are ports you can replace.
- **Secure by construction** — pure inbound verifiers, AES-256-GCM at-rest
  encryption for auth state, no credentials in logs.
- **Typed & quiet** — TypeScript-first, subpath exports, and a silent core
  (diagnostics go through an injected `Logger`, never stdout).

## Install

```sh
bun add @myrialabs/chatkit      # or: npm i @myrialabs/chatkit / pnpm add @myrialabs/chatkit
bun add -g @myrialabs/chatkit   # optional: the CLI (chatkit pair / send / capabilities)
```

Requires **Node ≥ 22.13** or **Bun ≥ 1.1** (older versions are rejected with a clear
error when `ChatKit` is constructed). Both ship SQLite built in, so persistence needs
no extra install. The platform SDKs (`discord.js`, `@slack/*`, `@whiskeysockets/baileys`)
are regular `dependencies`, so one install covers every platform — nothing else to add
per adapter. They load lazily, only when that platform starts: Telegram and the
WhatsApp Cloud API never touch them, and an unused adapter never loads its SDK (the
packages are still downloaded, so the install is larger than the core alone).

## Supported platforms

| | Telegram | WhatsApp (Baileys) | WhatsApp (Cloud) | Discord | Slack |
|---|:--:|:--:|:--:|:--:|:--:|
| Inbound | polling / webhook | persistent WS | webhook | Gateway WS / HTTP Interactions | Events HTTP / Socket Mode |
| Verification | secret token | — (socket) | HMAC-SHA256 | Ed25519 (HTTP mode) | signing secret |
| Reactions / reply | ✅ | ✅ | ✅ | ✅ | ✅ |
| Passthrough | any Bot API method | raw node | template / interactive | embeds / components | Block Kit |

Persistent adapters (Baileys, Discord Gateway, Slack Socket Mode) need a host process
that stays alive; webhook adapters can run scale-to-zero. Each adapter also carries its
platform's setup calls (`getMe`, `setWebhook`, `registerCommands`, `authTest`,
`subscribeApp`, …) plus `api()` for anything else — no `curl` needed.

## Usage at a glance

```ts
import { text, media, reaction, reply, richText, rt } from '@myrialabs/chatkit';

chat.on('message', (m) => chat.send(reply(m, text('got it'))));                     // reply, quoting the original
await chat.send({ to, content: media({ mediaType: 'image', url: 'https://…/a.png', caption: 'hi' }) });
await chat.send({ to, content: reaction('👍', nativeMessageId) });
await chat.send({ to, content: richText([rt.bold('Order #42'), rt.plain(' shipped')]) });
await chat.edit({ address, platform_message_id, content: text('fixed') });

// Platform-specific richness goes through typed builders or raw passthrough:
import { telegramButtons } from '@myrialabs/chatkit/interactive';
await chat.send({ to, ...telegramButtons('Pick one', [[{ text: 'A', data: 'a' }]]) });
```

Webhook platforms plug into your HTTP framework with ready handlers (Hono, Express,
Fastify, Elysia) that verify signatures and answer handshakes:

```ts
import { hono } from '@myrialabs/chatkit/middleware';
app.post('/webhook/telegram', hono({ chat, platform: 'telegram', account: 'bot:myshop' }));
```

Persist state and media by swapping the ports:

```ts
import { SqliteStore } from '@myrialabs/chatkit/store';
import { FileMediaStore } from '@myrialabs/chatkit/media';

const chat = new ChatKit({
  store: new SqliteStore({ path: 'chatkit.db', stateKey: process.env.CHATKIT_STATE_KEY }),
  media: new FileMediaStore({ dir: 'media', baseUrl: 'https://cdn.example.com/media' })
});
```

> ⚠️ **Baileys is unofficial and carries a real ban risk.** Always use a test
> number, keep the safety layer on, and read the [risk runbook](./docs/operations/runbook.md).

## CLI

```sh
chatkit pair --account wa:62…              # pair a WhatsApp (Baileys) number by QR
chatkit send --platform telegram --token T --to 12345 --text "hi"
chatkit capabilities discord               # print a platform's capability descriptor
```

## Documentation

| Start here | |
|---|---|
| [Quickstart](./docs/getting-started/quickstart.md) | Install, first bot, core loop |
| [Core concepts](./docs/essential/core-concepts.md) | Envelope, addressing, capabilities, sending, rich text, interactive, state & media |
| [Channels](./docs/channels/telegram.md) | [Telegram](./docs/channels/telegram.md) · [WhatsApp](./docs/channels/whatsapp.md) · [Discord](./docs/channels/discord.md) · [Slack](./docs/channels/slack.md) |
| [Webhooks & middleware](./docs/operations/webhooks.md) | Verification, handlers, raw-body rules |
| [CLI reference](./docs/operations/cli.md) | Every command and flag |
| [Risk runbook](./docs/operations/runbook.md) | WhatsApp bans, reconnects, backups, scaling |
| [API reference](./docs/reference/api.md) | Every export, option and method |
| [Examples](./examples/README.md) | Single-file `snippets/` and a full unified-inbox app in `inbox-app/` |

## Support

If ChatKit is useful to you, consider supporting its development:

| Method | Address / Link |
|--------|----------------|
| Bitcoin (BTC) | `bc1qd9fyx4r84cce2a9hkjksetah802knadw5msls3` |
| Solana (SOL) | `Ev3P4KLF1PNC5C9rZYP8M3DdssyBQAQAiNJkvNmPQPVs` |
| Ethereum (ERC-20) | `0x61D826e5b666AA5345302EEEd485Acca39b1AFCF` |
| USDT (TRC-20) | `TLH49i3EoVKhFyLb6u2JUXZWScK7uzksdC` |
| Saweria | [saweria.co/myrialabs](https://saweria.co/myrialabs) |

## License

MIT — see [LICENSE](LICENSE). ChatKit dynamically loads platform SDKs
(`@whiskeysockets/baileys`, `discord.js`, `@slack/*`) under their own licenses.
