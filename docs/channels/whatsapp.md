# WhatsApp

ChatKit supports **two** WhatsApp paths behind one `WhatsAppAdapter` interface:
Baileys (unofficial, free, self-hosted) and the official Cloud API. Your send/
receive code is identical; you choose per account.

> ⚠️ **Baileys carries a real, permanent ban risk.** Use a TEST number, keep the
> safety layer on, and read the [risk runbook](../operations/runbook.md).

| | Baileys | Cloud API |
|---|---|---|
| Official | No (impersonates WhatsApp Web) | Yes (Meta) |
| Connection | Persistent WebSocket | Stateless webhook |
| Cost | Free | Per-message pricing |
| Ban risk | Real — safety layer lowers it | None |
| Interactive buttons / lists | ❌ (silently dropped by WhatsApp) | ✅ |
| Poll / event builders | ✅ | ❌ |
| Templates, CTA, Flows, product messages | ❌ | ✅ |
| Verification | — (socket) | HMAC-SHA256 (`appSecret`) |
| Hosting | long-lived process | serverless OK |
| Receipts | via receipts | via webhook `statuses` |

Both support text, media (incl. sticker), reply and reaction, and both report
`delivery`/`read` status. To swap them per account:

```ts
const wa: WhatsAppAdapter = official
  ? new WhatsAppCloudAdapter({ account: 'wa:1', phoneNumberId, token })
  : new WhatsAppBaileysAdapter({ account: 'wa:1' });
chat.use(wa);
```

---

## Baileys

Persistent WebSocket. Auth state is persisted **encrypted** in the `StateStore`,
so a restart does not force a re-pair. A state key is required.

```ts
import { ChatKit } from '@myrialabs/chatkit';
import { SqliteStore } from '@myrialabs/chatkit/store';
import { WhatsAppBaileysAdapter } from '@myrialabs/chatkit/adapters';

const chat = new ChatKit({
  store: new SqliteStore({ path: 'chatkit.db', stateKey: process.env.CHATKIT_STATE_KEY })
});

chat.use(new WhatsAppBaileysAdapter({
  account: 'wa:6281234567890',
  onQR: (qr) => renderQrSomehow(qr),       // or use: chatkit pair --account wa:…
  // A freshly paired number auto-warms for 7 days (ramped send rate, cold sends
  // restricted). Override the window, or set warmupUntil to pin it explicitly.
  // warmupDurationMs: 7 * 864e5,
  // warmupUntil: Date.now() + 7 * 864e5,
  maxReconnectAttempts: 5                    // caps *pre-pair* retries only (see below)
  // version: [2, 3000, 1234567]            // pin the WA-web version; resolved automatically by default
}));

await chat.start();
```

Pairing from the CLI:

```sh
CHATKIT_STATE_KEY=… chatkit pair --account wa:6281234567890
```

### Safety layer

On by default; human-like behaviour to lower ban risk:

- a 24-hour **session window** (an inbound message lets you reply without opt-in);
- **typing simulation** before each send, **read receipts** on inbound, **presence
  management**;
