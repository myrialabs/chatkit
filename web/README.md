# chatkit-web

The marketing site + docs browser for ChatKit, served from
`chatkit.myrialabs.dev`. This package has **no content of its own** — the
home page, docs, and examples pages all raw-import from the repo root's
`docs/` and `examples/` at build time (see `src/lib/docs.ts` and
`src/lib/examples.ts`). If something here is wrong or missing, fix it in
`docs/`/`examples/`, not in this package.

Stack: Vite + Svelte 5 (runes), a tiny hand-rolled history-mode router (no
SvelteKit), `marked` + `shiki` for markdown rendering. A self-contained
package — its own `package.json`, not a workspace member — so root tooling
never touches its dependency tree.

## Running locally

```sh
bun install
bun run dev
```

Requires the repo root's `docs/`/`examples/` to exist (they're committed, so
a fresh clone already has them). `vite.config.ts` allows Vite to read one
directory above this package (`fs: { allow: ['..'] }`) for the raw markdown
imports.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Regenerate `llms.txt`/`llms-full.txt`/`sitemap.xml`, then start the Vite dev server |
| `bun run build` | Regenerate `llms.txt`/`llms-full.txt`/`sitemap.xml`, then build to `dist/` |
| `bun run preview` | Preview a production build |
| `bun run generate:llms` | Regenerate `public/llms.txt`, `public/llms-full.txt` + `public/sitemap.xml` from `docs/**/*.md` |
| `bun run typecheck` | `tsc --noEmit` + `svelte-check` |

`public/llms.txt`, `public/llms-full.txt` and `public/sitemap.xml` are generated, gitignored, and
regenerated on every `dev`/`build` — never hand-edit them.

## Deploying

`public/_redirects` (`/*  /index.html  200`) covers Netlify/Cloudflare Pages
SPA fallback out of the box. For any other static host, point its "unknown
path → index.html" rewrite at `dist/index.html` after `bun run build`.
