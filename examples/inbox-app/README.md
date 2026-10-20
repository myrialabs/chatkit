# ChatKit Inbox

A complete, good-looking **unified inbox** across WhatsApp, Telegram, Discord and
Slack — one screen to read and reply everywhere, with channels you add from the UI
at runtime. Built to stress-test ChatKit against a real app.

**Stack:** Svelte 5 (runes) · Tailwind v4 · Elysia · Bun · SQLite · `@myrialabs/chatkit`.

## What it demonstrates

- **Runtime channel management** via `chat.add()` / `chat.remove()` — add or drop
  accounts from a Settings panel while the server runs, no restart, **no `.env`**.
- **Encrypted credentials at rest** — tokens entered in the UI are AES-256-GCM
  encrypted with an auto-generated master key (`.inbox-key`), the same key that
  protects Baileys auth state.
- **App-owned history** — ChatKit streams and sends; the app persists its own
  conversations/messages to SQLite (see [`server/ingest.ts`](./server/ingest.ts)).
- Replies with quoting, delivery/read status, inbound media from ChatKit's
  `MediaStore`, WhatsApp QR linking, all live over **SSE**.
- **Start a new conversation** from the UI — pick a configured channel, enter the
  native destination (phone number, chat id, channel id, etc.), and send the first
  message. ChatKit still enforces platform capabilities and WhatsApp safety.
- **Capability-aware rich messages** — the composer's **+** menu is gated by the
  channel's `chat.capabilities()` descriptor, so it only offers what the platform
  supports: location, contact card, interactive **buttons** / **list**, **polls**
  (Telegram / Discord / WhatsApp Baileys), Telegram **dice** / **venue**, Discord/
  Slack **embeds** / **select menus**, WhatsApp Cloud **CTA URL** buttons and
  **templates**, and Discord/Slack rich cards. (WhatsApp Baileys has no interactive
  buttons/lists — WhatsApp restricts those to the Cloud API — but it does offer
  **polls**.) Inbound locations, contacts and button/list presses (`postback`)
  render in-thread.
- **Rich text formatting** — type lightweight markdown in the composer
  (`*bold*`, `_italic_`, `~strike~`, `` `code` ``, `[label](url)`); the server parses
  it into ChatKit's universal `richText` runs, so it renders natively on every
  platform. Inbound Telegram formatting round-trips back into styled bubbles.

## Run it

Build the library once from the repo root so the local `@myrialabs/chatkit` link
resolves:

```sh
bun run build          # in the chatkit repo root
```

Then, in this folder:

```sh
cd examples/inbox-app
bun install
bun run dev            # API on :3000, UI on http://localhost:5173
```

Open **http://localhost:5173**, open **Channels**, and **add a channel**. No config
files — everything is entered in the UI and stored encrypted.

> **Quickest start:** create a bot with [@BotFather](https://t.me/botfather), add a
> **Telegram** channel with its token, and DM your bot. It runs in long-polling —
> no public URL needed.
>
> **WhatsApp (Baileys):** add the channel with a **test** number; a QR appears —
> scan it from WhatsApp → Linked Devices. Baileys carries a real ban risk; see the
> [risk runbook](../../docs/operations/runbook.md).
>
> **Webhook channels** (WhatsApp Cloud, Slack Events) show a callback path
> (`/webhook/<id>`) after you add them — point the provider's console at it (use a
> tunnel for local dev).

## Production build

```sh
bun run build          # bundles the client into dist/client
bun run start          # Elysia serves the API + the built UI on :3000
```

## Layout

```
server/                       client (src/)
  chatkit.ts   ChatKit instance   App.svelte        shell + SSE wiring
  secrets.ts   master key/codec   lib/store.svelte  runes state
  adapters.ts  build + field specs lib/api.ts        REST + EventSource
  accounts.ts  add/remove + persist lib/components/  list · thread · composer · settings
  db.ts        accounts + history (SQLite)
  ingest.ts    events → rows + SSE
  events.ts    SSE hub
  index.ts     Elysia server
```

## API

| Method & path | Purpose |
|---|---|
| `GET /api/platform-specs` | Supported platforms + the fields each needs (drives the add-channel form). |
| `GET /api/accounts` | Configured channels + connection status (no secrets). |
| `POST /api/accounts` | Add a channel `{ platform, account?, label?, creds }` → `chat.add()`. |
| `DELETE /api/accounts/:id` | `chat.remove()` + forget the channel. |
| `GET /api/conversations` | Conversation list, newest first. |
| `GET /api/conversations/:id/messages` | Message history for a conversation. |
| `POST /api/conversations/:id/read` | Clear the unread count. |
| `POST /api/conversations/start` | Start a new native conversation `{ accountId, destination, title?, text }`. |
| `POST /api/send` | `{ conversationId, text, replyTo? }` → `chat.send()`. |
| `POST /api/conversations/:id/media` | Upload + send a media message. |
| `POST /api/conversations/:id/react` | React to a message with an emoji. |
| `GET /api/conversations/:id/capabilities` | The channel's rich-feature support (gates the composer). |
| `POST /api/conversations/:id/location` | Share a location `{ lat, lng, name? }`. |
| `POST /api/conversations/:id/contact` | Share a contact `{ name, phone }`. |
| `POST /api/conversations/:id/interactive` | Buttons/list `{ kind, body, buttons? , buttonText?, sections? }`. |
| `POST /api/conversations/:id/template` | WhatsApp Cloud template `{ name, language? }`. |
| `POST /api/conversations/:id/rich` | Discord embed / Slack Block Kit card `{ title, body }`. |
| `POST /api/conversations/:id/rich-message` | Extended builders `{ kind, … }`: poll, dice, venue, embed, select, cta. |
| `POST /api/send` (markdown) | Draft `*bold*`/`_italic_`/`` `code` ``/`[label](url)` → `richText` runs. |
| `GET /events` | SSE stream: `message`, `status`, `qr`, `connection`, `presence`. |
| `GET /media/:id` | Streams inbound media from ChatKit's `MediaStore`. |
| `GET`/`POST /webhook/:id` | Webhook channels (WhatsApp Cloud, Slack Events). |
