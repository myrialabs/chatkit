# Agent Guidelines

This file is for coding agents working in the **chatkit** repository.

## Project Snapshot

`@myrialabs/chatkit` is a TypeScript ESM library and CLI that gives one unified,
typed API to receive and send messages across Telegram, WhatsApp (Baileys &
Cloud API), Discord and Slack. It runs on Node 22.13+ and Bun (server-side; not the
browser — Baileys is Node-only). The docs for users live in `docs/`.

The shape: a universal message envelope + addressing + capability descriptors in
the core; per-platform adapters behind one `Adapter` interface; pluggable
`StateStore`/`MediaStore` ports; an in-process outbound dispatcher; pure inbound
verifiers; and a mandatory WhatsApp safety layer. Development uses Bun for
scripts and tests.

## Core Rules

- **Quiet core.** Nothing in `src/` writes to stdout/stderr except `src/cli.ts`.
  Diagnostics go through the injected `Logger` (default no-op).
- **Cross-runtime (Node 22.13+ and Bun).** Gate runtime-specific APIs; the SQLite
  layer already detects `bun:sqlite` → `node:sqlite` (no native driver).
- **Heavy platform SDKs are dynamically imported** via a non-literal specifier
  (`import(specifier)`). They stay regular `dependencies` (one install covers every
  platform; not `peerDependencies`), but unused adapters never load them and the
  core type-checks without their types. Keep it that way.
- **Capabilities don't lie.** Unsupported features must throw `CapabilityError`,
  never silently no-op. Rich/platform-specific features go through
  `platform_meta.<platform>` passthrough, not the universal core.
- **Security is built-in, not bolted on.** Inbound verification is pure and
  per-platform; auth state is encrypted at rest (AES-256-GCM); never log
  credentials.
- **WhatsApp safety is mandatory.** The Baileys safety layer is on by default —
  don't add a "send as fast as possible" path. Always document ban risk.
- Use explicit `.js` import specifiers. Keep strict TypeScript and ESLint intact.
- Do not revert or overwrite unrelated user changes. Update docs when public
  behaviour changes.

## Repository Map

- `src/index.ts` — public exports (barrel).
- `src/chatkit.ts` — the `ChatKit` class: registry, events, lifecycle, send.
- `src/schema.ts` — zod schemas + inferred types (single source of truth).
- `src/envelope.ts` — envelope builder, content builders, reversible native refs.
- `src/address.ts` · `src/capability.ts` · `src/logger.ts` · `src/adapter.ts`.
- `src/store/` — `StateStore` port, `memory.ts`, `sqlite.ts`, `crypto.ts`.
- `src/media/` — `MediaStore` port + `MediaProxy`, `memory.ts`, `file.ts`.
- `src/queue/` — in-process outbound dispatcher (ordering + rate + retry).
- `src/verify/` — pure inbound verifiers (HMAC / secret token / Ed25519).
- `src/safety/` — Baileys safety layer.
- `src/adapters/` — `telegram.ts`, `whatsapp.ts`, `whatsapp-cloud.ts`,
  `discord.ts`, `slack.ts`, `util/split-message.ts`.
- `src/middleware/` — Hono / Express / Fastify / Elysia + `shared.ts`.
- `src/cli.ts` — CLI entry and dispatch.
- `docs/*.md` · `examples/`.

## Style

- TypeScript strict. Tabs, single quotes, semicolons. `const` by default.
- `camelCase` values, `PascalCase` types/classes, `UPPER_SNAKE_CASE` constants,
  `kebab-case` files. Envelope *data* fields are `snake_case` by design (a wire
  contract).
- `any` only at the platform-SDK / framework / runtime boundary.
- Focused comments that explain non-obvious behaviour.

## Testing And Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun test src/verify/verify.test.ts   # targeted
```

Add `*.test.ts` next to non-trivial logic. Adapters are tested with a mocked
`fetch` / injected SDK module — never against the live network. Verifiers ship
with test vectors per family.

## Documentation Rules

- Public API changes: update `README.md` and `docs/reference/api.md`.
- Adapter behaviour changes: update the relevant `docs/channels/<platform>.md`.
- Example-affecting changes: update `examples/` or `examples/README.md`.
- Do not create new Markdown files unless requested or clearly needed.

## Contribution Metadata

Follow `CONTRIBUTING.md` for branch names, commit messages, PR titles, and PR
descriptions. Repository-facing text must be in English.