- per-account throttle + Gaussian jitter;
- a **gradual warming ramp** for freshly paired numbers — the send rate climbs from
  the warmup ceiling to steady state over the window instead of jumping to full
  speed (day-one blasting is the #1 ban trigger);
- opt-in enforcement for cold sends, and reply-ratio monitoring;
- an "account at risk" halt, tripped automatically on a `403 forbidden` disconnect
  and optionally on a catastrophic reply-ratio via `haltOnLowReplyRatio`;
- reconnect backoff.

Optional hard limits (`maxPerDay`, `activeHours`) are off by default. Tune via the
`safety` option; see the [API reference](../reference/api.md#outbound-queue--safety).

A refused send throws a `SafetyError` (with a clear reason) instead of failing
silently. You only need explicit opt-in for **cold** (out-of-session) sends:

```ts
await chat.store.setOptIn('wa:6281234567890', '628999@s.whatsapp.net', true);
```

The 24-hour session window is **persisted to the `StateStore`**, so replying to a
recent conversation keeps working across a restart (the window still expires on its
own). It is keyed on a **normalised** JID and opened under both the sender and the
conversation identifier, so WhatsApp's `@lid` addressing — where a peer's chat JID
and sender JID can differ — does not wrongly reject an in-session, non-reply send.

### Stability, reconnects & health

Baileys drops the WhatsApp-web socket often — the classic "scanned at 1, dropped at
3". ChatKit makes that self-heal instead of needing a babysitter:

- **Auth is persisted encrypted**, so a reconnect (or a process restart) never
  forces a re-pair — re-pairing is itself a ban signal.
- **Reconnect policy is failure-aware:**
  - *After the socket has opened at least once,* a drop is transient and retried
    **indefinitely with capped backoff** (≤ ~1 attempt/minute — self-healing, not a
    reconnect storm). `maxReconnectAttempts` does **not** apply here.
  - *Before it has ever paired,* repeated failures (typically a `405` pairing
    rate-limit, where retrying deepens the block) are bounded by
    `maxReconnectAttempts`, then the adapter **stops** and surfaces a clear error.
  - **Terminal** closes — logged out, `403 forbidden`, session replaced — stop
    immediately. Fix the root cause, then call `chat.reconnect(platform, account)`.

Monitor it with `chat.health()` — a snapshot per persistent account, with the
WhatsApp safety stats attached:

```ts
for (const h of chat.health()) {
  // { platform, account, state, connectedSince, lastConnectedAt, reconnects, terminal,
  //   safety?: { inbound, outbound, replyRatio, halted, warming, today } }
  if (h.terminal) await pageOncall(h);         // needs a manual reconnect()
  if (h.safety?.halted) await pageOncall(h);    // account flagged at risk
}
```

### Footprint

ChatKit is **not** Chromium-based (unlike whatsapp-web.js / gowa), so there is no
headless browser to blow up your VPS. On top of that the Baileys adapter:

- **skips WhatsApp history sync entirely** (`syncFullHistory: false`,
  `shouldSyncHistoryMessage: () => false`) — history sync is the biggest RAM/bandwidth
  spike on connect, and ChatKit keeps no conversation history anyway;
- **streams media to/from a disk-backed `MediaStore`** (`FileMediaStore`) instead of
  buffering whole files in memory;
- **bounds its in-memory session cache** (expired session windows are evicted).

Being Node/Bun, it will not match a Go client (whatsmeow) on raw RSS — that is a
runtime difference, not wasted overhead. Use `SqliteStore` + `FileMediaStore` in
production so auth keys and media live on disk, not in the heap.

### Baileys-only builders

Baileys sends these dependably (at `@myrialabs/chatkit/interactive`):
`whatsappBaileysPoll`, `whatsappBaileysContacts`, `whatsappBaileysLocation`,
`whatsappBaileysEvent`.

```ts
import { whatsappBaileysPoll } from '@myrialabs/chatkit/interactive';
await chat.send({ to, ...whatsappBaileysPoll('Lunch?', ['Sate', 'Bakso', 'Nasi goreng']) });
```

> ⚠️ **Interactive buttons and lists are only reliable on WhatsApp Cloud.** WhatsApp
> restricts interactive messages (both the deprecated `buttonsMessage`/`listMessage`
> and the modern native-flow `interactiveMessage`) to the official Business/Cloud API.
> Sent from an unofficial Baileys connection they are typically accepted by the server
> but silently dropped before delivery — so ChatKit does not offer button/list
> builders for Baileys. Use the Cloud adapter for those.

---

## Cloud API

Stateless webhook. No ban risk; per-message pricing and a 24-hour window apply.

```ts
import { WhatsAppCloudAdapter } from '@myrialabs/chatkit/adapters';
import { hono } from '@myrialabs/chatkit/middleware';

chat.use(new WhatsAppCloudAdapter({
  account: 'wa:cloud', phoneNumberId, token,
  appSecret: process.env.WA_APP_SECRET, verifyToken: process.env.WA_VERIFY_TOKEN
}));

app.get('/webhook/whatsapp', hono({ chat, platform: 'whatsapp_cloud', account: 'wa:cloud' }));   // handshake
app.post('/webhook/whatsapp', hono({ chat, platform: 'whatsapp_cloud', account: 'wa:cloud' }));  // events + statuses
```

Without an `appSecret`, `verifyInbound` rejects every webhook POST (the GET
handshake needs no signature) — anyone who finds the URL could otherwise inject
messages and statuses. For local experiments only, set `allowUnverified: true`.

### Setup helpers

Account setup without hand-rolled Graph calls (not part of the universal `Adapter`
contract). The template and subscription helpers need the WhatsApp Business Account
id (`businessAccountId`); sending and receiving do not.

```ts
const wa = new WhatsAppCloudAdapter({ account: 'wa:cloud', phoneNumberId, token, businessAccountId });
const num = await wa.getPhoneNumber();        // display number, verified name, quality_rating, tier — also a token check
await wa.subscribeApp();                      // without it no webhook event ever arrives
const approved = await wa.listTemplates({ status: 'APPROVED' }); // follows paging, up to 250 by default
await wa.createTemplate({ name: 'order_update', language: 'en_US', category: 'UTILITY', components: [{ type: 'BODY', text: 'Order {{1}} shipped' }] });
await wa.deleteTemplate('order_update');      // every language
await wa.api('POST', `${phoneNumberId}/whatsapp_business_profile`, { messaging_product: 'whatsapp', about: 'Open 9–5' });
```

Watch `quality_rating`: it falls when users block or report the number, and a low
rating lowers the messaging tier.

### Interactive messages and templates

Use the typed helpers (they build the `platform_meta` passthrough for you); inbound
button/list replies come back as a universal `postback`. The full set (at
`@myrialabs/chatkit/interactive`): `whatsappCloudButtons`, `whatsappCloudList`,
`whatsappCloudCtaUrl`, `whatsappCloudLocationRequest`, `whatsappCloudFlow`,
`whatsappCloudProduct`/`whatsappCloudProductList`, `whatsappCloudTemplate` +
`waTemplate.*` component builders, `whatsappCloudCarousel`.

```ts
import { whatsappCloudButtons, whatsappCloudCtaUrl, whatsappCloudTemplate, waTemplate } from '@myrialabs/chatkit/interactive';

await chat.send({ to, ...whatsappCloudButtons('Confirm your order?', [{ text: 'Yes', data: 'yes' }, { text: 'No', data: 'no' }]) });
await chat.send({ to, ...whatsappCloudCtaUrl('Your receipt is ready', 'View receipt', 'https://shop.example/r/42') });
await chat.send({ to, ...whatsappCloudTemplate('order_update', 'en_US', [waTemplate.body('Andi', '#42'), waTemplate.quickReply(0, 'TRACK')]) });

chat.on('message', (m) => { if (m.content.type === 'postback') handle(m.content.data); });
```

### Notes

- Statuses (`sent`/`delivered`/`read`/`failed`) arrive as `status` events;
  `markRead` marks an inbound message read.
- Free-form messages need an open 24-hour customer window; outside it, send a
  template. A `429` or `5xx` from Graph is retried by the dispatcher.

---

## Rich text (both adapters)

`richText`/`rt` render to WhatsApp markup (`*bold*`, `_italic_`, `~strike~`,
` ```code``` `). Links degrade to a plain URL (WhatsApp has no inline-link syntax);
underline/spoiler are dropped. On **Baileys**, `rt.mention(...)` also fills the
native `mentions` array; the Cloud API can't mention inside free-form text, so it
degrades to a plain `@number`. Captions use `caption_rich`.

For LLM output, see [Markdown from an LLM](../essential/core-concepts.md#markdown-from-an-llm).
The Cloud API caps a text body at **4096 characters** (`TEXT_LIMITS.whatsapp_cloud`);
on Baileys the cap is far higher (`TEXT_LIMITS.whatsapp_baileys`), but short messages
read better — and look more human.
