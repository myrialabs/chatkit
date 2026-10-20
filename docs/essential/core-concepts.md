# Core Concepts

The mental model behind ChatKit: one envelope in and out, addresses that stay
stable for replies, and capabilities that never lie about what a platform can
do. This page is a conceptual walkthrough — for every method signature and
option, see the [API reference](../reference/api.md).

**On this page**

- [The `ChatKit` class](#the-chatkit-class) · [Envelope](#the-universal-envelope) ·
  [Addressing](#addressing) · [Capabilities](#capabilities--the-honesty-contract)
- [Sending](#sending-content) · [Edit, delete, receipts, presence](#edit-delete-receipts-presence)
- [Rich text](#rich-text-formatting) · [Markdown from an LLM](#markdown-from-an-llm) ·
  [Interactive messages](#interactive-messages)
- [State & media](#state--media-ports) · [Running accounts](#running-accounts) ·
  [Health](#health-and-errors)

## The `ChatKit` class

`ChatKit` owns the adapter registry, the capability registry, the shared ports
(`StateStore`, media proxy, safety controller), the outbound dispatcher, and
the event emitter consumers use.

```ts
const chat = new ChatKit({ store, media, logger, safety, queue });

chat.use(adapter);              // register an adapter (before start())
chat.on('message', handler);    // 'message' | 'reaction' | 'status' | 'presence' | 'connection' | 'error'
await chat.start();             // start every persistent adapter
await chat.send({ to, content: text('hi') });
await chat.stop();              // drain the queue, close connections, close the store
```

Every option is optional. With none, you get an in-memory store, in-memory
media, a silent logger and the default WhatsApp safety layer.

## The universal envelope

Every inbound event normalises to one `UniversalMessage`; `chat.send()` takes
the matching `OutboundMessage` shape back. Fields are `snake_case` — the
envelope is a cross-platform *wire contract*, not a library options object.

```ts
chat.on('message', (m) => {
  // m.address       — where it came from (see Addressing, below)
  // m.from          — the sender (Participant)
  // m.content       — the MessageContent union (see below)
  // m.reply_to      — native id this message quotes, if any
  // m.platform_meta — raw per-platform payload, for advanced/debug use
});
```

Content is a discriminated union — branch on `m.content.type`:

| `type` | Meaning |
|---|---|
| `text` | Plain text, optionally with `rich` runs |
| `media` | image / video / audio / voice / document / sticker |
| `location`, `contact` | Shared location or contact card |
| `reaction` | An emoji reaction on another message |
| `postback` | An inbound button / list / menu press |
| `passthrough` | Escape hatch — the real payload lives in `platform_meta` |

All types are defined once as zod schemas in `src/schema.ts`, so runtime
validation and the TypeScript types can never drift apart.

## Addressing

An `Address` is `(platform, account, conversation_id[, thread_id])`.
`conversation_id` is the platform's **native** id — never normalised or
hashed — so a reply is always reversible:

```ts
import { address } from '@myrialabs/chatkit';

const to = address({ platform: 'telegram', account: 'bot:myshop', conversationId: '123', threadId: null });
```

`account` is the consumer-owned credential instance that owns the connection
(e.g. `'bot:myshop'`, `'wa:6281234567890'`) — it's how one process can run
several bots/numbers on the same platform side by side.

Replying to an inbound message is common enough to have a helper:

```ts
import { reply, text } from '@myrialabs/chatkit';

chat.on('message', (m) => {
  if (m.content.type === 'text') chat.send(reply(m, text(`echo: ${m.content.text}`)));
});
```

## Capabilities — the honesty contract

`chat.capabilities(platform)` returns a `CapabilityDescriptor` describing
exactly what that platform's adapter can do: which media types, whether it
has threads, buttons, typing indicators, message editing, and so on.
`chat.send()` is gated by it — ask for something unsupported and you get a
clear `CapabilityError`, never a silent no-op:

```ts
try {
  await chat.send({ to, content: location(lat, lng) });
} catch (e) {
  if (e instanceof CapabilityError) console.log(`${e.platform} can't do this: ${e.feature}`);
}
```

A `platform_meta.<platform>` passthrough bypasses the gate for that platform —
the adapter validates the native payload itself instead. That is how
platform-specific richness (Slack Block Kit, Discord embeds, WhatsApp
templates) stays out of the universal core:

```ts
await chat.send({
  to: slackAddress,
  content: passthrough(),   // the core content is ignored here
  platform_meta: { slack: { blocks: [/* … Block Kit … */] } }
});
```

`platform_meta.<platform>` is deliberately **not** portable.

## Sending content

```ts
import { text, media, location, contact, reaction } from '@myrialabs/chatkit';

await chat.send({ to, content: text('hello') });
await chat.send({ to, content: media({ mediaType: 'image', url: 'https://…/a.png', caption: 'hi' }) });
await chat.send({ to, content: media({ mediaType: 'document', data: bytes, filename: 'report.pdf' }) });
await chat.send({ to, content: reaction('👍', nativeMessageId) });
await chat.send({ to, content: text('hi'), reply_to: nativeMessageId });
```

Outbound is dispatched **in order per account**, rate-limited per platform,
and retried with backoff on transient failures. Pass `idempotency_key` to make
a send safe to retry end-to-end — a repeat call with the same key replays the
prior `SendResult` instead of sending again.

## Edit, delete, receipts, presence

```ts
await chat.edit({ address, platform_message_id, content: text('fixed') });   // needs the `edit` capability
await chat.deleteMessage({ address, platform_message_id });
await chat.markRead({ address, platform_message_id });                        // best-effort read receipt
await chat.setTyping('telegram', 'bot:myshop', conversationId, true);         // best-effort, never throws

chat.on('status', (s) => console.log(s.platform_message_id, s.status));        // sent / delivered / read / failed
chat.on('presence', (p) => {/* p.state: typing | online | offline … */});
chat.on('connection', (c) => {/* c.state: connecting | qr | open | closed; c.qr to pair */});
```

Which platforms report delivery/read receipts differs — check
`chat.capabilities(platform)` rather than assuming.

## Rich text formatting

Formatting lives in the universal core, not bolted on per platform: a text
message may carry an optional `rich` array of `TextRun`s that each adapter
renders to its native markup (Telegram entities, Discord/WhatsApp markdown,
Slack `mrkdwn`). The plain `text` field stays canonical for dedup/storage/
fallback. Formatting is **best-effort and never throws** — a mark a platform
can't express is dropped and the text kept.

```ts
import { richText, rt } from '@myrialabs/chatkit';

await chat.send({
  to,
  content: richText([rt.plain('Order '), rt.bold('#42'), rt.plain(' shipped — '), rt.link('track it', url)])
});
```

| Mark | Telegram | Discord | Slack | WhatsApp |
|---|:--:|:--:|:--:|:--:|
| bold / italic / strike / code / pre | ✅ | ✅ | ✅ | ✅ |
| link | ✅ | ✅ | ✅ | ⚠️ plain URL |
| underline / spoiler | ✅ | ✅ | ❌ | ❌ |
| mention | ✅ | ✅ | ✅ | ✅ Baileys only |

Inbound Telegram messages round-trip back into `rich`. Media captions take the
same styling through `caption_rich`.

### Markdown from an LLM

`markdownToRuns(md)` parses GitHub-flavoured Markdown — bold, italic, strike,
inline and fenced code (with its language), links, headings, lists, task lists,
quotes and tables — into universal runs, so an LLM's answer renders as native
formatting instead of literal asterisks. Headings become bold lines, list items
get `•`, and tables become an aligned monospace block.

Platforms cap message length, so pair it with `splitRuns(runs, limit)`. It cuts
at paragraph, line or word boundaries and keeps every run's marks on both
sides, so a split code block is still a code block in each message.

```ts
import { markdownToRuns, splitRuns, richText, TEXT_LIMITS } from '@myrialabs/chatkit';

for (const chunk of splitRuns(markdownToRuns(answer), TEXT_LIMITS.telegram)) {
  await chat.send({ to, content: richText(chunk) });
}
```

| Platform | Limit to pass | Note |
|---|---|---|
| Telegram | `TEXT_LIMITS.telegram` (4096) | |
| Discord | `TEXT_LIMITS.discord` (2000) | |
| Slack | `3000` | Hard cap is 40,000, Slack recommends < 4,000; a Block Kit `section` holds 3,000 |
| WhatsApp Cloud | `TEXT_LIMITS.whatsapp_cloud` (4096) | |
| WhatsApp Baileys | `TEXT_LIMITS.whatsapp_baileys` | Far higher, but short messages read more human |

## Interactive messages

Buttons, lists, embeds and Block Kit are **built per platform** with typed
helpers at the `@myrialabs/chatkit/interactive` subpath — each returns a
fragment to spread into `send()`. Inbound presses/selections always normalise
back to one universal `postback`, regardless of platform:

```ts
import { telegramButtons } from '@myrialabs/chatkit/interactive';

await chat.send({ to, ...telegramButtons('Pick one', [[{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }]]) });

chat.on('message', (m) => {
  if (m.content.type === 'postback') console.log('pressed', m.content.data);
});
```

Each [channel guide](../channels/telegram.md) lists its own builders. One
exception worth flagging early: Baileys has **no** reliable button/list support
(WhatsApp restricts interactive messages to the official Business/Cloud API),
so use the Cloud adapter when you need them.

## State & media ports

State (dedup keys, id mapping, opt-in, encrypted secrets) and media both sit
behind small interfaces with in-memory defaults, so ChatKit never forces
infrastructure on you:

```ts
import { SqliteStore } from '@myrialabs/chatkit/store';
import { FileMediaStore } from '@myrialabs/chatkit/media';

const chat = new ChatKit({
  store: new SqliteStore({ path: 'chatkit.db', stateKey: process.env.CHATKIT_STATE_KEY }),
  media: new FileMediaStore({ dir: 'media', baseUrl: 'https://cdn.example.com/media' })
});
```

| Runtime | SQLite driver | Extra install? |
|---|---|---|
| Bun ≥ 1.1 | `bun:sqlite` | no |
| Node ≥ 22.13 | `node:sqlite` | no |

Baileys auth state is always encrypted at rest with AES-256-GCM — a `stateKey`
(or `CHATKIT_STATE_KEY`) is required to use the secret store. ChatKit keeps no
conversation history; if you need one, persist events yourself (the
[inbox app](../../examples/README.md) does exactly that). Full port signatures
are in the [API reference](../reference/api.md#store).

## Running accounts

`use()` registers an adapter before `start()`. To add or drop accounts **while
running** — for example in an app where users configure their own channels — use
`add()` and `remove()`:

```ts
await chat.add(new TelegramAdapter({ token, account: 'bot:new' }));  // registers and starts now
await chat.remove('telegram', 'bot:new');                            // stops and unregisters
```

On shutdown, `await chat.stop()` drains the outbound queue, closes connections
and closes the store. Call it on `SIGINT`/`SIGTERM`.

Persistent adapters (Baileys, Discord Gateway, Slack Socket Mode) need a host
process that stays alive, so they can't run scale-to-zero. Webhook adapters
(Telegram, WhatsApp Cloud, Slack Events, Discord HTTP Interactions) can.

## Health and errors

Adapter failures are isolated per account and surface on `chat.on('error')` — one
broken connection never takes down its neighbours. For monitoring, `chat.health()`
returns a snapshot per persistent account (connection state, reconnect count,
terminal flag, plus the WhatsApp safety stats). When a connection has stopped
for good (logged out, banned, session replaced), `chat.reconnect(platform,
account)` re-arms it after you fix the cause. Details are in the
[runbook](../operations/runbook.md).

## Where to go next

- [Channels](../channels/telegram.md) — per-platform setup, quirks and
  passthrough.
- [Webhooks & middleware](../operations/webhooks.md) — verifying and routing
  inbound HTTP.
- [Risk runbook](../operations/runbook.md) — WhatsApp ban risk, reconnects,
  scaling.
- [API reference](../reference/api.md) — every export, option and method.
