# Slack

Slack has two inbound styles: the **Events API over HTTP** (recommended, webhook)
and **Socket Mode** (persistent WebSocket, dev-friendly, no public URL). Outbound
goes over the Web API.

| | |
|---|---|
| Inbound | Events API webhook, or Socket Mode (`socketMode: true`) |
| Verification | Signing secret (`X-Slack-Signature`, ±5-minute anti-replay) |
| Receipts | None — only `sent` is reported |
| Rate limit | `chat.postMessage` ≈ 1/s per channel; dispatcher caps Slack at 1/s |
| Passthrough | `platform_meta.slack` (Block Kit) |
| Not supported | sticker, voice, location, contact → `CapabilityError` |

## Setup

Create an app at [api.slack.com/apps](https://api.slack.com/apps). You need:

- **Bot token** (`xoxb-…`) with `chat:write`, `reactions:write`, `files:read`,
  `files:write` and the event scopes you care about (`message.channels`, …).
- **Signing secret** (Basic Information) for request verification.
- For Socket Mode: an **app token** (`xapp-…`) with `connections:write`.

Invite the bot to a channel.

Not part of the universal `Adapter` contract, but handy for setup:

```ts
const slack = new SlackAdapter({ botToken: process.env.SLACK_BOT_TOKEN!, signingSecret });
const me = await slack.authTest();                 // also a token check — a bad token throws
// me.user_id is the bot's own id — use it to spot @mentions of the bot
await slack.api('conversations.list', { limit: 20 }); // any Web API method (sent as form fields); throws on ok:false
```

## Receiving messages

### Events API (webhook)

```ts
import { ChatKit, text } from '@myrialabs/chatkit';
import { SlackAdapter } from '@myrialabs/chatkit/adapters';
import { hono } from '@myrialabs/chatkit/middleware';

const chat = new ChatKit();
chat.use(new SlackAdapter({ botToken: process.env.SLACK_BOT_TOKEN!, signingSecret: process.env.SLACK_SIGNING_SECRET! }));

chat.on('message', async (m) => {
  if (m.content.type === 'text') await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
});

app.post('/webhook/slack', hono({ chat, platform: 'slack', account: 'workspace' }));
```

Set your Request URL to `https://you.example.com/webhook/slack`. The handler
verifies `X-Slack-Signature` (with the ±5-minute anti-replay check) and answers the
`url_verification` challenge automatically.

Without a `signingSecret`, `verifyInbound` rejects every request — anyone who finds
the URL could otherwise inject events. For local experiments only, set
`allowUnverified: true`.

### Socket Mode

```ts
chat.use(new SlackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,
  appToken: process.env.SLACK_APP_TOKEN!,
  socketMode: true
}));
await chat.start();   // holds the WebSocket open
```

### Slash commands and interactivity

A slash command arrives as a universal text message — `/deploy prod` — with a unique
`event_id` per invocation, over both the Events API route (Slack POSTs it
form-encoded to the Request URL you set for the command) and Socket Mode.
`response_url` is kept in `raw` for delayed replies. The handler answers `200`
immediately, which Slack accepts as the ack; reply with `chat.send` to the channel,
or POST to `response_url` for an ephemeral answer.

Button and menu presses (Interactivity) arrive the same way, as `postback`.

### Several workspaces

One Slack app installed in many workspaces has one Request URL. Register one
adapter per workspace (its own bot token, `account` and `teamId`) and let a
resolver pick the account per request:

```ts
import { slackTeamId } from '@myrialabs/chatkit/adapters';

for (const w of workspaces) chat.use(new SlackAdapter({ botToken: w.token, signingSecret, account: w.teamId, teamId: w.teamId }));
app.post('/webhook/slack', hono({ chat, platform: 'slack', account: (req) => slackTeamId(req) ?? 'unknown' }));

await chat.send({ to: { platform: 'slack', account: 'T0123', conversation_id: 'C1', thread_id: null }, content: text('hi') });
```

`slackTeamId` reads the workspace from Events payloads, slash commands and
interactivity payloads (`null` for the `url_verification` handshake, which is
answered before routing matters). `teamId` makes an adapter ignore anything from
another workspace.

## Sending messages

Text, media, replies and reactions work as described in
[Core concepts](../essential/core-concepts.md#sending-content).

**Threads.** `thread_id` carries Slack's `thread_ts`. To reply in a thread, set
`reply_to` to the parent `ts`, or send to an address with `threadId`.

**Media** uses Slack's current external-upload flow (`getUploadURLExternal` →
upload → `completeUploadExternal`).

**Edits.** Edited messages (`message_changed`) arrive with `edited: true`, the
original `ts` as `platform_message_id`, and the new text. Edits made by bots are
ignored, and so are link unfurls (which Slack reports the same way but without a
text change).

## Rich text

`richText`/`rt` render to Slack `mrkdwn` (bold/italic/strike/code/link and `<@id>`
mentions; underline/spoiler are dropped — Slack has no syntax for them). Captions
use `caption_rich`.

For LLM output, see [Markdown from an LLM](../essential/core-concepts.md#markdown-from-an-llm)
and split with `splitRuns(runs, 3000)`.

## Interactive & Block Kit builders

Typed builders (at `@myrialabs/chatkit/interactive`): `slackButtons`, `slackMessage`,
and the `slack.*` namespace of Block Kit constructors — blocks (`section`, `fields`,
`header`, `divider`, `image`, `context`, `actions`, `input`) and elements (`button`,
`staticSelect`/`multiStaticSelect`, `usersSelect`/`channelsSelect`/
`conversationsSelect`/`externalSelect`, `overflow`, `datePicker`/`timePicker`,
`radio`, `checkboxes`, `textInput`). Interactions arrive as a universal `postback`.

```ts
import { slack } from '@myrialabs/chatkit/interactive';
await chat.send({ to, ...slack.message('New order', [
  slack.header('New order #42'),
  slack.section('*Total:* $42', { accessory: slack.button({ text: 'Refund', data: 'refund', style: 'danger' }) })
]) });
```

## Passthrough

Raw Block Kit, sent as-is:

```ts
await chat.send({
  to,
  content: passthrough(),
  platform_meta: { slack: { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*hi*' } }] } }
});
```
