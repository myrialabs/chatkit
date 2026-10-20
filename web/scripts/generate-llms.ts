/**
 * Generates public/llms.txt (curated index), public/llms-full.txt (full
 * content) and public/sitemap.xml from docs/**\/*.md, following the llmstxt.org convention. Both
 * output files are .gitignored and regenerated on every `dev`/`build` — never
 * hand-edit them; edit the source docs instead.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SITE_URL = 'https://chatkit.myrialabs.dev';
const DOCS_ROOT = join(import.meta.dir, '..', '..', 'docs');
const OUT_DIR = join(import.meta.dir, '..', 'public');

const SECTION_TITLES: Record<string, string> = {
	'getting-started': 'Getting Started',
	essential: 'Essential',
	channels: 'Channels',
	operations: 'Operations',
	reference: 'Reference'
};
const SECTION_ORDER = Object.keys(SECTION_TITLES);

interface Entry {
	section: string;
	url: string;
	title: string;
	summary: string;
	content: string;
}

async function walk(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) files.push(...(await walk(full)));
		else if (e.name.endsWith('.md')) files.push(full);
	}
	return files;
}

function firstHeading(md: string): string {
	const m = md.match(/^#\s+(.+)$/m);
	return m?.[1]?.trim() ?? 'Untitled';
}

function firstParagraph(md: string): string {
	const withoutH1 = md.replace(/^#\s+.+$/m, '').trim();
	const lines = withoutH1.split('\n');

	let inFence = false;
	let current: string[] = [];
	const paragraphs: string[] = [];
	for (const raw of lines) {
		if (raw.trim().startsWith('```')) {
			inFence = !inFence;
			if (current.length) paragraphs.push(current.join(' '));
			current = [];
			continue;
		}
		if (inFence) continue;
		const line = raw.trim();
		const isBoundary = line === '' || line.startsWith('#') || line.startsWith('|') || line.startsWith('>');
		if (isBoundary) {
			if (current.length) paragraphs.push(current.join(' '));
			current = [];
			continue;
		}
		current.push(line);
	}
	if (current.length) paragraphs.push(current.join(' '));

	const first = paragraphs.find((p) => p.trim().length > 0) ?? '';
	return first.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

async function collect(): Promise<Entry[]> {
	const files = await walk(DOCS_ROOT);
	const entries: Entry[] = [];
	for (const file of files) {
		const rel = relative(DOCS_ROOT, file).replace(/\\/g, '/');
		const content = await readFile(file, 'utf8');
		const title = firstHeading(content);
		const summary = firstParagraph(content);

		if (rel === 'README.md') {
			entries.push({ section: 'index', url: `${SITE_URL}/docs`, title, summary, content });
			continue;
		}
		const m = rel.match(/^([^/]+)\/([^/]+)\.md$/);
		if (!m) continue;
		const [, section, slug] = m;
		if (!SECTION_TITLES[section!]) continue;
		entries.push({ section: section!, url: `${SITE_URL}/docs/${section}/${slug}`, title, summary, content });
	}
	return entries;
}

function buildLlmsTxt(entries: Entry[]): string {
	const index = entries.find((e) => e.section === 'index');
	const lines: string[] = [];
	lines.push('# ChatKit');
	lines.push('');
	lines.push(
		`> ${index?.summary || 'One unified, typed API to receive and send messages across Telegram, WhatsApp (Baileys & Cloud API), Discord and Slack — a universal message envelope, capability descriptors and a built-in WhatsApp safety layer, for Node and Bun.'}`
	);
	lines.push('');
	for (const section of SECTION_ORDER) {
		const pages = entries.filter((e) => e.section === section);
		if (pages.length === 0) continue;
		lines.push(`## ${SECTION_TITLES[section]}`);
		lines.push('');
		for (const p of pages) {
			lines.push(`- [${p.title}](${p.url})${p.summary ? `: ${p.summary}` : ''}`);
		}
		lines.push('');
	}
	return lines.join('\n').trimEnd() + '\n';
}

function buildLlmsFullTxt(entries: Entry[]): string {
	const index = entries.find((e) => e.section === 'index');
	const lines: string[] = [];
	lines.push('# ChatKit — full documentation');
	lines.push('');
	lines.push(`> ${index?.summary || 'Every ChatKit doc page, full content, concatenated for a single-fetch agent context.'}`);
	lines.push('');
	for (const section of SECTION_ORDER) {
		const pages = entries.filter((e) => e.section === section);
		if (pages.length === 0) continue;
		lines.push(`## ${SECTION_TITLES[section]}`);
		lines.push('');
		for (const p of pages) {
			lines.push(`### ${p.title}`);
			lines.push('');
			lines.push(`URL: ${p.url}`);
			lines.push('');
			lines.push(p.content.trim());
			lines.push('');
		}
	}
	return lines.join('\n').trimEnd() + '\n';
}

function buildSitemap(entries: Entry[]): string {
	const urls = [SITE_URL, `${SITE_URL}/docs/examples`, ...entries.map((e) => e.url)];
	const unique = [...new Set(urls)];
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${unique
		.map((u) => `\t<url><loc>${u}</loc></url>`)
		.join('\n')}\n</urlset>\n`;
}

async function main(): Promise<void> {
	const entries = await collect();
	await mkdir(OUT_DIR, { recursive: true });
	await writeFile(join(OUT_DIR, 'llms.txt'), buildLlmsTxt(entries));
	await writeFile(join(OUT_DIR, 'llms-full.txt'), buildLlmsFullTxt(entries));
	await writeFile(join(OUT_DIR, 'sitemap.xml'), buildSitemap(entries));
	console.log(`generate-llms: wrote ${entries.length} doc pages to llms.txt / llms-full.txt / sitemap.xml`);
}

await main();
