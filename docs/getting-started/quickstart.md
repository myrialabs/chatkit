# Quickstart

ChatKit is a **library, not a service** — you `import` it into your own Node 22.13+
or Bun process. This page gets a real bot receiving and replying in a few
minutes using Telegram, the simplest adapter (raw Bot API over `fetch`, no SDK,
no ban risk) — the recommended first integration to validate the whole loop.

## Install

```sh
bun add @myrialabs/chatkit      # or: npm i @myrialabs/chatkit / pnpm add @myrialabs/chatkit
bun add -g @myrialabs/chatkit   # optional: the `chatkit` CLI (pair / send / capabilities)
```

Node 22.13+ and Bun include SQLite out of the box (used by the optional
`SqliteStore`), so nothing extra is installed — see [state & media](../essential/core-concepts.md#state--media-ports).

Platform SDKs (`@whiskeysockets/baileys`, `discord.js`, `@slack/*`) are regular
`dependencies` of the package — one install covers every platform, with no per-adapter
`npm i` step. They are **loaded lazily** by their adapters: an adapter you don't use
never loads its SDK (it is still downloaded at install time).

## Get a Telegram token

Talk to [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.

## Your first bot

```ts
import { ChatKit, text } from '@myrialabs/chatkit';
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';

const chat = new ChatKit();   // defaults: in-memory store + media, silent logger

chat.use(new TelegramAdapter({
  token: process.env.TELEGRAM_TOKEN!,
  account: 'bot:dev',
  polling: true               // long-polls getUpdates — no public URL needed
}));

chat.on('message', async (m) => {
  if (m.content.type === 'text') {
    await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
  }
});

await chat.start();
```

Run it, then DM your bot on Telegram — it echoes back. That loop —
`use()` an adapter, `on('message', …)`, `send()`, `start()` — is identical
across every platform ChatKit supports.

## The same loop, another platform

Swap the adapter and the rest of the code is unchanged:

```ts
import { WhatsAppBaileysAdapter } from '@myrialabs/chatkit/adapters';

chat.use(new WhatsAppBaileysAdapter({ account: 'wa:6281234567890' }));   // safety layer on by default
await chat.start();   // scan the printed QR, or run `chatkit pair --account wa:…`
```

```ts
import { DiscordAdapter } from '@myrialabs/chatkit/adapters';

chat.use(new DiscordAdapter({ token: process.env.DISCORD_TOKEN!, account: 'bot' }));
```

```ts
import { SlackAdapter } from '@myrialabs/chatkit/adapters';

chat.use(new SlackAdapter({ botToken: process.env.SLACK_BOT_TOKEN!, appToken: process.env.SLACK_APP_TOKEN!, socketMode: true }));
```

Each platform has its own setup quirks (intents, tokens, webhook vs. socket) —
see the [channel guides](../channels/telegram.md). WhatsApp specifically
carries operational risk; read the [risk runbook](../operations/runbook.md)
before pointing Baileys at anything that matters.

## Next steps

- [Core concepts](../essential/core-concepts.md) — the envelope, addressing,
  capabilities, sending and rich text, in one page.
- [Channels](../channels/telegram.md) — per-platform setup for Telegram,
  WhatsApp, Discord and Slack.
- [Webhooks & middleware](../operations/webhooks.md) — wire a webhook adapter
  into Hono/Express/Fastify/Elysia instead of polling.
- [Examples](../../examples/README.md) — runnable snippets and a full
  unified-inbox app.
