# ChatKit Examples

Two kinds of example — copy-paste snippets, and one full app.

| | What it is | Start here if… |
|---|---|---|
| [`snippets/`](./snippets) | Single-file scripts, one per idea. Read from env vars inline. | You want the minimal code for one platform. |
| [`inbox-app/`](./inbox-app) | A complete unified-inbox app (Svelte 5 + Tailwind v4 + Elysia + Bun + SQLite). Configures its own channels — **no `.env`**. | You want to see ChatKit in a real product. |

Build the library once from the repo root first:

```sh
bun run build
```

## `snippets/`

Each file is self-contained and reads its config from environment variables shown
in its header comment — run it directly, no setup file:

| File | What it shows |
|---|---|
| [`telegram.ts`](./snippets/telegram.ts) | Long-polling echo — the simplest full loop, just a bot token. |
| [`whatsapp-baileys.ts`](./snippets/whatsapp-baileys.ts) | Persistent WhatsApp via QR, encrypted state, safety on. |
| [`whatsapp-cloud.ts`](./snippets/whatsapp-cloud.ts) | Official Cloud API over a webhook server. |
| [`discord.ts`](./snippets/discord.ts) | Gateway bot (needs the Message Content Intent). |
| [`slack.ts`](./snippets/slack.ts) | Socket Mode echo bot. |
| [`interactive.ts`](./snippets/interactive.ts) | Inline buttons + formatted `richText` replies; handling the press as a universal `postback`. |
| [`control-process.ts`](./snippets/control-process.ts) | Generic two-way pipe: chat ⇄ a spawned process's stdio. |

```sh
TELEGRAM_BOT_TOKEN=123:abc bun examples/snippets/telegram.ts
```

## `inbox-app/`

A complete, good-looking unified inbox for WhatsApp, Telegram, Discord and Slack:
conversation list, live thread view, a composer that replies through ChatKit, and
a **Settings panel to add/remove channels at runtime** (credentials are encrypted
at rest — there is no `.env`). It persists its own history and pushes new messages
to the UI over SSE. See its own [README](./inbox-app/README.md).

```sh
cd examples/inbox-app && bun install && bun run dev   # → http://localhost:5173
```

> The snippets are illustrative; review the [risk runbook](../docs/operations/runbook.md)
> before pointing WhatsApp Baileys at anything that matters.
