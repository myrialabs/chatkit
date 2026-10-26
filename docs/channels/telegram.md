# Telegram

Telegram is the simplest adapter — raw Bot API over `fetch`, no SDK, no ban risk.
It's the recommended first integration to validate the whole loop.

| | |
|---|---|
| Inbound | Long polling (no public URL) or webhook |
| Verification | Secret token header (`X-Telegram-Bot-Api-Secret-Token`) |
| Receipts | None for bots — only `sent` is reported |
| Rate limit | ~30 msg/s global, 1 msg/s per chat; dispatcher caps at 25/s |
| Passthrough | `platform_meta.telegram = { method, params }` |

## Setup

Talk to [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.

## Receiving messages

### Polling (development)

Easiest — no public URL. The adapter long-polls `getUpdates`. On start it clears
any registered webhook (Telegram refuses `getUpdates` while one is set), asks for
every update kind it normalises (`allowedUpdates`, which includes
`message_reaction` — Telegram omits it unless named), and resumes from the offset
it persisted in the `StateStore`, so a restart neither replays nor drops updates.
`stop()` aborts the in-flight long-poll instead of waiting it out.

```ts
import { ChatKit, text } from '@myrialabs/chatkit';
import { TelegramAdapter } from '@myrialabs/chatkit/adapters';

const chat = new ChatKit();
chat.use(new TelegramAdapter({ token: process.env.TELEGRAM_TOKEN!, account: 'bot:dev', polling: true }));

chat.on('message', async (m) => {
  if (m.content.type === 'text') await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
});

await chat.start();
```

### Webhook (production)

Set a webhook with a secret token, then route requests through ChatKit. The
adapter carries the Bot API calls that set a bot up, so no `curl` is needed:

```ts
const bot = new TelegramAdapter({ token, account: 'bot:prod', secretToken: process.env.TELEGRAM_SECRET });
const { username } = await bot.getMe();          // also a token check — a bad token throws
await bot.setWebhook({ url: 'https://you.example.com/webhook/telegram' }); // sends secretToken + allowedUpdates
const info = await bot.getWebhookInfo();          // last_error_message says why deliveries fail
// bot.deleteWebhook() to go back to polling; bot.api(method, params) for anything else
```

```ts
import { hono } from '@myrialabs/chatkit/middleware';

chat.use(new TelegramAdapter({ token, account: 'bot:prod', secretToken: process.env.TELEGRAM_SECRET }));
app.post('/webhook/telegram', hono({ chat, platform: 'telegram', account: 'bot:prod' }));
```

The handler verifies the secret header, normalises the update, and emits it to
`chat.on('message')`. Without a `secretToken`, `verifyInbound` rejects every
request — anyone who finds the URL could otherwise inject messages. For local
experiments only, set `allowUnverified: true`.

`bot.setMyCommands([...], { scope })` publishes the `/` command menu — the default menu without a scope, or one chat's own menu with `{ type: 'chat', chat_id }`. `bot.deleteMyCommands({ scope })` removes a scoped menu so the default shows again.

## Sending messages

Text, media, replies and reactions work as described in
[Core concepts](../essential/core-concepts.md#sending-content).

**Media.** Inbound photos/files are downloaded via `getFile` and proxied through
your `MediaStore`; `content.media.url` is a stable handle. Outbound media is sent
by URL (Telegram fetches it) or uploaded as multipart from raw `data`.

**Edits.** Edited messages arrive with `edited: true`, the edited message's id as
`platform_message_id`, and the new content.

## Rich text

The adapter renders runs to Telegram **`entities`** (no `parse_mode`, so no
escaping pitfalls), and inbound `entities` are normalised back into
`content.rich`, so formatting round-trips. Media captions use `caption_rich`.

```ts
import { richText, rt } from '@myrialabs/chatkit';
await chat.send({ to, content: richText([rt.bold('Bold'), rt.plain(' + '), rt.spoiler('secret')]) });
```

For LLM output, see [Markdown from an LLM](../essential/core-concepts.md#markdown-from-an-llm)
and use `TEXT_LIMITS.telegram` (4096).

## Interactive builders

Typed builders (at `@myrialabs/chatkit/interactive`) cover the Bot API surface:

- `telegramButtons` — inline keyboard (`data` / `url` / `webApp` / `loginUrl` /
  `switchInline` / `copyText` / `pay`)
- `telegramReplyKeyboard`, `telegramRemoveKeyboard`, `telegramForceReply`
- `telegramMediaGroup`, `telegramPoll`, `telegramDice`, `telegramVenue`,
  `telegramLinkPreview`

Presses arrive as a universal `postback` whose `title` is the pressed button's
label and whose `event_id` is unique per press — so two presses on one message are
two events, not a duplicate.

`callback_data` is limited to **64 bytes**; the builders throw a `RangeError`
naming the button rather than letting Telegram reject the whole message. Keep a
short id in the button and the meaning server-side.

`telegramEditMessage(messageId, text, { buttons })` re-renders a sent message with
a new keyboard — or with none, to retire a question once it is answered.
`chat.edit()` remains the universal, text-only edit.

```ts
import { telegramPoll } from '@myrialabs/chatkit/interactive';
await chat.send({ to, ...telegramPoll('Best runtime?', ['Bun', 'Node'], { type: 'quiz', correctOptionId: 0 }) });
```

## Passthrough

Anything not covered still goes through raw `{ method, params }`:

```ts
await chat.send({
  to,
  content: passthrough(),
  platform_meta: { telegram: { method: 'sendMessage', params: { text: 'pick', reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] } } } }
});
```
