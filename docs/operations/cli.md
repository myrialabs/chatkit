# CLI Reference

`chatkit` is a thin command-line wrapper over the library for a handful of
operational tasks — it is the **only** place ChatKit writes to the terminal;
the library core itself stays silent (diagnostics flow through an injected
`Logger`).

## Install

```sh
bun add -g @myrialabs/chatkit
# or: npm i -g @myrialabs/chatkit
```

## Usage

```
chatkit pair --account wa:62...   [--db chatkit.db] [--state-key KEY]
chatkit send --platform telegram --token T --to ID --text "hello"
chatkit capabilities <platform>
chatkit version | help
```

Platforms: `telegram`, `whatsapp_baileys`, `whatsapp_cloud`, `discord`, `slack`.

## `chatkit pair`

Pairs a WhatsApp (Baileys) number by QR code and keeps the process alive as a
minimal echo listener (prints inbound message content, logs errors) — useful
to validate a number before wiring it into your app.

```sh
CHATKIT_STATE_KEY=… chatkit pair --account wa:6281234567890
```

| Flag | Required | Default |
|---|---|---|
| `--account` | yes | — (e.g. `wa:6281234567890`) |
| `--state-key` | yes, unless `CHATKIT_STATE_KEY` is set | — |
| `--db` | no | `./chatkit.db` |

Auth state is encrypted at rest with the state key, so re-running `pair`
against the same `--db` after a restart reconnects without a fresh QR. Scan
the printed QR from WhatsApp → Linked Devices, **with a test number** — see
the [risk runbook](./runbook.md). Stop with `Ctrl+C` (drains and closes
cleanly).

## `chatkit send`

Sends a single text message and exits. Currently Telegram-only.

```sh
chatkit send --platform telegram --token T --to 12345 --text "hi"
```

| Flag | Required |
|---|---|
| `--platform` | yes — only `telegram` today |
| `--token` | yes — bot token |
| `--to` | yes — chat id |
| `--text` | yes — message body |
| `--account` | no — defaults to `bot` |

## `chatkit capabilities <platform>`

Prints a platform's `CapabilityDescriptor` as JSON, built from a throwaway
adapter instance (no real credentials contacted) — a quick way to check what
a platform can do without writing code:

```sh
chatkit capabilities discord
```

## `chatkit version` / `chatkit help`

Print the installed version, or the usage text above.

## Notes

- `NO_COLOR=1` (or a non-TTY stdout) disables ANSI colour in output.
- The CLI is deliberately small — `pair`, `send`, and `capabilities` cover
  operational bootstrap and debugging. Everything else (routing inbound,
  building real bots) is the library API — see the
  [quickstart](../getting-started/quickstart.md).
