import { Marked, type RendererThis } from 'marked';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import themeGithubDark from 'shiki/themes/github-dark.mjs';
import langTypescript from 'shiki/langs/typescript.mjs';
import langBash from 'shiki/langs/bash.mjs';

// Only the languages actually fenced in docs/**/*.md and examples READMEs
// (grep '^```[a-zA-Z]*' across docs/ and examples/*.md — only `ts` and `sh`
// appear) — importing every shiki language would bundle the entire language
// registry. Re-grep fenced languages before adding more.
let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
	return (highlighterPromise ??= createHighlighterCore({
		themes: [themeGithubDark],
		langs: [langTypescript, langBash],
		engine: createJavaScriptRegexEngine()
	}));
}

const LANG_ALIAS: Record<string, string> = {
	ts: 'typescript',
	sh: 'bash',
	shell: 'bash',
	bash: 'bash',
	typescript: 'typescript'
};

const HTML_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	'#39': "'",
	apos: "'"
};

function decodeEntities(text: string): string {
	return text.replace(/&(#39|[a-z]+);/g, (m, code) => HTML_ENTITIES[code] ?? m);
}

function slugify(text: string): string {
	return decodeEntities(text)
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/[`*_~]/g, '')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

export interface RenderResult {
	html: string;
	headings: { depth: number; text: string; id: string }[];
}

/** Render markdown to HTML with syntax-highlighted code fences and heading anchors. */
export async function renderMarkdown(source: string): Promise<RenderResult> {
	const highlighter = await getHighlighter();
	const headings: { depth: number; text: string; id: string }[] = [];
	const marked = new Marked();

	// Two headings on the same page can share a slug (e.g. "## Quick" and a
	// "### `quick`" subcommand both slugify to "quick") — dedupe with a
	// GitHub-style `-2`/`-3` suffix so `{#each headings as h (h.id)}` in
	// DocContent/Sidebar never receives a duplicate key (a real Svelte crash).
	const seenSlugs = new Map<string, number>();
	function uniqueSlug(base: string): string {
		const count = seenSlugs.get(base) ?? 0;
		seenSlugs.set(base, count + 1);
		return count === 0 ? base : `${base}-${count + 1}`;
	}

	marked.use({
		renderer: {
			// Must be a real `function`, not an arrow function — marked assigns
			// `this.renderer.parser = this` before calling it, and an arrow
			// function can't see that `this`.
			heading(this: RendererThis, { tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				const plain = decodeEntities(text.replace(/<[^>]+>/g, ''));
				const id = uniqueSlug(slugify(plain));
				headings.push({ depth, text: plain, id });
				return `<h${depth} id="${id}">${text}</h${depth}>\n`;
			},
			code({ text, lang }) {
				const shikiLang = lang ? LANG_ALIAS[lang.toLowerCase()] : undefined;
				if (shikiLang) {
					return highlighter.codeToHtml(text, { lang: shikiLang, theme: 'github-dark' });
				}
				const escaped = text
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				return `<pre class="shiki"><code>${escaped}</code></pre>`;
			}
		}
	});

	const html = await marked.parse(source);
	return { html, headings };
}

/** Highlight a standalone code snippet (no markdown parsing) — for editor-chrome panels. */
export async function highlightCode(code: string, lang: 'typescript' | 'bash'): Promise<string> {
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, { lang, theme: 'github-dark' });
}
