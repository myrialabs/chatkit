# Operations & Risk Runbook

Running ChatKit means running long-lived connections and, for Baileys, accepting a
real ban risk. This is the operational guidance distilled from the project's design decisions.

## WhatsApp (Baileys) ban risk

Baileys is unofficial — it impersonates WhatsApp Web. Bans are real, often
permanent, and typically land **2–8 weeks** into risky usage. No mitigation makes
it "safe"; the safety layer only lowers and slows the probability.

**The three signals WhatsApp weighs:** low reply ratio (sending a lot, rarely
replied to), contact-graph distance (messaging numbers you've never interacted
with), and robotic timing (uniform intervals, bursts, inhuman hours).

**What the built-in safety layer does (on by default):**

- per-account throttle (default 1 msg/s) + Gaussian jitter between sends;
- warming guard — a freshly paired number auto-warms (default 7 days): cold
  (non-reply) sends are blocked and the send rate **ramps gradually** from the warmup
  ceiling up to steady state across the window (no day-one jump to full speed);
- opt-in enforcement before business-initiated (non-reply) sends;
- reply-ratio monitoring — warns when the inbound/outbound ratio falls below 0.1, and
  (opt-in via `haltOnLowReplyRatio`) auto-halts on a sustained catastrophic ratio;
- an "account at risk" halt (`safety.flagAtRisk`) that pauses sends until cleared —
  tripped **automatically** on a `403 forbidden` disconnect (WhatsApp's ban signal);
- a failure-aware reconnect policy (see below) that self-heals transient drops without
  becoming an abnormal reconnect loop.

**Your responsibilities:**

- Use a **test / non-critical number**. Warm it for 3–7 days with normal human use
  before connecting; a freshly paired number then auto-warms (ramped rate) — leave the
  window on, or tune it with `warmupDurationMs` / `warmupUntil`.
- Prefer **reply-driven** sending. Record opt-in
  (`store.setOptIn(account, userId, true)`) before any cold message.
- Never run risky operations (mass status uploads) from a server.
- If WhatsApp surfaces an "account at risk" warning, call
  `chat.safety.flagAtRisk(account)` and back off; investigate before clearing.
- If you cannot tolerate a ban, use the **Cloud API** adapter instead.

## Reconnect storms

A process restart drops every persistent connection at once; they all reconnect
together. For Baileys this reconnect burst is itself a risk signal.

- `chat.stop()` **drains** the outbound queue and closes connections cleanly — call
  it on shutdown (`SIGINT`/`SIGTERM`).
- Do **rolling** restarts when running many connections; don't bounce them all
  simultaneously.
- Auth state survives restarts (encrypted in the `StateStore`), so reconnects
  RESUME rather than re-pair. Losing state forces a re-pair (QR), which raises risk.
- The reconnect policy is **failure-aware**, not a flat cap:
  - *Post-open* (the socket paired successfully at least once): a drop is transient
    and retried **indefinitely with capped backoff** (≤ ~1 attempt/minute — a 24/7
    gateway self-heals). `maxReconnectAttempts` does not apply here.
  - *Pre-pair* (never opened): repeated failures — typically a `405` pairing
    rate-limit where looping deepens the block — are **bounded** by
    `maxReconnectAttempts` (default 5), then the adapter stops and emits an `error`.
  - **Terminal** closes (logged out, `403 forbidden`, session replaced) stop
    immediately. After fixing the root cause, call `chat.reconnect(platform, account)`.
  - `restartRequired` (the expected post-pair step) reconnects immediately and does
    not consume any budget. The disconnect status code is logged on every close.
- Monitor with `chat.health()` — per-account `state`/`connectedSince`/`reconnects`/
  `terminal` plus the WhatsApp `safety` snapshot (`halted`, `warming`, `replyRatio`).
  `terminal: true` or `safety.halted: true` means a number needs attention.

### "Connection Failure" before a QR appears

If the socket closes immediately with `405`/`428` **before** any QR is emitted —
and never reaches `open` — WhatsApp is rejecting the handshake. The usual cause is
a **stale WhatsApp-web client version**: the version Baileys bundles drifts out of
date and WhatsApp refuses it. The adapter guards against this by resolving the
current version at `start()` (logged as `Resolved WhatsApp web version`) and
announcing it on every socket; pin it with the `version` option if the lookup is
unavailable (offline/mirrored hosts).

If `405` persists *after* a current version is announced, the remaining cause is a
per-IP **pairing rate-limit** (often deepened by a fast reconnect loop). Confirm
with the close log (`code` / `reason`), stop the process, and retry later from a
clean network — looping only extends the cooldown, which is why reconnects are
bounded (see above).

## State & backups

- `SqliteStore` keeps dedup keys, the id mapping, opt-in records, and **encrypted**
  Baileys auth state in one SQLite file. Back up that file (and keep
  `CHATKIT_STATE_KEY` somewhere safe — without it the secrets are unrecoverable).
- To migrate a number to a new host: copy the SQLite file and the state key; the
  adapter restores auth state on `start()` with no re-pair.
- Rotating the state key re-encrypts nothing automatically — re-pair or re-write
  secrets after a key change.

## Scaling persistent connections

Each Baileys number / Discord bot is one live WebSocket + state — a stateful
fan-out, unlike stateless webhooks.

- A single process can hold many connections; memory/CPU per connection is your
  unit of capacity — measure it.
- To scale out, run several processes, each owning a subset of accounts. ChatKit
  doesn't force a topology; share a `StateStore` if you need cross-process
  coordination.
- One account's reconnect loop must not take down its neighbours — adapter errors
  are isolated per account and surfaced on `chat.on('error')`. Watch that channel.

## Rate limits

The outbound dispatcher caps per platform by default (Telegram 25/s, WA Cloud
60/s, WA Baileys 2/s on top of the safety throttle, Discord 4/s, Slack 1/s) and
retries transient failures (`429`/`5xx`) with backoff. Tune via the `queue`
option. Honour `Retry-After` semantics by letting the dispatcher retry rather than
hammering.
