# Contributing Guide

Thanks for considering a contribution to **chatkit**. This guide covers the dev
setup, conventions, and the submission process.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.2+ (used for dev, tests, and CI).
- Node 22.13+ (the supported floor, enforced in `src/runtime.ts`) if you want to
  verify the Node runtime path.

ChatKit is a TypeScript ESM library + CLI for Node 22.13+ and Bun. Heavy platform
SDKs (`@whiskeysockets/baileys`, `discord.js`, `@slack/*`) are dependencies that
are **dynamically imported**, so the library type-checks and the tests run without
hitting the network — adapters are tested against mocks.

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/chatkit.git
cd chatkit
git remote add upstream https://github.com/myrialabs/chatkit.git
bun install
bun run typecheck && bun run lint && bun run test && bun run build
```

All of these should pass on a fresh clone.

---

## Development Workflow

```bash
git checkout main && git pull upstream main
git checkout -b feature/your-feature
# develop & verify:
bun run typecheck && bun run lint && bun run test && bun run build
git commit -m "feat(telegram): support inline keyboards via passthrough"
git push origin feature/your-feature   # then open a PR targeting main
```

---

## Project Principles

Non-negotiable — a PR that breaks one needs explicit discussion first.

- **Quiet core.** Only `src/cli.ts` writes to stdout/stderr. The library logs
  through the injected `Logger`.
- **Cross-runtime.** `src/` runs on Node 22.13+ and Bun. Gate runtime-specific APIs
  with a portable fallback (the SQLite layer is the model).
- **Dynamic SDK loading.** Platform SDKs load via a non-literal `import()` so the
  core builds without their types and unused adapters never load. They stay regular
  `dependencies` (not peers). No static top-level imports of them.
- **Capabilities don't lie.** Gate `send()`; unsupported features throw
  `CapabilityError`. Platform-specific richness goes through `platform_meta`
  passthrough, not the universal core.
- **Security built-in.** Pure per-platform verifiers; auth state encrypted at
  rest; never log credentials.
- **WhatsApp safety is mandatory and default-on.** No unthrottled send path.
- **Public API changes are documented.** Update `README.md` and the relevant
  `docs/*.md` in the same PR.

---

## Code Style

- TypeScript, strict mode. `const` by default; `let` only when reassigned.
- ESM with explicit `.js` import specifiers (required by `NodeNext`).
- Tabs, single quotes, semicolons. No Prettier — manual consistency.
- Naming: `camelCase` values, `PascalCase` types/classes, `UPPER_SNAKE_CASE`
  constants, `kebab-case` files. Envelope data fields are `snake_case` by design.
- `any` is acceptable only at the SDK / framework / runtime boundary.

### Tests

Add a `*.test.ts` next to the source using `bun:test` for any non-trivial logic
where a regression would be silent — envelope validation, store round-trips,
capability gating, queue ordering/retry, verifier vectors, safety behaviour, and
adapter normalisation (with a mocked `fetch` or injected SDK module).

```bash
bun test src/chatkit.test.ts   # single file
bun test                       # full suite
```

---

## Documentation

User docs live in `docs/` (index: `docs/README.md`); the website in `web/`
imports them as-is, so keep the `docs/<section>/<page>.md` layout.

| Change | Update |
|---|---|
| Public API / options | `README.md` + `docs/reference/api.md` (+ `docs/essential/core-concepts.md` if it changes the model) |
| Adapter behaviour | The matching `docs/channels/<platform>.md` |
| Webhook / verifier | `docs/operations/webhooks.md` |
| CLI | `docs/operations/cli.md` |
| New concept shared by several platforms | `core-concepts.md` once — channel pages link to it instead of repeating it |

Channel pages share one layout — at-a-glance table, setup, receiving, sending,
rich text, interactive builders, passthrough — so keep new sections in that
order. Write for a first-time reader: lead with what to do, then
why. Examples must match the real API; docs-only changes need no code checks.

---

## Submitting Changes

All repository-facing text — branch names, commit messages, PR titles and
descriptions, PR comments — must be in **English**.

### Branch Naming

`<type>/<description>` — lowercase, kebab-case, exactly one `/`.
Types: `feature/`, `fix/`, `docs/`, `chore/`.

### Commit Messages

`<type>(<scope>): <subject>` — imperative, lowercase, no period, ≤72 chars.
Types: `feat`, `fix`, `docs`, `chore`, `release`.
Common scopes: `core`, `telegram`, `whatsapp`, `discord`, `slack`, `store`,
`media`, `queue`, `verify`, `safety`, `middleware`, `cli`, `readme`, `examples`.

```
feat(slack): add Socket Mode reaction events
fix(queue): keep the per-key chain alive after a rejected task
docs(runbook): expand the WhatsApp warming guidance
```

### Pre-commit Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] `bun run build` emits `dist/` cleanly
- [ ] Public API/adapter/CLI change reflected in `README.md` + `docs/`

### Pull Request Description Template

```markdown
## Summary
What this PR does, in a sentence or two.

## Why
The motivation — bug it fixes, behavior it changes.

## Changes
- concrete bullet list

## Notes (optional)
Trade-offs, follow-ups.
```

Add `## Breaking changes` with a migration note whenever the public API changes.

---

## Reference

```bash
bun run typecheck     # tsc --noEmit
bun run lint          # eslint
bun run test          # bun:test
bun run build         # emit dist/
```

- [TypeScript Docs](https://www.typescriptlang.org/docs/)
- [Bun Docs](https://bun.sh/docs)
- [Conventional Commits](https://www.conventionalcommits.org/)

## Questions?

- [Issues](https://github.com/myrialabs/chatkit/issues)
