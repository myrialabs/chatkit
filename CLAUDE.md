# Claude Code Guidelines

Guidelines for Claude Code when working on **chatkit**.

---

## What This Project Is

`@myrialabs/chatkit` is a TypeScript-native library and CLI for two-way messaging
across Telegram, WhatsApp (Baileys & Cloud API), Discord and Slack, on Node 22.13+
and Bun. It is a **library you embed**, not a service you deploy. It exposes one
unified API:

- A `ChatKit` class — adapter registry, event emitter (`message`/`reaction`/
  `status`/`error`), capability-gated `send()`, and lifecycle (`start`/`stop`).
- A universal message envelope + three-layer addressing + capability descriptors,
  defined as zod schemas in `src/schema.ts`.
- Per-platform adapters behind one `Adapter` interface, exported from a single
  subpath (`@myrialabs/chatkit/adapters`).
- Pluggable `StateStore` / `MediaStore` ports (in-memory + SQLite + filesystem
  defaults), an in-process outbound dispatcher, pure verifiers
  (`@myrialabs/chatkit/verify`), framework middleware, and a WhatsApp safety layer.

It ships ESM (`NodeNext`) from `src/` to `dist/`, exports from `src/index.ts`, and
exposes the `chatkit` command via `dist/cli.js`. User-facing docs live in
`docs/` (start at `docs/README.md`).

---

## Non-Negotiables

- The library core is **silent** — terminal writes belong only in `src/cli.ts`.
  Everything else logs through the injected `Logger`.
- Keep `src/` **cross-runtime** (Node 22.13+ and Bun). The SQLite layer detects
  `bun:sqlite` → `node:sqlite` (both built in; no native driver); don't hard-code one.
- Heavy platform SDKs (`@whiskeysockets/baileys`, `discord.js`, `@slack/*`) are
  **dynamically imported** through a non-literal specifier so unused adapters never
  load them and the core builds without their types. They remain regular
  `dependencies` (not peers) — don't move them. Don't add static top-level imports.
- **Capabilities are an honesty contract.** Gate `send()` with `assertSupported`;
  unsupported features throw `CapabilityError`. Platform-specific richness goes
  through `platform_meta.<platform>` passthrough, never into the universal core.
- **Security first.** Inbound verifiers are pure and per-platform; Baileys auth
  state is encrypted at rest (AES-256-GCM via `src/store/crypto.ts`); never log
  credentials.
- **WhatsApp safety is mandatory and default-on.** Don't expose an unthrottled
  send path. Document ban risk to consumers.
- ESM imports with explicit `.js` specifiers. Don't loosen compiler/lint settings
  to make a change pass. Check `git status`; don't clobber unrelated edits.

---

## Current Architecture

- `src/index.ts` — public exports.
- `src/chatkit.ts` — `ChatKit`: registry, events, dedup pipeline, send, lifecycle.
- `src/schema.ts` — zod schemas + inferred types (the contract).
- `src/envelope.ts` — `inbound()`, content builders, `encodeRef`/`decodeRef`, ids.
- `src/address.ts` — addressing helpers & keys. `src/capability.ts` — descriptors,
  registry, `assertSupported`, `CapabilityError`.
- `src/adapter.ts` — `Adapter` / `WhatsAppAdapter` / `AdapterContext` contracts.
- `src/store/` — `StateStore` port, `memory.ts`, cross-runtime `sqlite.ts`,
  `crypto.ts` (AES-256-GCM `SecretCodec`).
- `src/media/` — `MediaStore` port + `MediaProxy` (ingest/resolve/validate),
  `memory.ts`, `file.ts`.
- `src/queue/` — `OutboundQueue`: serial per key, rate-limited, retry+backoff.
- `src/verify/` — `verifyWhatsAppCloud`, `verifySlack`, `verifyTelegram`,
  `verifyDiscord`, anti-replay.
- `src/safety/` — `BaileysSafety` (throttle/jitter/warming/opt-in/halt/backoff) +
  `noopSafety`.
- `src/adapters/` — one file per platform + `util/split-message.ts`.
- `src/middleware/` — `hono.ts`, `express.ts`, `fastify.ts`, `elysia.ts`,
  `shared.ts`, `index.ts`.
- `src/cli.ts` — CLI entry/dispatch only.
- `docs/`, `examples/`.

---

## Work Protocol

### Before Editing
- Inspect the source and its neighbouring `*.test.ts`. Use `rg` for search.

### While Editing
- Match local style: tabs, single quotes, semicolons, `const` by default.
- kebab-case files; `camelCase`/`PascalCase`/`UPPER_SNAKE_CASE` per above.
- Add `bun:test` tests next to non-trivial logic. Adapters are tested with mocked
  `fetch` or an injected SDK module; verifiers with test vectors.
- Keep `any` limited to the SDK/framework/runtime boundary. Prefer focused changes.

### After Editing
```sh
bun run typecheck
bun run lint
bun run test
bun run build
```
For docs-only changes, say so and skip the code checks if nothing else changed.

---

## Public Surface Rules

- Public API changes → update `README.md` and `docs/reference/api.md`.
- Adapter/CLI changes → update `README.md` and the relevant `docs/channels/*.md`
  or `docs/operations/cli.md`.
- Keep examples aligned with the documented API.
- `README.md` may be dirty from user edits; don't overwrite unless required.
- Keep repository-facing text in English, following `CONTRIBUTING.md`.

---

## Verification Reference

- `bun run typecheck` — `tsc -p tsconfig.json --noEmit`
- `bun run lint` — ESLint flat config
- `bun run test` — `bun:test`
- `bun run build` — emit `dist/`
- `bun run prepublishOnly` — clean and build
