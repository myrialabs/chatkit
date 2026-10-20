const GITHUB_BLOB_BASE = 'https://github.com/myrialabs/chatkit/blob/main';
const GITHUB_TREE_BASE = 'https://github.com/myrialabs/chatkit/tree/main';

/**
 * Doc pages are rendered from raw `docs/**\/*.md` source, so relative markdown
 * links inside them resolve to literal `.md` repo paths (correct for reading
 * on GitHub) — not the site's clean `/docs/...` routes. This maps a resolved
 * `.md` URL to what the SPA should actually do with it.
 */
function resolveMarkdownLink(url: URL): { kind: 'spa'; path: string } | { kind: 'external'; href: string } {
	if (url.pathname === '/examples/README.md') {
		return { kind: 'spa', path: '/docs/examples' + url.hash };
	}
	if (url.pathname.startsWith('/docs/') && url.pathname.endsWith('.md')) {
		const clean = url.pathname.slice(0, -'.md'.length).replace(/\/README$/, '');
		return { kind: 'spa', path: (clean || '/docs') + url.hash };
	}
	// Anything else ending in .md (root README, examples/inbox-app/README.md,
	// examples docs) has no SPA route — it's a real repo file, so send it to
	// GitHub instead of silently 404ing the SPA router.
	return { kind: 'external', href: GITHUB_BLOB_BASE + url.pathname + url.hash };
}

/**
 * A `.md` URL can reach the app two ways: a click (handled by the link
 * interceptor below) or a direct load / refresh / typed URL / bookmark —
 * this covers the second case, so `/docs/essential/core-concepts.md` shows
 * the right page instead of a 404, and cleans the address bar to match.
 */
function normalizedInitialLocation(): { path: string; hash: string } {
	if (window.location.pathname.endsWith('.md')) {
		const resolved = resolveMarkdownLink(new URL(window.location.href));
		if (resolved.kind === 'spa') {
			history.replaceState({}, '', resolved.path);
			const u = new URL(resolved.path, window.location.origin);
			return { path: u.pathname, hash: u.hash };
		}
		// A real repo file with no SPA route (root README) —
		// nothing sensible to render in the app; fall through to the 404 page
		// rather than silently redirecting to GitHub on a direct page load.
	}
	return { path: window.location.pathname, hash: window.location.hash };
}

const initialLocation = normalizedInitialLocation();
let path = $state(initialLocation.path);
let hash = $state(initialLocation.hash);

export function currentPath(): string {
	return path;
}

export function currentHash(): string {
	return hash;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
	const url = new URL(to, window.location.origin);
	if (opts.replace) history.replaceState({}, '', url);
	else history.pushState({}, '', url);
	path = url.pathname;
	hash = url.hash;
	if (!opts.replace) window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
	path = window.location.pathname;
	hash = window.location.hash;
});

/**
 * Intercept same-origin anchor clicks anywhere in the document (including
 * inside `{@html}`-rendered markdown) and route them client-side instead of
 * a full page load.
 */
export function installLinkInterceptor(): () => void {
	function onClick(e: MouseEvent): void {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const anchor = (e.target as HTMLElement)?.closest?.('a');
		if (!anchor) return;
		const href = anchor.getAttribute('href');
		if (!href || href.startsWith('#') || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

		// `/docs` (no trailing slash) actually renders `docs/README.md` — a file
		// one level down from where the URL's own path suggests. The URL spec
		// treats a slash-less path as a "file", so relative markdown links like
		// `./essential/core-concepts.md` would otherwise resolve against `/`
		// instead of `/docs/`, silently dropping the `docs` segment.
		const base = window.location.pathname === '/docs' ? window.location.href + '/' : window.location.href;

		let url: URL;
		try {
			url = new URL(href, base);
		} catch {
			return;
		}
		if (url.origin !== window.location.origin) return;

		if (url.pathname.endsWith('.md')) {
			e.preventDefault();
			const resolved = resolveMarkdownLink(url);
			if (resolved.kind === 'external') window.open(resolved.href, '_blank', 'noopener');
			else navigate(resolved.path);
			return;
		}

		// A relative link in rendered markdown that leaves the site's routes
		// (e.g. `../examples/inbox-app`) is a repo folder — send it
		// to GitHub rather than the SPA's 404 page.
		const isRepoPath =
			!href.startsWith('/') && url.pathname !== '/' && url.pathname !== '/examples' && !/^\/docs(\/|$)/.test(url.pathname);
		e.preventDefault();
		if (isRepoPath) window.open(GITHUB_TREE_BASE + url.pathname + url.hash, '_blank', 'noopener');
		else navigate(url.pathname + url.search + url.hash);
	}
	document.addEventListener('click', onClick);
	return () => document.removeEventListener('click', onClick);
}
