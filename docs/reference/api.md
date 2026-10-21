# API Reference

Every public export of `@myrialabs/chatkit`, grouped by subpath. Types come from
the zod schemas in `src/schema.ts`, so the runtime validation and the TypeScript
types never drift.

- [`@myrialabs/chatkit`](#myrialabschatkit-core) — core: [`ChatKit`](#class-chatkit) ·
  [envelope & builders](#envelope--content-builders) · [addressing](#addressing) ·
  [capabilities](#capabilities) · [logger](#logger) · [queue & safety](#outbound-queue--safety) ·
  [rich text](#rich-text-formatting) · [interactive](#interactive-rich-messages) · [types](#types)
- [`/adapters`](#adapters) — Telegram · WhatsApp (Baileys & Cloud) · Discord · Slack
- [`/verify`](#verify) · [`/middleware`](#middleware) · [`/store`](#store) ·
  [`/media`](#media)
- `/interactive` — per-platform message builders, documented under
  [Interactive (rich) messages](#interactive-rich-messages)

New to the library? [Core concepts](../essential/core-concepts.md) explains the
ideas; this page is the lookup table.

---

## `@myrialabs/chatkit` (core)

### `class ChatKit`

```ts
new ChatKit(options?: ChatKitOptions)
```

| Option | Type | Default |
|---|---|---|
| `store` | `StateStore` | `MemoryStateStore` |
| `media` | `MediaStore \| MediaProxy` | `MemoryMediaStore` |
| `logger` | `Logger` | `noopLogger` (silent) |
| `stateKey` | `string` | `CHATKIT_STATE_KEY` env |
| `safety` | `SafetyOptions \| SafetyController` | `BaileysSafety` defaults |
| `queue` | `OutboundQueueOptions` | per-platform rate limits |

Methods:

- `use(adapter: Adapter): this` — register an adapter and record its capabilities.
  Throws if the `(platform, account)` pair is already registered.
- `add(adapter: Adapter): Promise<this>` — like `use`, but if ChatKit is already
  running it starts the adapter immediately (rolling back on start failure). Use
  this to configure accounts at runtime.
- `remove(platform, account): Promise<boolean>` — stop and unregister an account's
  adapter; `false` if none was registered. The inverse of `add`.
- `on(event, handler): this` / `off(event, handler): this` — events are
  `'message'`, `'reaction'`, `'status'`, `'presence'`, `'connection'`, `'error'`.
  `presence` carries typing/online signals (`PresenceUpdate`); `connection`
  carries a persistent adapter's lifecycle (`ConnectionUpdate`:
  `connecting`/`qr`/`authenticated`/`open`/`closed`, with `qr` for pairing).
- `capabilities(platform): CapabilityDescriptor | undefined`.
- `adapterFor(platform, account): Adapter | undefined`.
- `start(): Promise<void>` — start every persistent adapter; per-account failures
  are isolated and surfaced on `'error'`.
- `send(input: OutboundMessage): Promise<SendResult>` — validate → capability-gate
  → idempotency → dispatch in order per account.
- `edit(target: EditTarget): Promise<SendResult>` — replace a sent message's text
  (requires the `edit` capability). `EditTarget = { address, platform_message_id, content }`.
- `deleteMessage(target: MessageTarget): Promise<void>` — delete/revoke a message
  (`MessageTarget = { address, platform_message_id }`).
- `markRead(target: MessageTarget): Promise<void>` — best-effort read receipt.
- `setTyping(platform, account, conversationId, on): Promise<void>` — best-effort,
  capability-gated, never throws.
- `receive(platform, account, request): Promise<UniversalMessage | null>` — verify
  + normalise a single webhook request and route it through the pipeline.
- `pending(): number` — queued/in-flight outbound tasks.
- `health(platform?, account?): AccountHealth[]` — connection-health snapshots for
  every persistent adapter (WhatsApp Baileys, Telegram long-poll, Discord, Slack
  Socket Mode): `state`, `connectedSince`, `lastConnectedAt`, `reconnects`, `terminal`.
  For WhatsApp the safety snapshot is attached as `safety`. Intended for a `/health`
  endpoint or a monitoring loop.
- `reconnect(platform, account): boolean` — re-arm a connection that has *terminally*
  stopped (WhatsApp logged out / `403 forbidden` / session replaced / pre-pair
  rate-limit cap). Returns `true` if a resume was triggered. Call after fixing the
  root cause (re-pair, or wait out a `405`).
- `stop(): Promise<void>` — drain the queue, stop connections, close the store.

```ts
const chat = new ChatKit({ store, logger });
chat.use(adapter);
chat.on('message', (m) => …);
await chat.start();
const res = await chat.send({ to, content: text('hi') });
await chat.stop();
```

### Envelope & content builders

```ts
import {
  inbound, parseMessage, newId, messageKey, encodeRef, decodeRef,
  text, media, location, contact, reaction, passthrough, reply
} from '@myrialabs/chatkit';
```

- `text(body)` → text content.
- `media({ mediaType, url?, data?, mime?, caption?, filename? })` — accepts a URL
  or raw bytes.
- `location(lat, lng, name?)`, `contact(name, phone)`,
  `reaction(emoji, targetMessageId)`, `passthrough()`.
- `reply(message, content, opts?)` — build an `OutboundMessage` that replies to an
  inbound `message` (same conversation, quoting its native id). `opts` accepts
  `{ idempotencyKey?, platformMeta? }`.
- `inbound(init)` — adapters use this to build a validated inbound message.
- `parseMessage(value)` — validate an arbitrary value as a `UniversalMessage`.
- `newId()` — canonical ChatKit id. `messageKey(platform, account, id, conversationId?)` — dedup key; `inboundKey(msg)` — the key ChatKit dedups an inbound message on: its `event_id` when set (a button press, an edit, a reaction), otherwise its native id scoped to the conversation, since platforms like Telegram only number messages per chat.
- `encodeRef(ref)` / `decodeRef(token)` — reversible native-reference token.

### Addressing

```ts
import { address, participant, accountKey, conversationKey, sameConversation } from '@myrialabs/chatkit';

const to = address({ platform: 'telegram', account: 'bot', conversationId: '123', threadId: null });
```

### Capabilities

```ts
import { capabilities, emptySupport, assertSupported, CapabilityError, CapabilityRegistry } from '@myrialabs/chatkit';
```

`CapabilitySupport` flags: `delivery_receipt`, `read_receipt`, `reactions`,
`threads`, `buttons`, `typing`, `rich_layout`, `templates`, `edit`, `location`,
`contact`, and `media: MediaType[]`.

### Logger

```ts
import { noopLogger, consoleLogger, prefixedLogger, type Logger } from '@myrialabs/chatkit';
```

`Logger` has `debug/info/warn/error(message, fields?)`. The core defaults to
`noopLogger`. `consoleLogger('info')` is handy for examples and the CLI.

### Outbound queue & safety

```ts
import { OutboundQueue, retryable, DEFAULT_RETRY } from '@myrialabs/chatkit';
import { BaileysSafety, noopSafety, SafetyError } from '@myrialabs/chatkit';
```

- Mark a transient error so the dispatcher retries it: `throw retryable(new Error('429'))`.
- `BaileysSafety` is constructed by `ChatKit` from the `safety` option; you can
  inject your own `SafetyController`.

**Humanizers (on by default for WhatsApp Baileys)** — the safety layer shapes
outbound traffic to look human and lower ban risk:

| Option | Default | Effect |
|---|---|---|
| `sessionWindowMs` | `24h` | An inbound message opens a window in which replies need no opt-in. |
| `typing` | `{ enabled: true, perCharMs: 45, minMs: 600, maxMs: 5000 }` | "Types" for a text-length-derived duration before sending. |
| `readReceipts` | `true` | Marks inbound messages read on receipt. |
| `managePresence` | `true` | Goes online on connect rather than staying online 24/7. |
| `requireOptIn` | `true` | Out-of-session, non-reply sends require an explicit opt-in. |
| `warmupMaxPerSecond` | `0.2` | Rate ceiling at the *start* of a warming ramp; climbs to `maxPerSecond` across the window. |
| `blockColdDuringWarmup` | `true` | Blocks cold (out-of-session) sends while a number is warming. |
| `minReplyRatio` / `replyRatioSample` | `0.1` / `20` | Warn once the inbound/outbound ratio drops below the threshold (after the sample). |
| `haltOnLowReplyRatio` | `false` | Escalate a sustained low reply-ratio into an automatic "account at risk" halt (opt-in — it stops sending). |
| `maxPerDay` | off | Optional hard per-account daily cap. |
| `activeHours` | off | Optional `{ startHour, endHour }`; refuses sends outside it. |

Refusals throw a `SafetyError` (`reason`: `halted`/`opt-in`/`warming`/`daily-cap`/`quiet-hours`).
The controller also exposes `setWarmup(account, until, since?)` (the `since` drives the
gradual rate ramp) and `stats(account)`; the WhatsApp adapter auto-halts on a
`403 forbidden` disconnect via `flagAtRisk`.

### Helpers

```ts
import { splitMessage, TEXT_LIMITS } from '@myrialabs/chatkit';
splitMessage(longMarkdown, { limit: TEXT_LIMITS.discord }); // → string[]
```

### Rich text formatting

Formatting lives in the **universal core**: a text message may carry an optional
`rich` field — an ordered array of `TextRun`s (`{ text, bold?, italic?, strike?,
underline?, code?, pre?, spoiler?, link?, mention? }`). The plain `text` stays
canonical (used for dedup, storage and fallback); each adapter renders `rich` to its
native markup. Media captions take the same styling via `caption_rich`.

Build runs with the `rt` helpers and `richText`:

```ts
import { richText, rt } from '@myrialabs/chatkit';

await chat.send({
  to,
  content: richText([
    rt.plain('Order '), rt.bold('#42'), rt.plain(' shipped — '),
    rt.link('track it', 'https://track.example/42'), rt.plain(' '), rt.mention('628123', 'Andi')
  ])
});
```

Formatting is **best-effort and never throws**: a mark a platform can't express is
dropped and the text kept (unlike buttons/media, it is not capability-gated).

| mark | Telegram | Discord | Slack | WhatsApp |
|---|:--:|:--:|:--:|:--:|
| bold / italic / strike / code / pre | ✅ | ✅ | ✅ | ✅ |
| link | ✅ | ✅ | ✅ | ⚠️ plain url |
| underline / spoiler | ✅ | ✅ | ❌ | ❌ |
| mention | ✅ | ✅ | ✅ | ✅ (Baileys) |

Inbound Telegram messages are normalised back into `rich` (from Telegram `entities`),
so formatted messages round-trip. The renderers are exported for direct use:
`plainText`, `renderTelegramEntities`, `renderDiscord`, `renderSlackMrkdwn`,
`renderWhatsApp`, `telegramEntitiesToRuns`.

### Interactive (rich) messages

Buttons, lists, embeds, Block Kit, keyboards, Flows and templates are **built per
platform** with typed helpers that produce a `platform_meta` passthrough; the adapter
renders them natively. Inbound presses/selections normalise to a universal `postback`
message (`content.type === 'postback'`, with `data` and optional `title`). The full
surface is at the `@myrialabs/chatkit/interactive` subpath (common builders are also
re-exported from the root).

```ts
import { telegramButtons } from '@myrialabs/chatkit/interactive';

await chat.send({ to, ...telegramButtons('Pick one', [[{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }]]) });

chat.on('message', (m) => {
  if (m.content.type === 'postback') console.log('pressed', m.content.data);
});
```

- **Telegram** — `telegramButtons` (inline keyboard: `data`/`url`/`webApp`/`loginUrl`/
  `switchInline`/`copyText`/`pay`), `telegramReplyKeyboard`, `telegramRemoveKeyboard`,
  `telegramForceReply`, `telegramMediaGroup`, `telegramPoll`, `telegramDice`,
  `telegramVenue`, `telegramLinkPreview`.
- **Discord** — `discordButtons` (all styles + emoji), `discordSelect`
  (string/user/role/channel/mentionable), `discordEmbed`/`discordEmbeds`,
  `discordMessage` (allowed-mentions, suppress-embeds), `discordPoll`.
- **Slack** — `slackButtons`, `slackBlocks`, `slackMessage`, and the `slack.*`
  Block Kit constructors (`section`, `fields`, `header`, `divider`, `image`, `context`,
  `actions`, `input`; elements `button`, `staticSelect`/`multiStaticSelect`,
  `usersSelect`/`channelsSelect`/`conversationsSelect`/`externalSelect`, `overflow`,
  `datePicker`/`timePicker`, `radio`, `checkboxes`, `textInput`).
- **WhatsApp Cloud** — `whatsappCloudButtons`, `whatsappCloudList`,
  `whatsappCloudCtaUrl`, `whatsappCloudLocationRequest`, `whatsappCloudFlow`,
  `whatsappCloudProduct`/`whatsappCloudProductList`, `whatsappCloudTemplate` +
  `waTemplate.*` component builders, `whatsappCloudCarousel`.
- **WhatsApp Baileys** — `whatsappBaileysPoll`, `whatsappBaileysContacts`,
  `whatsappBaileysLocation`, `whatsappBaileysEvent`. ⚠️ No interactive buttons/lists:
  WhatsApp restricts them to the official Business/Cloud API, so from an unofficial
  Baileys connection they are silently dropped — use the **Cloud** adapter for
  buttons/lists.

Each returns an `InteractiveFragment` (`{ content, platform_meta }`) to spread into
`chat.send({ to, ...fragment })`.

### Types

All schema types are re-exported: `UniversalMessage`, `OutboundMessage`,
`MessageContent`, `OutboundContent`, `Address`, `Participant`, `Reaction`,
`SendResult`, `SendStatus`, `CapabilityDescriptor`, `PlatformId`, `MediaType`, …

---

## Adapters

Each adapter implements `Adapter` (or `WhatsAppAdapter`). Common surface:
`platform`, `account`, `capabilities()`, and a `send()`; persistent adapters add
`start()`, webhook adapters add `handleInbound()` + `verifyInbound()`.

### Telegram

```ts
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';
new TelegramAdapter({ token, account?, secretToken?, allowUnverified?, polling?, allowedUpdates?, apiBase?, fetchImpl? });
// bot setup: getMe(), setWebhook({ url, secretToken?, allowedUpdates?, dropPendingUpdates? }),
//            deleteWebhook(), getWebhookInfo(), api(method, params)
```

Webhook (`verifyInbound` + `handleInbound`) or long polling (`polling: true`).
Passthrough: `platform_meta.telegram = { method, params }`. See
[telegram.md](../channels/telegram.md).

### WhatsApp (Baileys)

```ts
import { WhatsAppBaileysAdapter } from '@myrialabs/chatkit/adapters';
new WhatsAppBaileysAdapter({ account, onQR?, pairingNumber?, onPairingCode?, warmupUntil?, version?, maxReconnectAttempts? });
```

Persistent. Encrypted auth state in the `StateStore`, safety layer on by default.
Passthrough: `platform_meta.whatsapp_baileys`. See [whatsapp.md](../channels/whatsapp.md).

### WhatsApp (Cloud)

```ts
import { WhatsAppCloudAdapter } from '@myrialabs/chatkit/adapters';
new WhatsAppCloudAdapter({ account, phoneNumberId, token, appSecret?, allowUnverified?, verifyToken?, businessAccountId?, graphBase?, apiVersion? });
// setup: getPhoneNumber(), subscribeApp(), listTemplates({ status?, limit? }), createTemplate(draft),
//        deleteTemplate(name), api(method, path, body?)   — the template/subscribe calls need businessAccountId
```

Webhook. `webhookChallenge(req)` answers the GET handshake. Passthrough (templates
/ interactive): `platform_meta.whatsapp_cloud`. See
[whatsapp.md](../channels/whatsapp.md#setup-helpers).

### Discord

```ts
import { DiscordAdapter } from '@myrialabs/chatkit/adapters';
new DiscordAdapter({ token, account?, publicKey?, applicationId?, gateway?, commandAck?, respond?, ephemeralCommands?, apiBase? });
// setup: getMe(), registerCommands(commands, { guildId? }), followUp(interaction, body), api(method, path, body?)
```

Gateway (default; needs the **Message Content Intent**) or webhook-only HTTP
Interactions (`gateway: false` + `publicKey`: `verifyInbound`, `webhookReply`,
`handleInbound`; `send()` falls back to REST whenever there is no Gateway client).
Slash commands, buttons, menus and modal submits arrive as `text` / `postback`; `respond` decides the initial response (modal, in-place update, custom reply). Passthrough
(embeds / components, raw API JSON): `platform_meta.discord`. See [discord.md](../channels/discord.md).

### Slack

```ts
import { SlackAdapter } from '@myrialabs/chatkit/adapters';
new SlackAdapter({ botToken, signingSecret?, allowUnverified?, appToken?, socketMode?, teamId? });
// setup: authTest(), api(method, params)   ·   slackTeamId(req) routes a shared URL to the right account
```

Events API webhook (default) or Socket Mode (`socketMode: true`); slash commands,
edits (`message_changed`) and Block Kit presses are normalised.
`webhookChallenge(req)` answers `url_verification`. Passthrough (Block Kit):
`platform_meta.slack`. See [slack.md](../channels/slack.md).

---

## `/verify`

Pure, framework-agnostic inbound verification. See [webhooks.md](../operations/webhooks.md).

```ts
import {
  verifyWhatsAppCloud, whatsAppCloudChallenge,
  verifySlack, slackUrlVerification,
  verifyTelegram, verifyDiscord,
  hmacSha256Hex, safeEqual, withinReplayWindow
} from '@myrialabs/chatkit/verify';
```

## `/middleware`

Webhook handlers for Hono, Express, Fastify and Elysia.

```ts
import { hono, express, fastify, elysia } from '@myrialabs/chatkit/middleware';
app.post('/webhook/telegram', hono({ chat, platform: 'telegram', account: 'bot' }));
```

Mount with a **raw body** parser — signatures are computed over unmodified bytes.

## `/store`

```ts
import { StateStore, MemoryStateStore, SqliteStore, createSecretCodec } from '@myrialabs/chatkit/store';
```

`StateStore`: `seen`, `putMapping`/`getPlatformMessageId`/`getChatkitId`,
`setOptIn`/`isOptedIn`, `kv*`, encrypted `secret*`, `close`. `SqliteStore` detects
`bun:sqlite` or `node:sqlite` (built in; no extra install).

## `/media`

```ts
import { MediaStore, MediaProxy, MemoryMediaStore, FileMediaStore } from '@myrialabs/chatkit/media';
```

`MediaProxy.ingest()` (inbound) stores bytes and returns a stable handle;
`resolveOutbound()` turns a URL/handle/bytes into bytes to upload; `validate()`
gates type & size per capability.

**Streaming (footprint):** a `MediaStore` may implement the optional `putStream()`
and `openRead()` so media never has to be fully buffered in memory. `FileMediaStore`
implements both; `MemoryMediaStore` does not (it is in-RAM by nature). The proxy
exposes `ingestStream(source, meta)` (inbound; buffers as a fallback when the store
lacks `putStream`) and `openOutboundStream(content, check?)` (outbound; returns a stream only
for our own handles in a stream-capable store, else `null` → buffered `resolveOutbound`).
The optional `check(read)` (e.g. a `validate()` call on `read.size_bytes`) runs before
the stream is returned; if it throws, the stream is released so no file handle leaks.
`releaseStream(stream)` frees a stream you decide not to consume.
**All adapters stream inbound media** (Telegram/Discord/Slack/WhatsApp Cloud pipe the
`fetch` download straight to `ingestStream`); the WhatsApp Baileys adapter also streams
outbound. With `FileMediaStore` large media move straight to/from disk instead of RAM.
