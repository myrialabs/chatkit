# ChatKit Documentation

`@myrialabs/chatkit` is one unified, typed API to receive and send messages
across Telegram, WhatsApp (Baileys & Cloud API), Discord and Slack — a
universal message envelope, honest capability descriptors, and a built-in
WhatsApp safety layer, for Node 22.13+ and Bun.

New here? Start with the [quickstart](./getting-started/quickstart.md). Building
against WhatsApp specifically? Read the [risk runbook](./operations/runbook.md)
before you point Baileys at anything that matters.

## Find what you need

| I want to… | Read |
|---|---|
| Get a bot answering in five minutes | [Quickstart](./getting-started/quickstart.md) |
| Understand the model (envelope, address, capabilities) | [Core concepts](./essential/core-concepts.md) |
| Connect a specific platform | [Telegram](./channels/telegram.md) · [WhatsApp](./channels/whatsapp.md) · [Discord](./channels/discord.md) · [Slack](./channels/slack.md) |
| Receive webhooks safely in Hono / Express / Fastify / Elysia | [Webhooks & middleware](./operations/webhooks.md) |
| Keep WhatsApp (Baileys) alive without getting banned | [Risk runbook](./operations/runbook.md) |
| Pair a number or send a test message from the terminal | [CLI reference](./operations/cli.md) |
| Look up an exact export, option or method | [API reference](./reference/api.md) |
| See complete working code | [Examples](../examples/README.md) |

## Pages by section

### Getting Started

| Page | What it answers |
|---|---|
| [Quickstart](./getting-started/quickstart.md) | Install, get a token, run your first bot, swap the platform. |

### Essential

| Page | What it answers |
|---|---|
| [Core concepts](./essential/core-concepts.md) | The `ChatKit` class, envelope, addressing, capabilities, sending, edit/delete/receipts, rich text, Markdown from an LLM, interactive messages, state & media ports, running accounts. |

### Channels

Per-platform setup, quirks and passthrough — every page follows the same layout:
at-a-glance table, setup, receiving, sending, rich text, interactive builders,
passthrough.

| Page | What it answers |
|---|---|
| [Telegram](./channels/telegram.md) | Bot token, polling vs. webhook, media, rich text, interactive builders. |
| [WhatsApp](./channels/whatsapp.md) | Baileys vs. Cloud API, pairing, safety layer, reconnects, templates. |
| [Discord](./channels/discord.md) | Gateway vs. HTTP Interactions, slash commands, modals, embeds. |
| [Slack](./channels/slack.md) | Events API vs. Socket Mode, slash commands, threads, Block Kit. |

### Operations

| Page | What it answers |
|---|---|
| [Webhooks & middleware](./operations/webhooks.md) | Pure verify functions vs. framework middleware, raw-body gotchas, anti-replay. |
| [CLI reference](./operations/cli.md) | `chatkit pair` / `send` / `capabilities` — every flag. |
| [Risk runbook](./operations/runbook.md) | WhatsApp ban risk, reconnect storms, state backups, scaling, rate limits. |

### Reference

| Page | What it answers |
|---|---|
| [API reference](./reference/api.md) | Every export, option and method, grouped by subpath (`/adapters`, `/verify`, `/middleware`, `/store`, `/media`, `/interactive`). |
