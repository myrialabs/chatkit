/**
 * Raw-imports every doc page from the repo-root `docs/` folder at build time.
 * `docs/` stays the only source of truth — this module never forks content,
 * it only organizes it into a nav tree for the site.
 */

const rawDocs = import.meta.glob('../../../docs/**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

export interface DocPage {
	/** Section folder name, or 'index' for the top-level docs/README.md. */
	section: string;
	/** URL slug within the section, e.g. 'core-concepts'. */
	slug: string;
	/** Full route path, e.g. '/docs/essential/core-concepts'. */
	path: string;
	/** First H1 text, falling back to a titleized slug. */
	title: string;
	/** Raw markdown source. */
	content: string;
}

export interface DocSection {
	key: string;
	title: string;
	pages: DocPage[];
}

const SECTION_TITLES: Record<string, string> = {
	'getting-started': 'Getting Started',
	essential: 'Essential',
	channels: 'Channels',
	operations: 'Operations',
	reference: 'Reference'
};

const SECTION_ORDER = Object.keys(SECTION_TITLES);

/** Reading order within a section, for slugs where alphabetical isn't logical. */
const SLUG_ORDER: Record<string, string[]> = {
	channels: ['telegram', 'whatsapp', 'discord', 'slack'],
	operations: ['webhooks', 'cli', 'runbook']
};

function slugRank(section: string, slug: string): number {
	const order = SLUG_ORDER[section];
	const i = order?.indexOf(slug) ?? -1;
	return i === -1 ? 999 : i;
}

function titleize(slug: string): string {
	return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstHeading(md: string): string | undefined {
	const m = md.match(/^#\s+(.+)$/m);
	return m?.[1]?.trim();
}

function parsePath(fullPath: string): { section: string; slug: string } | undefined {
	const m = fullPath.match(/\/docs\/(?:([^/]+)\/)?([^/]+)\.md$/);
	if (!m) return undefined;
	const [, section, file] = m;
	if (!section && file === 'README') return { section: 'index', slug: 'index' };
	if (!section) return undefined;
	return { section, slug: file! };
}

const allPages: DocPage[] = Object.entries(rawDocs)
	.map(([fullPath, content]) => {
		const parsed = parsePath(fullPath);
		if (!parsed) return undefined;
		const { section, slug } = parsed;
		const path = section === 'index' ? '/docs' : `/docs/${section}/${slug}`;
		const title = firstHeading(content) ?? titleize(slug);
		return { section, slug, path, title, content } satisfies DocPage;
	})
	.filter((p): p is DocPage => Boolean(p));

export const docsIndex = allPages.find((p) => p.section === 'index');

export const docSections: DocSection[] = SECTION_ORDER.map((key) => ({
	key,
	title: SECTION_TITLES[key]!,
	pages: allPages
		.filter((p) => p.section === key)
		.sort((a, b) => slugRank(key, a.slug) - slugRank(key, b.slug) || a.slug.localeCompare(b.slug))
})).filter((s) => s.pages.length > 0);

export function findDocPage(section: string, slug: string): DocPage | undefined {
	return allPages.find((p) => p.section === section && p.slug === slug);
}

export function allDocPages(): DocPage[] {
	return allPages;
}
