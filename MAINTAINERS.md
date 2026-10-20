# Maintainers Guide

Internal guide for chatkit maintainers. External contributors follow
[CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Guiding Principles

- **Audit before asking the contributor to validate.** Read the full diff and
  adjacent code before requesting changes.
- **Protect the invariants.** A quiet core, cross-runtime support (Node 22.13+ &
  Bun), dynamically-loaded SDKs, capability honesty, built-in security, and the
  default-on WhatsApp safety layer are load-bearing. A PR that breaks one needs
  explicit justification.
- **The envelope is a contract.** Changes to `src/schema.ts` ripple across every
  adapter and every consumer. Treat them as semver-significant and demand tests.
- **Default to the established pattern.** New mechanisms need a reason the existing
  shape (`Adapter` / `StateStore` / `MediaStore` / `OutboundQueue` / verifiers)
  doesn't fit.
- **Warm, brief, substantive — in that order.** Open by naming something specific
  the contributor did well. `file:line` inline for technical points.
- **Attribution always.** Whether you build on a branch or close-and-replace, the
  original find earns credit.

---

## The PR Lifecycle

1. **Intake** — `gh pr checkout <N>`, read the entire diff first.
2. **Audit** — check:
   - **Invariants** — quiet core, cross-runtime, dynamic SDK import, capability
     gating, security (verify + at-rest encryption), WhatsApp safety on.
   - **Envelope impact** — does it widen/narrow the universal core, or should it
     be passthrough? Is the change reflected in zod + types + docs?
   - **Adjacent code** — same-shape gaps the PR didn't touch.
   - **Tests** — is there a `*.test.ts` where CONTRIBUTING expects one? Adapters
     mocked, not live?
   - **Before/after** — walk one concrete inbound→outbound scenario in user terms.
3. **Choose a path** (below).
4. **Merge** — squash-merge via the GitHub UI; subject = PR title `(#N)`; body
   empty except a `Co-authored-by:` trailer when reshaping a contributor's work;
   delete the branch.

### Review Paths

| Situation | Path |
|---|---|
| Audit clean | **Approve & merge.** Short approval naming what they did well; note checks green; merge. |
| Right shape, small additions, contributor engaged | **Iterate on the branch.** Push a *new* commit (never amend theirs); `merge` (not rebase) to sync `main`. |
| Out-of-scope same-shape gaps | **Merge as-is, follow-up PR.** Credit the find; open `fix/<scope>-…`. |
| Substantive concerns, you might lack context | **Comment & wait.** Warm opener, `file:line` concerns, the question that would flip your position, a plain-English deadline, explicit auto-stale consequence. |
| Shape must change | **Close & replace.** Explain why with `file:line`; open a replacement crediting them via `Co-authored-by:`. |

When unsure between "comment & wait" and a close, default to comment & wait.

---

## Communication Norms

- **All PR-facing text in English**, warmly, even when the maintainer
  conversation is in another language.
- **Don't link this file from PR comments.** Reference CONTRIBUTING.md instead.
- **Resolve conflicts locally**, never via the web UI. Never `--no-verify`.
  Never force-push to `main`.

---

## Security-Sensitive Review

ChatKit handles credentials and unofficial WhatsApp access. Extra scrutiny for:

- **Verifiers** (`src/verify/`) — must stay constant-time, length-safe, and keep
  the anti-replay window. New families need test vectors.
- **At-rest crypto** (`src/store/crypto.ts`) — AES-256-GCM, random IV, auth tag
  checked. No plaintext credential ever persisted or logged.
- **Safety layer** (`src/safety/`) — no PR may introduce an unthrottled or
  opt-in-bypassing send path for Baileys.

---

## Release Process

Tag-driven, automated by `.github/workflows/ci.yml`. The `publish` job runs only
on `v*.*.*` tags, after `ci` (typecheck, lint, test, build, verify dist),
`node-matrix` (Node 22/24 smoke) and `pack` pass.

```bash
git checkout main && git pull origin main
# bump "version" in package.json
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

The workflow runs `npm publish --provenance --access public` (using `NPM_TOKEN`)
and creates a GitHub release with generated notes.

**One-time prerequisites:**
- `NPM_TOKEN` repository secret with publish rights to `@myrialabs/chatkit`.
- The package is scoped and published with `--access public`. Verify the tarball
  contains `dist/` with `npm pack` (the `pack` CI job does this).

**Versioning (semver):** `fix` → patch, `feat` → minor, breaking public-API or
envelope change → major.

---

## Co-authored-by Trailer

```
Co-authored-by: Full Name <email@example.com>
```

Get the email via `git log <branch> -1 --format='%ae'`.
