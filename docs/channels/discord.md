# Discord

Discord has two inbound styles: a persistent **Gateway** WebSocket (`discord.js`,
the default — every message, reaction, typing and edit) and **HTTP Interactions**
(a signed webhook — slash commands and button/menu presses only, scale-to-zero
friendly). Outbound works in both: through the Gateway client when it is up, over
REST otherwise.

| | Gateway (default) | HTTP Interactions |
|---|---|---|
| Needs | Message Content Intent | `publicKey`, `gateway: false` |
| Receives | messages, reactions, typing, edits, commands, presses | commands and presses only |
| Hosting | long-lived process | serverless / scale-to-zero |
| Verification | — (socket) | Ed25519, rejects requests older than 5 minutes |

Other facts: `conversation_id` is the channel id (threads are channels of their
own); bots get no delivery/read receipts, so only `sent` is reported; the
dispatcher caps Discord at 4/s and retries a `429`; `location` and `contact` are
unsupported and throw `CapabilityError`.

## Setup

1. Create an application + bot at the
   [Developer Portal](https://discord.com/developers/applications).
2. Enable the **Message Content Intent** (Bot → Privileged Gateway Intents) — without
   it `message.content` is empty.
3. Invite the bot to your server with the `bot` scope and read/send permissions.

Bot setup without hand-rolled REST calls (not part of the universal `Adapter`
contract):

```ts
const bot = new DiscordAdapter({ token: process.env.DISCORD_TOKEN! });
const me = await bot.getMe();                       // also a token check — a bad token throws
await bot.registerCommands([                        // replaces the whole list; [] clears it
  { name: 'deploy', description: 'Deploy', options: [{ type: 3, name: 'env', description: 'Target', required: true }] }
], { guildId });                                    // guild commands are instant; global ones take up to an hour
await bot.api('GET', '/gateway/bot');               // any other REST endpoint
```

`applicationId` is looked up from the token when not given.

## Receiving messages

### Gateway

```ts
import { ChatKit, text } from '@myrialabs/chatkit';
import { DiscordAdapter } from '@myrialabs/chatkit/adapters';

const chat = new ChatKit();
chat.use(new DiscordAdapter({ token: process.env.DISCORD_TOKEN!, account: 'bot' }));

chat.on('message', async (m) => {
  if (m.content.type === 'text') await chat.send({ to: m.address, content: text(`echo: ${m.content.text}`) });
});

await chat.start();
```

discord.js performs a session **RESUME** rather than a fresh IDENTIFY on reconnect;
ChatKit logs `Discord session resumed` when it happens. No state of your own is
required.

### HTTP Interactions (webhook)

For serverless or scale-to-zero hosting, skip the Gateway: pass the application's
**public key** (Developer Portal → General Information) and `gateway: false`, and
set the *Interactions Endpoint URL* to your route.

```ts
import { hono } from '@myrialabs/chatkit/middleware';

chat.use(new DiscordAdapter({ token, account: 'bot', publicKey: process.env.DISCORD_PUBLIC_KEY!, gateway: false }));
app.post('/webhook/discord', hono({ chat, platform: 'discord', account: 'bot' }));
await chat.start();   // opens nothing; send() goes over REST
```

The handler verifies the Ed25519 signature and rejects requests older than five
minutes (a bad one is a `401`, which Discord probes for when you save the URL),
answers the endpoint `PING`, acknowledges slash commands and presses inside the
3-second window, and emits them to `chat.on('message')`. Without `publicKey` every
request is rejected. This mode receives **no** regular messages, reactions or
typing — those need the Gateway.

### Slash commands

A slash command arrives as a universal text message — `/deploy env:prod` (options as
`key:value`, subcommands by name) — with a unique `event_id` per invocation. It works
on both the Gateway and HTTP Interactions. Discord shows "thinking…" until you
answer; use `followUp` with the interaction kept in `raw`:

```ts
chat.on('message', async (m) => {
  if (m.content.type === 'text' && m.content.text.startsWith('/deploy')) {
    await bot.followUp((m.raw as any).interaction, { content: 'Deployed.' });
  }
});
```

Prefer no follow-up to manage? `commandAck: 'On it…'` replies with that text at once
and leaves nothing to close.

The interaction token is valid for 15 minutes. `raw.data` carries the command as
received (typed option values, `resolved`, `target_id` for context-menu commands).
Button and menu presses are acknowledged for you, and autocomplete is answered with
no choices. Pass `ephemeralCommands: true` to make every command reply private to
the invoker (an ephemeral flag can only be set at the ack, not later).

### Modals, in-place updates, custom replies

Discord lets you answer an interaction *once*, inside 3 seconds — and that is the
only moment you can open a modal or update the pressed message. The `respond` hook
decides that initial response (REST shape: `{ type, data }`); return nothing to keep
the default ack. It is synchronous, sees the same `DiscordInteraction` on the
Gateway and over HTTP, and the interaction is still delivered as a message.

```ts
new DiscordAdapter({
  token, publicKey, gateway: false,
  respond: (i) => {
    if (i.command?.name === 'feedback') {
      return { type: 9, data: { custom_id: 'feedback', title: 'Feedback', components: [
        { type: 1, components: [{ type: 4, custom_id: 'note', label: 'Your note', style: 2 }] }
      ] } };                                   // 9 = open a modal
    }
    if (i.customId === 'next') return { type: 7, data: { content: 'Page 2' } };  // 7 = update the pressed message
  }
});

chat.on('message', (m) => {                    // the submit is a postback; the inputs are in raw.fields
  if (m.content.type === 'postback' && m.content.data === 'feedback') console.log((m.raw as any).fields.note);
});
```

If the hook throws, the default ack is sent instead — a bug in it never costs the
3-second window.

## Sending messages

Text, media, replies and reactions work as described in
[Core concepts](../essential/core-concepts.md#sending-content).

**Media.** Attachments are downloaded and proxied through your `MediaStore`.
Outbound media is sent as a file attachment from a URL/handle/bytes, with the
caption as the message content.

**Edits.** Edited messages arrive with `edited: true`, the edited message's id as
`platform_message_id`, and the new content (embed unfurls are not edits).

## Rich text

`richText`/`rt` render to Discord markdown (bold/italic/underline/strike/code/
spoiler/link, plus `<@id>` mentions). Captions use `caption_rich`.

For LLM output, see [Markdown from an LLM](../essential/core-concepts.md#markdown-from-an-llm)
and split with `TEXT_LIMITS.discord` (2000 characters).

## Interactive builders

Typed builders (at `@myrialabs/chatkit/interactive`): `discordButtons` (all styles +
emoji), `discordSelect` (string/user/role/channel/mentionable menus), `discordEmbed`/
`discordEmbeds`, `discordMessage` (allowed-mentions, suppress-embeds), `discordPoll`.
Button/select interactions arrive as a universal `postback`.

```ts
import { discordEmbeds, discordButtons } from '@myrialabs/chatkit/interactive';
await chat.send({ to, ...discordEmbeds({ title: 'Receipt', color: 0x5865f2, fields: [{ name: 'Total', value: '$42', inline: true }] }) });
await chat.send({ to, ...discordButtons('Confirm?', [{ text: 'Yes', data: 'y', style: 'success' }, { text: 'No', data: 'n', style: 'danger' }]) });
```

## Passthrough

Anything else is reachable through raw `platform_meta.discord` — raw API JSON
(`embeds`, `components`, `allowed_mentions`, …), applied the same way on the Gateway
and the REST path:

```ts
await chat.send({
  to,
  content: passthrough(),
  platform_meta: { discord: { embeds: [{ title: 'Hi', description: 'rich' }] } }
});
```
